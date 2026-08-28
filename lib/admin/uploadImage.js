import { put } from '@vercel/blob';
import { requireScope, cors, parseBody } from './auth.js';

/*
  POST /api/admin/uploadImage — banner art into Vercel Blob.

  Body: { name, type, data } with data base64-encoded. Base64-in-JSON rather
  than multipart because every other endpoint in this repo is JSON and
  Vercel's request cap (~4.5MB) prices the ceiling anyway: MAX_BYTES below
  is the decoded size, chosen to fit under that cap with base64's +33%.

  Banner images render small — a circle at most 190px wide in the highlights
  panel — so 3MB is already generous, not a constraint anyone hits with
  reasonable art.

  Needs BLOB_READ_WRITE_TOKEN in the Vercel env (created with the Blob
  store). Fails with a plain message if it is missing rather than letting
  @vercel/blob throw something cryptic.
*/
const MAX_BYTES = 3 * 1024 * 1024;
const TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const who = await requireScope(req, res, 'banners');
  if (!who) return;

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return res.status(500).json({ error: 'BLOB_READ_WRITE_TOKEN is not configured — create a Blob store in the Vercel dashboard' });
  }

  const b = parseBody(req);
  const type = (b.type || '').toString();
  if (!(type in TYPES)) return res.status(400).json({ error: 'Type must be png, jpeg, webp or gif', types: Object.keys(TYPES) });

  // Declare the type first, assign on its own line — and never trust the
  // client's byte count, only the decoded buffer's.
  let bytes;
  try { bytes = Buffer.from((b.data || '').toString(), 'base64'); }
  catch { return res.status(400).json({ error: 'data is not valid base64' }); }
  if (!bytes || bytes.length === 0) return res.status(400).json({ error: 'Empty file' });
  if (bytes.length > MAX_BYTES) {
    return res.status(400).json({ error: `Image is ${(bytes.length / 1048576).toFixed(1)}MB — the cap is 3MB`, max: MAX_BYTES });
  }

  // Magic-byte check so a renamed .exe cannot become a "png" on the CDN.
  const sig = bytes.subarray(0, 12);
  const okSig =
    (type === 'image/png' && sig[0] === 0x89 && sig[1] === 0x50) ||
    (type === 'image/jpeg' && sig[0] === 0xFF && sig[1] === 0xD8) ||
    (type === 'image/gif' && sig[0] === 0x47 && sig[1] === 0x49) ||
    (type === 'image/webp' && sig[8] === 0x57 && sig[9] === 0x45);
  if (!okSig) return res.status(400).json({ error: 'File contents do not match the declared type' });

  const base = (b.name || 'banner').toString().replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60) || 'banner';

  try {
    const blob = await put(`banners/${base}.${TYPES[type]}`, bytes, {
      access: 'public',
      contentType: type,
      addRandomSuffix: true, // never overwrite; an old banner may still reference the old file
    });
    res.status(200).json({ ok: true, url: blob.url, bytes: bytes.length });
  } catch (err) {
    res.status(500).json({ error: 'Upload failed', detail: String(err) });
  }
}
