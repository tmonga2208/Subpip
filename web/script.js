// Regional prices: ₹999 in India, $7 in the countries where $15 is a lot, $15
// elsewhere; each also for one year (₹399, $3, $6). Chosen from the browser's
// time zone. Display only: the server (web/api/_lib/pricing.js) sets the
// amount of an order and checks what was actually charged.
window.SubpipPricing = (() => {
  const REGIONAL_PRICES = {
    INR: { currency: 'INR', amount: 99900, label: '₹999' },
    USD: { currency: 'USD', amount: 1500, label: '$15' }
  };
  const LEVELS = {
    INR: { currency: 'INR', tier: 'standard', lifetime: { amount: 99900, label: '₹999' }, year: { amount: 39900, label: '₹399' } },
    LOW: { currency: 'USD', tier: 'low', lifetime: { amount: 700, label: '$7' }, year: { amount: 300, label: '$3' } },
    USD: { currency: 'USD', tier: 'standard', lifetime: { amount: 1500, label: '$15' }, year: { amount: 600, label: '$6' } }
  };
  const INDIA_TIME_ZONES = ['Asia/Kolkata', 'Asia/Calcutta'];
  // Indonesia, the Philippines, Vietnam, Thailand, Turkey, and Brazil
  const LOWER_PRICED = ['Asia/Jakarta', 'Asia/Pontianak', 'Asia/Makassar', 'Asia/Jayapura', 'Asia/Manila', 'Asia/Ho_Chi_Minh', 'Asia/Saigon', 'Asia/Bangkok', 'Europe/Istanbul', 'Asia/Istanbul',
    'America/Sao_Paulo', 'America/Bahia', 'America/Fortaleza', 'America/Recife', 'America/Maceio', 'America/Belem', 'America/Araguaina', 'America/Santarem', 'America/Manaus', 'America/Cuiaba', 'America/Campo_Grande', 'America/Porto_Velho', 'America/Boa_Vista', 'America/Rio_Branco', 'America/Eirunepe', 'America/Noronha'];
  const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
  const defaultCurrency = () => (INDIA_TIME_ZONES.includes(timeZone()) ? 'INR' : 'USD');
  // The prices here: { currency, tier, lifetime: { amount, label }, year: { amount, label } }
  const local = () => LEVELS[INDIA_TIME_ZONES.includes(timeZone()) ? 'INR' : LOWER_PRICED.includes(timeZone()) ? 'LOW' : 'USD'];
  return { REGIONAL_PRICES, LEVELS, defaultCurrency, local };
})();

document.querySelectorAll('[data-price]').forEach((el) => {
  el.textContent = window.SubpipPricing.local().lifetime.label;
});
document.querySelectorAll('[data-price-year]').forEach((el) => {
  el.textContent = window.SubpipPricing.local().year.label;
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

// Visits are counted with Vercel Web Analytics, which sets no cookies. Its
// script runs the hooks queued here before it reports anything. A visit is
// reported under the page's address alone, never what follows "?" or "#": a
// checkout link carries a code for the account and can carry an email address.
window.va = window.va || ((...args) => {
  (window.vaq = window.vaq || []).push(args);
});
window.va('beforeSend', (event) => {
  const address = new URL(event.url);
  return { ...event, url: address.origin + address.pathname };
});
document.head.append(Object.assign(document.createElement('script'), { src: '/_vercel/insights/script.js' }));
