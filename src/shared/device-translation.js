// Translation on the user's device, with Chrome's built-in Translator and
// LanguageDetector (Chrome 138+). A caption line takes a few milliseconds,
// costs nothing and never leaves the browser. Chrome fetches a language pack
// the first time a language is used (a few seconds); until it is there, and
// wherever the APIs are missing or unsure, translate() answers null and the
// caller uses the online services instead.

// The language last recognised per video is remembered, so a line too short
// to tell ("OK.") takes the language of the lines before it
const MAX_VIDEOS = 20;

// Regional variants are one language ("pt" and "pt-BR"); the two Chinese
// scripts are not
function sameLanguage(a, b) {
  const [left, right] = [a.toLowerCase(), b.toLowerCase()];
  if (left === right) return true;
  const base = (tag) => tag.split('-')[0];
  return base(left) === base(right) && base(left) !== 'zh';
}

export function createDeviceTranslation({ scope = globalThis, waitMs = 400, retryMs = 10000, minConfidence = 0.7, now = () => Date.now() } = {}) {
  const languages = new Map();
  const translators = new Map();

  // A model Chrome may have to download first. The returned function answers
  // null when it is not there yet. The call that starts it waits a moment (a
  // model already on the machine is ready within that time); a real download
  // carries on in the background without holding up the lines that follow,
  // and after a failure it is started again only once retryMs has passed.
  function lazily(create) {
    let model = null;
    let starting = null;
    let failedAt = -Infinity;
    return async () => {
      if (model || starting || now() - failedAt < retryMs) return model;
      starting = create()
        .then((created) => { model = created; }, () => { failedAt = now(); })
        .finally(() => { starting = null; });
      await Promise.race([starting, new Promise((resolve) => setTimeout(resolve, waitMs))]);
      return model;
    };
  }

  const detector = lazily(async () => {
    if (await scope.LanguageDetector.availability() === 'unavailable') throw new Error('No language detection on this device');
    return scope.LanguageDetector.create();
  });

  function translatorFor(sourceLanguage, targetLanguage) {
    const pair = `${sourceLanguage}>${targetLanguage}`;
    if (!translators.has(pair)) {
      translators.set(pair, lazily(async () => {
        const fromTo = { sourceLanguage, targetLanguage };
        if (await scope.Translator.availability(fromTo) === 'unavailable') throw new Error(`Chrome cannot translate ${pair}`);
        return scope.Translator.create(fromTo);
      }));
    }
    return translators.get(pair)();
  }

  // Each line is judged on its own (the detector loses confidence on text
  // that mixes languages); only an unclear one falls back on its video's
  // language so far.
  async function languageOf(text, contextKey) {
    const detect = await detector();
    if (!detect) return null;
    const [top] = await detect.detect(text);
    const sure = top && top.detectedLanguage !== 'und' && top.confidence >= minConfidence;
    if (!sure) return languages.get(contextKey) || null;
    if (contextKey !== undefined) {
      languages.delete(contextKey);
      languages.set(contextKey, top.detectedLanguage);
      if (languages.size > MAX_VIDEOS) languages.delete(languages.keys().next().value);
    }
    return top.detectedLanguage;
  }

  return {
    // Start fetching what translating into a language will need (the language
    // detector and, for the usual English captions, the language pack), so it
    // is there before the first caption. Never throws.
    prepare(targetLanguage, sourceLanguage = 'en') {
      if (!targetLanguage || !scope.Translator || !scope.LanguageDetector) return;
      detector().catch(() => {});
      if (!sameLanguage(sourceLanguage, targetLanguage)) translatorFor(sourceLanguage, targetLanguage).catch(() => {});
    },
    // contextKey names the video the line belongs to (the tab id). Resolves to
    // the translation - the text itself when it already is in the target
    // language - or to null when the device cannot do it right now.
    async translate(text, targetLanguage, contextKey) {
      if (!text || !targetLanguage || !scope.Translator || !scope.LanguageDetector) return null;
      try {
        const sourceLanguage = await languageOf(text, contextKey);
        if (!sourceLanguage) return null;
        if (sameLanguage(sourceLanguage, targetLanguage)) return text;
        const translator = await translatorFor(sourceLanguage, targetLanguage);
        return translator ? await translator.translate(text) : null;
      } catch (e) {
        return null;
      }
    }
  };
}
