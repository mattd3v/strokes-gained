#!/usr/bin/env node
// Local host for the Strokes Gained PWA.
//
// Serves ./public and proxies DataGolf's feeds API under /dg/* so the browser
// never has to rely on DataGolf sending CORS headers. Binds to loopback only;
// the API key travels from the browser to this process to DataGolf and is
// never logged.

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, 'public');
const PORT = Number(process.env.PORT || 5173);
const HOST = process.env.HOST || '127.0.0.1';
const UPSTREAM = 'https://feeds.datagolf.com';

// Only these upstream paths may be reached through the proxy.
const ALLOWED = new Set([
  '/get-schedule',
  '/get-player-list',
  '/field-updates',
  '/preds/skill-ratings',
  '/preds/pre-tournament',
  '/preds/get-dg-rankings',
  '/preds/player-decompositions',
  '/preds/live-tournament-stats',
]);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'cache-control': 'no-cache', ...headers });
  res.end(body);
}

function sendJson(res, status, obj) {
  send(res, status, JSON.stringify(obj), { 'content-type': MIME['.json'] });
}

/** Strips the key so a failing URL can be shown to the user safely. */
function redact(urlString) {
  return urlString.replace(/([?&]key=)[^&]*/i, '$1***');
}

async function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const resolved = path.resolve(ROOT, rel);
  if (resolved !== ROOT && !resolved.startsWith(ROOT + path.sep)) {
    return send(res, 403, 'Forbidden');
  }
  try {
    const body = await readFile(resolved);
    const type = MIME[path.extname(resolved).toLowerCase()] || 'application/octet-stream';
    // The service worker must never be served stale, or updates never land.
    const cache = rel === 'sw.js' ? 'no-cache' : 'no-cache';
    send(res, 200, body, { 'content-type': type, 'cache-control': cache });
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'EISDIR') {
      // Single-page app: unknown paths fall back to the shell.
      if (!path.extname(rel)) {
        try {
          const shell = await readFile(path.join(ROOT, 'index.html'));
          return send(res, 200, shell, { 'content-type': MIME['.html'] });
        } catch { /* fall through */ }
      }
      return send(res, 404, 'Not found');
    }
    send(res, 500, 'Server error');
  }
}

async function proxy(req, res, url) {
  const upstreamPath = url.pathname.slice('/dg'.length) || '/';
  if (!ALLOWED.has(upstreamPath)) {
    return sendJson(res, 400, {
      error: `Path not allowed through the local proxy: ${upstreamPath}`,
    });
  }
  const target = new URL(UPSTREAM + upstreamPath);
  target.search = url.search;
  if (!target.searchParams.get('key')) {
    return sendJson(res, 400, { error: 'Missing DataGolf API key.' });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const upstream = await fetch(target, {
      signal: controller.signal,
      headers: { accept: 'application/json,text/plain,*/*' },
    });
    const text = await upstream.text();
    const type = upstream.headers.get('content-type') || 'text/plain; charset=utf-8';
    console.log(`  ${upstream.status} ${upstreamPath}`);
    send(res, upstream.status, text, { 'content-type': type });
  } catch (err) {
    const reason = err.name === 'AbortError' ? 'Upstream request timed out.' : err.message;
    console.error(`  proxy error ${redact(target.toString())}: ${reason}`);
    sendJson(res, 502, { error: `Could not reach DataGolf: ${reason}` });
  } finally {
    clearTimeout(timer);
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || HOST}`);

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return send(res, 405, 'Method not allowed', { allow: 'GET, HEAD' });
  }
  if (url.pathname === '/dg/__health') {
    return sendJson(res, 200, { ok: true, proxy: UPSTREAM });
  }
  if (url.pathname === '/dg' || url.pathname.startsWith('/dg/')) {
    return proxy(req, res, url);
  }
  return serveStatic(req, res, url.pathname);
});

server.listen(PORT, HOST, () => {
  console.log(`Strokes Gained running at http://${HOST}:${PORT}`);
  console.log('Paste your DataGolf API key in the app to load this week\'s field.');
});
