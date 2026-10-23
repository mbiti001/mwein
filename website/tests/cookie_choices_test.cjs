const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../site/assets/visits.js'), 'utf8');
function setup(saved, privacy = false, failStorage = false) {
  const elements = [], calls = [], listeners = {};
  class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.handlers = {}; this.attrs = {}; this.hidden = false; elements.push(this); }
    append(...nodes) { this.children.push(...nodes); }
    before(node) { this.previous = node; }
    setAttribute(k,v) { this.attrs[k] = v; }
    addEventListener(k,fn) { this.handlers[k] = fn; }
    focus() { this.focused = true; }
    querySelector() { return this.children.find(n => n.tag === 'button' && !n.disabled); }
    click() { if (!this.disabled) this.handlers.click(); }
  }
  const footer = new Element('footer');
  let storage = saved ? JSON.stringify(saved) : null;
  const context = {
    navigator: { globalPrivacyControl: privacy }, location: { pathname: '/', search: '' }, URL, URLSearchParams,
    localStorage: { getItem: () => { if (failStorage) throw Error(); return storage; }, setItem: (_, v) => { if (failStorage) throw Error(); storage = v; } },
    document: { visibilityState: 'visible', referrer: '', querySelector: () => footer, createElement: tag => new Element(tag), addEventListener: (k, fn) => { listeners[k] = fn; } },
    window: { addEventListener: (k,fn) => { listeners[k] = fn; } },
    fetch: async (_, opts) => { calls.push(Object.fromEntries(opts.body)); return {}; }
  };
  vm.runInNewContext(source, context);
  return { calls, footer, context, button: label => elements.find(e => e.textContent === label), settle: () => new Promise(resolve => setImmediate(resolve)), saved: () => JSON.parse(storage) };
}
(async () => {
  const fresh = setup(); await fresh.settle();
  assert.deepEqual(fresh.calls, [{forget:'yes'}]); assert.equal(fresh.footer.previous.hidden, false);
  fresh.button('Accept all').click(); await fresh.settle();
  assert.equal(fresh.calls.at(-1).consent, 'yes'); assert.equal(fresh.footer.previous.hidden, true); assert.equal(fresh.saved().value, 'yes');
  fresh.button('Cookie settings').click(); assert.equal(fresh.footer.previous.hidden, false);
  fresh.button('Reject optional').click(); await fresh.settle(); assert.equal(fresh.calls.at(-1).forget, 'yes'); assert.equal(fresh.saved().value, 'no');
  const necessary = setup(); necessary.button('Necessary only').click(); await necessary.settle(); assert.equal(necessary.saved().value, 'necessary'); assert(necessary.calls.every(c => c.forget === 'yes'));
  const prior = setup({value:'yes',expires:Date.now()+10000}); await prior.settle(); assert.equal(prior.calls[0].consent,'yes'); assert.equal(prior.footer.previous.hidden,true);
  const expired = setup({value:'yes',expires:1}); await expired.settle(); assert(expired.calls.every(c=>c.forget==='yes')); assert.equal(expired.footer.previous.hidden,false);
  const protectedBrowser = setup({value:'yes',expires:Date.now()+10000},true); await protectedBrowser.settle(); assert.equal(protectedBrowser.button('Accept all').disabled,true); assert(protectedBrowser.calls.every(c=>c.forget==='yes'));
  const blockedStorage=setup(null,false,true); blockedStorage.button('Necessary only').click(); await blockedStorage.settle(); assert.equal(blockedStorage.footer.previous.hidden,true);
  const rapid=setup(); rapid.button('Accept all').click(); rapid.button('Reject optional').click(); await rapid.settle(); assert.equal(rapid.calls.at(-1).forget,'yes');
  console.log('Cookie consent checks passed: defaults, accept, reject, necessary-only, reopen, expiry, browser privacy, blocked storage, request ordering.');
})().catch(error => { console.error(error); process.exitCode=1; });
