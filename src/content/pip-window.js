// Opens a Document PiP window with the video, captions and controls, and puts
// everything back when it closes.

import { generateSubtitleStyles } from './styles.js';
import { setupCaptions } from './captions.js';
import { createControls, handlePipKeydown } from './controls.js';
import { createSettingsMenu } from './settings-menu.js';

// Everything registered during a PiP session is undone when it closes
function createSession() {
  const cleanups = [];
  const onCleanup = (fn) => cleanups.push(fn);
  return {
    onCleanup,
    listen(target, type, handler, options) {
      target.addEventListener(type, handler, options);
      onCleanup(() => target.removeEventListener(type, handler, options));
    },
    every(ms, fn) {
      const id = setInterval(fn, ms);
      onCleanup(() => clearInterval(id));
    },
    dispose() {
      cleanups.forEach((fn) => {
        try { fn(); } catch (e) { /* keep cleaning up */ }
      });
    }
  };
}

function copyPageStyles(pipDoc) {
  [...document.styleSheets].forEach((styleSheet) => {
    try {
      const style = document.createElement('style');
      style.textContent = [...styleSheet.cssRules].map((rule) => rule.cssText).join('');
      pipDoc.head.appendChild(style);
    } catch (e) {
      // Cross-origin stylesheet: link it instead
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.type = styleSheet.type;
      link.media = styleSheet.media;
      link.href = styleSheet.href;
      pipDoc.head.appendChild(link);
    }
  });
}

// Returns a handle whose onSettingsChanged() re-applies live settings.
// onClose runs after the window closes and the video is restored.
export async function openPipWindow({ video, adapter, getSettings, onClose }) {
  const settings = getSettings();
  const isPremium = !!settings.isPremium;

  // PiP-menu choices (caption size, translation language) for this window
  // only; they sit on top of the saved settings and are never stored.
  const overrides = {};
  const sessionSettings = () => ({ ...getSettings(), ...overrides });

  // Must be the first await: it consumes the page's user activation
  const pipWindow = await documentPictureInPicture.requestWindow({
    width: video.clientWidth || 640,
    height: video.clientHeight || 360,
  });
  const pipDoc = pipWindow.document;
  const session = createSession();

  copyPageStyles(pipDoc);

  // Remember exactly where the video was so it goes back in the same spot
  const placeholder = document.createComment('subpip-video-placeholder');
  video.before(placeholder);
  const prevStyle = video.style.cssText;
  const prevPlaybackRate = video.playbackRate;

  pipDoc.body.style.overflow = 'hidden';
  pipDoc.body.style.margin = '0';
  pipDoc.body.style.background = '#000';
  video.style.objectFit = 'contain';
  pipDoc.body.append(video);

  const subtitleStyle = document.createElement('style');
  subtitleStyle.id = 'subpip-settings-style';
  subtitleStyle.textContent = generateSubtitleStyles(sessionSettings());
  pipDoc.head.appendChild(subtitleStyle);

  const captions = await setupCaptions({ video, adapter, pipDoc, session, getSettings: sessionSettings, isPremium });

  const seekTo = (time) => {
    const duration = video.duration;
    const target = Math.max(0, isFinite(duration) ? Math.min(time, duration) : time);
    if (!(adapter.seek && adapter.seek(video, target))) {
      video.currentTime = target;
    }
  };

  const controls = createControls({ video, pipDoc, session, seekTo, captions });
  pipDoc.body.appendChild(controls.host);
  controls.show();

  const applyOverride = (patch) => {
    Object.assign(overrides, patch);
    subtitleStyle.textContent = generateSubtitleStyles(sessionSettings());
    captions.refresh();
  };
  controls.mountMenu(createSettingsMenu({
    video, pipDoc, session, isPremium,
    getSessionSettings: sessionSettings,
    applyOverride,
    captions
  }));

  if (isPremium && settings.playbackSpeed) {
    video.playbackRate = settings.playbackSpeed;
  }

  pipWindow.addEventListener('keydown', (event) => handlePipKeydown(event, { video, seekTo, controls }));

  // Keep the video filling the window as it is resized
  pipWindow.addEventListener('resize', () => {
    const w = pipWindow.innerWidth + 'px';
    const h = pipWindow.innerHeight + 'px';
    Object.assign(video.style, { width: w, height: h, minWidth: w, minHeight: h, maxWidth: w, maxHeight: h });
  });

  pipWindow.addEventListener('pagehide', () => {
    session.dispose();
    video.style.cssText = prevStyle;
    if (isPremium && settings.playbackSpeed) video.playbackRate = prevPlaybackRate;
    if (placeholder.isConnected) placeholder.replaceWith(video);
    else placeholder.remove();
    onClose();
  });

  return {
    onSettingsChanged() {
      subtitleStyle.textContent = generateSubtitleStyles(sessionSettings());
      captions.refresh();
    }
  };
}
