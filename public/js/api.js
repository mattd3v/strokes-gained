// DataGolf feeds client.
//
// Prefers the same-origin /dg proxy provided by server.mjs. If the app is
// being served some other way, falls back to calling feeds.datagolf.com
// directly, which works only if DataGolf allows the cross-origin request.

const DIRECT_BASE = 'https://feeds.datagolf.com';
const PROXY_BASE = '/dg';
const CACHE_PREFIX = 'sg.cache.v1.';

let transportPromise = null;

/** Resolves to 'proxy' or 'direct'. Probed once per page load. */
export function detectTransport() {
  if (transportPromise) return transportPromise;
  transportPromise = (async () => {
    try {
      const res = await fetch(`${PROXY_BASE}/__health`, { cache: 'no-store' });
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
function parseBody(text, endpoint, status) {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new DataGolfError('DataGolf returned an empty response.', { status, endpoint });
  }
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    const message = trimmed.slice(0, 300);
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
    throw new DataGolfError(String(parsed.error), { status, endpoint });
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
    return { data: cached.data, ts: cached.ts, stale: false, fromCache: true };
  }
  if (!apiKey) {
    if (cached) return { data: cached.data, ts: cached.ts, stale: true, fromCache: true };
    throw new DataGolfError('No DataGolf API key set.', { endpoint });
  }

  const transport = await detectTransport();
  const base = transport === 'proxy' ? PROXY_BASE : DIRECT_BASE;
  const url = new URL(base + endpoint, location.origin);
  for (const [k, v] of Object.entries({ file_format: 'json', ...params })) {
    if (v != null && v !== '') url.searchParams.set(k, String(v));
  }
  url.searchParams.set('key', apiKey);

  let res;
  try {
    res = await fetch(url, { cache: 'no-store' });
  } catch (err) {
    if (cached) return { data: cached.data, ts: cached.ts, stale: true, fromCache: true };
    const hint = transport === 'direct'
      ? ' The page is not being served by the bundled local server, so the request went straight to DataGolf and was probably blocked by the browser. Run `npm start` and open the app from there.'
      : '';
    throw new DataGolfError(`Network request failed.${hint}`, { endpoint });
  }

  const text = await res.text();
  if (!res.ok && !text.trim().startsWith('{')) {
    if (cached) return { data: cached.data, ts: cached.ts, stale: true, fromCache: true };
    throw new DataGolfError(`DataGolf returned HTTP ${res.status}.`, { status: res.status, endpoint });
  }

  const data = parseBody(text, endpoint, res.status);
  writeCache(endpoint, params, data);
  return { data, ts: Date.now(), stale: false, fromCache: false };
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
