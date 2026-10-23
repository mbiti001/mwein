(() => {
  const footer = document.querySelector('footer');
  if (!footer) return;
  const pages = ['/', '/index.html', '/services.html', '/insurers.html', '/blog.html', '/blog.php', '/reviews.php','/careers.html','/careers.php','/faq.html', '/partners.html', '/contact.html', '/privacy-policy.html'];
  const privacy = navigator.doNotTrack === '1' || navigator.globalPrivacyControl === true;
  const key = 'mwein_analytics_choice';
  const read = () => {
    try {
      const choice = JSON.parse(localStorage.getItem(key));
      return choice && choice.expires > Date.now() && ['yes', 'no', 'necessary'].includes(choice.value) ? choice.value : null;
    } catch { return null; }
  };
  let choice = read();
  let recorded = false, pending = false, retryTimer = null, attempts = 0;
  // One ID per page load makes retries safe even when a response is lost.
  const eventId = Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, '0')).join('');
  let requests = Promise.resolve();
  const send = (data, allowed = () => true) => {
    const request = requests.then(async () => {
      if (!allowed()) return null;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        return await fetch('/api/visit.php', {
          method: 'POST', credentials: 'same-origin', keepalive: true, signal: controller.signal,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(data)
        });
      } finally { clearTimeout(timeout); }
    });
    // Keep rejection cleanup ordered after any in-flight accept request.
    requests = request.catch(() => {});
    return request;
  };
  const permitted = () => !privacy && choice === 'yes';
  const forget = () => {
    clearTimeout(retryTimer); retryTimer = null;
    send({ forget: 'yes' }).catch(() => {});
  };
  const record = () => {
    if (!permitted() || recorded || pending || document.visibilityState !== 'visible' || !pages.includes(location.pathname)) return;
    clearTimeout(retryTimer); retryTimer = null;
    pending = true; attempts++;
    let referrer = '';
    try { referrer = new URL(document.referrer).origin; } catch {}
    const id = new URLSearchParams(location.search).get('id');
    const path = location.pathname === '/blog.php' && /^[1-9][0-9]{0,8}$/.test(id || '') ? 'post:' + id : location.pathname;
    let retryable = false;
    send({ path, consent: 'yes', referrer, event_id: eventId }, permitted).then(response => {
      if (!response) return;
      if (response.ok) recorded = true;
      else retryable = response.status === 429 || response.status >= 500;
    }).catch(() => { retryable = true; }).finally(() => {
      pending = false;
      if (retryable && permitted() && attempts < 3) retryTimer = setTimeout(record, attempts * 1500);
    });
  };
  const panel = document.createElement('section');
  panel.className = 'cookie-panel'; panel.id = 'cookie-preferences';
  panel.setAttribute('aria-labelledby', 'cookie-title');
  const heading = document.createElement('h2'); heading.id = 'cookie-title'; heading.textContent = 'Your cookie choices';
  const description = document.createElement('p');
  description.textContent = 'We use necessary storage to keep this site working. Optional analytics stays off unless you accept.';
  const status = document.createElement('p'); status.className = 'cookie-status'; status.setAttribute('role', 'status');
  const actions = document.createElement('div'); actions.className = 'cookie-actions';
  const settings = document.createElement('button'); settings.type = 'button'; settings.className = 'cookie-settings';
  settings.textContent = 'Cookie settings'; settings.setAttribute('aria-controls', panel.id);
  const update = () => {
    status.textContent = privacy ? 'Your browser privacy preference keeps optional analytics off.' : choice === 'yes' ? 'Current choice: all cookies accepted.' : choice === 'no' ? 'Current choice: optional cookies rejected.' : choice === 'necessary' ? 'Current choice: necessary cookies only.' : 'Optional analytics is off until you accept.';
    settings.setAttribute('aria-expanded', String(!panel.hidden));
  };
  for (const [label, value] of [['Accept all', 'yes'], ['Reject optional', 'no'], ['Necessary only', 'necessary']]) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
    button.disabled = privacy && value === 'yes';
    button.addEventListener('click', () => {
      choice = value;
      try { localStorage.setItem(key, JSON.stringify({ value, expires: Date.now() + 90 * 86400000 })); } catch {}
      if (value === 'yes') record(); else forget();
      panel.hidden = true; update(); settings.focus();
    });
    actions.append(button);
  }
  const notice = document.createElement('a'); notice.href = '/privacy-policy.html#cookies'; notice.textContent = 'Read our cookie and privacy notice';
  panel.append(heading, description, status, actions, notice);
  panel.hidden = choice !== null;
  footer.before(panel); footer.append(settings);
  settings.addEventListener('click', () => { panel.hidden = !panel.hidden; update(); if (!panel.hidden) actions.querySelector('button:not(:disabled)').focus(); });
  panel.addEventListener('keydown', event => { if (event.key === 'Escape') { panel.hidden = true; update(); settings.focus(); } });
  update();
  // Clear old identifiers when consent has expired, been declined, or browser privacy is enabled.
  if (privacy || choice !== 'yes') forget(); else record();
  document.addEventListener('visibilitychange', record);
  window.addEventListener('online', () => { attempts = 0; record(); });
  window.addEventListener('storage', event => {
    if (event.key !== key && event.key !== null) return;
    choice = read(); panel.hidden = choice !== null; update();
    if (privacy || choice !== 'yes') forget(); else record();
  });
})();
