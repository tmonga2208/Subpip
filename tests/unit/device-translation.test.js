// Translation on the user's device (Chrome's built-in Translator and
// LanguageDetector), with stand-ins for the two browser APIs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDeviceTranslation } from '../../src/shared/device-translation.js';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// detect(text) -> [language, confidence]; a translator answers "[en>es] text"
function fakeChrome({ detect = () => ['en', 1], createDelay = 0, cannotTranslate = [], failCreate = 0 } = {}) {
  const log = { created: [], availabilityChecks: 0, detected: [] };
  const scope = {
    LanguageDetector: {
      availability: async () => 'available',
      create: async () => ({
        detect: async (text) => {
          log.detected.push(text);
          const [detectedLanguage, confidence] = detect(text);
          return [{ detectedLanguage, confidence }];
        }
      })
    },
    Translator: {
      availability: async ({ sourceLanguage, targetLanguage }) => {
        log.availabilityChecks += 1;
        return cannotTranslate.includes(`${sourceLanguage}>${targetLanguage}`) ? 'unavailable' : 'downloadable';
      },
      create: async ({ sourceLanguage, targetLanguage }) => {
        const pair = `${sourceLanguage}>${targetLanguage}`;
        log.created.push(pair);
        if (log.created.length <= failCreate) throw new Error('NotSupportedError');
        await wait(createDelay);
        return { translate: async (text) => `[${pair}] ${text}` };
      }
    }
  };
  return { scope, log };
}
const device = (scope, options) => createDeviceTranslation({ scope, waitMs: 30, ...options });

test('a caption line is translated on the device, from the language it is in', async () => {
  const { scope } = fakeChrome({ detect: () => ['ja', 0.99] });
  assert.equal(await device(scope).translate('どこにいたの？', 'en'), '[ja>en] どこにいたの？');
});

test('one translator per language pair serves every line', async () => {
  const { scope, log } = fakeChrome();
  const translation = device(scope);
  assert.equal(await translation.translate('Where were you?', 'es'), '[en>es] Where were you?');
  assert.equal(await translation.translate('Do not move.', 'es'), '[en>es] Do not move.');
  assert.deepEqual(log.created, ['en>es']);
});

test('a browser without the built-in APIs leaves every line to the online service', async () => {
  assert.equal(await device({}).translate('Where were you?', 'es'), null);
  const { scope, log } = fakeChrome();
  delete scope.LanguageDetector;
  assert.equal(await device(scope).translate('Where were you?', 'es'), null);
  assert.deepEqual(log.created, []);
});

test('a line whose language is unclear is left to the online service', async () => {
  const { scope, log } = fakeChrome({ detect: () => ['km', 0.39] });
  assert.equal(await device(scope).translate('♪♪', 'es'), null);
  assert.deepEqual(log.created, []);
});

test('a line already in the target language comes back as it is, with no translator', async () => {
  const { scope, log } = fakeChrome({ detect: () => ['es', 1] });
  assert.equal(await device(scope).translate('¿Dónde estuviste anoche?', 'es'), '¿Dónde estuviste anoche?');
  assert.deepEqual(log.created, []);
});

test('while a language pack is downloading, lines go online; once it is there they stay on the device', async () => {
  const { scope, log } = fakeChrome({ createDelay: 120 });
  const translation = device(scope);
  assert.equal(await translation.translate('Where were you?', 'es'), null);
  assert.equal(await translation.translate('Do not move.', 'es'), null);
  await wait(150);
  assert.equal(await translation.translate('Where were you?', 'es'), '[en>es] Where were you?');
  assert.deepEqual(log.created, ['en>es'], 'the download is started once, not per line');
});

test('only the line that starts a download waits for it; the following lines go online at once', async () => {
  const { scope } = fakeChrome({ createDelay: 400 });
  const translation = device(scope, { waitMs: 150 });
  await translation.translate('Where were you?', 'es');
  const before = performance.now();
  assert.equal(await translation.translate('Do not move.', 'es'), null);
  const took = performance.now() - before;
  assert.ok(took < 75, `the second line was held up for ${Math.round(took)}ms`);
});

