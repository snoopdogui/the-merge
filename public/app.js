// the merge — upload -> reroll -> commit -> list.
//
// No framework, no build. The Atlas API key never appears here; every call goes
// through /api/*, which holds the key server-side.

const MAX_EDGE = 1024; // long-edge cap for a brand-new canvas

const el = {
  figure: document.getElementById('canvas-figure'),
  img: document.getElementById('canvas-img'),
  placeholder: document.getElementById('placeholder-text'),
  status: document.getElementById('status'),
  actions: document.getElementById('actions'),
  file: document.getElementById('file'),
  list: document.getElementById('list'),
  count: document.getElementById('count'),
  more: document.getElementById('more'),
};

let state = { canvas: null, contributions: [], total: 0, hasMore: false };
let pending = null; // the contribution being previewed, pre-commit
let limit = 24;
let busy = false;

// Viewing is open; contributing needs the shared passphrase. It is kept only in
// this browser and sent as a header, never in a URL.
const PASS_KEY = 'the-merge:passphrase';
let pass = localStorage.getItem(PASS_KEY) || '';
let unlocked = false;

// --- api ------------------------------------------------------------------

async function api(path, opts = {}) {
  const headers = {};
  if (opts.body) headers['Content-Type'] = 'application/json';
  if (pass) headers['x-merge-pass'] = pass;

  const res = await fetch(path, { ...opts, headers });
  const body = await res.json().catch(() => ({}));

  if (res.status === 401) {
    // The stored passphrase is wrong or was revoked server-side.
    relock();
    throw new Error(body.error || 'Contribution is gated.');
  }
  if (!res.ok) throw new Error(body.error || `${path} -> ${res.status}`);
  return body;
}

function relock() {
  unlocked = false;
  pass = '';
  localStorage.removeItem(PASS_KEY);
  pending = null;
}

// --- image prep -----------------------------------------------------------

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('could not read that image')); };
    img.src = url;
  });
}

/**
 * Draw `img` into a w x h canvas, centre-cropped to cover.
 *
 * The merge is a per-pixel average, so both images must share dimensions.
 * Cropping to cover rather than stretching keeps contributions from being
 * visibly distorted as they enter the piece.
 */
