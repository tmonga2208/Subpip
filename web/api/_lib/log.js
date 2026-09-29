// One JSON line per notable event, searchable in Vercel's logs
export function log(level, event, fields = {}) {
  const line = JSON.stringify({ level, event, ...fields });
  if (level === 'error') console.error(line);
  else console.log(line);
}
