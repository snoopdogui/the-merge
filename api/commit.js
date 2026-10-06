// POST /api/commit — the previewed merge becomes the new current canvas.
//
// The preview is already a finished PNG in Blob (composited locally by
// /api/merge), so committing is a copy to a stable canvas path. There is no
// Atlas asset involved any more: the old flow had to carry the telablur output's
// asset id forward to use as next round's image1, and nothing needs that now.
import { readState, writeState, putImage, json, handler } from './_store.js';

export default handler('POST', async (req, res) => {
  const { contributionId, previewUrl, originalUrl, thumbUrl, strength, name } = req.body || {};
  if (!previewUrl) return json(res, 400, { error: 'previewUrl is required' });
  if (!contributionId || !originalUrl) return json(res, 400, { error: 'contributionId and originalUrl are required' });

  const state = await readState();
  if (!state.canvas) return json(res, 409, { error: 'no canvas to merge into' });

  const round = state.canvas.round + 1;

  // Copy the preview bytes to a stable canvas path so the canvas URL doesn't
  // depend on a previews/ object we might later prune.
  const res2 = await fetch(previewUrl);
  if (!res2.ok) return json(res, 502, { error: `could not read the preview (${res2.status})` });
  const bytes = Buffer.from(await res2.arrayBuffer());
  const canvasUrl = await putImage(`canvas/round${round}.png`, bytes, 'image/png');

  state.canvas = {
    blobUrl: canvasUrl,
    width: state.canvas.width,
    height: state.canvas.height,
    round,
  };
  state.contributions.push({
    id: contributionId,
    originalUrl,
    thumbUrl: thumbUrl || originalUrl,
    name: (name || '').trim().slice(0, 60) || null,
    date: new Date().toISOString(),
    strength: typeof strength === 'number' ? strength : null,
    round,
  });
  await writeState(state);

  json(res, 200, { canvas: state.canvas, round });
}, { gated: true });
