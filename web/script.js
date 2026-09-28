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
