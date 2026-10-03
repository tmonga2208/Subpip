// Putting SubPIP into a tab, shared by the popup button and the Alt+P shortcut

// Opens Picture-in-Picture in the tab, or closes it when it is already open:
// fresh settings and the run flag first, then the page script (MAIN world).
export async function togglePipInTab(tabId, settings) {
  const target = { tabId };
  await chrome.scripting.executeScript({
    target,
    world: 'MAIN',
    func: (s) => { window.__SUBPIP_SETTINGS__ = s; window.__SUBPIP_RUN__ = true; },
    args: [settings]
  });
  await chrome.scripting.executeScript({ target, world: 'MAIN', files: ['script.js'] });
}

// The relay gives the page script live settings and translation
export function injectRelay(tabId) {
  return chrome.scripting.executeScript({ target: { tabId }, files: ['translate-relay.js'] });
}
