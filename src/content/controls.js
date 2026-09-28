// PiP window controls: play/pause, seek bar, volume, fit, translation, speed

export function formatTime(seconds) {
  if (isNaN(seconds) || !isFinite(seconds)) return '0:00';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const pad = (n) => (n < 10 ? '0' : '') + n;
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`;
}

// Create speed control dropdown (no emoji, clean UI)
export function createSpeedControls(video, settings, isPremium) {
  const speedContainer = document.createElement('div');
  speedContainer.style.cssText = 'display: flex; align-items: center; gap: 4px; margin-left: 8px; pointer-events: auto;';

  const label = document.createElement('span');
  label.textContent = 'Speed';
  label.style.cssText = 'color: rgba(255,255,255,0.8); font-size: 11px; pointer-events: none;';

  const select = document.createElement('select');
  select.style.cssText = `
    padding: 4px 6px;
    background: rgba(255,255,255,0.15);
    color: white;
    border: 1px solid rgba(255,255,255,0.3);
    border-radius: 4px;
    font-size: 11px;
    cursor: ${isPremium ? 'pointer' : 'not-allowed'};
    opacity: ${isPremium ? '1' : '0.6'};
    pointer-events: auto;
    z-index: 10001;
  `;
  [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3].forEach(speed => {
    const opt = document.createElement('option');
    opt.value = speed;
    opt.textContent = speed + 'x';
    if (speed === (settings?.playbackSpeed || 1)) opt.selected = true;
    select.appendChild(opt);
  });
  select.title = isPremium ? 'Playback speed' : 'Premium feature';
  if (isPremium) {
    select.onchange = (e) => {
      e.stopPropagation();
      video.playbackRate = parseFloat(select.value);
    };
  }

  speedContainer.appendChild(label);
  speedContainer.appendChild(select);
  return speedContainer;
}

const BUTTON_STYLE = `
    color: white;
    background: rgba(255,255,255,0.15);
    border: 1px solid rgba(255,255,255,0.3);
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    padding: 4px 10px;
    pointer-events: auto;
  `;

export function createControls({ video, pipDoc, session, seekTo, settings, isPremium, captions }) {
  const { listen, onCleanup } = session;

  const controls = document.createElement('div');
  controls.style.cssText = `
    position: absolute;
    bottom: 0;
    width: 100%;
    background-color: rgba(0, 0, 0, 0.8);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px;
    opacity: 0;
    transition: opacity 0.3s;
    z-index: 10000;
    pointer-events: auto;
    box-sizing: border-box;
  `;

  // Show controls on any mouse movement in the PiP window, hide when idle
  let hideControlsTimer = null;
  let pointerOnControls = false;
  const showControls = () => {
    controls.style.opacity = '1';
    clearTimeout(hideControlsTimer);
    hideControlsTimer = setTimeout(() => {
      if (!pointerOnControls) controls.style.opacity = '0';
    }, 2500);
  };
  onCleanup(() => clearTimeout(hideControlsTimer));
  listen(pipDoc, 'mousemove', showControls);
  listen(pipDoc.documentElement, 'mouseleave', () => { controls.style.opacity = '0'; });
  controls.addEventListener('mouseenter', () => { pointerOnControls = true; showControls(); });
  controls.addEventListener('mouseleave', () => { pointerOnControls = false; showControls(); });

  // Left section (play/pause, time)
  const leftSection = document.createElement('div');
  leftSection.style.cssText = 'display: flex; align-items: center; gap: 10px;';

  const playPauseButton = document.createElement('button');
  playPauseButton.textContent = video.paused ? 'Play' : 'Pause';
  playPauseButton.style.cssText = BUTTON_STYLE;
  playPauseButton.onclick = (e) => {
    e.stopPropagation();
    if (video.paused) video.play();
    else video.pause();
  };
  listen(video, 'play', () => playPauseButton.textContent = 'Pause');
  listen(video, 'pause', () => playPauseButton.textContent = 'Play');

  const currentTime = document.createElement('span');
  currentTime.style.cssText = 'color: white; font-size: 12px;';

  leftSection.appendChild(playPauseButton);
  leftSection.appendChild(currentTime);

  // Center section (progress bar)
  const centerSection = document.createElement('div');
  centerSection.style.cssText = 'flex: 1; margin: 0 15px; pointer-events: auto;';

  const progressBar = document.createElement('input');
  progressBar.type = 'range';
  progressBar.min = '0';
  progressBar.step = '0.1';
  progressBar.style.cssText = 'width: 100%; accent-color: #e94560; pointer-events: auto;';

  // While dragging, only preview the time; seek once on release. Otherwise
  // timeupdate keeps yanking the thumb back and every tick triggers a seek.
  let seeking = false;
  progressBar.addEventListener('input', () => {
    seeking = true;
    currentTime.textContent = formatTime(parseFloat(progressBar.value));
  });
  progressBar.addEventListener('change', () => {
    seekTo(parseFloat(progressBar.value));
    seeking = false;
  });
  centerSection.appendChild(progressBar);

  // Right section (duration, volume, fit, translation, speed)
  const rightSection = document.createElement('div');
  rightSection.style.cssText = 'display: flex; align-items: center; gap: 10px;';

  const totalTime = document.createElement('span');
  totalTime.style.cssText = 'color: white; font-size: 12px;';

  // Live streams have no finite duration - hide the seek bar for them
  const updateDuration = () => {
    const duration = video.duration;
    const seekable = isFinite(duration) && duration > 0;
    progressBar.max = seekable ? duration : 0;
    progressBar.disabled = !seekable;
    progressBar.style.visibility = seekable ? 'visible' : 'hidden';
    totalTime.textContent = seekable ? formatTime(duration) : 'Live';
  };
  const updateTime = () => {
    if (seeking) return;
    currentTime.textContent = formatTime(video.currentTime);
    progressBar.value = video.currentTime;
  };
  listen(video, 'durationchange', updateDuration);
  listen(video, 'loadedmetadata', updateDuration);
  listen(video, 'timeupdate', updateTime);
  updateDuration();
  updateTime();

  // Volume control
  const volumeContainer = document.createElement('div');
  volumeContainer.style.cssText = 'display: flex; align-items: center; gap: 6px; pointer-events: auto;';

  const volLabel = document.createElement('span');
  volLabel.textContent = 'Vol';
  volLabel.style.cssText = 'color: rgba(255,255,255,0.8); font-size: 11px; min-width: 24px; pointer-events: none;';

  const volumeBar = document.createElement('input');
  volumeBar.type = 'range';
  volumeBar.min = '0';
  volumeBar.max = '1';
  volumeBar.step = '0.01';
  volumeBar.value = video.volume;
  volumeBar.style.cssText = 'width: 56px; accent-color: #e94560; pointer-events: auto;';
  volumeBar.oninput = () => {
    video.volume = volumeBar.value;
    video.muted = volumeBar.value == 0;
  };
  listen(video, 'volumechange', () => {
    volumeBar.value = video.volume;
  });

  volumeContainer.appendChild(volLabel);
  volumeContainer.appendChild(volumeBar);

  // Fit to screen (contain / fill)
  const fitBtn = document.createElement('button');
  fitBtn.textContent = 'Fit';
  fitBtn.title = 'Toggle fit to screen (contain/fill)';
  fitBtn.style.cssText = BUTTON_STYLE + 'font-size: 11px; padding: 4px 8px;';
  let fitMode = 'fill';
  fitBtn.onclick = (e) => {
    e.stopPropagation();
    fitMode = fitMode === 'fill' ? 'contain' : 'fill';
    video.style.objectFit = fitMode;
    fitBtn.textContent = fitMode === 'fill' ? 'Fill' : 'Fit';
  };

  // Translation toggle (Premium)
  const transLabel = document.createElement('label');
  transLabel.style.cssText = 'display: flex; align-items: center; gap: 4px; cursor: pointer; font-size: 11px; color: rgba(255,255,255,0.9); pointer-events: auto;';
  const transCheck = document.createElement('input');
  transCheck.type = 'checkbox';
  transCheck.checked = captions.translationOn;
  transCheck.disabled = !isPremium;
  transCheck.title = isPremium ? 'Show translated subtitles' : 'Premium';
  transCheck.style.accentColor = '#e94560';
  transLabel.appendChild(transCheck);
  transLabel.appendChild(document.createTextNode('Trans.'));
  transCheck.onchange = () => captions.setTranslationOn(transCheck.checked);

  rightSection.appendChild(totalTime);
  rightSection.appendChild(volumeContainer);
  rightSection.appendChild(fitBtn);
  rightSection.appendChild(transLabel);
  rightSection.appendChild(createSpeedControls(video, settings, isPremium));

  controls.appendChild(leftSection);
  controls.appendChild(centerSection);
  controls.appendChild(rightSection);
  return controls;
}

// Keyboard shortcuts inside the PiP window
export function handlePipKeydown(event, video, seekTo) {
  if (event.target.tagName === 'INPUT' || event.target.tagName === 'SELECT') return;
  if (event.code === 'Space') {
    event.preventDefault();
    if (video.paused) video.play();
    else video.pause();
  } else if (event.code === 'ArrowRight') {
    event.preventDefault();
    seekTo(video.currentTime + 10);
  } else if (event.code === 'ArrowLeft') {
    event.preventDefault();
    seekTo(video.currentTime - 10);
  } else if (event.code === 'ArrowUp') {
    event.preventDefault();
    video.volume = Math.min(video.volume + 0.1, 1);
  } else if (event.code === 'ArrowDown') {
    event.preventDefault();
    video.volume = Math.max(video.volume - 0.1, 0);
  }
}
