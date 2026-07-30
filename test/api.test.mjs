import test from 'node:test';
import assert from 'node:assert/strict';

// api.js pulls in diagnostics.js, which reads localStorage at import time.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.location = { origin: 'http://127.0.0.1:5173' };

const { parseBody, DataGolfError } = await import('../public/js/api.js');

const KEY = 'live-key-9f8a7b6c';

test('parseBody returns parsed JSON for a good response', () => {
  const data = parseBody('{"event_name":"Test Open","field":[]}', '/field-updates', 200);
  assert.equal(data.event_name, 'Test Open');
});

test('parseBody accepts a top-level array', () => {
  assert.deepEqual(parseBody('[1,2]', '/x', 200), [1, 2]);
});

test('parseBody rejects an empty body', () => {
  assert.throws(() => parseBody('   ', '/x', 200), DataGolfError);
});

test('parseBody surfaces a plain-text rejection that arrived with HTTP 200', () => {
  assert.throws(
    () => parseBody('Invalid key. Please contact support.', '/preds/skill-ratings', 200),
    (err) => err instanceof DataGolfError && /rejected the request/.test(err.message),
  );
});

test('parseBody redacts the key from an error DataGolf echoes back', () => {
  let thrown;
  try {
    parseBody(`Invalid key: ${KEY} is not authorised.`, '/x', 200, [KEY]);
  } catch (err) {
    thrown = err;
  }
  assert.ok(thrown, 'should have thrown');
  assert.ok(!thrown.message.includes(KEY), 'the on-screen message must not contain the key');
  assert.ok(thrown.message.includes('«API-KEY»'));
});

test('parseBody redacts a key echoed inside a URL even without the key on hand', () => {
  let thrown;
  try {
    parseBody('Bad request: /preds/skill-ratings?key=abc123def&display=value', '/x', 200);
  } catch (err) {
    thrown = err;
  }
  assert.ok(!thrown.message.includes('abc123def'));
});

test('parseBody redacts a JSON error field too', () => {
  let thrown;
  try {
    parseBody(JSON.stringify({ error: `key ${KEY} expired` }), '/x', 200, [KEY]);
  } catch (err) {
    thrown = err;
  }
  assert.ok(thrown instanceof DataGolfError);
  assert.ok(!thrown.message.includes(KEY));
});

test('parseBody reports unparseable JSON distinctly', () => {
  assert.throws(
    () => parseBody('{not json', '/x', 200),
    (err) => /parse/i.test(err.message),
  );
});
