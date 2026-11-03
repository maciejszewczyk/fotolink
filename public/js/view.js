// Strona z linkiem: pobiera shardy, skleja, sprawdza sumę kontrolną i daje przycisk „Pobierz”.
import { downloadImage } from './shards.js';
import { ID_PATTERN, formatSize, formatDate, el } from './util.js';

const $ = (s) => document.querySelector(s);
const id = location.pathname.split('/').filter(Boolean)[1] || '';

function fail(title, text) {
  $('#loading').hidden = true;
  $('#content').hidden = true;
  $('#error-title').textContent = title;
  $('#error-text').textContent = text;
  $('#error').hidden = false;
}

async function main() {
  if (!ID_PATTERN.test(id)) return fail('Nieprawidłowy link', 'Sprawdź, czy link został skopiowany w całości.');
  let result;
  try {
    result = await downloadImage(id, (done, total) => {
      $('#loading-label').textContent = total > 1 ? `Pobieranie części ${done} z ${total}…` : 'Pobieranie…';
      $('#loading-fill').style.width = `${total ? Math.round((done / total) * 100) : 0}%`;
    });
  } catch (e) {
    console.error(e);
    if (e.code === 'permission-denied' || e.code === 'not-found') {
      return fail('Link wygasł lub nie istnieje', 'Poproś osobę, która go wysłała, o nowy link.');
    }
    if (e.code === 'corrupted') return fail('Plik jest uszkodzony', 'Spróbuj odświeżyć stronę.');
    if (e.code === 'resource-exhausted') return fail('Chwilowo niedostępne', 'Dzienny limit został wyczerpany. Spróbuj jutro.');
    return fail('Nie udało się pobrać', 'Sprawdź połączenie z internetem i odśwież stronę.');
  }

  const { meta, bytes } = result;
  const blob = new Blob([bytes], { type: meta.type });
  const url = URL.createObjectURL(blob);
  const name = meta.name || 'zdjecie';

  document.title = name;
  $('#name').textContent = name;
  $('#info').textContent = `${formatSize(meta.size)} · link ważny do ${formatDate(meta.expireAt.toDate())}`;

  const img = $('#image');
  img.onerror = () => {
    img.replaceWith(el('div', { class: 'no-preview muted' }, 'Podgląd niedostępny w tej przeglądarce (np. format HEIC), ale plik można pobrać.'));
  };
  img.src = url;
  img.alt = name;

  const dl = $('#btn-download');
  dl.href = url;
  dl.download = name;

  // Na telefonie: „Zapisz / Udostępnij” otwiera systemowe menu (np. „Zapisz obraz” na iPhonie).
  try {
    const file = new File([blob], name, { type: meta.type });
    if (navigator.canShare?.({ files: [file] })) {
      const sh = $('#btn-save');
      sh.hidden = false;
      sh.addEventListener('click', () => navigator.share({ files: [file] }).catch(() => {}));
    }
  } catch { /* starsze przeglądarki */ }

  $('#loading').hidden = true;
  $('#content').hidden = false;
}

main();
