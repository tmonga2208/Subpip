// A cleanup scope: everything registered through it is undone by dispose().
// The PiP window has one; each caption source has its own, so sources can be
// swapped while the window stays open.
export function createSession() {
  const cleanups = [];
  const onCleanup = (fn) => cleanups.push(fn);
  return {
    onCleanup,
    listen(target, type, handler, options) {
      target.addEventListener(type, handler, options);
      onCleanup(() => target.removeEventListener(type, handler, options));
    },
    every(ms, fn) {
      const id = setInterval(fn, ms);
      onCleanup(() => clearInterval(id));
    },
    dispose() {
      cleanups.splice(0).forEach((fn) => {
        try { fn(); } catch (e) { /* keep cleaning up */ }
      });
    }
  };
}
