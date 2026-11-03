// Drobne funkcje pomocnicze.

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

// Losowe ID o długości 22 znaków (~131 bitów losowości) — praktycznie nie do zgadnięcia.
export function randomId(len = 22) {
  let out = '';
  const buf = new Uint8Array(len * 2);
  while (out.length < len) {
    crypto.getRandomValues(buf);
    for (const b of buf) {
      if (b < 248 && out.length < len) out += ALPHABET[b % 62]; // 248 = 4*62, bez przekłamań rozkładu
    }
  }
  return out;
}

export const ID_PATTERN = /^[A-Za-z0-9]{22}$/;

export async function sha256Hex(bytes) {
  const h = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function formatSize(bytes) {
  const nf = (n, d) => n.toLocaleString('pl-PL', { maximumFractionDigits: d });
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${nf(bytes / 1024, 0)} KB`;
  if (bytes < 1024 ** 3) return `${nf(bytes / 1024 ** 2, 1)} MB`;
  return `${nf(bytes / 1024 ** 3, 2)} GB`;
}

const dtf = new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
export const formatDate = (d) => dtf.format(d);

const rtf = new Intl.RelativeTimeFormat('pl-PL', { numeric: 'auto' });
export function formatRelative(date) {
  const diff = date.getTime() - Date.now();
  const abs = Math.abs(diff);
  if (abs < 3600e3) return rtf.format(Math.round(diff / 60e3), 'minute');
  if (abs < 86400e3) return rtf.format(Math.round(diff / 3600e3), 'hour');
  return rtf.format(Math.round(diff / 86400e3), 'day');
}

export function daysLabel(n) {
  return n === 1 ? '1 dzień' : `${n} dni`;
}

export function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null) e.append(c);
  return e;
}

export function toast(msg) {
  let t = document.getElementById('toast');
  if (!t) { t = el('div', { id: 'toast', role: 'status' }); document.body.append(t); }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('show'), 2200);
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = el('textarea', {}, text); document.body.append(ta); ta.select();
    document.execCommand('copy'); ta.remove();
  }
  toast('Skopiowano link');
}

export function linkFor(id) {
  return `${location.origin}/v/${id}`;
}

// Miniaturka (~320 px) tylko do listy i podglądu — oryginał NIE jest zmieniany.
export async function makeThumb(blob) {
  try {
    const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    const scale = Math.min(1, 320 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bmp.width * scale));
    c.height = Math.max(1, Math.round(bmp.height * scale));
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close?.();
    const out = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.7));
    if (!out || out.size > 60000) return null;
    return new Uint8Array(await out.arrayBuffer());
  } catch {
    return null; // np. HEIC w Chrome — po prostu bez miniaturki
  }
}

export function thumbUrl(bytesField) {
  if (!bytesField) return null;
  return URL.createObjectURL(new Blob([bytesField.toUint8Array()], { type: 'image/jpeg' }));
}
