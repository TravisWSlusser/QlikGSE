/*
  The Blob token, found wherever Vercel put it. Connecting a store with a
  custom name/prefix injects <PREFIX>_READ_WRITE_TOKEN instead of the
  default BLOB_READ_WRITE_TOKEN — the systems board caught exactly this in
  production (store: qlik-gse-blob). Accept any var with the suffix so the
  store's name never matters; callers pass the token explicitly to
  @vercel/blob rather than relying on its env autodetection.
*/
export function blobToken() {
  if (process.env.BLOB_READ_WRITE_TOKEN) return process.env.BLOB_READ_WRITE_TOKEN;
  for (const k of Object.keys(process.env)) {
    if (k.endsWith('_READ_WRITE_TOKEN') && process.env[k]) return process.env[k];
  }
  return '';
}
