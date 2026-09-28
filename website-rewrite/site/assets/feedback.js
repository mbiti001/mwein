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
  async function initialiseCounters() {
    // A dated static snapshot remains usable when JavaScript or the API is unavailable.
    if (counters.length) {
      try {
        const response = await fetch('/api/care-summary.php', { cache: 'no-store', signal: AbortSignal.timeout(5000) });
        if (!response.ok) throw new Error();
        const data = await response.json();
        if (!['patients', 'encounters'].every(key => Number.isInteger(data[key]) && data[key] >= 0 && data[key] <= 1000000000) || !/^\d{4}-\d{2}-\d{2}$/.test(data.recorded_on)) throw new Error();
        const date = new Date(data.recorded_on + 'T12:00:00Z');
        if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== data.recorded_on) throw new Error();
        for (const node of counters) {
          const total = data[node.dataset.careKind];
          node.dataset.careCount = String(total);
          node.textContent = total.toLocaleString('en-KE');
          node.parentElement.querySelector('.impact-exact').textContent = node.textContent;
        }
        const dateLabel = document.querySelector('.care-impact time');
        dateLabel.dateTime = data.recorded_on;
        dateLabel.textContent = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
      } catch {
        const note=document.querySelector('.impact-note');
        if(note)note.textContent='The latest totals could not be loaded. Showing the confirmed snapshot dated above. Please try again later.';
      }
    }
    if ('IntersectionObserver' in window && !reduce.matches) {
      const observer = new IntersectionObserver(entries => {
        for (const entry of entries) if (entry.isIntersecting) { observer.unobserve(entry.target); animate(entry.target); }
      }, { threshold: .5 });
      counters.forEach(node => observer.observe(node));
    }
  }
  initialiseCounters();
  const summary = document.querySelector('[data-review-summary]');
  if (summary) fetch('/api/review-summary.php').then(r => { if (!r.ok) throw new Error(); return r.json(); }).then(data => {
    if (!Number.isInteger(data.count) || data.count < 0) return;
    summary.textContent = data.count && Number.isFinite(data.average) && data.average >= 1 && data.average <= 5
      ? `${data.average.toFixed(1)} / 5 from ${data.count} published ${data.count === 1 ? 'review' : 'reviews'}`
      : 'No ratings yet. Share your experience of visiting Mwein.';
  }).catch(() => {});
})();
