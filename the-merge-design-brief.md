# the-merge: Living Collective Artwork — Design Brief
### Moth Hack 2026

## Concept

A single, continuously evolving canvas, not a mosaic, not a staged critique of hierarchy. Every contribution genuinely morphs the collective piece toward itself through a real quantum-simulated transform, so it becomes an actual amalgam of everyone rather than tiles sitting side by side. A visible list of every original upload sits alongside the canvas, so the transparency comes from an honest ledger, not from a claim that the merge is untraceable. Seeded and demoed solo for the hackathon. Opened to public contribution after, once there's a moderation plan.

## Why this version

Earlier drafts moved through a tiered-access hierarchy mechanic, then a grid of individually-filtered tiles. Both got dropped: the tier mechanic was effortful to build and parse quickly, and a grid of tiles read as separate pieces displayed together, not a merged, remixed piece. This version merges for real, one canvas, one continuous history, using an engine built specifically for morphing one image into another.

## Player flow

1. **Land** — see the current canvas, the single collective piece as it stands right now.
2. **Contribute** — upload an image (a photo, existing artwork, anything). Automatically resized to match the canvas's dimensions, since the merge engine requires both images to be the same size.
3. **Preview and reroll** — the canvas morphs toward your upload, at a strength decided by a fresh quantum measurement. See the result. Not happy? Reroll: a new quantum draw picks a new strength, try again, as many times as wanted, before committing.
4. **Commit** — the chosen result becomes the new current canvas.
5. **Join the list** — your original upload, plus name and date if you opt in, joins a visible list next to the canvas. This is the transparency mechanism: an actual gallery of what's gone in, not hoverable pixels on the artwork itself, since individual pixels stop being attributable after a few rounds of merging.
6. **Living between contributions** *(not in the hackathon build, add later)* — on a shared schedule, the canvas would morph slightly toward one past upload, chosen by a fresh quantum draw, keeping the piece shifting even when nobody's actively contributing. For now, the canvas only changes when someone actually contributes, simplest version, no background scheduler to build.

## The merge engine

`teleblur-v1` — takes two images and morphs one toward the other through quantum rotation gates, with a `strength` parameter (0 to 1) controlling how far the pull goes. This is the actual mechanism: image1 is the current canvas, image2 is the new upload, strength comes from a quantum draw each time. Runs on a simulator (deterministic given fixed inputs, not live hardware), so the "randomness" that makes each reroll different comes entirely from re-rolling the strength via `comet-qrng-v1` beforehand, not from the merge itself.

## On "untraceable," precisely

Two different claims, kept separate on purpose. Visually, after a few rounds of merging, nobody can pick a contribution back out of the canvas by looking, that's genuine. Mathematically, the transform itself is a deterministic, parameterised interpolation, not one-way destruction, so calling it "impossible to trace" would overclaim what the quantum step actually guarantees. The honest version: dissolution in the artwork itself, full transparency in the uploads list. Originals are kept and shown, not deleted after merging.

## Visual direction

Super minimalistic. Reference: [Obvious](https://www.obvious-art.com), the French collective behind the AI-generated portrait *Edmond de Belamy*. Worth noting, not just as a look but as a fitting reference: they describe their own practice as "a collective vision that goes beyond individual authorship," which is close to what this piece is actually doing. Practically, that points toward: the canvas itself as the only large, high-contrast element on the page, generous negative space, minimal UI chrome (no dashboard-like panels, no busy controls), a quiet/muted palette for everything that isn't the artwork, and the uploads list kept visually secondary, a plain list, not competing with the canvas for attention.

## Scaling and performance

- The canvas is one image. Serving it stays cheap and fast regardless of how many contributions have gone into it, this got easier by moving off a mosaic.
- The uploads list needs the same treatment any growing list needs: thumbnails, not full-size originals, a capped/paginated view (most recent N, load more on demand), not every upload ever rendered at once.
- Not in the hackathon build, but if idle drift gets added later: it should run once, on a shared schedule, not once per visitor, keeping both load and Atlas credit usage tied to how often the piece updates, not to how many people are looking at it.
- Cache the current canvas's asset ID rather than re-uploading it as a fresh asset on every merge, only the new contribution needs uploading each time.

## Engines used (Atlas API)

- **`teleblur-v1`** — the core merge: current canvas morphed toward each new upload.
- **`comet-qrng-v1`** — picks the strength for each reroll. (Would also drive idle drift, if that gets added later.)
- **`blur-v1`** / **`deep-fryer-v1`** — cut from the initial build. Start without them, easy to add back in as a genuine extra step once the core loop works.

## Target challenge

Still Expert tier, "Quantum-native repo." The daisy-chain angle (multiple engines, each doing real work) now rests on `teleblur-v1` plus `comet-qrng-v1`, both load-bearing. Adding Blur or Deep Fryer back in as a genuine third step would strengthen that claim further, but isn't required.

## Tech stack recommendation

Single-page vanilla HTML/CSS/JS app, no framework needed. Atlas calls go through a small serverless function so the API key never sits in the browser. Deploy on Vercel or Netlify's free tier.

## API call sequence

- **Auth:** sign up on the Moth platform → get a Supabase JWT → `POST /keys` once to mint a `moth_` API key (shown exactly once, save it immediately).
- **`comet-qrng-v1`:** pure JSON in, job out. No file upload needed.
- **`teleblur-v1`:** needs both images as uploaded assets (`POST /assets` → PUT bytes → mark complete), the current canvas's asset ID reused from the previous round, the new upload freshly uploaded each time.
- **All engines:** `POST /engines/{id}/process` → returns `job_id` → poll `GET /jobs/{id}/status` → `GET /jobs/{id}/result` once done.

## Open / not yet decided

- What phase two's moderation plan looks like, once it's genuinely public. Deliberately deferred, worth raising with the judges/at the event itself to get outside feedback before deciding, rather than guessing solo now.
- Whether idle drift and/or Blur/Deep Fryer get added once the core loop (upload → reroll → merge → list) is actually working.
- Hosting name/domain for the submission link.

## Status

Atlas API key obtained. Build underway via Claude Code, in a local project folder named `the-merge`. Next: get one real `comet-qrng-v1` call working end to end before building the rest of the UI.
