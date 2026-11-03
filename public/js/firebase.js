// Inicjalizacja Firebase (wspólna dla strony wysyłania i strony z linkiem).
import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js';
import { FIREBASE_CONFIG } from './config.js';

async function loadConfig() {
  if (FIREBASE_CONFIG) return { ...FIREBASE_CONFIG };
  // Firebase Hosting sam udostępnia konfigurację projektu pod tym adresem.
  const res = await fetch('/__/firebase/init.json');
  if (!res.ok) throw new Error('Brak konfiguracji Firebase (init.json). Zobacz instrukcję, krok „Rozwiązywanie problemów”.');
  return res.json();
}

const config = await loadConfig();

// Logowanie przez tę samą domenę co strona — działa pewniej na iPhone (Safari) i Androidzie.
if (/\.(web\.app|firebaseapp\.com)$/.test(location.hostname)) {
  config.authDomain = location.hostname;
}

export const app = initializeApp(config);
export const db = getFirestore(app);
