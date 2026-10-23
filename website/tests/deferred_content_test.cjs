const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../site/assets/deferred.js'), 'utf8');
let callback, disconnected = false, observed, calls = 0;
const context = { window: {}, IntersectionObserver: class {
  constructor(fn, options) { callback = fn; assert.equal(options.rootMargin, '250px'); }
  observe(element) { observed = element; }
  disconnect() { disconnected = true; }
} };
context.window.IntersectionObserver = context.IntersectionObserver;
vm.runInNewContext(source, context);
const element = {};
context.window.Mwein.whenNear(element, () => calls++);
assert.equal(calls, 0); assert.equal(observed, element);
callback([{ isIntersecting: false }]); assert.equal(calls, 0);
callback([{ isIntersecting: true }]); assert.equal(calls, 1); assert(disconnected);
const fallback = { window: {} };
vm.runInNewContext(source, fallback);
fallback.window.Mwein.whenNear(element, () => calls++);
assert.equal(calls, 2);
fallback.window.Mwein.whenNear(null, () => calls++);
assert.equal(calls, 2);
console.log('Deferred content checks passed: no early request, viewport trigger, disconnect, compatibility fallback and missing section.');
