// POST /api/contribute — take an upload into the piece.
//
// The client has already resized/cropped the image to the canvas's exact
// dimensions, so the stored original doubles as the merge input. The job here is
// to keep that original in Blob for the ledger (the brief's transparency
// mechanism: originals are kept and shown, not deleted after merging) and hand
// its URL back so every reroll can reuse it.
//
// This used to also upload the image to Atlas as an asset, because telablur-v1
// took its inputs as asset ids. The merge is local now, so nothing here touches
// Atlas at all.
//
// If there is no canvas yet, this upload *becomes* the canvas — round 0, no
// merge and no quantum draw, because there is nothing to merge it toward.

import { readState, writeState, putImage, decodeDataUrl, json, handler } from './_store.js';

export default handler('POST', async (req, res) => {
  const { image, thumb, width, height } = req.body || {};
  if (!image) return json(res, 400, { error: 'image (data URL) is required' });

  const { bytes, contentType } = decodeDataUrl(image);
  const id = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const ext = contentType === 'image/png' ? 'png' : 'jpg';

  const state = await readState();

  const [originalUrl, thumbUrl] = await Promise.all([
    putImage(`originals/${id}.${ext}`, bytes, contentType),
    thumb
      ? (() => {
          const t = decodeDataUrl(thumb);
          return putImage(`thumbs/${id}.jpg`, t.bytes, t.contentType);
        })()
      : Promise.resolve(null),
  ]);

  // First upload: it becomes the canvas outright.
  if (!state.canvas) {
    const canvasUrl = await putImage(`canvas/round0.${ext}`, bytes, contentType);
    state.canvas = {
      blobUrl: canvasUrl,
      width: Number(width) || null,
      height: Number(height) || null,
      round: 0,
    };
    state.contributions.push({
      id,
      originalUrl,
      thumbUrl: thumbUrl || originalUrl,
      name: null,
      date: new Date().toISOString(),
      strength: null, // nothing to merge toward on round 0
      round: 0,
    });
    await writeState(state);
    return json(res, 200, {
      becameCanvas: true,
      contributionId: id,
      canvas: state.canvas,
    });
  }

  json(res, 200, {
    becameCanvas: false,
    contributionId: id,
    contributionUrl: originalUrl, // what /api/merge composites on top of the canvas
    originalUrl,
    thumbUrl: thumbUrl || originalUrl,
    canvas: state.canvas,
  });
}, { gated: true });
