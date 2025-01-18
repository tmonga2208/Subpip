function findLargestPlayingVideo() {
    const videos = Array.from(document.querySelectorAll('video'))
        .filter(video => video.readyState != 0)
        .filter(video => video.disablePictureInPicture == false)
        .sort((v1, v2) => {
            const v1Rect = v1.getClientRects()[0] || { width: 0, height: 0 };
            const v2Rect = v2.getClientRects()[0] || { width: 0, height: 0 };
            return ((v2Rect.width * v2Rect.height) - (v1Rect.width * v1Rect.height));
        });

    if (videos.length === 0) {
        return;
    }

    return videos[0];
}



function maybeUpdatePictureInPictureVideo(entries, observer) {
    const observedVideo = entries[0].target;

    if (!document.querySelector('[__pip__]')) {
        observer.unobserve(observedVideo);
        return;
    }

    const video = findLargestPlayingVideo();

    if (video && !video.hasAttribute('__pip__')) {
        observer.unobserve(observedVideo);
        requestPictureInPicture(video);
    }
}