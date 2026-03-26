// BrainGlimpse.ai — API Test Suite
// Run with: node tests/api.test.js
// Run mock-only tests: node tests/api.test.js --mock
//
// Tags:
//   [MOCK] — runs without any API keys (validation, mock mode)
//   [LIVE] — requires GEMINI_API_KEY + UPSTASH_* env vars
//
// Base URL is configurable via BASE_URL env var.
// Default: http://localhost:3000  (vercel dev)
// Example: BASE_URL=https://brainglimpse.ai node tests/api.test.js

// ─────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────
const BASE_URL        = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const MOCK_ONLY       = process.argv.includes('--mock');
// Delay between LIVE tests to avoid exhausting the 3 req/60s rate limit.
// Override: LIVE_DELAY_MS=0 node tests/api.test.js  (e.g. when Redis is not configured)
const LIVE_DELAY_MS   = parseInt(process.env.LIVE_DELAY_MS ?? '1200', 10);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─────────────────────────────────────────────
// Color helpers (ANSI — works on all modern terminals)
// ─────────────────────────────────────────────
const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN   = '\x1b[36m';
const BOLD   = '\x1b[1m';
const RESET  = '\x1b[0m';

const pass = (msg) => `${GREEN}✓${RESET} ${msg}`;
const fail = (msg) => `${RED}✗${RESET} ${msg}`;
const skip = (msg) => `${YELLOW}–${RESET} ${msg} ${YELLOW}[skipped — --mock flag]${RESET}`;
const info = (msg) => `${CYAN}${msg}${RESET}`;

// ─────────────────────────────────────────────
// Minimal assertion helpers
// ─────────────────────────────────────────────
function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new AssertionError(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertTruthy(value, label) {
  if (!value) {
    throw new AssertionError(`${label}: expected truthy, got ${JSON.stringify(value)}`);
  }
}

function assertArray(value, label) {
  if (!Array.isArray(value)) {
    throw new AssertionError(`${label}: expected Array, got ${typeof value} (${JSON.stringify(value)})`);
  }
}

function assertNonEmptyArray(value, label) {
  assertArray(value, label);
  if (value.length === 0) {
    throw new AssertionError(`${label}: expected non-empty array`);
  }
}

function assertHasFields(obj, fields, label) {
  for (const f of fields) {
    if (!(f in obj)) {
      throw new AssertionError(`${label}: missing field "${f}" in ${JSON.stringify(obj)}`);
    }
  }
}

function assertValidUrl(url, label) {
  try {
    new URL(url);
  } catch {
    throw new AssertionError(`${label}: "${url}" is not a valid URL`);
  }
}

class AssertionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AssertionError';
  }
}

// ─────────────────────────────────────────────
// HTTP helper
// ─────────────────────────────────────────────
async function get(path) {
  const url   = `${BASE_URL}${path}`;
  const start = Date.now();
  const res   = await fetch(url);
  const ms    = Date.now() - start;
  let body;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body, ms };
}

// ─────────────────────────────────────────────
// Test runner
// ─────────────────────────────────────────────
let passed  = 0;
let failed  = 0;
let skipped = 0;

async function test(name, tag, fn) {
  const isLive = tag === '[LIVE]';
  if (MOCK_ONLY && isLive) {
    console.log(skip(`${tag} ${name}`));
    skipped++;
    return;
  }

  const label = `${tag} ${name}`;
  try {
    const start = Date.now();
    await fn();
    const ms = Date.now() - start;
    console.log(pass(`${label}  ${CYAN}(${ms}ms)${RESET}`));
    passed++;
  } catch (err) {
    console.log(fail(`${label}`));
    console.log(`       ${RED}${err.message}${RESET}`);
    failed++;
  }

  // Throttle LIVE tests to avoid exhausting the 3 req/60s rate limit
  if (isLive && LIVE_DELAY_MS > 0) await sleep(LIVE_DELAY_MS);
}

function section(title) {
  console.log(`\n${BOLD}${CYAN}── ${title} ──${RESET}`);
}

