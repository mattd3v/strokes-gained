// Request accounting, error capture and the copyable debug report.
//
// Nothing here ever stores the API key: callers redact before recording, and
// buildReport() redacts again on the way out as a backstop.

const LOG_KEY = 'sg.log.v1';
const MAX_ENTRIES = 300;
const APP_VERSION = '0.1.0';

/** Header names worth showing if a server happens to send them. */
export const RATE_LIMIT_HEADERS = [
  'x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset', 'x-ratelimit-used',
  'ratelimit-limit', 'ratelimit-remaining', 'ratelimit-reset', 'ratelimit-policy',
  'x-rate-limit-limit', 'x-rate-limit-remaining', 'x-rate-limit-reset',
  'x-requests-remaining', 'x-quota-remaining', 'retry-after',
];

let entries = [];
let feedShapes = {};
const listeners = new Set();

try {
  const raw = JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
  if (Array.isArray(raw)) entries = raw.slice(-MAX_ENTRIES);
} catch {
  entries = [];
}

function persist() {
  try {
    localStorage.setItem(LOG_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
  } catch {
    // Log persistence is best effort.
  }
}

function notify() {
  for (const fn of listeners) {
    try { fn(); } catch { /* a broken listener must not break recording */ }
  }
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Replaces secrets with a placeholder. Handles both the literal key and any
 * `key=` query parameter, because DataGolf sometimes echoes the request URL
 * back inside an error message.
 */
export function redact(text, secrets = []) {
  if (text == null) return text;
  let out = String(text);
  for (const secret of secrets) {
    if (secret && secret.length >= 4) {
      out = out.split(secret).join('«API-KEY»');
    }
  }
  return out.replace(/([?&]key=)[^&\s"']+/gi, '$1«API-KEY»');
}

/**
 * Records one request attempt. `network: false` marks a cache hit, which is
 * tracked but does not count against the API quota.
 */
export function record(entry) {
  entries.push({
    ts: Date.now(),
    network: true,
    ok: false,
    ...entry,
  });
  if (entries.length > MAX_ENTRIES) entries = entries.slice(-MAX_ENTRIES);
  persist();
  notify();
}

export function getEntries() {
  return entries.slice();
}

export function clearLog() {
  entries = [];
  persist();
  notify();
}

export function setFeedShapes(shapes) {
  feedShapes = shapes || {};
  notify();
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function stats(now = Date.now()) {
  const network = entries.filter((e) => e.network);
  const since = (ms) => network.filter((e) => now - e.ts < ms).length;
  return {
    total: network.length,
    lastMinute: since(60_000),
    lastHour: since(3_600_000),
    today: network.filter((e) => e.ts >= startOfToday()).length,
    cacheHits: entries.filter((e) => !e.network).length,
    errors: network.filter((e) => !e.ok).length,
    oldest: network.length ? network[0].ts : null,
  };
}

/** Requests per minute for the last `minutes`, oldest bucket first. */
export function buckets(minutes = 30, now = Date.now()) {
  const out = new Array(minutes).fill(0);
  for (const entry of entries) {
    if (!entry.network) continue;
    const age = now - entry.ts;
    if (age < 0 || age >= minutes * 60_000) continue;
    const index = minutes - 1 - Math.floor(age / 60_000);
    out[index] += 1;
  }
  return out;
}

/** The most recent response that carried any rate-limit header. */
export function latestRateLimit() {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const rl = entries[i].rateLimit;
    if (rl && Object.keys(rl).length) return { ...rl, ts: entries[i].ts, endpoint: entries[i].endpoint };
  }
  return null;
}

export function recentErrors(limit = 10) {
  return entries.filter((e) => e.network && !e.ok).slice(-limit).reverse();
}

/** Pulls whatever rate-limit headers a Headers object actually exposes. */
export function parseRateLimit(headers) {
  const out = {};
  if (!headers || typeof headers.get !== 'function') return out;
  for (const name of RATE_LIMIT_HEADERS) {
    const value = headers.get(name);
    if (value != null && value !== '') out[name] = value;
  }
  return out;
}

/**
 * Some APIs report quota in the response body rather than in headers. This
 * looks for likely-looking top-level fields so they show up in the report even
 * though the code does not otherwise use them.
 */
export function scanBodyForQuota(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  const out = {};
  for (const [key, value] of Object.entries(data)) {
    if (typeof value !== 'number' && typeof value !== 'string') continue;
    if (/limit|quota|remaining|usage|credits|calls/i.test(key)) out[key] = value;
  }
  return out;
}

/** A one-line summary of an unknown payload's shape, for bug reports. */
export function describeShape(value, { maxKeys = 40, depth = 0 } = {}) {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) {
    const sample = value.find((v) => v && typeof v === 'object');
    const inner = sample && depth < 2
      ? ` of { ${Object.keys(sample).slice(0, maxKeys).join(', ')} }`
      : '';
    return `array(${value.length})${inner}`;
  }
  if (typeof value !== 'object') return typeof value;

  const parts = Object.entries(value).slice(0, maxKeys).map(([key, v]) => {
    if (Array.isArray(v) || (v && typeof v === 'object')) {
      return `${key}: ${describeShape(v, { maxKeys: 12, depth: depth + 1 })}`;
    }
    return `${key}: ${typeof v}`;
  });
  return `{ ${parts.join('; ')} }`;
}

function isoOrDash(ts) {
  return ts ? new Date(ts).toISOString() : '—';
}

function table(header, rows) {
  if (!rows.length) return '_none_\n';
  const lines = [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${r.join(' | ')} |`),
  ];
  return `${lines.join('\n')}\n`;
}

/**
 * Builds the markdown debug report. `secrets` are redacted from every field,
 * including anything already stored in the log.
 */
export function buildReport({ settings = {}, transport = 'unknown', dataSummary = null, secrets = [] } = {}) {
  const now = Date.now();
  const s = stats(now);
  const rl = latestRateLimit();

  const lines = [];
  lines.push('# Strokes Gained debug report');
  lines.push('');
  lines.push(`- Generated: ${new Date(now).toISOString()}`);
  lines.push(`- App version: ${APP_VERSION}`);
  lines.push(`- Transport: ${transport}`);
  lines.push(`- Page origin: ${typeof location !== 'undefined' ? location.origin : 'n/a'}`);
  lines.push(`- User agent: ${typeof navigator !== 'undefined' ? navigator.userAgent : 'n/a'}`);
  lines.push(`- Online: ${typeof navigator !== 'undefined' ? navigator.onLine : 'n/a'}`);
  lines.push(`- Tour: ${settings.tour ?? '—'} · score mode: ${settings.mode ?? '—'} · preset: ${settings.presetId ?? '—'}`);
  lines.push(`- Weights: ${JSON.stringify(settings.weights ?? {})}`);
  lines.push('');

  lines.push('## API usage');
  lines.push('');
  lines.push(`- Requests: ${s.total} logged (${s.today} today, ${s.lastHour} in the last hour, ${s.lastMinute} in the last minute)`);
  lines.push(`- Cache hits that avoided a request: ${s.cacheHits}`);
  lines.push(`- Failed requests: ${s.errors}`);
  lines.push(`- Oldest logged request: ${isoOrDash(s.oldest)}`);
  if (rl) {
    lines.push(`- Server-reported limits (from ${rl.endpoint} at ${isoOrDash(rl.ts)}):`);
    for (const [k, v] of Object.entries(rl)) {
      if (k === 'ts' || k === 'endpoint') continue;
      lines.push(`  - \`${k}\`: ${v}`);
    }
  } else {
    lines.push('- Server-reported limits: none seen'
      + (transport === 'direct'
        ? ' (in direct mode the browser hides response headers unless DataGolf sets Access-Control-Expose-Headers)'
        : ' (DataGolf did not send any recognised rate-limit header)'));
  }
  lines.push('');

  const errors = recentErrors(10);
  lines.push(`## Errors (${s.errors} total, showing ${errors.length})`);
  lines.push('');
  if (!errors.length) {
    lines.push('_none_');
  } else {
    for (const e of errors) {
      lines.push(`### ${e.endpoint || 'unknown endpoint'} — ${isoOrDash(e.ts)}`);
      lines.push('');
      lines.push(`- Transport: ${e.transport || '—'} · HTTP status: ${e.status ?? '—'} · ${e.durationMs ?? '—'} ms`);
      lines.push(`- Message: ${e.error || '—'}`);
      if (e.bodySnippet) {
        lines.push('- Response body:');
        lines.push('');
        lines.push('```');
        lines.push(e.bodySnippet);
        lines.push('```');
      }
      lines.push('');
    }
  }
  lines.push('');

  lines.push('## Recent requests');
  lines.push('');
  lines.push(table(
    ['time', 'endpoint', 'via', 'status', 'ms', 'bytes', 'note'],
    entries.slice(-30).reverse().map((e) => [
      new Date(e.ts).toISOString().slice(11, 19),
      e.endpoint || '—',
      e.network ? (e.transport || '—') : 'cache',
      e.status ?? (e.network ? 'failed' : '—'),
      e.durationMs ?? '—',
      e.bytes ?? '—',
      e.ok ? 'ok' : (e.error ? String(e.error).slice(0, 60) : 'cache hit'),
    ]),
  ));

  lines.push('## Feed shapes');
  lines.push('');
  if (!Object.keys(feedShapes).length) {
    lines.push('_no feeds loaded_');
  } else {
    for (const [name, shape] of Object.entries(feedShapes)) {
      lines.push(`- **${name}**: ${shape}`);
    }
  }
  lines.push('');

  if (dataSummary) {
    lines.push('## Parsed data');
    lines.push('');
    lines.push(`- Event: ${dataSummary.event || '—'}`);
    lines.push(`- Field size: ${dataSummary.fieldSize ?? '—'} · without skill data: ${dataSummary.missingSkill ?? '—'}`);
    lines.push(`- Odds model: ${dataSummary.oddsModel || 'none'}`);
    lines.push('');
    lines.push('Players with a value in each category:');
    lines.push('');
    lines.push(table(
      ['category', 'players with data', 'min', 'max'],
      dataSummary.coverage || [],
    ));
  }

  return redact(lines.join('\n'), secrets);
}
