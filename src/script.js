async function requestPictureInPicture(video, videoParentElement, videoCssText, subs, miniplayerButton) {
  const pipWindow = await documentPictureInPicture.requestWindow({
    width: video.clientWidth,
    height: video.clientHeight,
  });

  [...document.styleSheets].forEach((styleSheet) => {
    // Copy style sheets over from the initial document so that the player looks the same.
    try {
      const cssRules = [...styleSheet.cssRules].map((rule) => rule.cssText).join('');
      const style = document.createElement('style');

      style.textContent = cssRules;
      pipWindow.document.head.appendChild(style);
    } catch (e) {
      const link = document.createElement('link');

      link.rel = 'stylesheet';
      link.type = styleSheet.type;
      link.media = styleSheet.media;
      link.href = styleSheet.href;
      pipWindow.document.head.appendChild(link);
    }
  });

  let newVid = video;

  pipWindow.document.body.style.overflow = 'hidden';
  newVid.style.objectFit = "fill";

  pipWindow.document.body.append(newVid);
  let subsClone;
  if (subs) {
    subsClone = subs.cloneNode(true);
    pipWindow.document.body.append(subsClone);

    // Define specific CSS for subtitles
    const subtitleStyle = `
      .player-timedtext-text-container {
        font-weight: bold !important;
        color: white !important;
        text-shadow: 0 0 3px black, 0 0 5px black !important;
        background: rgba(0, 0, 0, 0.75) !important;
        padding: 0.5em 1em !important;
        border-radius: 5px !important;
        position: absolute !important;
        bottom: 5% !important;
        left: 50% !important;
        transform: translateX(-50%) !important;
        width: auto !important;
        height: auto !important;
        text-align: center !important;
      }
      .player-timedtext-text-container  span {
        font-size: 5vh !important;
      }
      .ytp-caption-window-container {
        font-weight: bold !important;
        color: white !important;
        text-shadow: 0 0 3px black, 0 0 5px black !important;
      }
      .ytp-caption-window-container .captions-text {
        margin: 0 !important;
      }
        .shaka-text-container{
        font-weight: bold !important;
        color: white !important;
        text-shadow: 0 0 3px black, 0 0 5px black !important;
         position: absolute !important;
        bottom: 5% !important;
        left: 50% !important;
        transform: translateX(-50%) !important;
        }
        #subtitle-1{
        font-weight: bold !important;
        color: white !important;
        text-shadow: 0 0 3px black, 0 0 5px black !important;
         position: absolute !important;
        bottom: 5% !important;
        left: 50% !important;
        transform: translateX(-50%) !important;
        }
    `;

    // Create a new <style> element for subtitles
    const styleElement = document.createElement('style');
    styleElement.textContent = subtitleStyle;
    pipWindow.document.head.appendChild(styleElement);

    // Observe changes in the original subs element and update subsClone
    const observer = new MutationObserver(() => {
      while (subsClone.firstChild) {
        subsClone.removeChild(subsClone.firstChild);
      }
      subs.childNodes.forEach(node => {
        subsClone.appendChild(node.cloneNode(true));
      });
    });
    observer.observe(subs, { childList: true, subtree: true });
  }

  // Create custom controls
  const controls = document.createElement('div');
  controls.style.position = 'absolute';
  controls.style.bottom = '0';
  controls.style.width = '100%';
  controls.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
  controls.style.display = 'flex';
  controls.style.alignItems = 'center';
  controls.style.justifyContent = 'space-between';
  controls.style.padding = '10px';
  controls.style.opacity = "0";
  controls.style.transition = "opacity 0.5s";
  controls.addEventListener("mouseenter", () => {
    controls.style.opacity = "1";
  });
  controls.addEventListener("mouseleave", () => {
    controls.style.opacity = "0";
  });

  // Play/Pause button
  const playPauseButton = document.createElement('button');
  playPauseButton.textContent = video.paused ? 'Play' : 'Pause';
  playPauseButton.style.color = 'white';
  playPauseButton.style.background = 'none';
  playPauseButton.style.border = 'none';
  playPauseButton.style.cursor = 'pointer';
  playPauseButton.addEventListener('click', () => {
    if (video.paused) {
      video.play();
      playPauseButton.textContent = 'Pause';
    } else {
      video.pause();
      playPauseButton.textContent = 'Play';
    }
  });

  // Current time
  const currentTime = document.createElement('span');
  currentTime.style.color = 'white';
  currentTime.textContent = formatTime(video.currentTime);

  // Total time
  const totalTime = document.createElement('span');
  totalTime.style.color = 'white';
  totalTime.textContent = formatTime(video.duration);

  // Volume bar
  const volumeBar = document.createElement('input');
  volumeBar.type = 'range';
  volumeBar.min = '0';
  volumeBar.max = '1';
  volumeBar.step = '0.01';
  volumeBar.value = video.volume;
  volumeBar.style.width = '100px';
  volumeBar.addEventListener('input', () => {
    video.volume = volumeBar.value;
  });

  // Progress bar
  const progressBar = document.createElement('input');
  progressBar.type = 'range';
  progressBar.min = '0';
  progressBar.max = video.duration;
  progressBar.step = '0.1';
  progressBar.value = video.currentTime;
  progressBar.style.flex = '1';
  progressBar.style.margin = '0 10px';
  progressBar.addEventListener('input', () => {
    const newTime = (progressBar.value / progressBar.max) * video.duration;
      console.log('progressBar.value', formatTime(newTime));
  });

  // Update current time and progress bar as the video plays
  video.addEventListener('timeupdate', () => {
    currentTime.textContent = formatTime(video.currentTime);
    progressBar.value = video.currentTime;
  });

  controls.appendChild(playPauseButton);
  controls.appendChild(currentTime);
  controls.appendChild(progressBar);
  controls.appendChild(totalTime);
  controls.appendChild(volumeBar);
  pipWindow.document.body.appendChild(controls);

  // Adding event listener for spacebar to play/pause video
  pipWindow.addEventListener('keydown', (event) => {
    if (event.code === 'Space') {
      event.preventDefault(); // Prevent default spacebar action (scrolling)
      if (video.paused) {
        video.play();
      } else {
        video.pause();
      }
    }
  });

  pipWindow.addEventListener("pagehide", (event) => {
    destroyPipWindow(newVid, subsClone, videoParentElement, videoCssText);
  });

  pipWindow.addEventListener("resize", (e) => {
    console.log("🚀 ~ pipWindow.addEventListener ~ e:", e);

    videoCssText.preventMutTrigger = true;

    const w = e.target.window.innerWidth;
    const h = e.target.window.innerHeight;

    newVid.style.width = w + "px";
    newVid.style.height = h + "px";

    // Minimums to prevent resize of content
    newVid.style.minWidth = w + "px";
    newVid.style.minHeight = h + "px";
    newVid.style.maxWidth = w + "px";
    newVid.style.maxHeight = h + "px";
  });

  newVid.setAttribute('__pip__', true);
  new ResizeObserver(maybeUpdatePictureInPictureVideo).observe(newVid);

  //Play/pause video
  document.addEventListener('keydown', (event) => {
    if (event.code === 'Space') {
      if (video.paused) {
        video.play();
      } else {
        video.pause();
      }
    } else if (event.code === 'ArrowRight') {
      event.preventDefault(); // Prevent default right arrow action (scrolling)
      video.currentTime = Math.min(video.currentTime + 10, video.duration);
    }
  });
}

