// Usuwa dane lokalizacji (GPS) ze zdjęcia BEZ ponownego kodowania obrazu.
// Piksele zostają nietknięte — zmieniamy tylko metadane, w miejscu (rozmiar pliku się nie zmienia,
// poza PNG, gdzie przeliczamy sumy kontrolne fragmentów).
//
// Obsługiwane: JPEG, HEIC/HEIF/AVIF, WebP, PNG (EXIF + XMP), także zdjęcia z wieloma
// obrazami w środku (MPF/Ultra HDR), bo szukamy wszystkich bloków EXIF w pliku.
//
// Zwraca { bytes: Uint8Array, removed: liczba usuniętych bloków GPS }

const TYPE_SIZES = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4 };
const GPS_TAG = 0x8825;

// Czyści katalog GPS w bloku TIFF (EXIF) zaczynającym się w `start`.
function wipeGpsInTiff(buf, start, end) {
  if (end - start < 8) return 0;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const b0 = buf[start], b1 = buf[start + 1];
  let le;
  if (b0 === 0x49 && b1 === 0x49) le = true;        // "II"
  else if (b0 === 0x4d && b1 === 0x4d) le = false;  // "MM"
  else return 0;
  if (dv.getUint16(start + 2, le) !== 42) return 0;

  const u16 = (o) => dv.getUint16(o, le);
  const u32 = (o) => dv.getUint32(o, le);
  const inRange = (o, len) => o >= start && o + len <= end;

  const ifd0 = start + u32(start + 4);
  if (!inRange(ifd0, 2)) return 0;
  const n0 = u16(ifd0);
  if (!inRange(ifd0 + 2, n0 * 12)) return 0;

  let removed = 0;
  for (let i = 0; i < n0; i++) {
    const e = ifd0 + 2 + i * 12;
    if (u16(e) !== GPS_TAG) continue;
    const gps = start + u32(e + 8);
    if (!inRange(gps, 2)) continue;
    const n = u16(gps);
    if (!inRange(gps + 2, n * 12)) continue;

    // 1) wyzeruj dane wskazywane przez wpisy (współrzędne, wysokość, czas itd.)
    for (let j = 0; j < n; j++) {
      const ge = gps + 2 + j * 12;
      const size = (TYPE_SIZES[u16(ge + 2)] || 0) * u32(ge + 4);
      if (size > 4) {
        const off = start + u32(ge + 8);
        if (inRange(off, size)) buf.fill(0, off, off + size);
      }
    }
    // 2) wyzeruj same wpisy i ustaw ich liczbę na 0 (pusty, ale poprawny katalog)
    const tailEnd = Math.min(gps + 2 + n * 12 + 4, end);
    buf.fill(0, gps + 2, tailEnd);
    dv.setUint16(gps, 0, le);
    removed++;
  }
  return removed;
}

// Szuka sygnatury "Exif\0\0" + nagłówek TIFF w całym pliku (JPEG APP1, HEIC, obrazy MPF).
function wipeAllExif(buf) {
  let removed = 0;
  for (let i = 0; i + 10 < buf.length; i++) {
    if (buf[i] === 0x45 && buf[i + 1] === 0x78 && buf[i + 2] === 0x69 && buf[i + 3] === 0x66 &&
        buf[i + 4] === 0 && buf[i + 5] === 0) {
      removed += wipeGpsInTiff(buf, i + 6, buf.length);
    }
  }
  return removed;
}

// XMP to tekst XML — zamieniamy wartości pól GPS na spacje (ta sama długość, XML dalej poprawny).
function wipeGpsInXmp(buf, from = 0, to = buf.length) {
  // latin1: 1 bajt = 1 znak, więc indeksy w tekście = indeksy w buforze
  let text = '';
  const CH = 0x8000;
  for (let i = from; i < to; i += CH) {
    text += String.fromCharCode.apply(null, buf.subarray(i, Math.min(i + CH, to)));
  }
  if (text.indexOf('GPS') === -1) return 0;
  let removed = 0;
  const blank = (s, e) => { buf.fill(0x20, from + s, from + e); removed++; };

  // atrybuty:  exif:GPSLatitude="50,3.12N"   (dowolny prefiks przestrzeni nazw)
  const attr = /\b[\w-]+:GPS\w*\s*=\s*("[^"]*"|'[^']*')/g;
  let m;
  while ((m = attr.exec(text))) {
    const valStart = m.index + m[0].length - m[1].length + 1;
    blank(valStart, m.index + m[0].length - 1);
  }
  // elementy:  <exif:GPSLatitude>50,3.12N</exif:GPSLatitude>
  const el = /<([\w-]+:GPS\w*)\b[^>]*>([\s\S]*?)<\/\1>/g;
  while ((m = el.exec(text))) {
    const inner = m[2];
    if (!inner.length) continue;
    const innerStart = m.index + m[0].indexOf('>') + 1;
    blank(innerStart, innerStart + inner.length);
  }
  return removed;
}

// --- PNG: fragmenty mają CRC, więc trzeba je przeliczyć po zmianie ---
let CRC_TABLE;
function crc32(buf, from, to) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = from; i < to; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function stripPng(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let removed = 0;
  let p = 8;
  while (p + 12 <= buf.length) {
    const len = dv.getUint32(p);
    const type = String.fromCharCode(buf[p + 4], buf[p + 5], buf[p + 6], buf[p + 7]);
    const data = p + 8;
    if (data + len + 4 > buf.length) break;
    let r = 0;
    if (type === 'eXIf') r = wipeGpsInTiff(buf, data, data + len);
    else if (type === 'iTXt' || type === 'tEXt') r = wipeGpsInXmp(buf, data, data + len);
    if (r) {
      dv.setUint32(data + len, crc32(buf, p + 4, data + len));
      removed += r;
    }
    if (type === 'IEND') break;
    p = data + len + 4;
  }
  return removed;
}

// --- WebP: fragment EXIF może nie mieć prefiksu "Exif\0\0" ---
function stripWebpExifChunks(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let removed = 0;
  let p = 12;
  while (p + 8 <= buf.length) {
    const type = String.fromCharCode(buf[p], buf[p + 1], buf[p + 2], buf[p + 3]);
    const len = dv.getUint32(p + 4, true);
    const data = p + 8;
    if (data + len > buf.length) break;
    if (type === 'EXIF') {
      const hasPrefix = buf[data] === 0x45 && buf[data + 1] === 0x78; // "Ex" — obsłużone przez wipeAllExif
      if (!hasPrefix) removed += wipeGpsInTiff(buf, data, data + len);
    }
    p = data + len + (len & 1);
  }
  return removed;
}

export function stripGps(input) {
  const buf = new Uint8Array(input); // kopia — oryginał zostaje nietknięty
  const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  const isWebp = buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
                 buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50;
  let removed = 0;
  try {
    if (isPng) {
      removed += stripPng(buf);
    } else {
      removed += wipeAllExif(buf);
      if (isWebp) removed += stripWebpExifChunks(buf);
      removed += wipeGpsInXmp(buf);
    }
  } catch (e) {
    console.warn('Usuwanie GPS: nietypowy plik, część metadanych mogła zostać', e);
  }
  return { bytes: buf, removed };
}
