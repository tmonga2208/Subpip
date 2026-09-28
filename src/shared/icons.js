// One icon set for the PiP window, popup and website (24x24, currentColor).
// createIcon() builds DOM nodes, which is safe on Trusted Types pages like
// YouTube; iconMarkup() returns a string for extension pages and the website.

const SVG_NS = 'http://www.w3.org/2000/svg';
const STROKE = { fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
const FILL = { fill: 'currentColor' };

const ICONS = {
  play: [['path', { d: 'M8 5v14l11-7z', ...FILL }]],
  pause: [['path', { d: 'M7 5h3.5v14H7zM13.5 5H17v14h-3.5z', ...FILL }]],
  back10: [['path', { d: 'M4 12a8 8 0 1 0 2.3-5.7M4 4v4h4', ...STROKE }]],
  forward10: [['path', { d: 'M20 12a8 8 0 1 1-2.3-5.7M20 4v4h-4', ...STROKE }]],
  volume: [['path', { d: 'M4 9h4l5-4v14l-5-4H4z', ...FILL }], ['path', { d: 'M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12', ...STROKE }]],
  'volume-muted': [['path', { d: 'M4 9h4l5-4v14l-5-4H4z', ...FILL }], ['path', { d: 'M16 9l5 6M21 9l-5 6', ...STROKE }]],
  cc: [['rect', { x: '3', y: '5', width: '18', height: '14', rx: '3', ...STROKE }], ['path', { d: 'M10.5 10a2 2 0 1 0 0 4M17 10a2 2 0 1 0 0 4', ...STROKE }]],
  'cc-off': [['rect', { x: '3', y: '5', width: '18', height: '14', rx: '3', ...STROKE }], ['path', { d: 'M10.5 10a2 2 0 1 0 0 4M17 10a2 2 0 1 0 0 4', ...STROKE }], ['path', { d: 'M3 3l18 18', ...STROKE }]],
  gear: [['circle', { cx: '12', cy: '12', r: '3', ...STROKE }], ['path', { d: 'M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1', ...STROKE }]],
  check: [['path', { d: 'M5 12.5l4.5 4.5L19 7', ...STROKE }]],
  'chevron-right': [['path', { d: 'M9 6l6 6-6 6', ...STROKE }]],
  'chevron-left': [['path', { d: 'M15 6l-6 6 6 6', ...STROKE }]],
  lock: [['rect', { x: '5', y: '11', width: '14', height: '10', rx: '2', ...STROKE }], ['path', { d: 'M8 11V8a4 4 0 0 1 8 0v3', ...STROKE }]],
  fill: [['path', { d: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5', ...STROKE }]],
  close: [['path', { d: 'M6 6l12 12M18 6L6 18', ...STROKE }]],
  spinner: [['path', { d: 'M12 3a9 9 0 1 0 9 9', ...STROKE }]],
  person: [['circle', { cx: '12', cy: '8', r: '4', ...STROKE }], ['path', { d: 'M4 20c1.5-4 4.5-6 8-6s6.5 2 8 6', ...STROKE }]]
};

export const ICON_NAMES = Object.keys(ICONS);

function parts(name) {
  const icon = ICONS[name];
  if (!icon) throw new Error(`Unknown icon: ${name}`);
  return icon;
}

export function createIcon(doc, name) {
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const [tag, attrs] of parts(name)) {
    const node = doc.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    svg.append(node);
  }
  return svg;
}

export function iconMarkup(name) {
  const inner = parts(name)
    .map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ')}/>`)
    .join('');
  return `<svg xmlns="${SVG_NS}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${inner}</svg>`;
}
