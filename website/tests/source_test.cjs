const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const site = path.resolve(__dirname, '../site');
let checked = 0;
for (const name of fs.readdirSync(site).filter(name => name.endsWith('.html'))) {
  const html = fs.readFileSync(path.join(site, name), 'utf8');
  for (const match of html.matchAll(/(?:href|src)="([^"<>]+)"/g)) {
    const url = new URL(match[1].replaceAll('&amp;', '&'), 'https://website.test/' + name);
    if (url.origin !== 'https://website.test') continue;
    const target = path.join(site, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    assert(fs.existsSync(target), `${name}: missing local file ${url.pathname}`);
    if (url.hash && target.endsWith('.html')) {
      const content = fs.readFileSync(target, 'utf8');
      assert(content.includes(`id="${decodeURIComponent(url.hash.slice(1))}"`), `${name}: missing anchor ${url.href}`);
    }
    checked++;
  }
  const styles = [...html.matchAll(/<link rel="stylesheet" href="([^"<>]+)"/g)];
  if (!styles.length) continue; // Redirect-only compatibility pages.
  assert.equal(styles.length, 1, `${name}: expected one CSS request`);
  const filename = styles[0][1].replace(/^\//, '');
  const css = fs.readFileSync(path.join(site, filename));
  assert(filename.includes(createHash('sha256').update(css).digest('hex').slice(0, 12)), 'stale CSS fingerprint');
  assert(!css.toString().includes('@import'), 'render-blocking font import');
}
const home = fs.readFileSync(path.join(site, 'index.html'), 'utf8');
assert(home.indexOf('assets/deferred.js') < home.indexOf('assets/site.js'));
assert(home.includes('data-clinic-clock'));
assert(home.includes('2022-09-27'));
assert(home.includes('data-care-count="6255"') && home.includes('data-care-count="13557"'));
console.log(`Source checks passed: ${checked} local links/assets, bundle hashes, font imports, script order and confirmed facts.`);
