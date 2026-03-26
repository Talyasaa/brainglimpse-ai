// BrainGlimpse.ai — Inspire Orchestrator
// Step 1: cache check  →  Step 2: Gemini parse  →  Step 3: curated images  →  return
// Full result cached 7 days in Redis.

import { Ratelimit } from '@upstash/ratelimit';
import { Redis }     from '@upstash/redis';
import { parsePrompt } from './parse.js';
import { getRedis }    from '../lib/redis.js';
import { hashKey }     from '../lib/hash.js';

const INSPIRE_TTL = 60 * 60 * 24 * 7; // 7 days

// ── Curated Unsplash image bank keyed by style keyword ──
// Each keyword maps to 3 high-quality images. Easy to expand.
const STYLE_IMAGES = {
  tropical:     [
    'https://images.unsplash.com/photo-1540541338287-41700207dee6?w=800&q=80',
    'https://images.unsplash.com/photo-1586105251261-72a756497a11?w=800&q=80',
    'https://images.unsplash.com/photo-1602002418816-5c0aeef426aa?w=800&q=80',
  ],
  resort:       [
    'https://images.unsplash.com/photo-1571003123894-1f0594d2b5d9?w=800&q=80',
    'https://images.unsplash.com/photo-1561501900-3701fa6a0864?w=800&q=80',
    'https://images.unsplash.com/photo-1582719508461-905c673771fd?w=800&q=80',
  ],
  minimalist:   [
    'https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=800&q=80',
    'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=800&q=80',
    'https://images.unsplash.com/photo-1616486338812-3dadae4b4ace?w=800&q=80',
  ],
  cozy:         [
    'https://images.unsplash.com/photo-1631049307264-da0ec9d70304?w=800&q=80',
    'https://images.unsplash.com/photo-1540518614846-7eded433c457?w=800&q=80',
    'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800&q=80',
  ],
  industrial:   [
    'https://images.unsplash.com/photo-1493552152660-f915ab47ae9d?w=800&q=80',
    'https://images.unsplash.com/photo-1536437075651-01d675529a6b?w=800&q=80',
    'https://images.unsplash.com/photo-1524758631624-e2822e304c36?w=800&q=80',
  ],
  bohemian:     [
    'https://images.unsplash.com/photo-1617104678098-de229db51175?w=800&q=80',
    'https://images.unsplash.com/photo-1600585152220-90363fe7e115?w=800&q=80',
    'https://images.unsplash.com/photo-1593696140826-c58b021acf8b?w=800&q=80',
  ],
  luxurious:    [
    'https://images.unsplash.com/photo-1631049552057-403cdb8f0658?w=800&q=80',
    'https://images.unsplash.com/photo-1615873968403-89e068629265?w=800&q=80',
    'https://images.unsplash.com/photo-1618221195710-dd6b41faaea6?w=800&q=80',
  ],
  scandinavian: [
    'https://images.unsplash.com/photo-1598928506311-c55ded91a20c?w=800&q=80',
    'https://images.unsplash.com/photo-1484101403633-562f891dc89a?w=800&q=80',
    'https://images.unsplash.com/photo-1600121848594-d8644e57abab?w=800&q=80',
  ],
  gaming:       [
    'https://images.unsplash.com/photo-1598550476439-6847785fcea6?w=800&q=80',
    'https://images.unsplash.com/photo-1593305841991-05c297ba4575?w=800&q=80',
    'https://images.unsplash.com/photo-1612287230202-1ff1d85d1bdf?w=800&q=80',
  ],
  aesthetic:    [
    'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800&q=80',
    'https://images.unsplash.com/photo-1629079447777-1e605162dc8d?w=800&q=80',
    'https://images.unsplash.com/photo-1614102073832-030967418971?w=800&q=80',
  ],
  modern:       [
    'https://images.unsplash.com/photo-1615529182904-14819c35db37?w=800&q=80',
    'https://images.unsplash.com/photo-1567016432779-094069958ea5?w=800&q=80',
    'https://images.unsplash.com/photo-1583847268964-b28dc8f51f92?w=800&q=80',
  ],
  rustic:       [
    'https://images.unsplash.com/photo-1600585152915-d208bec867a1?w=800&q=80',
    'https://images.unsplash.com/photo-1565183997392-2f6f122e5912?w=800&q=80',
    'https://images.unsplash.com/photo-1510798831971-661eb04b3739?w=800&q=80',
  ],
  // Fallback when no keyword matches
  default:      [
    'https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=800&q=80',
    'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=800&q=80',
    'https://images.unsplash.com/photo-1631049307264-da0ec9d70304?w=800&q=80',
    'https://images.unsplash.com/photo-1540541338287-41700207dee6?w=800&q=80',
  ],
};