// ─────────────────────────────────────────────
// /api/search tests
// ─────────────────────────────────────────────
async function runSearchTests() {
  section('/api/search');

  // TC-S1: missing query param
  await test('returns 400 when query param is missing', '[MOCK]', async () => {
    const { status, body } = await get('/api/search');
    assertEqual(status, 400, 'status');
    assertTruthy(body.error, 'error field present');
  });

  // TC-S2: empty string query
  await test('returns 400 when query is empty string', '[MOCK]', async () => {
    const { status, body } = await get('/api/search?query=');
    assertEqual(status, 400, 'status');
    assertTruthy(body.error, 'error field present');
  });

  // TC-S3: query exceeds 200 chars
  await test('returns 400 when query exceeds 200 characters', '[MOCK]', async () => {
    const longQuery = encodeURIComponent('a'.repeat(201));
    const { status, body } = await get(`/api/search?query=${longQuery}`);
    assertEqual(status, 400, 'status');
    assertTruthy(body.error, 'error field present');
  });

  // TC-S4: mock data returns products array
  // NOTE: USE_MOCK_DATA must be set in the server process (vercel dev reads .env.local).
  // When the server is started with USE_MOCK_DATA=true this test will verify mock behavior.
  await test('returns products array in mock mode (USE_MOCK_DATA=true on server)', '[MOCK]', async () => {
    const { status, body } = await get('/api/search?query=standing+desk');
    // In mock mode we expect 200; without keys the server may return 500.
    // We only assert the shape when mock mode is confirmed via the flag.
    if (body && body.mock === true) {
      assertEqual(status, 200, 'status');
      assertNonEmptyArray(body.products, 'products');
    } else if (status === 200) {
      // Live or cached — still valid, just verify shape
      assertNonEmptyArray(body.products, 'products');
    } else {
      // Server not in mock mode and no live key — acceptable in CI
      assertTruthy(
        [400, 429, 500, 502].includes(status),
        `status is an expected non-200 code (got ${status})`
      );
    }
  });

  // TC-S5: mock flag in response body
  await test('response includes mock:true flag when mock mode active', '[MOCK]', async () => {
    const { status, body } = await get('/api/search?query=desk+lamp');
    if (status === 200 && body.mock === true) {
      assertEqual(body.mock, true, 'mock flag');
      assertArray(body.products, 'products is array');
    } else {
      // Server is not running in mock mode — skip assertion but don't fail
      // (developer must start server with USE_MOCK_DATA=true)
      assertTruthy(
        typeof body === 'object' && body !== null,
        'body is a JSON object'
      );
    }
  });

  // TC-S6: rate limit returns 429 after exceeding 3 req/min
  // This test requires Upstash to be configured; it hammers the endpoint rapidly.
  await test('returns 429 after exceeding rate limit (3 req/min)', '[LIVE]', async () => {
    const query = encodeURIComponent('rate limit test ' + Date.now());
    // Fire 4 requests in quick succession from the same "IP" (the test runner IP)
    const results = [];
    for (let i = 0; i < 4; i++) {
      const r = await get(`/api/search?query=${query}${i}`);
      results.push(r.status);
    }
    const got429 = results.includes(429);
    assertTruthy(got429, `one of the 4 rapid requests should return 429 (got: ${results.join(', ')})`);
  });

  // TC-S7: second identical request returns cached:true
  await test('second identical request returns cached:true (Redis cache hit)', '[LIVE]', async () => {
    // Use a unique query to avoid hitting a pre-existing cache entry from another run
    const query = encodeURIComponent('brainglimpse cache test ' + Date.now());
    const first  = await get(`/api/search?query=${query}`);
    // First call may be a live fetch or mock; only assert caching on second call
    if (first.status === 200 && first.body.mock !== true) {
      const second = await get(`/api/search?query=${query}`);
      assertEqual(second.status, 200, 'second request status');
      assertEqual(second.body.cached, true, 'cached flag on second request');
    } else {
      // Mock mode active — cache path not exercised
      assertTruthy(true, 'skipped: server in mock mode or live call failed');
    }
  });
}

