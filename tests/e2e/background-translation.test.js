// Where a caption gets translated: on the device when Chrome can do it,
// otherwise online. Driven the way the page script does it (through the
// relay), with stand-ins for Chrome's built-in APIs and for the network.
// The real Translator and LanguageDetector cannot be used here: the test
// browser starts with --disable-component-update and without
// "OptimizationHints", which is how Chrome fetches their models.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useExtension } from '../helpers/extension.js';

const ctx = useExtension();

// Every page gets its own address, so its tab cannot be mistaken for another test's
let pages = 0;
async function pageWithRelay() {
  const page = await ctx.newPage(`novideo.html?page=${++pages}`);
  const tabId = await ctx.tabIdFor(page.url());
  await ctx.worker.evaluate((id) => chrome.scripting.executeScript({ target: { tabId: id }, files: ['translate-relay.js'] }), tabId);
  return page;
}

const translate = (page, text, targetLang) => page.evaluate((line, lang) => new Promise((resolve, reject) => {
  const id = `test_${Math.random()}`;
  setTimeout(() => reject(new Error('no answer from the relay')), 5000);
  window.addEventListener('message', function handler(event) {
    if (event.data?.type !== 'SUBPIP_TRANSLATE_RESPONSE' || event.data.id !== id) return;
    window.removeEventListener('message', handler);
    resolve(event.data.translation);
  });
  window.postMessage({ type: 'SUBPIP_TRANSLATE_REQUEST', id, text: line, targetLang: lang }, '*');
}), text, targetLang);

// The online service always answers; the device APIs are there or not
const standIns = ({ onDevice }) => ctx.worker.evaluate((device) => {
  self.onlineRequests = [];
  self.fetch = async (url) => {
    self.onlineRequests.push(String(url));
    return new Response(JSON.stringify({ responseStatus: 200, responseData: { translatedText: 'from the online service' } }));
  };
  self.LanguageDetector = device ? {
    availability: async () => 'available',
    create: async () => ({ detect: async (text) => [{ detectedLanguage: /[¿¡ñ]/.test(text) ? 'es' : 'en', confidence: 1 }] })
  } : undefined;
  self.Translator = device ? {
    availability: async () => 'available',
    create: async ({ sourceLanguage, targetLanguage }) => ({ translate: async (text) => `[${sourceLanguage}>${targetLanguage} on device] ${text}` })
  } : undefined;
}, onDevice);
const onlineRequests = () => ctx.worker.evaluate(() => self.onlineRequests);

test('a caption is translated on the device, and nothing is sent to an online service', async () => {
  await standIns({ onDevice: true });
  const page = await pageWithRelay();
  assert.equal(await translate(page, 'Where were you last night?', 'es'), '[en>es on device] Where were you last night?');
  assert.deepEqual(await onlineRequests(), []);
  await page.close();
});

test('a caption already in the target language is not sent anywhere either', async () => {
  await standIns({ onDevice: true });
  const page = await pageWithRelay();
  assert.equal(await translate(page, '¿Dónde estuviste anoche?', 'es'), '¿Dónde estuviste anoche?');
  assert.deepEqual(await onlineRequests(), []);
  await page.close();
});

test('when the device cannot translate, the online service answers as before', async () => {
  await standIns({ onDevice: false });
  const page = await pageWithRelay();
  assert.equal(await translate(page, 'Where were you last night?', 'es'), 'from the online service');
  const requests = await onlineRequests();
  assert.equal(requests.length, 1);
  assert.match(requests[0], /^https:\/\/api\.mymemory\.translated\.net\/get\?q=Where%20were%20you%20last%20night%3F&langpair=Autodetect\|es$/);
  await page.close();
});

test('the popup can have a language prepared before any caption is translated', async () => {
  await standIns({ onDevice: true });
  await ctx.worker.evaluate(() => {
    self.prepared = [];
    const create = self.Translator.create;
    self.Translator.create = (pair) => { self.prepared.push(`${pair.sourceLanguage}>${pair.targetLanguage}`); return create(pair); };
  });
  const popup = await ctx.openPopup();
  await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'PREPARE_TRANSLATION', targetLang: 'hi' }));
  await ctx.worker.evaluate(() => new Promise((resolve) => setTimeout(resolve, 200)));
  assert.deepEqual(await ctx.worker.evaluate(() => self.prepared), ['en>hi']);
  await popup.close();
});
