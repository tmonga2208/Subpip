// Choosing which <video> to put in PiP

// Pick the video the user most likely wants: playing videos first, then by size.
// disablePictureInPicture is not filtered out - Document PiP ignores it.
function findLargestPlayingVideo() {
  const area = (video) => {
    const rect = video.getClientRects()[0] || { width: 0, height: 0 };
    return rect.width * rect.height;
  };
  const isPlaying = (video) => !video.paused && !video.ended;

  const videos = Array.from(document.querySelectorAll('video'))
    .filter(video => video.readyState != 0)
    .sort((v1, v2) => (isPlaying(v2) - isPlaying(v1)) || (area(v2) - area(v1)));

  return videos[0];
}

// The PiP window to ask for: 640px on the long side, in the video's shape.
// It deliberately ignores how big the player is on the page - Chrome reuses
// the size the user last gave the window only while the request stays the same.
const PIP_LONG_SIDE = 640;

export function pipWindowSize(video) {
  const width = video.videoWidth || video.clientWidth;
  const height = video.videoHeight || video.clientHeight;
  if (!width || !height) return { width: PIP_LONG_SIDE, height: 360 };
  const scale = PIP_LONG_SIDE / Math.max(width, height);
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

export function findVideo(adapter) {
  const video = adapter.videoSelector ? document.querySelector(adapter.videoSelector) : null;
  return video || findLargestPlayingVideo() || document.querySelector('video');
}