function getInspirationImages(styleKeywords = []) {
  const seen   = new Set();
  const images = [];
  for (const kw of styleKeywords) {
    const bank = STYLE_IMAGES[kw.toLowerCase()] || [];
    for (const url of bank) {
      if (!seen.has(url)) { seen.add(url); images.push(url); }
    }
  }
  if (images.length === 0) {
    STYLE_IMAGES.default.forEach(url => images.push(url));
  }
  return images.slice(0, 6);
}

// ── CORS + security headers ──
const ALLOWED_ORIGINS = [
  'https://brainglimpse.ai',
  'https://www.brainglimpse.ai',
  ...(process.env.NODE_ENV === 'development' ? ['http://localhost:3000'] : []),
];

function setCors(req, res) {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

// ── Upstash rate limiter (shared instance) ──
let _ratelimit = null;
function getRatelimit() {
  if (_ratelimit) return _ratelimit;
  if (!process.env.UPSTASH_REDIS_REST_URL) return null;
  _ratelimit = new Ratelimit({
    redis:   Redis.fromEnv(),
    limiter: Ratelimit.slidingWindow(3, '60 s'),
    prefix:  'bg_inspire_rl',
  });
  return _ratelimit;
}

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed.' });

  // ── Rate limit ──
  const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown')
    .split(',')[0].trim();
  const rl = getRatelimit();
  if (rl) {
    const { success } = await rl.limit(ip);
    if (!success) {
      return res.status(429).json({ error: 'Too many requests. Please wait a minute and try again.' });
    }
  }

  // ── Input validation ──
  const prompt = (req.query.prompt || '').trim();
  if (!prompt)             return res.status(400).json({ error: 'A prompt is required.' });
  if (prompt.length > 300) return res.status(400).json({ error: 'Prompt must be 300 characters or fewer.' });

  // ── Full bundle cache check (7-day TTL) ──
  const redis    = getRedis();
  const cacheKey = `inspire:${hashKey(prompt)}`;
  if (redis) {
    const cached = await redis.get(cacheKey);
    if (cached) return res.status(200).json({ ...cached, cached: true });
  }

  if (!process.env.GEMINI_API_KEY) {
    console.error('[BrainGlimpse] GEMINI_API_KEY is not configured.');
    return res.status(500).json({ error: 'AI service is currently unavailable.' });
  }

  try {
    // ── Step 2: Gemini parse ──
    const parsed = await parsePrompt(prompt);

    // ── Step 3: Map style_keywords → curated images ──
    const inspiration_images = getInspirationImages(parsed.style_keywords);

    const result = {
      prompt,
      room_type:            parsed.room_type,
      style_keywords:       parsed.style_keywords,
      product_categories:   parsed.product_categories,
      amazon_search_queries: parsed.amazon_search_queries,
      intent_summary:       parsed.intent_summary,
      inspiration_images,
    };

    // ── Cache full bundle for 7 days ──
    if (redis) await redis.set(cacheKey, result, { ex: INSPIRE_TTL });

    return res.status(200).json(result);

  } catch (err) {
    console.error('[BrainGlimpse] Inspire error:', err.message);
    return res.status(500).json({ error: 'Our AI is currently overwhelmed, please try again in a minute.' });
  }
}
