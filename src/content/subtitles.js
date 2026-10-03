// Caption sources other than site DOM: text tracks and subtitle files

// A subtitles/captions track the site renders itself (mode "hidden").
// "showing" tracks are drawn by the video element, so they already appear in PiP.
export function findHiddenTextTrack(video) {
  return [...(video.textTracks || [])].find((track) =>
    (track.kind === 'subtitles' || track.kind === 'captions') && track.mode === 'hidden'
  ) || null;
}

const CHARACTER_REFERENCES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', lrm: '', rlm: '' };

// Caption text as plain text: formatting tags (<i>, <font ...>, <v Name>,
// <c.class>, karaoke <00:01.000>) and ASS overrides ({\an8}) are removed and
// character references decoded. Captions are shown with textContent, so
// anything left in would appear on screen as typed.
export function plainCaptionText(text) {
  return (text || '')
    .replace(/\{\\[^}]*\}/g, '')
    .replace(/<\/?[a-zA-Z][^>]*>|<\d+:\d{2}(?::\d{2})?[.,]\d{1,3}>/g, '')
    .replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (whole, ref) => {
      if (ref[0] !== '#') return ref in CHARACTER_REFERENCES ? CHARACTER_REFERENCES[ref] : whole;
      const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    })
    .trim();
}

export function cueText(track) {
  return [...(track.activeCues || [])]
    .map((cue) => plainCaptionText(cue.text))
    .join('\n')
    .trim();
}

// Parse a VTT/SRT timestamp to seconds: [h:]mm:ss.mmm, hours of any length.
// NaN when it cannot be read, so the cue is dropped rather than placed at 0.
function parseTimestamp(ts) {
  const m = ts.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})[,.](\d{1,3})$/);
  if (!m) return NaN;
  return Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, '0')) / 1000;
}

// Parse VTT or SRT content into cues [{ start, end, text }]
export function parseVTTOrSRT(content) {
  const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const cues = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const arrow = line.indexOf('-->');
    if (arrow !== -1) {
      const startStr = line.slice(0, arrow).trim();
      const endStr = line.slice(arrow + 3).trim().split(/\s/)[0];
      const start = parseTimestamp(startStr);
      const end = parseTimestamp(endStr);
      const textLines = [];
      i++;
      while (i < lines.length && lines[i].trim() !== '') {
        const text = plainCaptionText(lines[i]);
        if (text) textLines.push(text);
        i++;
      }
      if (start >= 0 && end > start && textLines.length) {
        cues.push({ start, end, text: textLines.join('\n') });
      }
    }
    i++;
  }
  return cues;
}