function destroyPipWindow(video, subsClone, videoParentElement, videoCssText, subtitleStyleElement) {
  video.style.cssText = videoCssText.prevStyle;
  video.removeAttribute('__pip__');
  videoParentElement.appendChild(video);

  if (subsClone) {
    subsClone.remove();
  }

  if (subtitleStyleElement) {
    subtitleStyleElement.remove();
  }
}

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${minutes}:${secs < 10 ? '0' : ''}${secs}`;
}

(async () => {
    const video = document.querySelector('video');
    const domain = window.location.hostname;
    let subs, miniplayerButton;
  
  if (!video) {
    console.log('video not found');
    // const iframes = document.querySelector('iframe');
    // if (iframes) {
    //   const clonedIframe = iframes.cloneNode(true);
      if (documentPictureInPicture.window != null) {
        documentPictureInPicture.window.close();
      // }
        // return requestPictureInPicture(clonedIframe);
        return
    }
  }

  if (domain.includes("youtube")) {
    subs = document.querySelectorAll("#ytp-caption-window-container")[0];
    miniplayerButton = document.querySelector('.ytp-miniplayer-button');
  
    if (subs) {
      setInterval(() => {
        const lines = subs.querySelectorAll('.captions-text > span');
        if (lines.length > 2) {
          lines.forEach((line, index) => {
            if (index < lines.length - 2) {
              line.style.display = 'none';
            } else {
              line.style.display = 'block';
            }
          });
        }
      }, 1000);
    }
  } else if (domain.includes("netflix")) {
    const subtitleContainer = document.querySelectorAll(".player-timedtext")[0];
    if (subtitleContainer) {
      subs = subtitleContainer.cloneNode(true);
      const observer = new MutationObserver(() => {
        while (subs.firstChild) {
          subs.removeChild(subs.firstChild);
        }
        subtitleContainer.childNodes.forEach(node => {
          subs.appendChild(node.cloneNode(true));
        });
      });
      observer.observe(subtitleContainer, { childList: true, subtree: true });
    }
  } else if (domain.includes("hotstar") || domain.includes("disneyplus")) {
    const subtitleContainer = document.querySelector(".shaka-text-container");
    if (subtitleContainer) {
      subs = subtitleContainer.cloneNode(true);
      const observer = new MutationObserver(() => {
        while (subs.firstChild) {
          subs.removeChild(subs.firstChild);
        }
        subtitleContainer.childNodes.forEach(node => {
          subs.appendChild(node.cloneNode(true));
        });
      });
      observer.observe(subtitleContainer, { childList: true, subtree: true });
    }
  } else if (domain.includes("jiocinema")) {
    const subtitleContainer = document.querySelector("#subtitle-1");
    if (subtitleContainer) {
      subs = subtitleContainer.cloneNode(true);
      const observer = new MutationObserver(() => {
        while (subs.firstChild) {
          subs.removeChild(subs.firstChild);
        }
        subtitleContainer.childNodes.forEach(node => {
          subs.appendChild(node.cloneNode(true));
        });
      });
      observer.observe(subtitleContainer, { childList: true, subtree: true });
    }
  }
    // } else if(domain.includes("crunchyroll")){
    //   const subtitleContainer = document.querySelector("#velocity-canvas");
    //   if (subtitleContainer) {
    //   subs = subtitleContainer.cloneNode(true);
    //   const observer = new MutationObserver(() => {
    //     while (subs.firstChild) {
    //       subs.removeChild(subs.firstChild);
    //     }
    //     subtitleContainer.childNodes.forEach(node => {
    //       subs.appendChild(node.cloneNode(true));
    //     });
    //   });
    //   observer.observe(subtitleContainer, { childList: true, subtree: true });
    // }
    // }
  //   else {
  //   const divs = document.querySelectorAll("div");
  //   let changingSpan = null;
    
  //   divs.forEach(div => {
  //     const span = div.querySelector("span");
  //     if (span) {
  //       const observer = new MutationObserver((mutations) => {
  //         mutations.forEach((mutation) => {
  //           if (mutation.type === 'characterData' || mutation.type === 'childList') {
  //             changingSpan = span;
  //             observer.disconnect(); // Stop observing once we find the changing span
  //           }
  //         });
  //       });
  //       observer.observe(span, { characterData: true, childList: true, subtree: true });
    
  //       // Check for changes within a short period to determine if this span changes frequently
  //       setTimeout(() => {
  //         observer.disconnect();
  //       }, 1000); // Adjust the timeout as needed
  //     }
  //   });
    
  //   if (changingSpan) {
  //     subs = changingSpan.cloneNode(true);
  //     pipWindow.document.body.append(subs);
    
  //     // Observe changes in the original span element and update subsClone
  //     const observer = new MutationObserver((mutations) => {
  //       mutations.forEach((mutation) => {
  //         if (mutation.type === 'characterData' || mutation.type === 'childList') {
  //           subs.textContent = changingSpan.textContent;
  //         }
  //       });
  //     });
  //     observer.observe(changingSpan, { characterData: true, childList: true, subtree: true });
  //   }
  // }

  let videoParentElement = video.parentElement;

  const videoCssText = { prevStyle: video.style.cssText, newStyle: null, preventMutTrigger: false };

  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      if (mutation.attributeName === "style" && !videoCssText.preventMutTrigger) {
        videoCssText.newStyle = video.style.cssText;
      }
    }
  });

  observer.observe(video, { attributes: true });
  await requestPictureInPicture(video, videoParentElement, videoCssText, subs, miniplayerButton);
})();