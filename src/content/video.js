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

export function findVideo(adapter) {
  const video = adapter.videoSelector ? document.querySelector(adapter.videoSelector) : null;
  return video || findLargestPlayingVideo() || document.querySelector('video');
}
