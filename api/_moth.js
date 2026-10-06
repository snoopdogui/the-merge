// Moth Atlas API client.
//
// Contract verified live against api.mothquantum.com on 2026-09-27:
//   POST /api/v1/engines/{id}/process   -> { job_id }   body: { params, input_files }
//   GET  /api/v1/jobs/{id}/status       -> { status }
//   GET  /api/v1/jobs/{id}/result       -> { outputs: [...] }
//
// Only comet-qrng-v1 is used now. The asset-upload and output-download helpers
// that fed telablur-v1 were removed when compositing moved local (see _blend.js);
// `git log` has them if an image engine is ever wired back in.

import './_env.js';

const BASE = 'https://api.mothquantum.com/api/v1';

export const ENGINE_QRNG = 'comet-qrng-v1';

function key() {
  const k = process.env.MOTH_API_KEY;
  if (!k) throw new Error('MOTH_API_KEY is not set');
  return k;
}

async function atlas(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      Authorization: `Bearer ${key()}`,
      'User-Agent': 'the-merge/0.1',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    throw new Error(`Atlas ${method} ${path} -> ${res.status}: ${(await res.text()).slice(0, 600)}`);
  }
  return res.json();
}

/** Submit a job and return its id without waiting. */
async function submit(engine, params, inputFiles) {
  const body = { params };
  if (inputFiles) body.input_files = inputFiles;
  const { job_id } = await atlas('POST', `/engines/${engine}/process`, body);
  return job_id;
}

function jobStatus(id) {
  return atlas('GET', `/jobs/${id}/status`);
}

function jobResult(id) {
  return atlas('GET', `/jobs/${id}/result`);
}

/** Submit, then poll to completion. Only for fast engines (the QRNG draw). */
export async function runToCompletion(engine, params, inputFiles, { timeoutMs = 45000 } = {}) {
  const id = await submit(engine, params, inputFiles);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const st = await jobStatus(id);
    if (st.status === 'completed') return { id, result: await jobResult(id) };
    if (st.status === 'failed' || st.status === 'cancelled') {
      throw new Error(`${engine} job ${id} ${st.status}: ${JSON.stringify(st).slice(0, 400)}`);
    }
    if (Date.now() > deadline) throw new Error(`${engine} job ${id} timed out`);
    await new Promise((r) => setTimeout(r, 1500));
  }
}

/**
 * One fresh quantum draw -> a strength in [0,1).
 *
 * Two constraints learned from the live engine, both of which silently produce
 * a useless result rather than an error:
 *
 * 1. num_qubits must comfortably exceed log2(shots), or the extractable budget
 *    is zero. In counts-only readout the engine subtracts log2(shots!) as an
 *    ordering penalty. Raw bits grow as shots*num_qubits but the penalty grows
 *    as shots*log2(shots), so WIDTH is what buys margin, not shot count — and
 *    dropping shots too low backfires, because the entropy estimator's
 *    99%-confidence bound weakens with fewer samples. The engine's own defaults
 *    (12 qubits x 4096 shots) yield zero bytes.
 *
 * 2. Even when the budget is positive it VARIES per run with the measured
 *    min-entropy, and the leftover hash lemma caps output at
 *    (budget - 2*epsilon_log2) bits. Asking the engine to derive a 53-bit float
 *    therefore fails outright on a low-entropy draw ("conditioned bytes ran out
 *    before the derivation request was met"). So we ask only for bytes and do
 *    the uniform mapping ourselves: dividing an n-byte integer by 2^(8n) is
 *    exactly uniform for any n, so a 2-byte draw still gives a usable strength
 *    at 1/65536 resolution — far finer than the merge can express.
 */
const QRNG_PARAMS = {
  // Measured over 3 runs each (scratch/tune-qrng.mjs):
  //   20q x 512s, no witness -> budget ~3240-3773 bits, usable 3/3
  //   20q x 256s, no witness -> budget ~1496-1590 bits, usable 3/3
  //   12q x 256s, +witness   -> budget ~71-348 bits,    usable 2/3  <- too flaky
  //
  // The Aer emulator caps the whole circuit at 20 qubits and bell_witness costs
  // 8 of them, leaving only 12 for the randomness register — not enough to clear
  // the ordering penalty dependably. We give up the CHSH fidelity witness to get
  // a reroll that doesn't fail in front of an audience; the randomness itself is
  // unaffected. Re-enable bell_witness (with num_qubits: 12) if the witness
  // matters more than reliability.
  num_qubits: 20,
  shots: 512,
  bell_witness: false,
  mode: 'emu',
  output_bytes: 8,
  include_raw_counts: false,
};

export async function drawStrength() {
  let last;
  // A draw can legitimately come back with zero extractable bytes; one retry.
  for (let attempt = 0; attempt < 2; attempt++) {
    const { id, result } = await runToCompletion(ENGINE_QRNG, QRNG_PARAMS);
    const out = result.result.output;
    const hex = out.random?.hex || '';
    last = out;
    if (hex.length >= 2) {
      const bits = BigInt('0x' + hex);
      const scale = 1n << BigInt(4 * hex.length);
      return {
        strength: Number(bits) / Number(scale),
        jobId: id,
        hex,
        bytes: out.random.bytes,
        grade: out.entropy_report?.grade,
        chshS: out.bell_witness?.S,
        budgetBits: out.entropy?.budget_bits,
        pulseHash: out.pulse?.pulse_hash,
        backend: out.provenance?.backend,
      };
    }
  }
  throw new Error(
    `QRNG yielded no extractable bytes twice over: ${JSON.stringify(last?.random)}`,
  );
}