test('a pair Chrome cannot translate is not asked for again on every line', async () => {
  const { scope, log } = fakeChrome({ detect: () => ['kn', 1], cannotTranslate: ['kn>ko'] });
  const translation = device(scope);
  assert.equal(await translation.translate('ನೀವು ಎಲ್ಲಿದ್ದೀರಿ?', 'ko'), null);
  assert.equal(await translation.translate('ಚಲಿಸಬೇಡಿ.', 'ko'), null);
  assert.equal(log.availabilityChecks, 1);
  assert.deepEqual(log.created, []);
});

test('a translator that failed to start is tried again later, not on every line', async () => {
  let clock = 1_000_000;
  const { scope, log } = fakeChrome({ failCreate: 1 });
  const translation = device(scope, { retryMs: 30_000, now: () => clock });
  assert.equal(await translation.translate('Where were you?', 'es'), null);
  assert.equal(await translation.translate('Do not move.', 'es'), null);
  assert.deepEqual(log.created, ['en>es'], 'no second attempt straight away');
  clock += 30_001;
  assert.equal(await translation.translate('Do not move.', 'es'), '[en>es] Do not move.');
});

test('a short line takes the language of the lines before it in the same video', async () => {
  // Like the real detector: sure about a sentence, unsure about "OK."
  const { scope } = fakeChrome({ detect: (text) => (text.length > 15 ? ['en', 1] : ['en', 0.38]) });
  const translation = device(scope);
  assert.equal(await translation.translate('OK.', 'es', 'tab-7'), null);
  assert.equal(await translation.translate('Where were you last night?', 'es', 'tab-7'), '[en>es] Where were you last night?');
  assert.equal(await translation.translate('OK.', 'es', 'tab-7'), '[en>es] OK.');
  // another video has its own context
  assert.equal(await translation.translate('OK.', 'es', 'tab-8'), null);
});

test('a line the detector is sure about is judged on its own, whatever came before it', async () => {
  // The real detector loses confidence on text that mixes languages, so the
  // line must not be shown to it glued to the previous ones
  const spanish = /[¿ñé]/;
  const english = /\b(the|you|were)\b/;
  const { scope, log } = fakeChrome({
    detect: (text) => {
      if (text.length < 8) return ['en', 0.3];
      if (spanish.test(text) && english.test(text)) return ['en', 0.5];
      return spanish.test(text) ? ['es', 1] : ['en', 1];
    }
  });
  const translation = device(scope);
  assert.equal(await translation.translate('Where were you last night?', 'es', 'tab-7'), '[en>es] Where were you last night?');
  // the film switches to Spanish: this line is already in the target language
  assert.equal(await translation.translate('¿Dónde estuviste anoche?', 'es', 'tab-7'), '¿Dónde estuviste anoche?');
  assert.equal(log.detected.at(-1), '¿Dónde estuviste anoche?');
  // and a short line now follows the new language
  assert.equal(await translation.translate('Sí.', 'en', 'tab-7'), '[es>en] Sí.');
});

test('Simplified and Traditional Chinese are not treated as the same language', async () => {
  const { scope } = fakeChrome({ detect: () => ['zh-Hant', 1] });
  assert.equal(await device(scope).translate('你昨晚在哪裡？', 'zh'), '[zh-Hant>zh] 你昨晚在哪裡？');
});

test('a translator that throws leaves the line to the online service', async () => {
  const { scope } = fakeChrome();
  scope.Translator.create = async () => ({ translate: async () => { throw new Error('model crashed'); } });
  assert.equal(await device(scope).translate('Where were you?', 'es'), null);
});

test('preparing a language fetches what it needs before the first caption arrives', async () => {
  const { scope, log } = fakeChrome({ createDelay: 100 });
  const translation = device(scope);
  translation.prepare('es');
  await wait(150);
  // English is the usual language of captions, so that pair is the one prepared
  assert.deepEqual(log.created, ['en>es']);
  assert.equal(await translation.translate('Where were you?', 'es'), '[en>es] Where were you?');
  assert.deepEqual(log.created, ['en>es']);
});

test('preparing does nothing a browser cannot do, and never throws', async () => {
  createDeviceTranslation({ scope: {}, waitMs: 30 }).prepare('es');
  const { scope, log } = fakeChrome();
  device(scope).prepare('en'); // captions are assumed English: nothing to translate into English yet
  await wait(20);
  assert.deepEqual(log.created, []);
});
