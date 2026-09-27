(() => {
  const footer = document.querySelector('footer');
  if (!footer) return;
  const pages = ['/', '/index.html', '/services.html', '/insurers.html', '/blog.html', '/blog.php', '/partners.html', '/contact.html', '/privacy-policy.html'];
  const privacy = navigator.doNotTrack === '1' || navigator.globalPrivacyControl === true;
  const key = 'mwein_analytics_choice';
  const read = () => {
    try {
      const choice = JSON.parse(localStorage.getItem(key));
      return choice && choice.expires > Date.now() && ['yes', 'no', 'necessary'].includes(choice.value) ? choice.value : null;
    } catch { return null; }
  };
  let choice = read();
  let recorded = false;
  // Serialize changes so a late accept response cannot restore cookies after rejection.
  let requests = Promise.resolve();
  const send = data => {
    requests = requests.then(() => fetch('/api/visit.php', {
      method: 'POST', credentials: 'same-origin', keepalive: true,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(data)
    })).catch(() => {});
  };
  const record = () => {
    if (privacy || choice !== 'yes' || recorded || document.visibilityState !== 'visible' || !pages.includes(location.pathname)) return;
    recorded = true;
    let referrer = '';
    try { referrer = new URL(document.referrer).origin; } catch {}
    const id = new URLSearchParams(location.search).get('id');
    const path = location.pathname === '/blog.php' && /^[1-9][0-9]{0,8}$/.test(id || '') ? 'post:' + id : location.pathname;
    send({ path, consent: 'yes', referrer });
  };
  const panel = document.createElement('section');
  panel.className = 'cookie-panel'; panel.id = 'cookie-preferences';
  panel.setAttribute('aria-labelledby', 'cookie-title');
  const heading = document.createElement('h2'); heading.id = 'cookie-title'; heading.textContent = 'Your cookie choices';
  const description = document.createElement('p');
  description.textContent = 'Necessary storage supports security and remembers your choice. Optional analytics cookies help us understand website use. Accept all to allow analytics, or choose Reject optional or Necessary only to keep it off.';
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
      if (value === 'yes') record(); else send({ forget: 'yes' });
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
  if (privacy || choice !== 'yes') send({ forget: 'yes' }); else record();
  document.addEventListener('visibilitychange', record);
  window.addEventListener('storage', event => {
    if (event.key !== key && event.key !== null) return;
    choice = read(); panel.hidden = choice !== null; update();
    if (privacy || choice !== 'yes') send({ forget: 'yes' }); else record();
  });
})();
