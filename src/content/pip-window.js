// Opens a Document PiP window with the video, captions and controls, and puts
// everything back when it closes.

import { generateSubtitleStyles } from './styles.js';
import { setupCaptions } from './captions.js';
import { createControls, handlePipKeydown } from './controls.js';

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
  video.style.objectFit = 'fill';
  pipDoc.body.append(video);

  const subtitleStyle = document.createElement('style');
  subtitleStyle.id = 'subpip-settings-style';
  subtitleStyle.textContent = generateSubtitleStyles(settings);
  pipDoc.head.appendChild(subtitleStyle);

  const captions = await setupCaptions({ video, adapter, pipDoc, session, getSettings, isPremium });

  const seekTo = (time) => {
    const duration = video.duration;
    const target = Math.max(0, isFinite(duration) ? Math.min(time, duration) : time);
    if (!(adapter.seek && adapter.seek(video, target))) {
      video.currentTime = target;
    }
  };

  pipDoc.body.appendChild(createControls({ video, pipDoc, session, seekTo, settings, isPremium, captions }));

  if (isPremium && settings.playbackSpeed) {
    video.playbackRate = settings.playbackSpeed;
  }

  pipWindow.addEventListener('keydown', (event) => handlePipKeydown(event, video, seekTo));

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
      subtitleStyle.textContent = generateSubtitleStyles(getSettings());
      captions.refresh();
    }
  };
}
