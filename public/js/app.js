// Strona właściciela: logowanie, wysyłanie, lista zdjęć.
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult,
  onAuthStateChanged, signOut,
} from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js';
import { app } from './firebase.js';
import {
  OWNER_EMAIL, MAX_FILE_SIZE, QUOTA_BYTES, EXPIRY_DAYS, DEFAULT_EXPIRY_DAYS, SHARD_SIZE, ABANDONED_UPLOAD_MS,
} from './config.js';
import { stripGps } from './strip-gps.js';
import { uploadImage, deleteImage, listImages } from './shards.js';
import {
  el, toast, copyText, linkFor, formatSize, formatDate, formatRelative, daysLabel, thumbUrl,
} from './util.js';

const auth = getAuth(app);
const $ = (s) => document.querySelector(s);
const screens = { loading: $('#screen-loading'), login: $('#screen-login'), denied: $('#screen-denied'), main: $('#screen-main') };
function show(name) { for (const [k, s] of Object.entries(screens)) s.hidden = k !== name; }

let selectedDays = DEFAULT_EXPIRY_DAYS;
let pendingFile = null;
let busy = false;

// ---------- Logowanie ----------
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });

$('#btn-login').addEventListener('click', async () => {
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment', 'auth/web-storage-unsupported'].includes(e.code)) {
      await signInWithRedirect(auth, provider);
    } else if (e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') {
      toast('Logowanie nie powiodło się: ' + (e.code || e.message));
    }
  }
});
getRedirectResult(auth).catch((e) => toast('Logowanie nie powiodło się: ' + (e.code || e.message)));
for (const b of document.querySelectorAll('.btn-logout')) b.addEventListener('click', () => signOut(auth));

onAuthStateChanged(auth, (user) => {
  if (!user) return show('login');
  if ((user.email || '').toLowerCase() !== OWNER_EMAIL.toLowerCase()) {
    $('#denied-email').textContent = user.email || '(brak adresu)';
    return show('denied');
  }
  $('#user-email').textContent = user.email;
  show('main');
  refreshList();
});

// ---------- Wybór wygasania ----------
const expiryBox = $('#expiry');
for (const d of EXPIRY_DAYS) {
  const b = el('button', { type: 'button', class: 'chip', 'aria-pressed': String(d === selectedDays), onclick: () => {
    selectedDays = d;
    for (const c of expiryBox.children) c.setAttribute('aria-pressed', String(c === b));
  } }, daysLabel(d));
  expiryBox.append(b);
}

// ---------- Wybór pliku ----------
const fileInput = $('#file');
fileInput.addEventListener('change', () => {
  const f = fileInput.files?.[0];
  fileInput.value = '';
  if (!f) return;
  if (f.size > MAX_FILE_SIZE) return toast(`Plik za duży (maks. ${formatSize(MAX_FILE_SIZE)})`);
  pendingFile = f;
  const prev = $('#preview');
  if (prev.dataset.url) URL.revokeObjectURL(prev.dataset.url);
  prev.dataset.url = URL.createObjectURL(f);
  prev.src = prev.dataset.url;
  $('#preview-name').textContent = f.name || 'zdjęcie';
  const shards = Math.max(1, Math.ceil(f.size / SHARD_SIZE));
  $('#preview-meta').textContent = `${formatSize(f.size)} · ${shards} ${shards === 1 ? 'część' : 'części'} po 1 MB`;
  $('#picked').hidden = false;
  $('#result').hidden = true;
  $('#picker').hidden = true;
});

$('#btn-cancel').addEventListener('click', resetPicker);
function resetPicker() {
  pendingFile = null;
  $('#picked').hidden = true;
  $('#picker').hidden = false;
  $('#progress').hidden = true;
}

