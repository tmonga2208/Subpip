// Caption styles applied inside the PiP window

// Convert hex to rgba
function hexToRgba(hex, opacity) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity / 100})`;
}

// Generate dynamic subtitle styles based on settings
export function generateSubtitleStyles(settings) {
  const bgRgba = hexToRgba(settings.bgColor, settings.bgOpacity);
  const position = settings.captionPosition === 'top' ? 'top: 5%' : 'bottom: 0';

  return `
  .subpip-caption-container {
    font-size: ${settings.fontSize}px !important;
    font-family: ${settings.fontFamily} !important;
    font-weight: bold !important;
    color: ${settings.textColor} !important;
    text-shadow: 0 0 3px black, 0 0 5px black !important;
    background: ${bgRgba} !important;
    padding: 0.5em 1em !important;
    border-radius: 5px !important;
    position: absolute !important;
    ${position} !important;
    left: 50% !important;
    transform: translateX(-50%) !important;
    width: auto !important;
    max-width: 90% !important;
    height: auto !important;
    text-align: center !important;
    z-index: 9999 !important;
    transition: top 0.1s, bottom 0.1s !important;
  }
  .player-timedtext-text-container,
  .player-timedtext-text-container * {
    font-size: ${settings.fontSize}px !important;
    font-family: ${settings.fontFamily} !important;
    font-weight: bold !important;
    color: ${settings.textColor} !important;
    text-shadow: 0 0 3px black, 0 0 5px black !important;
    background: ${bgRgba} !important;
    text-align: center !important;
  }
  .player-timedtext-text-container {
    padding: 0.5em 1em !important;
    border-radius: 5px !important;
    position: absolute !important;
    ${position} !important;
    left: 50% !important;
    transform: translateX(-50%) !important;
    width: auto !important;
    height: auto !important;
  }
  .ytp-caption-window-container,
  .ytp-caption-window-container * {
    font-size: ${settings.fontSize}px !important;
    font-family: ${settings.fontFamily} !important;
    font-weight: bold !important;
    color: ${settings.textColor} !important;
    text-shadow: 0 0 3px black, 0 0 5px black !important;
  }
  .ytp-caption-window-container .captions-text {
    margin: 0 !important;
  }
  .caption-window {
    position: absolute !important;
    ${position} !important;
  }
  .shaka-text-container,
  .shaka-text-container * {
    font-size: ${settings.fontSize}px !important;
    font-family: ${settings.fontFamily} !important;
    font-weight: bold !important;
    color: ${settings.textColor} !important;
    text-shadow: 0 0 3px black, 0 0 5px black !important;
  }
  .shaka-text-container {
    position: absolute !important;
    ${position} !important;
    left: 50% !important;
    transform: translateX(-50%) !important;
  }
  #subtitle-1, 
  #subtitle-1 * {
    font-size: ${settings.fontSize}px !important;
    font-family: ${settings.fontFamily} !important;
    font-weight: bold !important;
    color: ${settings.textColor} !important;
    text-shadow: 0 0 3px black, 0 0 5px black !important;
  }
  #subtitle-1 {
    position: absolute !important;
    ${position} !important;
    left: 50% !important;
    transform: translateX(-50%) !important;
  }
`;
}
