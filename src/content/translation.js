// Caption translation: in-memory + IndexedDB cache, requests relayed to the
// background through translate-relay.js (page CSP cannot block that).

export const translationCache = {};

// IndexedDB for persistent translation cache
let translationDB = null;
const DB_NAME = 'SubPIPTranslations';
const DB_VERSION = 1;
const STORE_NAME = 'translations';

// Initialize IndexedDB
async function initTranslationDB() {
  return new Promise((resolve, reject) => {
    if (translationDB) {
      resolve(translationDB);
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);

    request.onsuccess = () => {
      translationDB = request.result;
      resolve(translationDB);
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };
  });
}

// Get from IndexedDB cache
async function getFromCache(cacheKey) {
  try {
    const db = await initTranslationDB();
    return new Promise((resolve) => {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(cacheKey);

      request.onsuccess = () => {
        resolve(request.result?.translation || null);
      };
      request.onerror = () => resolve(null);
    });
  } catch (e) {
    return null;
  }
}

// Save to IndexedDB cache
async function saveToCache(cacheKey, translation) {
  try {
    const db = await initTranslationDB();
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    store.put({ key: cacheKey, translation: translation, timestamp: Date.now() });
  } catch (e) {
    // Silent fail - cache is optional
  }
}

// Translation: request goes via content-script relay to background (avoids page CSP blocking fetch)
export async function translateText(text, targetLang, uid) {
  if (!text || text.trim() === '') return text;

  const cacheKey = `${text}_${targetLang}`;

  // 1. Check session cache (instant)
  if (translationCache[cacheKey]) {
    return translationCache[cacheKey];
  }

  // 2. Check IndexedDB cache (~5ms)
  const cachedTranslation = await getFromCache(cacheKey);
  if (cachedTranslation) {
    translationCache[cacheKey] = cachedTranslation;
    return cachedTranslation;
  }

  // 3. Request translation via relay (background does fetch; page CSP cannot block it)
  const id = 'subpip_' + Date.now() + '_' + Math.random().toString(36).slice(2);
  const result = await new Promise(function (resolve) {
    const timeout = setTimeout(function () {
      window.removeEventListener('message', handler);
      resolve(null);
    }, 8000);
    function handler(e) {
      if (e.source !== window || !e.data || e.data.type !== 'SUBPIP_TRANSLATE_RESPONSE' || e.data.id !== id) return;
      window.removeEventListener('message', handler);
      clearTimeout(timeout);
      resolve(e.data.translation);
    }
    window.addEventListener('message', handler);
    window.postMessage({ type: 'SUBPIP_TRANSLATE_REQUEST', id, text, targetLang, uid }, '*');
  });

  if (result && result !== text) {
    translationCache[cacheKey] = result;
    await saveToCache(cacheKey, result);
    return result;
  }
  return text;
}
