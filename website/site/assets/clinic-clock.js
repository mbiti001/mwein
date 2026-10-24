/* Clinic-local time, independent of the visitor's time zone. */
(() => {
  const panel = document.querySelector('[data-clinic-clock]');
  if (!panel) return;
  const field = name => panel.querySelector(`[data-clock-${name}]`);
  const weekday = field('weekday'), day = field('day'), month = field('month'), time = field('time');
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Nairobi', weekday: 'long', day: '2-digit', month: 'long',
    year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  });
  let timer;
  function update() {
    const now = new Date();
    const parts = Object.fromEntries(formatter.formatToParts(now).map(p => [p.type, p.value]));
    weekday.textContent = parts.weekday;
    day.textContent = parts.day;
    month.textContent = `${parts.month} ${parts.year}`;
    time.textContent = `${parts.hour}:${parts.minute}`;
    time.dateTime = now.toISOString();
    time.setAttribute('aria-label', `${parts.hour}:${parts.minute} East Africa Time, ${parts.weekday} ${parts.day} ${parts.month} ${parts.year}`);
    panel.hidden = false;
  }
  function sync() {
    clearInterval(timer);
    if (document.hidden) return;
    update();
    timer = setInterval(update, 60000);
  }
  document.addEventListener('visibilitychange', sync);
  window.addEventListener('pageshow', sync);
  window.addEventListener('pagehide', () => clearInterval(timer));
  sync();
  const board = panel.closest('.care-board');
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        board.classList.add('is-in-view');
        observer.disconnect();
      }
    }, {threshold: 0.25});
    observer.observe(board);
  } else {
    board.classList.add('is-in-view');
  }
})();
