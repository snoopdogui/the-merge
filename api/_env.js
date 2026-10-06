// `vercel env pull` writes .env.local as KEY="value", and `vercel dev` passes
// those surrounding quote characters through into process.env verbatim. A real
// deployment injects clean values, so this only bites locally — but it bites
// silently, as a 401 from a key that looks correct. Normalise once, on import.
for (const k of ['MOTH_API_KEY', 'BLOB_READ_WRITE_TOKEN', 'CONTRIBUTE_PASSPHRASE']) {
  const v = process.env[k];
  if (v && v.length > 1 && v.startsWith('"') && v.endsWith('"')) {
    process.env[k] = v.slice(1, -1);
  }
}
