// Caption lines over time, for the study tools: replaying a line, stepping to
// the one before or after, and stopping when one ends. A line is
// { start, end, text }; end is missing where it is not known (yet).

// Times this close count as the same moment
const SAME = 0.01;

// The line on screen at a time, or the last one that was
export function lineAt(lines, time) {
  let found = null;
  for (const line of lines) {
    if (line.start <= time + SAME) found = line;
    else break;
  }
  return found;
}

export function lineBefore(lines, time) {
  const current = lineAt(lines, time);
  return current ? lines[lines.indexOf(current) - 1] || null : null;
}

export function lineAfter(lines, time) {
  return lines.find((line) => line.start > time + SAME) || null;
}

// A site's captions arrive as text on its page, with no timings. This notes
// each line as it appears, so lines already seen can be gone back to.
const REPLAY_WINDOW = 3;
const GROWTH_WINDOW = 10;

export function createLineLog(limit = 300) {
  const lines = [];
  return {
    lines,
    // What the caption shows now ('' for nothing), at the video's time
    note(time, text) {
      const current = lineAt(lines, time);
      if (!text) {
        if (current && current.end === undefined && time > current.start) current.end = time;
        return;
      }
      // The same line again, after going back to it
      if (lines.some((line) => line.text === text && Math.abs(line.start - time) < REPLAY_WINDOW)) return;
      // Captions that fill in word by word are one line, growing
      if (current && current.end === undefined && text.startsWith(current.text) && time - current.start < GROWTH_WINDOW) {
        current.text = text;
        return;
      }
      if (current && current.end === undefined && time > current.start) current.end = time;
      const index = lines.findIndex((line) => line.start > time);
      lines.splice(index === -1 ? lines.length : index, 0, { start: time, text });
      if (lines.length > limit) lines.shift();
    }
  };
}

// The word at a position in a line, where there is one there (not on a space
// or punctuation). Works for languages written without spaces too.
export function wordAt(text, offset, locale) {
  for (const part of new Intl.Segmenter(locale, { granularity: 'word' }).segment(text)) {
    if (offset >= part.index && offset < part.index + part.segment.length) return part.isWordLike ? part.segment : null;
  }
  return null;
}

// Running speech as caption lines. Lines are filled from the start of what
// was said, so they break in the same places as more is said: a line fills
// up, then moves up for the next, as captions on live television do.
const SPEECH_LINE_LENGTH = 42;

export function speechLines(text, lineLength = SPEECH_LINE_LENGTH) {
  const lines = [];
  for (const word of (text || '').trim().split(/\s+/).filter(Boolean)) {
    const last = lines[lines.length - 1];
    if (last !== undefined && last.length + 1 + word.length <= lineLength) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  return lines;
}

// The latest two lines; hidden is how many lines were already taken off screen
export function speechCaption(text, hidden = 0) {
  const lines = speechLines(text);
  return lines.slice(Math.max(hidden, lines.length - 2)).join('\n');
}
