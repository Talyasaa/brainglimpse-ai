// BrainGlimpse.ai — LLM Prompt Parser (Gemini 1.5 Flash)
// Converts a free-text user vibe into structured search data.
// Results are cached in Redis for 30 days.

import { GoogleGenerativeAI } from '@google/generative-ai';
import { getRedis }           from '../lib/redis.js';
import { hashKey }            from '../lib/hash.js';

const PARSE_TTL = 60 * 60 * 24 * 30; // 30 days

const SYSTEM_PROMPT = `You are a shopping intent parser for an AI-powered visual commerce platform.
Given a user's free-text vibe or idea, extract structured data to power product discovery.

Return ONLY a valid JSON object — no markdown, no explanation — with exactly these fields:

{
  "room_type": string | null,           // e.g. "bedroom", "kitchen", "office", null for gifts/personal
  "style_keywords": string[],           // 3-5 mood/aesthetic adjectives (e.g. ["tropical","resort","airy"])
  "product_categories": string[],       // 2-4 product types (e.g. ["bedding","furniture","wall art"])
  "amazon_search_queries": string[],    // 3-4 specific, Amazon-searchable queries
  "intent_summary": string              // one sentence: what is the user actually trying to do?
}

Rules:
- amazon_search_queries must be specific enough to return real Amazon results (include materials, colors, styles)
- style_keywords should capture the visual/emotional vibe, not product names
- Keep intent_summary concise and in plain English
- The user may write in any language. Always output amazon_search_queries in English.
- style_keywords must always be in English (used for image matching).
- intent_summary should be in the same language the user wrote in.`;

export async function parsePrompt(prompt) {
  const redis = getRedis();
  const key   = `parse:${hashKey(prompt)}`;

  // ── Cache check ──
  if (redis) {
    const cached = await redis.get(key);
    if (cached) return cached;
  }

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

  const result = await model.generateContent(
    `${SYSTEM_PROMPT}\n\nUser prompt: "${prompt}"`
  );

  const raw    = result.response.text().replace(/```json\n?|\n?```/g, '').trim();
  const parsed = JSON.parse(raw);

  // ── Cache result for 30 days ──
  if (redis) await redis.set(key, parsed, { ex: PARSE_TTL });

  return parsed;
}

// ── HTTP endpoint (useful for debugging / future direct use) ──
export default async function handler(req, res) {
  const origin = req.headers.origin;
  const ALLOWED = [
    'https://brainglimpse.ai',
    'https://www.brainglimpse.ai',
    ...(process.env.NODE_ENV === 'development' ? ['http://localhost:3000'] : []),
  ];
  if (ALLOWED.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed.' });

  const prompt = (req.query.prompt || '').trim();
  if (!prompt)          return res.status(400).json({ error: 'A prompt is required.' });
  if (prompt.length > 300) return res.status(400).json({ error: 'Prompt must be 300 characters or fewer.' });

  if (!process.env.GEMINI_API_KEY) {
    console.error('[BrainGlimpse] GEMINI_API_KEY is not configured.');
    return res.status(500).json({ error: 'AI service is currently unavailable.' });
  }

  try {
    const parsed = await parsePrompt(prompt);
    return res.status(200).json(parsed);
  } catch (err) {
    console.error('[BrainGlimpse] Parse error:', err.message);
    return res.status(500).json({ error: 'Our AI is currently overwhelmed, please try again in a minute.' });
  }
}
