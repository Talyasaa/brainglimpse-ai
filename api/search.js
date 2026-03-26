// BrainGlimpse.ai — Serverless API Route
// Proxies requests to RapidAPI's Real-Time Amazon Data API.
// Set USE_MOCK_DATA=true in env to skip the real API and return dummy data.

const MOCK_PRODUCTS = [
  {
    asin: 'B09G9FPHY6',
    product_title: 'FLEXISPOT Pro Standing Desk — Walnut Edition',
    product_price: '$179.99',
    product_star_rating: '4.8',
    product_num_ratings: '3,241',
    product_photo: 'https://images.unsplash.com/photo-1593640408182-31c228b5ec5b?w=600&q=80',
    product_category: 'Tech / Workspace',
  },
  {
    asin: 'B0BF2XLNGJ',
    product_title: 'Keychron Q1 Pro — QMK Wireless Mechanical Keyboard',
    product_price: '$199.99',
    product_star_rating: '4.7',
    product_num_ratings: '1,876',
    product_photo: 'https://images.unsplash.com/photo-1527864550417-7fd91fc51a46?w=600&q=80',
    product_category: 'Peripherals',
  },
  {
    asin: 'B08DY93SM2',
    product_title: 'BenQ ScreenBar Halo — Monitor LED Light Bar',
    product_price: '$179.00',
    product_star_rating: '4.6',
    product_num_ratings: '5,102',
    product_photo: 'https://images.unsplash.com/photo-1616763355548-1b606f439f86?w=600&q=80',
    product_category: 'Lighting',
  },
  {
    asin: 'B09NF5R6BC',
    product_title: 'Sony WH-1000XM5 — Industry Leading Noise Cancelling Headphones',
    product_price: '$279.99',
    product_star_rating: '4.9',
    product_num_ratings: '12,450',
    product_photo: 'https://images.unsplash.com/photo-1608043152269-423dbba4e7e1?w=600&q=80',
    product_category: 'Audio',
  },
  {
    asin: 'B09JQMJHXY',
    product_title: 'Leuchtturm1917 Hardcover Dot Grid Notebook — A5 Black',
    product_price: '$22.95',
    product_star_rating: '4.7',
    product_num_ratings: '8,930',
    product_photo: 'https://images.unsplash.com/photo-1586281380349-632531db7ed4?w=600&q=80',
    product_category: 'Stationery',
  },
  {
    asin: 'B07FK96F6S',
    product_title: 'Costa Farms Succulent Desk Collection — 4-Pack Live Plants',
    product_price: '$24.99',
    product_star_rating: '4.5',
    product_num_ratings: '2,318',
    product_photo: 'https://images.unsplash.com/photo-1545127398-14699f92334b?w=600&q=80',
    product_category: 'Decor',
  },
];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const { query } = req.query;
  if (!query || !query.trim()) {
    return res.status(400).json({ error: 'A search query is required.' });
  }

  // ── Mock mode: skip real API to protect rate limit quota ──
  if (process.env.USE_MOCK_DATA === 'true') {
    return res.status(200).json({ products: MOCK_PRODUCTS, mock: true });
  }

  // ── Live mode ──
  if (!process.env.RAPIDAPI_KEY) {
    return res.status(500).json({ error: 'RAPIDAPI_KEY environment variable is not set.' });
  }

  try {
    const url = new URL('https://real-time-amazon-data.p.rapidapi.com/search');
    url.searchParams.set('query', query.trim());
    url.searchParams.set('page', '1');
    url.searchParams.set('country', 'US');
    url.searchParams.set('sort_by', 'RELEVANCE');
    url.searchParams.set('product_condition', 'ALL');

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'x-rapidapi-key': process.env.RAPIDAPI_KEY,
        'x-rapidapi-host': 'real-time-amazon-data.p.rapidapi.com',
      },
    });

    // Graceful rate-limit handling
    if (response.status === 429) {
      return res.status(429).json({
        error: "You've hit the monthly API limit (100 requests). Set USE_MOCK_DATA=true or upgrade your RapidAPI plan.",
      });
    }

    if (!response.ok) {
      return res.status(response.status).json({ error: `Upstream API error: ${response.statusText}` });
    }

    const data = await response.json();

    if (data.status !== 'OK') {
      return res.status(502).json({ error: 'Unexpected response from data provider.' });
    }

    const products = (data.data?.products || []).slice(0, 6);
    return res.status(200).json({ products });

  } catch (err) {
    console.error('[BrainGlimpse API Error]', err);
    return res.status(500).json({ error: 'Internal server error. Please try again.' });
  }
}
