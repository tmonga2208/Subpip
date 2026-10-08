// Opens a Document PiP window with the video, captions and controls, and puts
// everything back when it closes.

import { generateSubtitleStyles } from './styles.js';
import { setupCaptions } from './captions.js';
import { createControls, handlePipKeydown } from './controls.js';
import { createSettingsMenu } from './settings-menu.js';
import { pipWindowSize } from './video.js';
import { createSession } from './session.js';
import { findSiteActions } from './site-actions.js';
import { createStudyTools } from './study.js';

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
// subtitleMemory keeps a loaded subtitle file between windows on this page.
export async function openPipWindow({ video, adapter, getSettings, onClose, subtitleMemory }) {
  const settings = getSettings();
  const isPremium = !!settings.isPremium;

  // PiP-menu choices (caption size, translation language) for this window
  // only; they sit on top of the saved settings and are never stored.
  const overrides = {};
  const sessionSettings = () => ({ ...getSettings(), ...overrides });

  // Must be the first await: it consumes the page's user activation
  const pipWindow = await documentPictureInPicture.requestWindow(pipWindowSize(video));
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

  // Chrome picks the window's real size (it clamps big requests and reuses the
  // size the user last dragged it to), so fit the video now and on every resize
  const fitVideo = () => {
    const w = pipWindow.innerWidth + 'px';
    const h = pipWindow.innerHeight + 'px';
    Object.assign(video.style, { width: w, height: h, minWidth: w, minHeight: h, maxWidth: w, maxHeight: h });
  };
  fitVideo();
  pipWindow.addEventListener('resize', fitVideo);

  const subtitleStyle = document.createElement('style');
  subtitleStyle.id = 'subpip-settings-style';
  subtitleStyle.textContent = generateSubtitleStyles(sessionSettings());
  pipDoc.head.appendChild(subtitleStyle);

  const captions = await setupCaptions({ video, adapter, pipDoc, session, getSettings: sessionSettings, isPremium, memory: subtitleMemory });

  // One anonymous count per window (shared/usage.js): that it was opened, and
  // whether captions were found. Told after a while, or at closing if it was
  // open long enough to say; a window closed at once says nothing.
  const openedAt = Date.now();
  let counted = false;
  const countOpened = () => {
    if (counted) return;
    counted = true;
    window.postMessage({ type: 'SUBPIP_COUNT', fact: { event: 'opened', captions: captions.lines().length ? 'found' : 'none' } }, '*');
  };
  const countTimer = setTimeout(countOpened, 20000);
  session.onCleanup(() => clearTimeout(countTimer));

  const seekTo = (time) => {
    const duration = video.duration;
    const target = Math.max(0, isFinite(duration) ? Math.min(time, duration) : time);
    if (!(adapter.seek && adapter.seek(video, target))) {
      video.currentTime = target;
    }
  };

  // Gives the window the shape of the video at its current width, so no
  // black bars are left. Chrome only lets a window resize itself from a click
  // inside it.
  const fitWindow = () => {
    if (!video.videoWidth || !video.videoHeight) return;
    const frameWidth = pipWindow.outerWidth - pipWindow.innerWidth;
    const frameHeight = pipWindow.outerHeight - pipWindow.innerHeight;
    const height = Math.round(pipWindow.innerWidth * video.videoHeight / video.videoWidth);
    try {
      pipWindow.resizeTo(pipWindow.innerWidth + frameWidth, height + frameHeight);
    } catch (e) {
      // Not from a click in this window: leave the size alone
    }
  };

  const next = isPremium && adapter.next ? adapter.next : null;
  const controls = createControls({ video, pipDoc, session, seekTo, captions, fitWindow, isPremium, next });
  pipDoc.body.appendChild(controls.host);
  controls.show();

  const applyOverride = (patch) => {
    Object.assign(overrides, patch);
    subtitleStyle.textContent = generateSubtitleStyles(sessionSettings());
    captions.refresh();
  };
  const study = isPremium ? createStudyTools({ video, pipDoc, session, captions, controls, seekTo, getSettings: sessionSettings }) : null;
  controls.mountMenu(createSettingsMenu({
    video, pipDoc, session, isPremium,
    getSessionSettings: sessionSettings,
    applyOverride,
    captions,
    study
  }));

  if (isPremium && settings.playbackSpeed) {
    video.playbackRate = settings.playbackSpeed;
  }

  // The site's passing buttons (Skip intro, Next episode), looked for for as
  // long as the window is open
  const lookForSiteButtons = () => controls.setActions(findSiteActions(adapter));
  lookForSiteButtons();
  session.every(700, lookForSiteButtons);

  pipWindow.addEventListener('keydown', (event) => {
    if (study && study.handleKeydown(event)) return;
    handlePipKeydown(event, { video, seekTo, controls, next });
  });

  pipWindow.addEventListener('pagehide', () => {
    if (Date.now() - openedAt >= 5000) countOpened();
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
