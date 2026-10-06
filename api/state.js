// GET /api/state — the current canvas and the uploads ledger.
import { readState, json, handler } from './_store.js';

const PAGE = 24; // brief: capped view, most recent N, load more on demand

export default handler('GET', async (req, res) => {
  const state = await readState();
  const limit = Math.min(Number(new URL(req.url, 'http://x').searchParams.get('limit')) || PAGE, 200);
  const all = state.contributions;
  const recent = all.slice(-limit).reverse(); // newest first for display
  json(res, 200, {
    canvas: state.canvas,
    contributions: recent.map((c) => ({
      id: c.id,
      thumbUrl: c.thumbUrl,
      originalUrl: c.originalUrl,
      name: c.name || null,
      date: c.date,
      strength: c.strength,
      round: c.round,
    })),
    total: all.length,
    hasMore: all.length > recent.length,
  });
});
