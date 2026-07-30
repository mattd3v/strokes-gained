// DataGolf feeds client.
//
// Prefers the same-origin /dg proxy provided by server.mjs. If the app is
// being served some other way, falls back to calling feeds.datagolf.com
// directly, which works only if DataGolf allows the cross-origin request.

import * as diagnostics from './diagnostics.js';

export const DIRECT_BASE = 'https://feeds.datagolf.com';
const CACHE_PREFIX = 'sg.cache.v1.';

/**
 * The proxy lives alongside the page, not at the domain root, so its URL is
 * resolved against the document base. That keeps the app working when it is
 * served from a subpath rather than `/`.
 */
function proxyUrl(path) {
  return new URL(`dg${path}`, document.baseURI);
}

let transportPromise = null;

/** Resolves to 'proxy' or 'direct'. Probed once per page load. */
export function detectTransport() {
  if (transportPromise) return transportPromise;
  transportPromise = (async () => {
    try {
      const res = await fetch(proxyUrl('/__health'), { cache: 'no-store' });
      if (res.ok) {
        const body = await res.json();
        if (body && body.ok) return 'proxy';
      }
    } catch {
      /* no local proxy, fall through */
    }
    return 'direct';
  })();
  return transportPromise;
}

export class DataGolfError extends Error {
  constructor(message, { status = null, endpoint = null } = {}) {
    super(message);
    this.name = 'DataGolfError';
    this.status = status;
    this.endpoint = endpoint;
  }
}

function cacheKey(endpoint, params) {
  const rest = { ...params };
  delete rest.key;
  const query = new URLSearchParams(rest).toString();
  return `${CACHE_PREFIX}${endpoint}${query ? `?${query}` : ''}`;
}

export function readCache(endpoint, params = {}) {
  try {
    const raw = localStorage.getItem(cacheKey(endpoint, params));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.ts !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(endpoint, params, data) {
  try {
    localStorage.setItem(
      cacheKey(endpoint, params),
      JSON.stringify({ ts: Date.now(), data }),
    );
  } catch {
    // Quota exceeded or storage disabled; caching is best effort.
  }
}

export function clearCache() {
  const doomed = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const k = localStorage.key(i);
    if (k && k.startsWith(CACHE_PREFIX)) doomed.push(k);
  }
  for (const k of doomed) localStorage.removeItem(k);
}

/**
 * DataGolf answers some errors with a plain-text body and a 200 status, so
 * the body has to be sniffed rather than trusting the status code.
 */
export function parseBody(text, endpoint, status, secrets = []) {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new DataGolfError('DataGolf returned an empty response.', { status, endpoint });
  }
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    // DataGolf echoes the request — key included — back in some error bodies,
    // and this message goes on screen, so it has to be redacted here rather
    // than only in the debug report.
    const message = diagnostics.redact(trimmed.slice(0, 300), secrets);
    throw new DataGolfError(
      /key/i.test(message)
        ? `DataGolf rejected the request: ${message}`
        : `DataGolf returned an unexpected response: ${message}`,
      { status, endpoint },
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new DataGolfError('Could not parse the DataGolf response as JSON.', { status, endpoint });
  }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.error) {
    throw new DataGolfError(diagnostics.redact(String(parsed.error), secrets), { status, endpoint });
  }
  return parsed;
}

/**
 * Fetches one endpoint. Returns { data, ts, stale }.
 * On network failure a cached copy is returned with stale: true; if there is
 * no cache the error propagates.
 */
export async function fetchEndpoint(endpoint, params, { apiKey, force = false, maxAgeMs = 0 } = {}) {
  const cached = readCache(endpoint, params);
  if (!force && cached && maxAgeMs > 0 && Date.now() - cached.ts < maxAgeMs) {
    diagnostics.record({ endpoint, network: false, ok: true, fromCache: true });
    return { data: cached.data, ts: cached.ts, stale: false, fromCache: true };
  }
  if (!apiKey) {
    if (cached) return { data: cached.data, ts: cached.ts, stale: true, fromCache: true };
    throw new DataGolfError('No DataGolf API key set.', { endpoint });
  }

  const transport = await detectTransport();
  const url = transport === 'proxy' ? proxyUrl(endpoint) : new URL(DIRECT_BASE + endpoint);
  for (const [k, v] of Object.entries({ file_format: 'json', ...params })) {
    if (v != null && v !== '') url.searchParams.set(k, String(v));
  }
  url.searchParams.set('key', apiKey);

  const started = Date.now();
  const fail = (message, extra = {}) => {
    diagnostics.record({
      endpoint,
      transport,
      ok: false,
      durationMs: Date.now() - started,
      error: diagnostics.redact(message, [apiKey]),
      ...extra,
    });
  };

  let res;
  try {
    res = await fetch(url, { cache: 'no-store' });
  } catch (err) {
    // fetch rejects identically for a CORS block and a dead network, so the
    // message has to name both possibilities rather than guess.
    const hint = transport === 'direct'
      ? ' The page is not served by the bundled local server, so this went straight to DataGolf. Either the network is down or DataGolf refused the cross-origin request. Diagnostics → Test connectivity will tell you which.'
      : ' The local proxy could not be reached.';
    fail(`${err.name}: ${err.message}.${hint}`);
    if (cached) return { data: cached.data, ts: cached.ts, stale: true, fromCache: true };
    throw new DataGolfError(`Network request failed.${hint}`, { endpoint });
  }

  const text = await res.text();
  const rateLimit = diagnostics.parseRateLimit(res.headers);
  const base_ = {
    endpoint,
    transport,
    status: res.status,
    durationMs: Date.now() - started,
    bytes: text.length,
    rateLimit,
    // Set by the local proxy: which rate-limit headers DataGolf actually sent.
    // Distinguishes "DataGolf reports no quota" from "we could not read it".
    upstreamHeaders: res.headers.get('x-sg-upstream-headers') || undefined,
  };

  if (!res.ok && !text.trim().startsWith('{')) {
    diagnostics.record({
      ...base_,
      ok: false,
      error: `HTTP ${res.status}`,
      bodySnippet: diagnostics.redact(text.slice(0, 500), [apiKey]),
    });
    if (cached) return { data: cached.data, ts: cached.ts, stale: true, fromCache: true };
    throw new DataGolfError(`DataGolf returned HTTP ${res.status}.`, { status: res.status, endpoint });
  }

  let data;
  try {
    data = parseBody(text, endpoint, res.status, [apiKey]);
  } catch (err) {
    diagnostics.record({
      ...base_,
      ok: false,
      error: diagnostics.redact(err.message, [apiKey]),
      bodySnippet: diagnostics.redact(text.slice(0, 500), [apiKey]),
    });
    throw err;
  }

  const quota = diagnostics.scanBodyForQuota(data);
  diagnostics.record({
    ...base_,
    ok: true,
    rateLimit: { ...rateLimit, ...quota },
  });

  writeCache(endpoint, params, data);
  return { data, ts: Date.now(), stale: false, fromCache: false };
}

