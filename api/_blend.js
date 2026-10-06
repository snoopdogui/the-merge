// Local compositing — what replaced telablur-v1 as the merge step.
//
// telablur-v1's amplitude interpolation was not a blend: measured over a
// strength sweep on real inputs, output luminance went 27 -> 34 -> 46 -> 113 -> 88
// against inputs at 44.4 and 144.7 — non-monotonic, and darker than *both*
// inputs exactly at the low strengths we wanted to be gentlest. A plain weighted
// average is linear in strength and always bracketed by the two inputs, so the
// quantum draw now maps to a predictable visible effect.
//
// Atlas is still in the loop, but only for comet-qrng-v1: the strength is drawn
// quantum-mechanically, the compositing is local.

import sharp from 'sharp';

/**
 * The band a raw [0,1) draw is remapped into.
 *
 * Straight [0,1) is unusable: near 0 the contribution is invisible and near 1 it
 * erases the canvas. 0.2 is about where a contribution reads as present; above
 * ~0.4 two dissimilar images start cancelling into grey (measured contrast
 * bottoms out around s=0.5), so the top of the band stays below that.
 */
export const STRENGTH_BAND = { min: 0.2, max: 0.4 };

/** Map a uniform draw in [0,1) onto the band. Uniform in, uniform out. */
export function remapStrength(u) {
  return STRENGTH_BAND.min + u * (STRENGTH_BAND.max - STRENGTH_BAND.min);
}

/**
 * out = base*(1-strength) + top*strength, per channel, in sRGB bytes.
 *
 * Done on raw pixels rather than via a sharp composite so the arithmetic is the
 * literal thing we specified and verified, with no blend-mode or
 * premultiplied-alpha subtleties in between. `top` is resized to cover `base`
 * if the dimensions ever disagree — the client already fits uploads to the
 * canvas, so this is a guard, not the normal path.
 */
export async function blendImages(baseBytes, topBytes, strength) {
  if (!(strength >= 0 && strength <= 1)) throw new Error(`strength out of range: ${strength}`);

  const base = sharp(baseBytes).removeAlpha().raw();
  const { data: a, info } = await base.toBuffer({ resolveWithObject: true });
  const { width, height } = info;

  const { data: b } = await sharp(topBytes)
    .resize(width, height, { fit: 'cover', position: 'centre' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (a.length !== b.length) throw new Error(`raw buffers differ: ${a.length} vs ${b.length}`);

  const out = Buffer.allocUnsafe(a.length);
  const w = strength;
  const v = 1 - strength;
  for (let i = 0; i < a.length; i++) {
    out[i] = (a[i] * v + b[i] * w + 0.5) | 0; // +0.5 => round, not truncate
  }

  return sharp(out, { raw: { width, height, channels: 3 } }).png().toBuffer();
}