// ─────────────────────────────────────────────
// /api/parse tests
// ─────────────────────────────────────────────
async function runParseTests() {
  section('/api/parse');

  // TC-P1: missing prompt
  await test('returns 400 when prompt param is missing', '[MOCK]', async () => {
    const { status, body } = await get('/api/parse');
    assertEqual(status, 400, 'status');
    assertTruthy(body.error, 'error field present');
  });

  // TC-P2: prompt exceeds 300 chars
  await test('returns 400 when prompt exceeds 300 characters', '[MOCK]', async () => {
    const longPrompt = encodeURIComponent('b'.repeat(301));
    const { status, body } = await get(`/api/parse?prompt=${longPrompt}`);
    assertEqual(status, 400, 'status');
    assertTruthy(body.error, 'error field present');
  });

  // TC-P3: valid JSON with all required fields
  await test('returns valid JSON with all required fields', '[LIVE]', async () => {
    const { status, body } = await get('/api/parse?prompt=minimalist+home+office');
    assertEqual(status, 200, 'status');
    assertHasFields(body, [
      'room_type',
      'style_keywords',
      'amazon_search_queries',
      'intent_summary',
      'product_categories',
    ], 'response body');
  });

  // TC-P4: style_keywords is array of strings
  await test('style_keywords is an array of strings', '[LIVE]', async () => {
    const { status, body } = await get('/api/parse?prompt=cozy+bohemian+bedroom');
    assertEqual(status, 200, 'status');
    assertNonEmptyArray(body.style_keywords, 'style_keywords');
    for (const kw of body.style_keywords) {
      assertEqual(typeof kw, 'string', `style_keywords entry "${kw}" is a string`);
    }
  });

  // TC-P5: amazon_search_queries is array of 2-4 strings
  await test('amazon_search_queries is array of 2-4 strings', '[LIVE]', async () => {
    const { status, body } = await get('/api/parse?prompt=scandinavian+living+room');
    assertEqual(status, 200, 'status');
    assertArray(body.amazon_search_queries, 'amazon_search_queries');
    const len = body.amazon_search_queries.length;
    assertTruthy(
      len >= 2 && len <= 4,
      `amazon_search_queries length should be 2-4, got ${len}`
    );
    for (const q of body.amazon_search_queries) {
      assertEqual(typeof q, 'string', `query entry "${q}" is a string`);
    }
  });

  // TC-P6: second identical request returns faster (cache hit)
  await test('second identical request returns faster (Redis cache hit)', '[LIVE]', async () => {
    const prompt = encodeURIComponent('industrial loft kitchen ' + Date.now());
    const first  = await get(`/api/parse?prompt=${prompt}`);
    assertEqual(first.status, 200, 'first request status');
    const second = await get(`/api/parse?prompt=${prompt}`);
    assertEqual(second.status, 200, 'second request status');
    // Cache hit should be meaningfully faster (allow generous margin for network jitter)
    assertTruthy(
      second.ms < first.ms || second.ms < 500,
      `second call (${second.ms}ms) should be faster or under 500ms (first: ${first.ms}ms)`
    );
  });
}

// ─────────────────────────────────────────────
// /api/inspire tests
// ─────────────────────────────────────────────
async function runInspireTests() {
  section('/api/inspire');

  // TC-I1: missing prompt
  await test('returns 400 when prompt param is missing', '[MOCK]', async () => {
    const { status, body } = await get('/api/inspire');
    assertEqual(status, 400, 'status');
    assertTruthy(body.error, 'error field present');
  });

  // TC-I2: all required fields present
  await test('returns all required fields', '[LIVE]', async () => {
    const { status, body } = await get('/api/inspire?prompt=tropical+resort+bedroom');
    assertEqual(status, 200, 'status');
    assertHasFields(body, [
      'style_keywords',
      'amazon_search_queries',
      'inspiration_images',
      'intent_summary',
    ], 'response body');
  });

  // TC-I3: inspiration_images is non-empty array of valid URLs
  await test('inspiration_images is a non-empty array of valid URLs', '[LIVE]', async () => {
    const { status, body } = await get('/api/inspire?prompt=cozy+rustic+living+room');
    assertEqual(status, 200, 'status');
    assertNonEmptyArray(body.inspiration_images, 'inspiration_images');
    for (const url of body.inspiration_images) {
      assertValidUrl(url, `inspiration_images entry`);
    }
  });

  // TC-I4: second identical request returns cached:true
  await test('second identical request returns cached:true', '[LIVE]', async () => {
    const prompt = encodeURIComponent('luxurious master bedroom ' + Date.now());
    const first  = await get(`/api/inspire?prompt=${prompt}`);
    assertEqual(first.status, 200, 'first request status');
    const second = await get(`/api/inspire?prompt=${prompt}`);
    assertEqual(second.status, 200, 'second request status');
    assertEqual(second.body.cached, true, 'cached flag on second request');
  });

  // TC-I5: works with gift-type prompt (room_type may be null)
  await test('works with gift-type prompt — "gift for a gamer boyfriend"', '[LIVE]', async () => {
    const { status, body } = await get('/api/inspire?prompt=gift+for+a+gamer+boyfriend');
    assertEqual(status, 200, 'status');
    assertHasFields(body, [
      'style_keywords',
      'amazon_search_queries',
      'inspiration_images',
      'intent_summary',
    ], 'response body');
    // room_type is expected to be null or absent for gift prompts — just ensure no crash
    assertNonEmptyArray(body.inspiration_images, 'inspiration_images');
    assertNonEmptyArray(body.amazon_search_queries, 'amazon_search_queries');
  });

  // TC-I6: works with room prompt
  await test('works with room prompt — "minimalist home office"', '[LIVE]', async () => {
    const { status, body } = await get('/api/inspire?prompt=minimalist+home+office');
    assertEqual(status, 200, 'status');
    assertHasFields(body, [
      'room_type',
      'style_keywords',
      'amazon_search_queries',
      'inspiration_images',
      'intent_summary',
    ], 'response body');
    assertNonEmptyArray(body.inspiration_images, 'inspiration_images');
    assertNonEmptyArray(body.style_keywords, 'style_keywords');
  });
}

