// POST /api/unlock — check a passphrase without doing anything else.
//
// Lets the page tell you the passphrase is wrong up front, rather than after
// you have already picked a file and waited on an upload. The gate itself does
// the checking; reaching the body means it passed.
import { json, handler } from './_store.js';

export default handler('POST', async (req, res) => {
  json(res, 200, { ok: true });
}, { gated: true });
