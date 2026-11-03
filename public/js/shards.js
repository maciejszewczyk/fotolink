// Sharding: zapis zdjęcia w kawałkach po 1 MB w Firestore i sklejanie przy odczycie.
//
// Struktura w bazie:
//   images/{id}               — metadane: nazwa, typ, rozmiar, liczba shardów, SHA-256, daty, miniaturka
//   images/{id}/shards/0..N-1 — kawałki pliku (pole "d" typu Bytes) + expireAt
//
// Kolejność zapisu: metadane (complete=false) → shardy → complete=true.
// Link działa dopiero, gdy wszystko jest zapisane. Przerwane wysyłanie sprząta się samo.

import {
  doc, getDoc, setDoc, updateDoc, writeBatch, collection, getDocs, query, orderBy,
  Bytes, Timestamp, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js';
import { db } from './firebase.js';
import { SHARD_SIZE } from './config.js';
import { sha256Hex, randomId, makeThumb } from './util.js';

export function splitIntoShards(bytes, size = SHARD_SIZE) {
  const parts = [];
  for (let i = 0; i < bytes.length; i += size) parts.push(bytes.subarray(i, i + size));
  return parts.length ? parts : [new Uint8Array(0)];
}

export function joinShards(parts) {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

async function withRetry(fn, tries = 3) {
  for (let i = 1; ; i++) {
    try { return await fn(); }
    catch (e) {
      if (i >= tries || e?.code === 'permission-denied') throw e;
      await new Promise((r) => setTimeout(r, 800 * i));
    }
  }
}

// bytes — plik już po usunięciu GPS
export async function uploadImage({ bytes, name, type, days, gpsRemoved, onProgress }) {
  const id = randomId();
  const expireAt = Timestamp.fromMillis(Date.now() + days * 86400e3);
  const parts = splitIntoShards(bytes);
  const sha256 = await sha256Hex(bytes);
  const thumb = await makeThumb(new Blob([bytes], { type }));

  const metaRef = doc(db, 'images', id);
  const meta = {
    name: (name || 'zdjecie').slice(0, 200),
    type: (type || 'application/octet-stream').slice(0, 100),
    size: bytes.length,
    shards: parts.length,
    sha256,
    gpsRemoved: !!gpsRemoved,
    createdAt: serverTimestamp(),
    expireAt,
    complete: false,
  };
  if (thumb) meta.thumb = Bytes.fromUint8Array(thumb);

  await withRetry(() => setDoc(metaRef, meta));
  onProgress?.(0, parts.length);

  for (let i = 0; i < parts.length; i++) {
    await withRetry(() => setDoc(doc(db, 'images', id, 'shards', String(i)), {
      d: Bytes.fromUint8Array(parts[i]),
      expireAt,
    }));
    onProgress?.(i + 1, parts.length);
  }

  await withRetry(() => updateDoc(metaRef, { complete: true }));
  return { id, expireAt: expireAt.toDate() };
}

export async function downloadImage(id, onProgress) {
  const metaSnap = await getDoc(doc(db, 'images', id));
  if (!metaSnap.exists()) throw Object.assign(new Error('not-found'), { code: 'not-found' });
  const meta = metaSnap.data();
  let done = 0;
  onProgress?.(0, meta.shards);
  const parts = await Promise.all(
    Array.from({ length: meta.shards }, (_, i) =>
      withRetry(() => getDoc(doc(db, 'images', id, 'shards', String(i)))).then((s) => {
        if (!s.exists()) throw Object.assign(new Error('missing-shard'), { code: 'not-found' });
        onProgress?.(++done, meta.shards);
        return s.get('d').toUint8Array();
      }),
    ),
  );
  const bytes = joinShards(parts);
  if (bytes.length !== meta.size || (await sha256Hex(bytes)) !== meta.sha256) {
    throw Object.assign(new Error('checksum'), { code: 'corrupted' });
  }
  return { meta, bytes };
}

// Usuwa zdjęcie razem ze wszystkimi shardami (tylko właściciel).
export async function deleteImage(id, shardCount) {
  const batch = writeBatch(db);
  for (let i = 0; i < shardCount; i++) batch.delete(doc(db, 'images', id, 'shards', String(i)));
  batch.delete(doc(db, 'images', id));
  await batch.commit();
}

// Lista zdjęć właściciela (tylko metadane — bez pobierania shardów).
export async function listImages() {
  const snap = await getDocs(query(collection(db, 'images'), orderBy('createdAt', 'desc')));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