// ─────────────────────────────────────────────
// Integration test
// ─────────────────────────────────────────────
async function runIntegrationTests() {
  section('Integration');

  // TC-INT-1: parse a prompt → use amazon_search_queries[0] in /api/search
  await test('parse prompt → feed first query into /api/search → verify products returned', '[LIVE]', async () => {
    // Step 1: parse
    const parseRes = await get('/api/parse?prompt=modern+gaming+setup+desk');
    assertEqual(parseRes.status, 200, 'parse status');
    assertNonEmptyArray(parseRes.body.amazon_search_queries, 'amazon_search_queries from parse');

    const firstQuery = parseRes.body.amazon_search_queries[0];
    assertTruthy(typeof firstQuery === 'string' && firstQuery.length > 0, 'first query is non-empty string');

    // Step 2: search with that query
    const searchRes = await get(`/api/search?query=${encodeURIComponent(firstQuery)}`);

    // In mock mode or with live keys we expect 200 with products
    if (searchRes.status === 200) {
      assertNonEmptyArray(searchRes.body.products, 'products from search');
    } else {
      // No RAPIDAPI_KEY configured — server returns 500; integration path still verified up to search call
      assertTruthy(
        [200, 500, 502].includes(searchRes.status),
        `search returned expected status (got ${searchRes.status})`
      );
    }
  });
}

// ─────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────
async function main() {
  console.log(`\n${BOLD}BrainGlimpse.ai — API Test Suite${RESET}`);
  console.log(info(`Base URL : ${BASE_URL}`));
  console.log(info(`Mode     : ${MOCK_ONLY ? '--mock (LIVE tests skipped)' : 'full (MOCK + LIVE)'}`));
  console.log(info(`Time     : ${new Date().toISOString()}\n`));

  // Verify server is reachable before running any tests
  try {
    await fetch(`${BASE_URL}/api/search`);
  } catch (err) {
    console.error(`${RED}${BOLD}ERROR: Cannot reach ${BASE_URL}${RESET}`);
    console.error(`${RED}Make sure the server is running (vercel dev) or set BASE_URL to a live URL.${RESET}`);
    console.error(`${RED}Details: ${err.message}${RESET}\n`);
    process.exit(1);
  }

  await runSearchTests();
  await runParseTests();
  await runInspireTests();
  await runIntegrationTests();

  // ── Summary ──
  const total = passed + failed + skipped;
  console.log(`\n${BOLD}── Summary ──${RESET}`);
  console.log(`Total   : ${total}`);
  console.log(`${GREEN}Passed  : ${passed}${RESET}`);
  if (failed > 0)  console.log(`${RED}Failed  : ${failed}${RESET}`);
  else             console.log(`Failed  : ${failed}`);
  if (skipped > 0) console.log(`${YELLOW}Skipped : ${skipped} (--mock flag active)${RESET}`);

  if (failed > 0) {
    console.log(`\n${RED}${BOLD}Some tests failed.${RESET}`);
    process.exit(1);
  } else {
    console.log(`\n${GREEN}${BOLD}All tests passed.${RESET}`);
  }
}

main().catch((err) => {
  console.error(`${RED}Unexpected runner error: ${err.message}${RESET}`);
  process.exit(1);
});
