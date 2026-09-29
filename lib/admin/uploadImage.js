import { put } from '@vercel/blob';
import { requireScope, cors, parseBody } from './auth.js';
import { blobToken } from './blob.js';
import { logChange } from './log.js';

/*
  POST /api/admin/uploadImage — images into Vercel Blob.

  Two kinds, and the kind decides who may upload:
    kind:'banner' (default) → 'banners' scope, banners/ prefix, 1.5MB
    kind:'avatar'           → ANY valid key, avatars/ prefix, 400KB

  The avatar branch is open on purpose. A profile picture you cannot set
  yourself is not a profile picture, and gating it behind 'banners' meant
  only the three people who edit hero art could have a face. The cap is
  low because the client downscales to 256x256 WebP before sending — 400KB
  is roughly twenty times what a correct upload weighs, so it only ever
  catches something that skipped the resize.

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
const MAX_BYTES = 1.5 * 1024 * 1024;   // banner art renders ≤190px — 1.5MB is already generous
const AVATAR_MAX_BYTES = 400 * 1024;   // a 256px WebP is ~20KB; this only catches an un-resized upload
const MAX_DIM = 2000;                  // px, either axis
const AVATAR_MAX_DIM = 1024;
const MIN_DIM = 50;
const TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };

/* Pixel dimensions straight from the container headers — no image library,
   and never trusted from the client. Returns {w,h} or null if unreadable. */
function imageDims(type, b) {
  try {
    if (type === 'image/png') {
      return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
    }
    if (type === 'image/gif') {
      return { w: b.readUInt16LE(6), h: b.readUInt16LE(8) };
    }
    if (type === 'image/jpeg') {
      // walk the markers to the first SOF0/1/2
      let i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xFF) { i++; continue; }
        const m = b[i + 1];
        if (m >= 0xC0 && m <= 0xC2) return { w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5) };
        if (m === 0xD8 || (m >= 0xD0 && m <= 0xD9)) { i += 2; continue; }
        i += 2 + b.readUInt16BE(i + 2);
      }
      return null;
    }
    if (type === 'image/webp') {
      const four = b.toString('ascii', 12, 16);
      if (four === 'VP8X') return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
      if (four === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3FFF, h: b.readUInt16LE(28) & 0x3FFF };
      if (four === 'VP8L') {
        const n = b.readUInt32LE(21);
        return { w: 1 + (n & 0x3FFF), h: 1 + ((n >> 14) & 0x3FFF) };
      }
      return null;
    }
  } catch { return null; }
  return null;
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const b0 = parseBody(req);
  const kind = (b0.kind || 'banner').toString() === 'avatar' ? 'avatar' : 'banner';
  // An avatar is yours; banner art is the org's front page.
  const who = await requireScope(req, res, kind === 'avatar' ? null : 'banners');
  if (!who) return;

  const maxBytes = kind === 'avatar' ? AVATAR_MAX_BYTES : MAX_BYTES;
  const maxDim = kind === 'avatar' ? AVATAR_MAX_DIM : MAX_DIM;

  const token = blobToken();
  if (!token) {
    return res.status(500).json({ error: 'No Blob token in the env — connect the Blob store to this project in the Vercel dashboard' });
  }

  const b = b0;
  const type = (b.type || '').toString();
  if (!(type in TYPES)) return res.status(400).json({ error: 'Type must be png, jpeg, webp or gif', types: Object.keys(TYPES) });

  // Declare the type first, assign on its own line — and never trust the
  // client's byte count, only the decoded buffer's.
  let bytes;
  try { bytes = Buffer.from((b.data || '').toString(), 'base64'); }
  catch { return res.status(400).json({ error: 'data is not valid base64' }); }
  if (!bytes || bytes.length === 0) return res.status(400).json({ error: 'Empty file' });
  if (bytes.length > maxBytes) {
    return res.status(400).json({
      error: `Image is ${(bytes.length / 1048576).toFixed(1)}MB — the cap is ${(maxBytes / 1048576).toFixed(1)}MB`,
      max: maxBytes,
    });
  }

  // Magic-byte check so a renamed .exe cannot become a "png" on the CDN.
  const sig = bytes.subarray(0, 12);
  const okSig =
    (type === 'image/png' && sig[0] === 0x89 && sig[1] === 0x50) ||
    (type === 'image/jpeg' && sig[0] === 0xFF && sig[1] === 0xD8) ||
    (type === 'image/gif' && sig[0] === 0x47 && sig[1] === 0x49) ||
    (type === 'image/webp' && sig[8] === 0x57 && sig[9] === 0x45);
  if (!okSig) return res.status(400).json({ error: 'File contents do not match the declared type' });

  const dims = imageDims(type, bytes);
  if (!dims) return res.status(400).json({ error: 'Could not read the image dimensions — the file may be corrupt' });
  if (dims.w > maxDim || dims.h > maxDim) {
    return res.status(400).json({ error: `Image is ${dims.w}×${dims.h}px — the cap is ${maxDim}px on either side. It renders small, so export smaller.` });
  }
  if (dims.w < MIN_DIM || dims.h < MIN_DIM) {
    return res.status(400).json({ error: `Image is ${dims.w}×${dims.h}px — too small to render cleanly (minimum ${MIN_DIM}px)` });
  }

  const base = (b.name || kind).toString().replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60) || kind;

  try {
    const blob = await put(`${kind === 'avatar' ? 'avatars' : 'banners'}/${base}.${TYPES[type]}`, bytes, {
      access: 'public',
      contentType: type,
      addRandomSuffix: true, // never overwrite; an old banner may still reference the old file
      token, // explicit — the env var name depends on how the store was connected
    });
    res.status(200).json({ ok: true, url: blob.url, bytes: bytes.length });
  } catch (err) {
    res.status(500).json({ error: 'Upload failed', detail: String(err) });
  }
}
