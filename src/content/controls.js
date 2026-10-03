// PiP window controls: a Cinema-style bottom bar in a shadow root so the site
// stylesheets copied into the PiP window cannot restyle it. Everything is
// built with DOM calls - YouTube enforces Trusted Types (no HTML strings).

import { createIcon } from '../shared/icons.js';
import { CONTROLS_CSS } from './controls.css.js';

const HIDE_DELAY_MS = 2500;
const HOST_LAYOUT = {
  display: 'block', position: 'fixed', top: '0', right: '0', bottom: '0', left: '0',
  width: 'auto', height: 'auto', margin: '0', padding: '0', border: '0',
  transform: 'none', 'z-index': '2147483647', 'pointer-events': 'none'
};

export function formatTime(seconds) {
  if (isNaN(seconds) || !isFinite(seconds)) return '--:--';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const pad = (n) => (n < 10 ? '0' : '') + n;
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`;
}

// createElement with props: class, text, attributes; children may be strings
function make(doc, tag, props = {}, children = []) {
  const node = doc.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else node.setAttribute(key, value);
  }
  node.append(...children);
  return node;
}

export function createControls({ video, pipDoc, session, seekTo, captions }) {
  const { listen, onCleanup } = session;
  const h = (tag, props, ...children) => make(pipDoc, tag, props, children);
  const setIcon = (button, name) => button.replaceChildren(createIcon(pipDoc, name));
  const setLabel = (button, label) => {
    button.setAttribute('aria-label', label);
    button.title = label;
  };
  const iconButton = (cls, label, iconName) => {
    const button = h('button', { class: `btn ${cls}`, type: 'button' });
    setLabel(button, label);
    setIcon(button, iconName);
    return button;
  };

  const host = pipDoc.createElement('subpip-controls');
  // Inline !important beats page stylesheets copied into the PiP window
  // (e.g. `body > * { position: relative }` would otherwise collapse us)
  for (const [prop, value] of Object.entries(HOST_LAYOUT)) host.style.setProperty(prop, value, 'important');
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.append(h('style', { text: CONTROLS_CSS }));

  const seekInput = h('input', { class: 'seek-input', type: 'range', min: '0', max: '0', step: '0.1', value: '0', 'aria-label': 'Seek' });
  const tip = h('div', { class: 'tip', hidden: '' });
  const playBtn = iconButton('play', 'Play (Space)', 'play');
  const backBtn = iconButton('skip back', 'Back 10 seconds (←)', 'back10');
  const fwdBtn = iconButton('skip fwd', 'Forward 10 seconds (→)', 'forward10');
  const muteBtn = iconButton('mute', 'Mute (M)', 'volume');
  const volInput = h('input', { class: 'vol-input', type: 'range', min: '0', max: '1', step: '0.01', 'aria-label': 'Volume' });
  const cur = h('span', { class: 'cur', text: '0:00' });
  const dur = h('span', { class: 'dur', text: '--:--' });
  const ccBtn = iconButton('cc', 'Captions (C)', 'cc');
  ccBtn.setAttribute('aria-pressed', 'true');

  const row = h('div', { class: 'row' },
    playBtn, backBtn, fwdBtn,
    h('div', { class: 'vol' }, muteBtn, volInput),
    h('span', { class: 'time' }, cur, ' / ', dur),
    h('span', { class: 'spacer' }),
    ccBtn
  );
  const bar = h('div', { class: 'bar' }, h('div', { class: 'seek' }, seekInput, tip), row);
  const root = h('div', { class: 'root' }, h('div', { class: 'fade' }), bar);
  shadow.append(root);
  // Keep focus off buttons on mouse press, so Space keeps meaning play/pause
  root.addEventListener('mousedown', (event) => {
    if (event.target.closest('.btn, .menu-item')) event.preventDefault();
  });

  // Play / pause
  const syncPlay = () => {
    setIcon(playBtn, video.paused ? 'play' : 'pause');
    setLabel(playBtn, video.paused ? 'Play (Space)' : 'Pause (Space)');
  };
  playBtn.addEventListener('click', () => (video.paused ? video.play() : video.pause()));
  listen(video, 'play', syncPlay);
  listen(video, 'pause', syncPlay);
  syncPlay();

  backBtn.addEventListener('click', () => seekTo(video.currentTime - 10));
  fwdBtn.addEventListener('click', () => seekTo(video.currentTime + 10));

  // Volume
  const syncVolume = () => {
    const muted = video.muted || video.volume === 0;
    setIcon(muteBtn, muted ? 'volume-muted' : 'volume');
    setLabel(muteBtn, muted ? 'Unmute (M)' : 'Mute (M)');
    volInput.value = muted ? 0 : video.volume;
  };
  muteBtn.addEventListener('click', () => {
    video.muted = !video.muted;
    if (!video.muted && video.volume === 0) video.volume = 0.5;
  });
  volInput.addEventListener('input', () => {
    const volume = parseFloat(volInput.value);
    video.volume = volume;
    video.muted = volume === 0;
  });
  listen(video, 'volumechange', syncVolume);
  syncVolume();

  // Seek bar: preview while dragging, seek once on release
  let dragging = false;
  const setProgress = (time) => {
    const max = parseFloat(seekInput.max) || 0;
    seekInput.style.setProperty('--p', max ? `${(time / max) * 100}%` : '0%');
  };
  const syncDuration = () => {
    const duration = video.duration;
    const known = isFinite(duration) && duration > 0;
    seekInput.max = known ? duration : 0;
    seekInput.disabled = !known;
    root.classList.toggle('no-seek', !known);
    dur.textContent = duration === Infinity ? 'Live' : formatTime(known ? duration : NaN);
  };
  const syncTime = () => {
    if (dragging) return;
    cur.textContent = formatTime(video.currentTime || 0);
    seekInput.value = video.currentTime || 0;
    setProgress(video.currentTime || 0);
  };
  seekInput.addEventListener('input', () => {
    dragging = true;
    const time = parseFloat(seekInput.value);
    cur.textContent = formatTime(time);
    setProgress(time);
  });
  seekInput.addEventListener('change', () => {
    seekTo(parseFloat(seekInput.value));
    dragging = false;
  });
  seekInput.addEventListener('pointermove', (event) => {
    const max = parseFloat(seekInput.max);
    if (!max) return;
    const rect = seekInput.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    tip.textContent = formatTime(ratio * max);
    tip.style.left = `${ratio * 100}%`;
    tip.hidden = false;
  });
  seekInput.addEventListener('pointerleave', () => { tip.hidden = true; });
  listen(video, 'durationchange', syncDuration);
  listen(video, 'loadedmetadata', syncDuration);
  listen(video, 'timeupdate', syncTime);
  listen(video, 'seeked', syncTime);
  syncDuration();
  syncTime();

  // Captions on/off
  let captionsOn = true;
  const setCaptions = (on) => {
    captionsOn = on;
    captions.setVisible(on);
    setIcon(ccBtn, on ? 'cc' : 'cc-off');
    ccBtn.setAttribute('aria-pressed', String(on));
  };
  ccBtn.addEventListener('click', () => setCaptions(!captionsOn));

  // Show on mouse move; hide (with the cursor) after idle. Bottom captions
  // lift by the bar's height while it is shown.
  let menu = null;
  let visible = false;
  let pointerInside = false;
  let hideTimer = null;
  const menuOpen = () => !!menu && menu.isOpen();
  const setVisible = (on) => {
    visible = on;
    root.classList.toggle('visible', on);
    pipDoc.body.style.cursor = on ? '' : 'none';
    const shift = on ? Math.ceil(bar.getBoundingClientRect().height) + 6 : 0;
    pipDoc.documentElement.style.setProperty('--subpip-caption-shift', `${shift}px`);
  };
  const scheduleHide = () => {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (!pointerInside && !menuOpen()) setVisible(false);
    }, HIDE_DELAY_MS);
  };
  const show = () => {
    setVisible(true);
    scheduleHide();
  };
  const trackPointer = (element) => {
    element.addEventListener('pointerenter', () => { pointerInside = true; });
    element.addEventListener('pointerleave', () => { pointerInside = false; scheduleHide(); });
  };
  trackPointer(bar);
  onCleanup(() => clearTimeout(hideTimer));
  listen(pipDoc, 'mousemove', show);
  listen(pipDoc.documentElement, 'mouseleave', () => {
    if (menuOpen()) return;
    clearTimeout(hideTimer);
    setVisible(false);
  });
  root.addEventListener('focusin', show);
  pipDoc.documentElement.style.setProperty('--subpip-caption-shift', '0px');

  return {
    host,
    bar,
    show,
    isVisible: () => visible,
    toggleCaptions: () => setCaptions(!captionsOn),
    captionsOn: () => captionsOn,
    closeMenu: () => menu && menu.close(),
    // Settings menu: button goes at the end of the row, panel above the bar
    mountMenu(menuParts) {
      menu = menuParts;
      row.append(menuParts.button);
      root.insertBefore(menuParts.panel, bar);
      root.append(...(menuParts.extras || []));
      trackPointer(menuParts.panel);
    }
  };
}

// Keyboard shortcuts inside the PiP window
export function handlePipKeydown(event, { video, seekTo, controls }) {
  const origin = event.composedPath()[0];
  const tag = origin && origin.tagName;
  // Our seek/volume sliders keep the shortcuts; real text fields don't
  const isSlider = tag === 'INPUT' && origin.type === 'range';
  if ((tag === 'INPUT' && !isSlider) || tag === 'SELECT' || tag === 'TEXTAREA') return;
  // A focused button already acts on Space/Enter; don't double-toggle
  if (tag === 'BUTTON' && (event.code === 'Space' || event.code === 'Enter')) return;

  switch (event.code) {
    case 'Space':
      if (video.paused) video.play();
      else video.pause();
      break;
    case 'ArrowRight':
      seekTo(video.currentTime + 10);
      break;
    case 'ArrowLeft':
      seekTo(video.currentTime - 10);
      break;
    case 'ArrowUp':
      video.muted = false;
      video.volume = Math.min(1, video.volume + 0.1);
      break;
    case 'ArrowDown':
      video.volume = Math.max(0, video.volume - 0.1);
      break;
    case 'KeyM':
      video.muted = !video.muted;
      break;
    case 'KeyC':
      controls.toggleCaptions();
      break;
    case 'Escape':
      controls.closeMenu();
      break;
    default:
      return;
  }
  event.preventDefault();
  controls.show();
}
