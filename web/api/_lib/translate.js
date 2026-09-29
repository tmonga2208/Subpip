// Premium translation: shared cache → per-user daily cap → DeepL. When DeepL
// can't help, the server declines and the extension falls back to MyMemory
// from the user's own browser (its own free quota). The server never calls MyMemory.
import crypto from 'node:crypto';
import { HttpsError } from './http.js';
import { alertOwner, day } from './alerts.js';

export const DAILY_CHAR_LIMIT = 60000;
export const MAX_TEXT_LENGTH = 1000;
export const DEEPL_TARGETS = { en: 'EN-US', es: 'ES', fr: 'FR', de: 'DE', it: 'IT', pt: 'PT-BR', zh: 'ZH-HANS', ja: 'JA', ko: 'KO', ar: 'AR', ru: 'RU' };
const DEEPL_URL = 'https://api-free.deepl.com/v2/translate';

const cacheId = (lang, text) => crypto.createHash('sha256').update(`${lang}\n${text}`).digest('hex');

export async function translateForUser(deps, uid, text, lang) {
  const target = DEEPL_TARGETS[lang];
  if (!target || !deps.deeplKey) throw new HttpsError('failed-precondition', 'UNSUPPORTED_LANGUAGE');

  const cacheRef = deps.db.collection('translations').doc(cacheId(lang, text));
  const cached = await cacheRef.get();
  if (cached.exists) return { translation: cached.data().translation, provider: 'cache' };

  const usageRef = deps.db.collection('usage').doc(`${uid}_${day(deps.now())}`);
  const allowed = await deps.db.runTransaction(async (tx) => {
    const snap = await tx.get(usageRef);
    const used = snap.exists ? snap.data().chars : 0;
    if (used + text.length > DAILY_CHAR_LIMIT) return false;
    tx.set(usageRef, { chars: used + text.length }, { merge: true });
    return true;
  });
  if (!allowed) throw new HttpsError('resource-exhausted', 'Daily translation limit reached');

  const response = await deps.fetch(DEEPL_URL, {
    method: 'POST',
    headers: { Authorization: `DeepL-Auth-Key ${deps.deeplKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: [text], target_lang: target })
  });
  if (response.status === 456) {
    await alertOwner(deps, 'deepl-quota', 'DeepL monthly character quota is used up; Premium translation is falling back to MyMemory until it resets.');
    throw new HttpsError('resource-exhausted', 'Translation quota reached');
  }
  if (!response.ok) throw new HttpsError('unavailable', 'Translation service unavailable');
  const translation = (await response.json()).translations?.[0]?.text;
  if (!translation) throw new HttpsError('unavailable', 'Translation service unavailable');

  await cacheRef.set({ lang, text, translation, provider: 'deepl', createdAt: deps.FieldValue.serverTimestamp() });
  return { translation, provider: 'deepl' };
}
