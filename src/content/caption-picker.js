// "Point at the captions": on a site SubPIP does not know, the viewer clicks
// the caption text on the page once, and SubPIP follows that element from then
// on (captions.js). Everything is built with DOM calls and style properties,
// which pages with Trusted Types or a strict style policy allow.

const BANNER_TEXT = 'Click the captions on the video. Pause on a line first if they are gone. Esc cancels.';
// A caption layer holds text and nothing to press or look at
const NOT_CAPTIONS = 'video, audio, button, input, select, textarea, a[href], img, svg, canvas, iframe';
const MAX_CAPTION_LENGTH = 300;
const NAME = /^[A-Za-z][\w-]*$/;

// The element whose own text lies under a point. Caption layers usually let
// clicks through (pointer-events: none), so the browser's hit testing skips
// them: go by where text is laid out instead, and take the smallest box.
function textElementAt(x, y) {
  let best = null;
  let bestArea = Infinity;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const element = node.parentElement;
    if (!element || !node.nodeValue.trim() || element.closest('subpip-picker, script, style, noscript')) continue;
    const rect = element.getBoundingClientRect();
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) continue;
    const area = rect.width * rect.height;
    if (area > 0 && area < bestArea && getComputedStyle(element).visibility !== 'hidden') {
      best = element;
      bestArea = area;
    }
  }
  return best;
}

// From the text that was clicked up to the biggest box that still holds only
// caption text: a single line is often re-created for every caption, the layer
// around the lines stays
export function captionContainer(element) {
  let box = element;
  for (let parent = box.parentElement; parent && parent !== document.body && parent !== document.documentElement; parent = box.parentElement) {
    if (parent.querySelector(NOT_CAPTIONS) || parent.innerText.trim().length > MAX_CAPTION_LENGTH) break;
    box = parent;
  }
  return box;
}

const isUnique = (selector) => {
  try {
    return document.querySelectorAll(selector).length === 1;
  } catch (e) {
    return false;
  }
};
// Names with digits in them are mostly generated, and different on the next visit
const steady = (name) => NAME.test(name) && !/\d/.test(name);
function describe(element) {
  if (element.id && steady(element.id)) return `#${CSS.escape(element.id)}`;
  return element.localName + [...element.classList].filter(steady).slice(0, 2).map((name) => `.${CSS.escape(name)}`).join('');
}
const place = (element) => `${element.localName}:nth-of-type(${[...element.parentElement.children].filter((sibling) => sibling.localName === element.localName).indexOf(element) + 1})`;

// A selector that finds the element again on a later visit: by what it is
// called if that singles it out, else by where it sits in the page
export function selectorFor(element) {
  let selector = describe(element);
  for (let parent = element.parentElement; parent && parent !== document.documentElement && !isUnique(selector); parent = parent.parentElement) {
    selector = `${describe(parent)} > ${selector}`;
  }
  if (isUnique(selector)) return selector;
  const path = [];
  for (let node = element; node && node !== document.body && node.parentElement; node = node.parentElement) path.unshift(place(node));
  return `body > ${path.join(' > ')}`;
}

// onDone(selector) once the viewer has chosen, onDone(null) when they cancel
export function startCaptionPicker({ onDone }) {
  const host = document.createElement('subpip-picker');
  const frame = document.createElement('div');
  const banner = document.createElement('div');
  Object.assign(host.style, { position: 'fixed', inset: '0', zIndex: '2147483647', pointerEvents: 'none' });
  Object.assign(frame.style, { position: 'fixed', display: 'none', border: '2px solid #ff4d5e', borderRadius: '4px', background: 'rgba(255, 77, 94, 0.15)', boxSizing: 'border-box' });
  Object.assign(banner.style, {
    position: 'fixed', top: '12px', left: '50%', transform: 'translateX(-50%)', maxWidth: '90vw', padding: '10px 14px',
    borderRadius: '10px', background: '#111214', color: '#f2f2f2', border: '1px solid #ff4d5e',
    font: '14px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif', boxShadow: '0 8px 24px rgba(0, 0, 0, 0.5)'
  });
  banner.textContent = BANNER_TEXT;
  host.append(frame, banner);
  document.documentElement.append(host);

  const cleanups = [];
  const listen = (type, handler) => {
    window.addEventListener(type, handler, true);
    cleanups.push(() => window.removeEventListener(type, handler, true));
  };
  let closeTimer = null;
  const stop = () => {
    clearTimeout(closeTimer);
    cleanups.splice(0).forEach((cleanup) => cleanup());
    host.remove();
  };
  const outline = (element) => {
    if (!element) {
      frame.style.display = 'none';
      return;
    }
    const rect = element.getBoundingClientRect();
    Object.assign(frame.style, { display: 'block', left: `${rect.left - 3}px`, top: `${rect.top - 3}px`, width: `${rect.width + 6}px`, height: `${rect.height + 6}px` });
  };
  const candidateAt = (event) => {
    const text = textElementAt(event.clientX, event.clientY);
    return text ? captionContainer(text) : null;
  };

  // While choosing, the page gets none of the mouse: a click meant for the
  // captions must not pause the video or follow a link
  const swallow = (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'dblclick', 'contextmenu']) listen(type, swallow);

  let lastMove = 0;
  listen('mousemove', (event) => {
    if (event.timeStamp - lastMove < 60) return;
    lastMove = event.timeStamp;
    outline(candidateAt(event));
  });
  listen('click', (event) => {
    swallow(event);
    const chosen = candidateAt(event);
    if (!chosen) {
      banner.textContent = 'No text there. Click the caption text itself. Esc cancels.';
      return;
    }
    const text = chosen.innerText.trim().replace(/\s+/g, ' ');
    outline(chosen);
    cleanups.splice(0).forEach((cleanup) => cleanup());
    banner.textContent = `Captions picked: "${text.length > 60 ? `${text.slice(0, 60)}…` : text}". SubPIP will use them on this site.`;
    closeTimer = setTimeout(stop, 2500);
    onDone(selectorFor(chosen));
  });
  listen('keydown', (event) => {
    if (event.key !== 'Escape') return;
    swallow(event);
    stop();
    onDone(null);
  });

  return { stop };
}
