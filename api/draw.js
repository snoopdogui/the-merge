// POST /api/draw — one fresh comet-qrng-v1 measurement, turned into a strength.
//
// This runs on every reroll, and is now the *only* call that reaches Atlas: the
// compositing is local (see _blend.js). It is also the only source of variation
// in the piece — the blend is deterministic, so re-drawing the strength is what
// makes a reroll different.
import { drawStrength } from './_moth.js';
import { remapStrength, STRENGTH_BAND } from './_blend.js';
import { json, handler } from './_store.js';

export default handler('POST', async (req, res) => {
  const draw = await drawStrength();
  // drawStrength() yields a uniform in [0,1); the piece composites in a narrower
  // band. `raw` is kept so the ledger can still show the untouched measurement.
  json(res, 200, {
    ...draw,
    strength: remapStrength(draw.strength),
    raw: draw.strength,
    band: STRENGTH_BAND,
  });
}, { gated: true });
