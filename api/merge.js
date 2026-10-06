// POST /api/merge — composite the contribution into the canvas at `strength`.
//
// This used to submit a telablur-v1 job to Atlas and hand back a job id for the
// client to poll. The merge is now a local weighted pixel average, which takes
// tens of milliseconds, so there is no job and no polling: the preview comes
// back on this response. /api/job is gone with it.
//
// The preview is NOT the canvas. It only becomes the canvas on commit.
import { blendImages } from './_blend.js';
import { readState, putImage, json, handler } from './_store.js';

// Both inputs are fetched by URL, and this endpoint is only passphrase-gated, so
// constrain what it can be pointed at: our own Blob store and nothing else.
function assertBlobUrl(raw, label) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(`${label} is not a valid URL`);
  }
  if (u.protocol !== 'https:' || !u.hostname.endsWith('.public.blob.vercel-storage.com')) {
    throw new Error(`${label} must be a Vercel Blob URL`);
  }
  return u.toString();
}

async function fetchBytes(url, label) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`could not read ${label} (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

export default handler('POST', async (req, res) => {
  const { contributionUrl, strength } = req.body || {};
  if (!contributionUrl) return json(res, 400, { error: 'contributionUrl is required' });
  if (typeof strength !== 'number' || !(strength >= 0 && strength <= 1)) {
    return json(res, 400, { error: 'strength must be a number in [0,1]' });
  }

  const state = await readState();
  if (!state.canvas) return json(res, 409, { error: 'no canvas yet — the first upload becomes the canvas' });

  const topUrl = assertBlobUrl(contributionUrl, 'contributionUrl');
  const baseUrl = assertBlobUrl(state.canvas.blobUrl, 'canvas');

  // Re-fetched on every reroll. Cheap next to the quantum draw that precedes it,
  // and it keeps the endpoint stateless.
  const [baseBytes, topBytes] = await Promise.all([
    fetchBytes(baseUrl, 'the canvas'),
    fetchBytes(topUrl, 'the contribution'),
  ]);

  const png = await blendImages(baseBytes, topBytes, strength);
  const previewUrl = await putImage(
    `previews/${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}.png`,
    png,
    'image/png',
  );

  json(res, 200, { previewUrl, strength });
}, { gated: true });