/**
 * Attempts one direct, cross-origin request to DataGolf and reports what the
 * browser did with it. This is the only way to find out whether the app can
 * run without the local proxy — it depends on headers DataGolf chooses to
 * send, which cannot be known ahead of time.
 *
 * Costs one API request.
 */
export async function probeDirect(apiKey) {
  if (!apiKey) return { ok: false, verdict: 'no-key', message: 'Set an API key first.' };

  const url = new URL(`${DIRECT_BASE}/get-schedule`);
  url.searchParams.set('tour', 'pga');
  url.searchParams.set('file_format', 'json');
  url.searchParams.set('key', apiKey);

  const started = Date.now();
  try {
    const res = await fetch(url, { cache: 'no-store' });
    const text = await res.text();
    const rateLimit = diagnostics.parseRateLimit(res.headers);
    const readable = [...res.headers.keys()];

    diagnostics.record({
      endpoint: '/get-schedule (direct probe)',
      transport: 'direct',
      status: res.status,
      ok: res.ok,
      durationMs: Date.now() - started,
      bytes: text.length,
      rateLimit,
    });

    return {
      ok: res.ok,
      verdict: res.ok ? 'cors-allowed' : 'http-error',
      status: res.status,
      readableHeaders: readable,
      rateLimit,
      message: res.ok
        ? 'DataGolf allowed the cross-origin request. This app can run as a plain static page with no proxy.'
        : `The request went through but DataGolf answered HTTP ${res.status}.`,
    };
  } catch (err) {
    diagnostics.record({
      endpoint: '/get-schedule (direct probe)',
      transport: 'direct',
      ok: false,
      durationMs: Date.now() - started,
      error: `${err.name}: ${err.message}`,
    });
    return {
      ok: false,
      verdict: 'blocked',
      message: `The browser refused the direct request (${err.name}: ${err.message}). That is either a CORS block or no network. If the rest of the app works through the local proxy, it is CORS, and the proxy is required.`,
    };
  }
}

export const endpoints = {
  schedule: (tour) => ['/get-schedule', { tour }],
  field: (tour) => ['/field-updates', { tour }],
  skills: () => ['/preds/skill-ratings', { display: 'value' }],
  preTournament: (tour) => ['/preds/pre-tournament', { tour, odds_format: 'percent' }],
};

/**
 * Loads everything the board needs. Skill ratings are one global table, so
 * they are cached for longer than the field, which moves during the week.
 */
export async function loadAll({ apiKey, tour = 'pga', force = false }) {
  const results = {};
  const errors = {};

  const jobs = [
    ['field', ...endpoints.field(tour), 5 * 60 * 1000, true],
    ['skills', ...endpoints.skills(), 6 * 60 * 60 * 1000, true],
    ['schedule', ...endpoints.schedule(tour), 12 * 60 * 60 * 1000, false],
    ['preTournament', ...endpoints.preTournament(tour), 30 * 60 * 1000, false],
  ];

  await Promise.all(
    jobs.map(async ([name, endpoint, params, maxAgeMs, required]) => {
      try {
        results[name] = await fetchEndpoint(endpoint, params, { apiKey, force, maxAgeMs });
      } catch (err) {
        errors[name] = err;
        if (!required) results[name] = null;
      }
    }),
  );

  // The field and the skill table are both load-bearing; the schedule and
  // odds feeds are garnish and are allowed to fail quietly.
  if (errors.field || errors.skills) {
    throw errors.field || errors.skills;
  }
  return { results, errors };
}
