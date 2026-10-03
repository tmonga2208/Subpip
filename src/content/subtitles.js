// Caption sources other than site DOM: text tracks and subtitle files

// The subtitle and caption tracks a video carries
export function subtitleTracks(video) {
  return [...(video.textTracks || [])].filter((track) => track.kind === 'subtitles' || track.kind === 'captions');
}

const sameLanguage = (a, b) => !!a && !!b && a.toLowerCase().split('-')[0] === b.toLowerCase().split('-')[0];

// The track to start with: one the page has on, else the viewer's language,
// else the first. wasMode holds what a track's mode was before SubPIP took it
// over (see captions.js).
export function preferredTrack(tracks, wasMode = new Map(), languages = navigator.languages) {
  const mode = (track) => wasMode.get(track) || track.mode;
  return tracks.find((track) => mode(track) === 'showing')
    || tracks.find((track) => mode(track) === 'hidden')
    || languages.map((language) => tracks.find((track) => sameLanguage(track.language, language))).find(Boolean)
    || tracks[0]
    || null;
}

// What to call a track in the menu: its label, else its language, else its place
export function trackLabel(track, index) {
  if (track.label) return track.label;
  try {
    const name = new Intl.DisplayNames(['en'], { type: 'language' }).of(track.language);
    if (name && name !== track.language) return name;
  } catch (e) {
    // Not a language tag
  }
  return `Track ${index + 1}`;
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

// The lines of a text track at a time. Read from the cues themselves, not
// from activeCues: a track that loads while the video is paused has its cues
// long before the browser marks any of them active.
export function trackTextAt(track, time) {
  return [...(track.cues || [])]
    .filter((cue) => time >= cue.startTime && time < cue.endTime)
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

// The line on screen at a given time ('' when there is none)
export function cueAt(cues, time) {
  const cue = cues.find((c) => time >= c.start && time <= c.end);
  return cue ? cue.text : '';
}

// Subtitle files are usually UTF-8, but plenty of older ones are UTF-16 (they
// say so with a byte-order mark) or Windows-1252
export function decodeSubtitleFile(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xFF && bytes[1] === 0xFE) return new TextDecoder('utf-16le').decode(buffer);
  if (bytes[0] === 0xFE && bytes[1] === 0xFF) return new TextDecoder('utf-16be').decode(buffer);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch (e) {
    return new TextDecoder('windows-1252').decode(buffer);
  }
}
