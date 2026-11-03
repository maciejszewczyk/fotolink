// ====== USTAWIENIA — zmień tylko to, co jest opisane w instrukcji ======

// Adres Gmail (konto Google), którym będziesz się logować.
// UWAGA: prawdziwa blokada jest w pliku firestore.rules — tam też wpisz ten sam adres.
export const OWNER_EMAIL = 'TWOJ_ADRES@gmail.com';

// Zostaw null — konfiguracja pobierze się automatycznie z Firebase Hosting.
// (Tylko jeśli instrukcja tak mówi, wklej tu obiekt firebaseConfig z konsoli Firebase.)
export const FIREBASE_CONFIG = null;

// ====== Ustawienia techniczne (nie trzeba zmieniać) ======
export const SHARD_SIZE = 1_000_000;             // 1 MB na shard (limit dokumentu Firestore to 1 MiB)
export const MAX_FILE_SIZE = 25 * 1024 * 1024;   // maks. 25 MB na zdjęcie
export const QUOTA_BYTES = 1024 ** 3;            // darmowe 1 GiB w Firestore (plan Spark)
export const EXPIRY_DAYS = [1, 7, 30, 90];       // opcje wygasania linku
export const DEFAULT_EXPIRY_DAYS = 7;
export const ABANDONED_UPLOAD_MS = 60 * 60 * 1000; // przerwane wysyłanie sprzątamy po 1 h
