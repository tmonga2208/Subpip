// The store offers a listing per language only for an extension that names its
// languages in the package: the name and summary come from _locales, and each
// language's summary matches the one drafted beside its store description
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const LANGUAGES = ['en', 'id', 'ko', 'th', 'tr', 'vi', 'zh_CN', 'zh_TW'];
const manifest = JSON.parse(readFileSync('src/manifest.json', 'utf8'));
const messages = (language) => JSON.parse(readFileSync(`src/_locales/${language}/messages.json`, 'utf8'));

test('the name and summary come from the language files, English by default', () => {
  assert.equal(manifest.default_locale, 'en');
  assert.equal(manifest.name, '__MSG_extName__');
  assert.equal(manifest.description, '__MSG_extDescription__');
  assert.equal(messages('en').extName.message, 'SubPIP (Picture-in-Picture)');
  assert.equal(messages('en').extDescription.message, 'Picture-in-Picture that keeps the subtitles. Style the captions, translate them, and follow a video while you work in another tab.');
});

test('eight languages, each with a name and a summary the store accepts', () => {
  assert.deepEqual(readdirSync('src/_locales').sort(), LANGUAGES);
  for (const language of LANGUAGES) {
    const { extName, extDescription } = messages(language);
    assert.equal(extName.message, 'SubPIP (Picture-in-Picture)', language);
    assert.ok(extDescription.message.length > 20 && extDescription.message.length <= 132, `${language}: ${extDescription.message.length} characters`);
  }
});

test('each summary is the one drafted with that language\'s store description', () => {
  for (const language of LANGUAGES.filter((each) => each !== 'en')) {
    const drafted = readFileSync(`store/description.${language}.txt`, 'utf8').split('\n')[1];
    assert.equal(messages(language).extDescription.message, drafted, language);
  }
});

test('the build puts the language files in the package', () => {
  assert.match(readFileSync('build.mjs', 'utf8'), /'_locales'/);
});
