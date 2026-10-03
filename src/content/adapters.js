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

// YouTube's captions are a module of its player object: loading it switches
// captions on in the language YouTube picks for the viewer.
const youtubePlayer = () => document.querySelector('#movie_player');
const youtubeCaptions = {
  // One entry per language, the written track ahead of the auto-generated one
  tracks() {
    try {
      const byLanguage = new Map();
      for (const track of youtubePlayer().getOption('captions', 'tracklist') || []) {
        const known = byLanguage.get(track.languageCode);
        if (!known || (known.kind && !track.kind)) byLanguage.set(track.languageCode, track);
      }
      return [...byLanguage.values()].map((track) => ({ id: track.languageCode, label: track.displayName || track.languageName || track.languageCode }));
    } catch (e) {
      return [];
    }
  },
  current() {
    try {
      const player = youtubePlayer();
      return player.isSubtitlesOn() ? player.getOption('captions', 'track').languageCode || null : null;
    } catch (e) {
      return null;
    }
  },
  select(id) {
    try {
      const player = youtubePlayer();
      if (id === null) {
        player.unloadModule('captions');
      } else {
        player.loadModule('captions');
        player.setOption('captions', 'track', { languageCode: id });
      }
    } catch (e) {
      // Not the player SubPIP knows: the viewer can still use YouTube's own button
    }
  },
  turnOn() {
    try {
      youtubePlayer().loadModule('captions');
    } catch (e) {
      // As above
    }
  }
};

// Per-site configuration. Sites not listed here use the largest video on the
// page and fall back to the video's own text tracks for captions.
//   videoSelector    - element to put in PiP (default: largest playing video)
//   subtitleSelector - live caption container to mirror into the PiP window
//   maxCaptionLines  - hide older caption lines beyond this count
//   seek(video, t)   - custom seek; return false to fall back to currentTime
//   label            - site name shown in the popup ("Captions: YouTube")
//   captions         - the site's own caption switch, where SubPIP can work it:
//                      tracks() -> [{ id, label }], current() -> id or null (off),
//                      select(id or null), turnOn() (in the site's own choice)
//   next()           - goes to the next video, where the site has a call for it
//   actions          - passing buttons of the site's player (Skip intro, Next
//                      episode) by a name that does not depend on the site's
//                      language: [{ id, label, selector }]. See site-actions.js.
export const SITE_ADAPTERS = [
  {
    name: 'youtube',
    label: 'YouTube',
    match: (host) => host.includes('youtube'),
    subtitleSelector: '#ytp-caption-window-container',
    maxCaptionLines: 2,
    captions: youtubeCaptions,
    next() {
      try {
        youtubePlayer().nextVideo();
      } catch (e) {
        // Not the player SubPIP knows
      }
    }
  },
  {
    name: 'netflix',
    label: 'Netflix',
    match: (host) => host.includes('netflix'),
    subtitleSelector: '.player-timedtext',
    seek: netflixSeek,
    actions: [
      { id: 'skip-intro', label: 'Skip intro', selector: '[data-uia="player-skip-intro"]' },
      { id: 'skip-recap', label: 'Skip recap', selector: '[data-uia="player-skip-recap"]' },
      { id: 'next-episode', label: 'Next episode', selector: '[data-uia="next-episode-seamless-button"], [data-uia="next-episode-seamless-button-draining"]' }
    ]
  },
  {
    // JioCinema and Disney+ Hotstar merged into JioHotstar (hotstar.com) in 2025
    name: 'hotstar',
    label: 'JioHotstar',
    match: (host) => host.includes('hotstar'),
    subtitleSelector: '.shaka-text-container'
  },
  {
    name: 'disneyplus',
    label: 'Disney+',
    match: (host) => host.includes('disneyplus'),
    subtitleSelector: '.shaka-text-container',
    actions: [{ id: 'skip-intro', label: 'Skip', selector: '.skip__button' }]
  },
  {
    // primevideo.com, and the video pages of the Amazon shops (/gp/video/...)
    name: 'primevideo',
    label: 'Prime Video',
    match: (host, path) => host.includes('primevideo') || (/(^|\.)amazon\./.test(host) && /\/gp\/video\b/.test(path)),
    subtitleSelector: '.atvwebplayersdk-captions-overlay',
    actions: [
      { id: 'skip-intro', label: 'Skip', selector: '.atvwebplayersdk-skipelement-button' },
      { id: 'next-episode', label: 'Next episode', selector: '.atvwebplayersdk-nextupcard-button' }
    ]
  },
  {
    name: 'crunchyroll',
    label: 'Crunchyroll',
    match: (host) => host.includes('crunchyroll'),
    videoSelector: '#player0',
    subtitleSelector: '#vilosVttJs'
  }
];

// Players that many sites build on, recognised on any of them by the element
// they draw captions in. The class names are the players' own.
export const PLAYER_CAPTIONS = [
  { name: 'Video.js', selector: '.vjs-text-track-display' },
  { name: 'JW Player', selector: '.jw-captions' },
  { name: 'Plyr', selector: '.plyr__captions' },
  { name: 'Bitmovin', selector: '.bmpui-ui-subtitle-overlay' },
  { name: 'Shaka Player', selector: '.shaka-text-container' }
];

export function findPlayerCaptions(doc = document) {
  return PLAYER_CAPTIONS.find((player) => doc.querySelector(player.selector)) || null;
}

export function getSiteAdapter(hostname, pathname = '') {
  return SITE_ADAPTERS.find((adapter) => adapter.match(hostname, pathname)) || { name: 'generic' };
}
