// Study tools (Premium): step through the caption lines, stop after each one,
// click a word in a caption for its meaning, save a line.
//   A previous line · S replay the line · D next line · Q stop after each line

import { lineAt, lineBefore, lineAfter, wordAt } from './lines.js';
import { translateText } from './translation.js';

export function createStudyTools({ video, pipDoc, session, captions, controls, seekTo, getSettings }) {
  const el = (tag, cls, text) => {
    const node = pipDoc.createElement(tag);
    node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  // The meaning on screen, and whether the video was playing when it opened
  let lookup = null;
  let wasPlaying = false;
  function closeLookup() {
    if (!lookup) return false;
    lookup.remove();
    lookup = null;
    if (wasPlaying) video.play();
    return true;
  }

  // The line both ways, and - where the caption shows the original - the word
  // that was clicked with its meaning. The video waits meanwhile.
  function openLookup(word, line) {
    closeLookup();
    const { targetLanguage: language, uid } = getSettings();
    wasPlaying = !video.paused;
    video.pause();

    const box = el('div', 'lookup');
    const fill = (node, text) => translateText(text, language, uid).then((translation) => {
      node.textContent = translation || text;
    });
    let meaning = null;
    if (word) {
      meaning = el('span', 'lookup-meaning', '…');
      const head = el('div', 'lookup-head');
      head.append(el('span', 'lookup-word', word), meaning);
      box.append(head);
      fill(meaning, word);
    }
    const translation = el('div', 'lookup-translation', '…');
    const save = el('button', 'lookup-save', 'Save line');
    save.type = 'button';
    box.append(el('div', 'lookup-line', line), translation, save);
    fill(translation, line);

    // Kept by the extension, on this computer (the relay does the saving)
    save.addEventListener('click', () => {
      const text = (node) => (node && node.textContent !== '…' ? node.textContent : '');
      window.postMessage({ type: 'SUBPIP_SAVE_LINE', line: { text: line, translation: text(translation), word: word || '', meaning: text(meaning) } }, '*');
      save.textContent = 'Saved';
      save.disabled = true;
    });

    lookup = box;
    controls.mount(box);
  }

  const caretAt = (x, y) => {
    if (pipDoc.caretPositionFromPoint) {
      const position = pipDoc.caretPositionFromPoint(x, y);
      return position ? { node: position.offsetNode, offset: position.offset } : null;
    }
    const range = pipDoc.caretRangeFromPoint ? pipDoc.caretRangeFromPoint(x, y) : null;
    return range ? { node: range.startContainer, offset: range.startOffset } : null;
  };

  // Before the window's own click handling: a click on a caption looks a word
  // up, and a click anywhere else while a meaning is open only closes it
  session.listen(pipDoc, 'click', (event) => {
    const path = event.composedPath();
    if (lookup && path.includes(lookup)) return;
    const caption = path.find((node) => node.hasAttribute && node.hasAttribute('data-subpip-captions'));
    if (!caption) {
      if (closeLookup()) event.stopPropagation();
      return;
    }
    event.stopPropagation();
    const line = captions.rawLine;
    if (!line) return;
    // A caption showing the translation has no original word to look up
    const translated = (captions.translationOn && !getSettings().dualSubtitles) || path.some((node) => node.classList && node.classList.contains('subpip-translation'));
    let word = null;
    const caret = translated ? null : caretAt(event.clientX, event.clientY);
    if (caret && caret.node && caret.node.nodeType === 3) {
      // The caret sits between letters: after the last letter still means that word
      word = wordAt(caret.node.data, caret.offset) || wordAt(caret.node.data, caret.offset - 1);
    }
    openLookup(word, line);
    controls.show();
  }, true);

  const go = (pick) => {
    const line = pick(captions.lines(), video.currentTime);
    if (!line) return;
    closeLookup();
    seekTo(line.start);
    video.play();
  };

  return {
    get pauseAfterLine() { return captions.pauseAfterLine; },
    setPauseAfterLine(on) { captions.setPauseAfterLine(on); },
    // True when the key was one of the study keys (the window then leaves it alone)
    handleKeydown(event) {
      const origin = event.composedPath()[0];
      const tag = origin && origin.tagName;
      if ((tag === 'INPUT' && origin.type !== 'range') || tag === 'SELECT' || tag === 'TEXTAREA') return false;
      if (event.ctrlKey || event.metaKey || event.altKey) return false;
      if (lookup && (event.code === 'Escape' || event.code === 'Space')) {
        closeLookup();
      } else if (event.code === 'KeyS') {
        go(lineAt);
      } else if (event.code === 'KeyA') {
        go(lineBefore);
      } else if (event.code === 'KeyD') {
        go(lineAfter);
      } else if (event.code === 'KeyQ') {
        captions.setPauseAfterLine(!captions.pauseAfterLine);
        controls.refreshMenu();
      } else {
        return false;
      }
      event.preventDefault();
      controls.show();
      return true;
    }
  };
}
