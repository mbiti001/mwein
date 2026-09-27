(() => {
  const counters = [...document.querySelectorAll('[data-care-count]')];
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  function animate(node) {
    const total = Number(node.dataset.careCount);
    if (!Number.isFinite(total) || reduce.matches) return;
    let start;
    function tick(now) {
      if (reduce.matches) { node.textContent = total.toLocaleString('en-KE'); return; }
      start ??= now;
      const progress = Math.min((now - start) / 1400, 1);
      node.textContent = Math.round(total * (1 - Math.pow(1 - progress, 3))).toLocaleString('en-KE');
      if (progress < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }
  // Exact values are present in HTML for no-JS, reduced-motion and screen-reader use.
  if ('IntersectionObserver' in window && !reduce.matches) {
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) { observer.unobserve(entry.target); animate(entry.target); }
    }, { threshold: .5 });
    counters.forEach(node => observer.observe(node));
  }
  const summary = document.querySelector('[data-review-summary]');
  if (summary) fetch('/api/review-summary.php').then(r => { if (!r.ok) throw new Error(); return r.json(); }).then(data => {
    if (!Number.isInteger(data.count) || data.count < 0) return;
    summary.textContent = data.count && Number.isFinite(data.average) && data.average >= 1 && data.average <= 5
      ? `${data.average.toFixed(1)} / 5 from ${data.count} published ${data.count === 1 ? 'review' : 'reviews'}`
      : 'No ratings yet. Share your experience of visiting Mwein.';
  }).catch(() => {});
  for (const form of document.querySelectorAll('.feedback-form')) {
    const button = form.querySelector('button[type="submit"]');
    const status = form.querySelector('.feedback-submit-status');
    if (!button || !status) continue;
    form.addEventListener('submit', () => { button.disabled = true; status.textContent = 'Sending your feedback…'; });
    window.addEventListener('pageshow', () => { button.disabled = false; status.textContent = ''; });
  }
})();