function fit(img, w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  const scale = Math.max(w / img.width, h / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  return c;
}

/** Dimensions for a brand-new canvas: the image's own aspect, long edge capped. */
function firstCanvasSize(img) {
  const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
  return {
    w: Math.max(8, Math.round(img.width * scale)),
    h: Math.max(8, Math.round(img.height * scale)),
  };
}

// --- rendering ------------------------------------------------------------

function setStatus(html) { el.status.innerHTML = html; }

function button(label, onClick, cls = '') {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.className = cls;
  b.disabled = busy;
  b.addEventListener('click', onClick);
  return b;
}

function render() {
  el.actions.replaceChildren();

  if (pending) {
    el.figure.dataset.state = busy ? 'working' : 'preview';
    el.img.src = pending.previewUrl || el.img.src;
    const name = document.createElement('input');
    name.type = 'text';
    name.id = 'name';
    name.className = 'name-field';
    name.placeholder = 'your name (optional)';
    name.maxLength = 60;
    name.value = pending.name || '';
    name.disabled = busy;
    name.addEventListener('input', () => { pending.name = name.value; });
    el.actions.append(
      name,
      button('Commit', commit),
      button('Reroll', reroll),
      button('Discard', discard, 'quiet'),
    );
  } else if (!unlocked) {
    // Open to look at, gated to alter.
    el.figure.dataset.state = state.canvas ? 'current' : 'empty';
    if (state.canvas) el.img.src = state.canvas.blobUrl;
    else el.placeholder.textContent = 'No canvas yet.';
    const field = document.createElement('input');
    field.type = 'password';
    field.id = 'pass';
    field.className = 'name-field';
    field.placeholder = 'passphrase to contribute';
    field.disabled = busy;
    field.addEventListener('keydown', (e) => { if (e.key === 'Enter') unlock(); });
    el.actions.append(field, button('Unlock', unlock));
    if (!busy) {
      setStatus(
        state.canvas
          ? `Round ${state.canvas.round} · ${state.total} contribution${state.total === 1 ? '' : 's'} · open to view, gated to contribute`
          : 'Nothing here yet. Contributing is gated.',
      );
    }
    renderList();
    return;
  } else if (state.canvas) {
    el.figure.dataset.state = busy ? 'working' : 'current';
    el.img.src = state.canvas.blobUrl;
    el.actions.append(button('Contribute an image', () => el.file.click()));
  } else {
    el.figure.dataset.state = 'empty';
    el.placeholder.textContent = 'No canvas yet.';
    el.actions.append(button('Upload the first image', () => el.file.click()));
    if (!busy) setStatus('The first upload becomes the canvas — nothing to merge toward yet.');
  }

  if (state.canvas && !pending && !busy) {
    setStatus(`Round ${state.canvas.round} · ${state.total} contribution${state.total === 1 ? '' : 's'}`);
  }

  renderList();
}

async function unlock() {
  const field = document.getElementById('pass');
  const value = (field?.value || '').trim();
  if (!value) return;
  busy = true;
  setStatus('Checking…');
  try {
    pass = value;
    await api('/api/unlock', { method: 'POST' });
    unlocked = true;
    localStorage.setItem(PASS_KEY, pass);
    busy = false;
    render();
    setStatus(state.canvas ? 'Unlocked. You can contribute.' : 'Unlocked. The first upload becomes the canvas.');
  } catch (err) {
    busy = false;
    render();
    fail(err);
  }
}

function renderList() {
  el.count.textContent = state.total ? String(state.total) : '';
  el.list.replaceChildren();

  if (!state.contributions.length) {
    const li = document.createElement('li');
    li.innerHTML = '<span class="empty-note">Nothing yet.</span>';
    li.style.borderBottom = 'none';
    el.list.append(li);
  }

  for (const c of state.contributions) {
    const li = document.createElement('li');

    const a = document.createElement('a');
    a.href = c.originalUrl;
    a.target = '_blank';
    a.rel = 'noopener';
    const img = document.createElement('img');
    img.src = c.thumbUrl;
    img.alt = c.name ? `Original upload by ${c.name}` : 'An original upload';
    img.loading = 'lazy';
    a.append(img);

    const meta = document.createElement('div');
    meta.className = 'entry';
    const date = new Date(c.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    const strength = c.strength == null ? 'the canvas' : `s ${c.strength.toFixed(3)}`;
    meta.innerHTML =
      `<span class="who">${c.name ? escapeHtml(c.name) : 'Anonymous'}</span>` +
      `<span class="meta">${date} · ${strength}</span>`;

    li.append(a, meta);
    el.list.append(li);
  }

  el.more.hidden = !state.hasMore;
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

async function refresh() {
  state = await api(`/api/state?limit=${limit}`);
  // A passphrase kept from a previous visit may no longer be valid.
  if (pass && !unlocked) {
    try {
      await api('/api/unlock', { method: 'POST' });
      unlocked = true;
    } catch {
      /* relock() has already cleared it; render() shows the locked state */
    }
  }
  render();
}

// --- the loop -------------------------------------------------------------

el.file.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  el.file.value = '';
  if (file) await contribute(file);
});

async function contribute(file) {
  busy = true;
  render();
  try {
    setStatus('Reading image…');
    const img = await loadImage(file);

    const size = state.canvas?.width
      ? { w: state.canvas.width, h: state.canvas.height }
      : firstCanvasSize(img);
    const full = fit(img, size.w, size.h);
    const thumbH = Math.max(1, Math.round((160 * size.h) / size.w));
    const thumb = fit(img, 160, thumbH);

    setStatus('Uploading…');
    const up = await api('/api/contribute', {
      method: 'POST',
      body: JSON.stringify({
        image: full.toDataURL('image/png'),
        thumb: thumb.toDataURL('image/jpeg', 0.82),
        width: size.w,
        height: size.h,
      }),
    });

    if (up.becameCanvas) {
      busy = false;
      await refresh();
      setStatus('This upload is now the canvas. The next one will merge into it.');
      return;
    }

    pending = {
      contributionId: up.contributionId,
      contributionUrl: up.contributionUrl,
      originalUrl: up.originalUrl,
      thumbUrl: up.thumbUrl,
    };
    await runMerge();
  } catch (err) {
    fail(err);
  } finally {
    busy = false;
    render();
  }
}

/** One quantum draw, then one merge at that strength. */
async function runMerge() {
  setStatus('Drawing a strength from <b>comet-qrng-v1</b>…');
  const draw = await api('/api/draw', { method: 'POST' });
  pending.strength = draw.strength;
  pending.draw = draw;

  // The merge is a local weighted average now — it returns the preview straight
  // away, so there is no job to poll.
  setStatus(`Merging at strength <b>${draw.strength.toFixed(4)}</b>…`);
  const { previewUrl } = await api('/api/merge', {
    method: 'POST',
    body: JSON.stringify({ contributionUrl: pending.contributionUrl, strength: draw.strength }),
  });
  pending.previewUrl = previewUrl;

  const band = draw.band ? ` in band ${draw.band.min}–${draw.band.max}` : '';
  setStatus(
    `Strength <b>${draw.strength.toFixed(4)}</b>${band} — from ${draw.bytes} quantum byte${draw.bytes === 1 ? '' : 's'} ` +
    `(20 qubits × 512 shots, <b>${draw.backend}</b>${draw.chshS ? `, CHSH S ${draw.chshS.toFixed(2)}` : ''}). ` +
    `Reroll for a new draw, or commit this.`,
  );
}

async function reroll() {
  busy = true;
  render();
  try {
    await runMerge();
  } catch (err) {
    fail(err);
  } finally {
    busy = false;
    render();
  }
}

async function commit() {
  busy = true;
  render();
  try {
    setStatus('Committing…');
    await api('/api/commit', {
      method: 'POST',
      body: JSON.stringify({ ...pending, name: (pending.name || '').trim() }),
    });
    pending = null;
    busy = false;
    await refresh();
    setStatus(`Committed. Round ${state.canvas.round}.`);
  } catch (err) {
    fail(err);
  } finally {
    busy = false;
    render();
  }
}

function discard() {
  pending = null;
  render();
  setStatus('Discarded. The canvas is unchanged.');
}

function fail(err) {
  console.error(err);
  setStatus(`<b>${escapeHtml(String(err.message || err))}</b>`);
}

el.more.addEventListener('click', async () => {
  limit += 24;
  await refresh();
});

refresh().catch(fail);
