// Site adapters: per-site video/caption selectors and quirks

// Netflix blocks direct currentTime writes (error M7375) - seek through its player API
function netflixSeek(video, time) {
  try {
    const videoPlayer = window.netflix.appContext.state.playerApp.getAPI().videoPlayer;
    const player = videoPlayer.getVideoPlayerBySessionId(videoPlayer.getAllPlayerSessionIds()[0]);
    player.seek(Math.round(time * 1000));
    return true;
  } catch (e) {
    return false;
  }
}

// Per-site configuration. Sites not listed here use the largest video on the
// page and fall back to the video's own text tracks for captions.
//   videoSelector    - element to put in PiP (default: largest playing video)
//   subtitleSelector - live caption container to mirror into the PiP window
//   maxCaptionLines  - hide older caption lines beyond this count
//   seek(video, t)   - custom seek; return false to fall back to currentTime
export const SITE_ADAPTERS = [
  {
    name: 'youtube',
    match: (host) => host.includes('youtube'),
    subtitleSelector: '#ytp-caption-window-container',
    maxCaptionLines: 2
  },
  {
    name: 'netflix',
    match: (host) => host.includes('netflix'),
    subtitleSelector: '.player-timedtext',
    seek: netflixSeek
  },
  {
    name: 'hotstar',
    match: (host) => host.includes('hotstar') || host.includes('disneyplus'),
    subtitleSelector: '.shaka-text-container'
  },
  {
    name: 'jiocinema',
    match: (host) => host.includes('jiocinema'),
    subtitleSelector: '#subtitle-1'
  },
  {
    name: 'crunchyroll',
    match: (host) => host.includes('crunchyroll'),
    videoSelector: '#player0',
    subtitleSelector: '#vilosVttJs'
  }
];

export function getSiteAdapter(hostname) {
  return SITE_ADAPTERS.find((adapter) => adapter.match(hostname)) || { name: 'generic' };
}
