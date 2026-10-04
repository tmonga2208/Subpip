// Regional price: ₹1000 in India, $15 elsewhere. Display only; the server
// (functions/pricing.js) checks the amount actually charged.
window.SubpipPricing = (() => {
  const REGIONAL_PRICES = {
    INR: { currency: 'INR', amount: 100000, label: '₹1000' },
    USD: { currency: 'USD', amount: 1500, label: '$15' }
  };
  const INDIA_TIME_ZONES = ['Asia/Kolkata', 'Asia/Calcutta'];
  const defaultCurrency = () => (INDIA_TIME_ZONES.includes(Intl.DateTimeFormat().resolvedOptions().timeZone) ? 'INR' : 'USD');
  return { REGIONAL_PRICES, defaultCurrency };
})();

document.querySelectorAll('[data-price]').forEach((el) => {
  el.textContent = window.SubpipPricing.REGIONAL_PRICES[window.SubpipPricing.defaultCurrency()].label;
});

// FAQ accordion: each question button toggles its answer
document.querySelectorAll('.accordion-trigger').forEach((button) => {
  button.addEventListener('click', () => {
    const item = button.closest('.accordion-item');
    const open = item.dataset.state !== 'open';
    item.dataset.state = open ? 'open' : 'closed';
    button.setAttribute('aria-expanded', String(open));
  });
});

document.querySelectorAll('[data-year]').forEach((el) => {
  el.textContent = String(new Date().getFullYear());
});

// Recordings of the window: each plays while it is on screen and waits when
// it is not. For visitors who asked their system for less motion nothing
// plays by itself; the recordings get play controls instead.
const clips = [...document.querySelectorAll('video.clip')];
if (clips.length) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) {
    clips.forEach((clip) => {
      clip.removeAttribute('autoplay');
      clip.pause();
      clip.controls = true;
    });
  } else {
    const onScreen = new IntersectionObserver((entries) => {
      for (const { target, isIntersecting } of entries) {
        if (isIntersecting) target.play().catch(() => {});
        else target.pause();
      }
    }, { threshold: 0.35 });
    clips.forEach((clip) => onScreen.observe(clip));
  }
}
