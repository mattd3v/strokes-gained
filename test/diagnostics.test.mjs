import test from 'node:test';
import assert from 'node:assert/strict';

// diagnostics.js touches localStorage at import time.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.location = { origin: 'http://127.0.0.1:5173' };
// Node 22 defines navigator as a getter-only global.
Object.defineProperty(globalThis, 'navigator', {
  value: { userAgent: 'test-agent', onLine: true },
  configurable: true,
});

const d = await import('../public/js/diagnostics.js');

test.beforeEach(() => d.clearLog());

test('redact removes the literal key', () => {
  const out = d.redact('failed for key abcd1234secret here', ['abcd1234secret']);
  assert.equal(out, 'failed for key «API-KEY» here');
});

test('redact removes key query parameters even for an unknown key', () => {
  const out = d.redact('GET https://feeds.datagolf.com/x?tour=pga&key=zzz999 failed', []);
  assert.ok(!out.includes('zzz999'));
  assert.ok(out.includes('key=«API-KEY»'));
});

test('redact ignores implausibly short secrets to avoid mangling text', () => {
  assert.equal(d.redact('a big cat', ['a']), 'a big cat');
});

test('redact handles null and undefined', () => {
  assert.equal(d.redact(null), null);
  assert.equal(d.redact(undefined), undefined);
});

test('stats separates network requests from cache hits', () => {
  d.record({ endpoint: '/a', network: true, ok: true });
  d.record({ endpoint: '/b', network: true, ok: false, error: 'boom' });
  d.record({ endpoint: '/c', network: false, ok: true });

  const s = d.stats();
  assert.equal(s.total, 2, 'cache hits are not requests');
  assert.equal(s.cacheHits, 1);
  assert.equal(s.errors, 1);
  assert.equal(s.lastMinute, 2);
});

test('stats windows exclude older requests', () => {
  const now = Date.now();
  d.record({ ts: now - 90 * 60_000, endpoint: '/old', network: true, ok: true });
  d.record({ ts: now - 90_000, endpoint: '/recent', network: true, ok: true });
  d.record({ ts: now, endpoint: '/now', network: true, ok: true });

  const s = d.stats(now);
  assert.equal(s.total, 3);
  assert.equal(s.lastHour, 2);
  assert.equal(s.lastMinute, 1);
});

test('buckets place requests in the right minute, newest last', () => {
  const now = Date.now();
  d.record({ ts: now, network: true, ok: true });
  d.record({ ts: now, network: true, ok: true });
  d.record({ ts: now - 3 * 60_000, network: true, ok: true });
  d.record({ ts: now - 99 * 60_000, network: true, ok: true });

  const b = d.buckets(30, now);
  assert.equal(b.length, 30);
  assert.equal(b[29], 2, 'current minute');
  assert.equal(b[26], 1, 'three minutes ago');
  assert.equal(b.reduce((a, x) => a + x, 0), 3, 'the 99-minute-old request falls outside the window');
});

test('parseRateLimit pulls known headers and ignores the rest', () => {
  const headers = new Map([
    ['x-ratelimit-remaining', '412'],
    ['x-ratelimit-limit', '5000'],
    ['content-type', 'application/json'],
  ]);
  const parsed = d.parseRateLimit({ get: (k) => headers.get(k) ?? null });
  assert.deepEqual(parsed, { 'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': '412' });
});

test('parseRateLimit tolerates a missing Headers object', () => {
  assert.deepEqual(d.parseRateLimit(null), {});
});

test('latestRateLimit returns the most recent reported values', () => {
  d.record({ endpoint: '/a', network: true, ok: true, rateLimit: { 'x-ratelimit-remaining': '100' } });
  d.record({ endpoint: '/b', network: true, ok: true, rateLimit: {} });
  d.record({ endpoint: '/c', network: true, ok: true, rateLimit: { 'x-ratelimit-remaining': '98' } });

  const rl = d.latestRateLimit();
  assert.equal(rl['x-ratelimit-remaining'], '98');
  assert.equal(rl.endpoint, '/c');
});

test('latestRateLimit is null when nothing reported limits', () => {
  d.record({ endpoint: '/a', network: true, ok: true, rateLimit: {} });
  assert.equal(d.latestRateLimit(), null);
});

test('scanBodyForQuota finds quota-shaped fields only', () => {
  assert.deepEqual(
    d.scanBodyForQuota({ requests_remaining: 47, event_name: 'Open', players: [] }),
    { requests_remaining: 47 },
  );
  assert.deepEqual(d.scanBodyForQuota([1, 2]), {});
  assert.deepEqual(d.scanBodyForQuota(null), {});
});

test('describeShape summarises a feed payload', () => {
  const shape = d.describeShape({
    event_name: 'Test Open',
    current_round: 1,
    field: [{ dg_id: 1, player_name: 'A, B', dk_salary: 9000 }],
  });
  assert.ok(shape.includes('event_name: string'));
  assert.ok(shape.includes('array(1)'));
  assert.ok(shape.includes('dg_id'));
});

test('the debug report never contains the API key', () => {
  const key = 'supersecretkey123';
  d.record({
    endpoint: '/preds/skill-ratings',
    network: true,
    ok: false,
    status: 401,
    error: `rejected for key ${key}`,
    bodySnippet: `Invalid key: ${key}`,
  });
  d.setFeedShapes({ field: 'array(0)' });

  const report = d.buildReport({
    settings: { tour: 'pga', mode: 'z', weights: { sg_app: 1 } },
    transport: 'proxy',
    secrets: [key],
  });

  assert.ok(!report.includes(key), 'key must not appear anywhere in the report');
  assert.ok(report.includes('«API-KEY»'));
  assert.ok(report.includes('/preds/skill-ratings'));
  assert.ok(report.includes('401'));
});

test('the report redacts a key even if the caller forgets to pass it', () => {
  d.record({
    endpoint: '/x',
    network: true,
    ok: false,
    error: 'GET https://feeds.datagolf.com/x?key=leaked-value-here failed',
  });
  const report = d.buildReport({ transport: 'direct' });
  assert.ok(!report.includes('leaked-value-here'));
});

test('the report explains why limits are missing in direct mode', () => {
  const report = d.buildReport({ transport: 'direct' });
  assert.ok(/Access-Control-Expose-Headers/.test(report));
});

test('the report includes category coverage when data is loaded', () => {
  const report = d.buildReport({
    transport: 'proxy',
    dataSummary: {
      event: 'Test Open',
      fieldSize: 156,
      missingSkill: 4,
      oddsModel: 'baseline_history_fit',
      coverage: [['APP', 152, '-0.40', '1.10']],
    },
  });
  assert.ok(report.includes('Test Open'));
  assert.ok(report.includes('| APP | 152 | -0.40 | 1.10 |'));
});

test('the log is capped so it cannot grow without bound', () => {
  for (let i = 0; i < 400; i += 1) d.record({ endpoint: `/e${i}`, network: true, ok: true });
  assert.ok(d.getEntries().length <= 300);
  assert.equal(d.getEntries().at(-1).endpoint, '/e399');
});