// ---------- Wysyłanie ----------
$('#btn-upload').addEventListener('click', async () => {
  if (!pendingFile || busy) return;
  busy = true;
  const btn = $('#btn-upload');
  btn.disabled = true; $('#btn-cancel').disabled = true;
  const bar = $('#progress'); const fill = $('#progress-fill'); const label = $('#progress-label');
  bar.hidden = false; fill.style.width = '0%'; label.textContent = 'Przygotowanie…';
  try {
    const original = new Uint8Array(await pendingFile.arrayBuffer());
    const { bytes, removed } = stripGps(original);
    const { id, expireAt } = await uploadImage({
      bytes, name: pendingFile.name, type: pendingFile.type, days: selectedDays, gpsRemoved: removed > 0,
      onProgress: (done, total) => {
        fill.style.width = `${Math.round((done / total) * 100)}%`;
        label.textContent = `Wysyłanie części ${Math.min(done + 1, total)} z ${total}…`;
        if (done === total) label.textContent = 'Kończenie…';
      },
    });
    showResult(id, expireAt, removed > 0);
    resetPicker();
    refreshList();
  } catch (e) {
    console.error(e);
    label.textContent = e?.code === 'permission-denied'
      ? 'Brak uprawnień — sprawdź adres e-mail w firestore.rules.'
      : e?.code === 'resource-exhausted'
        ? 'Przekroczony darmowy limit Firestore. Usuń stare zdjęcia lub spróbuj jutro.'
        : 'Błąd wysyłania: ' + (e?.code || e?.message || e);
  } finally {
    busy = false; btn.disabled = false; $('#btn-cancel').disabled = false;
  }
});

function showResult(id, expireAt, gpsRemoved) {
  const url = linkFor(id);
  $('#result-link').value = url;
  $('#result-info').textContent = `Ważny do ${formatDate(expireAt)}` + (gpsRemoved ? ' · lokalizacja GPS usunięta' : '');
  $('#btn-open').href = url;
  $('#btn-share').hidden = !navigator.share;
  $('#result').hidden = false;
  $('#result').scrollIntoView({ behavior: 'smooth', block: 'center' });
}
$('#btn-copy').addEventListener('click', () => copyText($('#result-link').value));
$('#btn-share').addEventListener('click', () => navigator.share({ url: $('#result-link').value }).catch(() => {}));

// ---------- Lista i sprzątanie ----------
async function refreshList() {
  const list = $('#list');
  let items;
  try { items = await listImages(); }
  catch (e) {
    list.replaceChildren(el('p', { class: 'muted' }, 'Nie udało się wczytać listy: ' + (e.code || e.message)));
    return;
  }
  const now = Date.now();
  const expired = items.filter((x) => x.expireAt.toMillis() <= now ||
    (!x.complete && now - (x.createdAt?.toMillis?.() ?? now) > ABANDONED_UPLOAD_MS));
  const active = items.filter((x) => !expired.includes(x) && x.complete);

  // sprzątanie wygasłych i przerwanych (zapasowo do automatycznego TTL)
  for (const x of expired) deleteImage(x.id, x.shards).catch((e) => console.warn('cleanup', x.id, e));

  const used = active.reduce((s, x) => s + x.size, 0);
  $('#usage-fill').style.width = `${Math.min(100, (used / QUOTA_BYTES) * 100)}%`;
  $('#usage-label').textContent = `${active.length} zdj. · ${formatSize(used)} z ${formatSize(QUOTA_BYTES)}`;

  if (!active.length) {
    list.replaceChildren(el('p', { class: 'muted empty' }, 'Brak aktywnych zdjęć.'));
    return;
  }
  list.replaceChildren(...active.map((x) => {
    const t = thumbUrl(x.thumb);
    const exp = x.expireAt.toDate();
    return el('article', { class: 'item' },
      t ? el('img', { class: 'thumb', src: t, alt: '', loading: 'lazy' }) : el('div', { class: 'thumb placeholder' }, '🖼'),
      el('div', { class: 'item-body' },
        el('div', { class: 'item-name' }, x.name),
        el('div', { class: 'muted small' }, `${formatSize(x.size)} · wygasa ${formatRelative(exp)}`),
        el('div', { class: 'item-actions' },
          el('button', { type: 'button', class: 'btn small', onclick: () => copyText(linkFor(x.id)) }, 'Kopiuj link'),
          el('a', { class: 'btn small ghost', href: linkFor(x.id), target: '_blank', rel: 'noopener' }, 'Otwórz'),
          el('button', { type: 'button', class: 'btn small danger', onclick: async (ev) => {
            if (!confirm(`Usunąć „${x.name}”? Link przestanie działać.`)) return;
            ev.target.disabled = true;
            try { await deleteImage(x.id, x.shards); toast('Usunięto'); refreshList(); }
            catch (e) { ev.target.disabled = false; toast('Nie udało się usunąć: ' + (e.code || e.message)); }
          } }, 'Usuń'),
        ),
      ),
    );
  }));
}
