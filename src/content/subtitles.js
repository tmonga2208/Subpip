// Caption sources other than site DOM: text tracks and subtitle files

// A subtitles/captions track the site renders itself (mode "hidden").
// "showing" tracks are drawn by the video element, so they already appear in PiP.
export function findHiddenTextTrack(video) {
  return [...(video.textTracks || [])].find((track) =>
    (track.kind === 'subtitles' || track.kind === 'captions') && track.mode === 'hidden'
  ) || null;
}

export function cueText(track) {
  return [...(track.activeCues || [])]
    .map((cue) => (cue.text || '').replace(/<[^>]+>/g, ''))
    .join('\n')
    .trim();
}

// Parse VTT/SRT timestamp to seconds
function parseTimestamp(ts) {
  const m = ts.trim().match(/^(\d{2}):(\d{2}):(\d{2})[,.](\d{3})$/);
  if (m) return parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseInt(m[3], 10) + parseInt(m[4], 10) / 1000;
  const m2 = ts.trim().match(/^(\d{1,2}):(\d{2})[,.](\d{3})$/);
  if (m2) return parseInt(m2[1], 10) * 60 + parseInt(m2[2], 10) + parseInt(m2[3], 10) / 1000;
  return 0;
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
        textLines.push(lines[i].trim());
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
