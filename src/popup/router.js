// Home + drill-in pages: exactly one .view is visible. Sub-pages swap the
// top bar for a back bar with the page title; Escape goes back one level.

export function createRouter(doc) {
  const views = new Map([...doc.querySelectorAll('.view')].map((view) => [view.dataset.view, view]));
  const topbar = doc.getElementById('topbar');
  const pagebar = doc.getElementById('pagebar');
  const title = doc.getElementById('page-title');
  const scroller = doc.querySelector('.views');
  const stack = ['home'];
  const listeners = [];

  function render(direction) {
    const name = stack[stack.length - 1];
    for (const [key, view] of views) view.hidden = key !== name;
    const view = views.get(name);
    const isHome = name === 'home';
    topbar.hidden = !isHome;
    pagebar.hidden = isHome;
    title.textContent = isHome ? '' : view.dataset.title || '';
    view.classList.remove('enter-forward', 'enter-back');
    if (direction) {
      void view.offsetWidth; // restart the animation
      view.classList.add(direction === 'back' ? 'enter-back' : 'enter-forward');
    }
    scroller.scrollTop = 0;
    listeners.forEach((fn) => fn(name));
  }

  const router = {
    current: () => stack[stack.length - 1],
    go(name) {
      if (!views.has(name)) throw new Error(`Unknown view: ${name}`);
      if (router.current() === name) return;
      stack.push(name);
      render('forward');
    },
    back() {
      if (stack.length === 1) return false;
      stack.pop();
      render('back');
      return true;
    },
    onChange(fn) {
      listeners.push(fn);
    }
  };

  doc.getElementById('back-btn').addEventListener('click', () => router.back());
  doc.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && router.back()) event.preventDefault();
  });
  render(null);
  return router;
}
