// State + image storage, both on Vercel Blob.
//
// There is no native Vercel KV any more (it moved to Marketplace Upstash Redis),
// so all mutable state is a small JSON snapshot in Blob. Writes happen once per
// commit, so read-modify-write is fine at this scale; going public would want a
// real atomic store, since concurrent commits here are last-writer-wins.

import './_env.js';
import { timingSafeEqual } from 'node:crypto';
import { put, list, del } from '@vercel/blob';

// State lives in Blob as a series of immutable, timestamp-named snapshots.
//
// Writing to one fixed pathname does not work: Vercel Blob's public URLs are
// CDN-cached and ignore query strings, so an overwritten state.json keeps
// serving the previous body and a commit reads back stale. Each write instead
// creates a new object, and readState finds the newest via list(), which hits
// the Blob API rather than the CDN. Unique URLs are never stale.
const STATE_PREFIX = 'state/snapshot-';
const KEEP_SNAPSHOTS = 5;

const EMPTY = {
  version: 1,
  canvas: null, // { blobUrl, width, height, round }
  contributions: [], // newest last
};

/** Newest-first list of state snapshots. */
async function snapshots() {
  const { blobs } = await list({ prefix: STATE_PREFIX });
  // Pathnames embed a zero-padded ms timestamp, so lexicographic desc == newest first.
  return blobs.sort((a, b) => (a.pathname < b.pathname ? 1 : a.pathname > b.pathname ? -1 : 0));
}

export async function readState() {
  const all = await snapshots();
  if (!all.length) return structuredClone(EMPTY);
  const res = await fetch(all[0].url);
  if (!res.ok) return structuredClone(EMPTY);
  return { ...structuredClone(EMPTY), ...(await res.json()) };
}

export async function writeState(state) {
  const stamp = String(Date.now()).padStart(15, '0');
  await put(`${STATE_PREFIX}${stamp}-${Math.random().toString(36).slice(2, 8)}.json`, JSON.stringify(state, null, 2), {
    access: 'public',
    contentType: 'application/json',
    addRandomSuffix: false,
  });
  // Keep a short tail for debugging, drop the rest.
  const stale = (await snapshots()).slice(KEEP_SNAPSHOTS);
  if (stale.length) await del(stale.map((b) => b.url)).catch(() => {});
  return state;
}

/**
 * Store an image and return its public URL.
 *
 * addRandomSuffix keeps every write at a fresh, immutable URL. Writing to a
 * fixed pathname is unsafe here for the same reason the state snapshots are
 * versioned: Blob's public URLs sit behind a CDN that caches both bodies and
 * 404s, so a reused pathname can serve a stale body — or a cached miss for an
 * object that now exists. The resulting URL is recorded in state, so nothing
 * depends on the pathname being predictable.
 */
export async function putImage(pathname, bytes, contentType = 'image/png') {
  const blob = await put(pathname, bytes, {
    access: 'public',
    contentType,
    addRandomSuffix: true,
  });
  return blob.url;
}

// --- request helpers -------------------------------------------------------

export function json(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

/** An error carrying an HTTP status, so handlers can reject cleanly. */
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * Gate the endpoints that can alter the piece or spend Atlas credits.
 *
 * Viewing is public: the canvas and the ledger are the artwork and its honest
 * record, and both should be open. Contributing is not, because /api/* has no
 * other authentication and each contribution spends real Atlas credits — and
 * because the brief defers public contribution until there is a moderation
 * plan. A single shared passphrase is the smallest thing that separates the two.
 *
 * Not a substitute for per-user auth if this genuinely opens up later.
 */
export function requirePassphrase(req) {
  const expected = process.env.CONTRIBUTE_PASSPHRASE;
  if (!expected) throw new HttpError(503, 'CONTRIBUTE_PASSPHRASE is not configured on the server');

  const given = req.headers['x-merge-pass'];
  if (typeof given !== 'string' || given.length === 0) {
    throw new HttpError(401, 'This piece is open to view but gated for contribution.');
  }
  // Compare over fixed-length digests so the check does not leak length.
  const a = Buffer.from(given.padEnd(64).slice(0, 64));
  const b = Buffer.from(expected.padEnd(64).slice(0, 64));
  if (!timingSafeEqual(a, b)) throw new HttpError(401, 'That passphrase is not right.');
}

/**
 * Wrap a handler so thrown errors come back as JSON instead of an opaque 500.
 * Pass { gated: true } for anything that mutates the piece or costs credits.
 */
export function handler(method, fn, { gated = false } = {}) {
  return async (req, res) => {
    if (req.method !== method) return json(res, 405, { error: `Use ${method}` });
    try {
      if (gated) requirePassphrase(req);
      await fn(req, res);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status >= 500) console.error(err);
      json(res, status, { error: String(err.message || err) });
    }
  };
}

export function decodeDataUrl(dataUrl) {
  const m = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl || '');
  if (!m) throw new Error('expected a base64 data URL');
  return { contentType: m[1], bytes: Buffer.from(m[2], 'base64') };
}
