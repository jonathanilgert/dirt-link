// Edge-case audit for both calculator widgets and the lead endpoint.
// Run: node --test test/edge-cases.test.js
//
// Goals: prove the widgets handle malformed inputs gracefully, that double-
// submit is prevented, that very large numbers don't break layout/output,
// and that unknown postal codes don't silently mis-route quadrant.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const VOL_SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'dist', 'calculators', 'volume.js'), 'utf8');
const DISP_SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'dist', 'calculators', 'disposal-cost.js'), 'utf8');

function bootstrap(html, src, search) {
  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    url: 'https://dirtlink.ca/page' + (search || '')
  });
  dom.window.fetch = function () { return Promise.reject(new Error('stub')); };
  dom.window.eval(src);
  return dom;
}

// ── Disposal-cost: URL params edge cases ─────────────────────────────────────

test('disposal: URL with loads=0 falls back to default 5', () => {
  const dom = bootstrap(
    '<div data-calculator="dirt-disposal"></div>',
    DISP_SRC, '?loads=0&type=clean-fill&zone=SE'
  );
  const slider = dom.window.document.querySelector('input[type="range"]');
  assert.equal(slider.value, '5', 'loads=0 ignored, default 5 used');
});

test('disposal: URL with loads=999 falls back to default 5', () => {
  const dom = bootstrap(
    '<div data-calculator="dirt-disposal"></div>',
    DISP_SRC, '?loads=999&type=sod&zone=NW'
  );
  const slider = dom.window.document.querySelector('input[type="range"]');
  assert.equal(slider.value, '5');
});

test('disposal: URL with negative loads falls back', () => {
  const dom = bootstrap(
    '<div data-calculator="dirt-disposal"></div>',
    DISP_SRC, '?loads=-3&type=sod&zone=SE'
  );
  const slider = dom.window.document.querySelector('input[type="range"]');
  assert.equal(slider.value, '5');
});

test('disposal: garbage URL params are silently ignored', () => {
  const dom = bootstrap(
    '<div data-calculator="dirt-disposal"></div>',
    DISP_SRC, '?loads=banana&type=hummus&zone=PLUTO'
  );
  const slider = dom.window.document.querySelector('input[type="range"]');
  const matPressed = dom.window.document.querySelector('.dl-disp-mat-btn[aria-pressed="true"]');
  const quadPressed = dom.window.document.querySelector('.dl-disp-quad-btn[aria-pressed="true"]');
  assert.equal(slider.value, '5');
  assert.equal(matPressed.getAttribute('data-mat'), 'clean-fill');
  assert.equal(quadPressed.getAttribute('data-quad'), 'SE');
});

// ── Disposal-cost: postal code edge cases ────────────────────────────────────

test('disposal: postal code with extra whitespace still resolves', () => {
  const dom = bootstrap('<div data-calculator="dirt-disposal"></div>', DISP_SRC);
  const postal = dom.window.document.querySelector('.dl-disp-postal-input');
  postal.value = '  T 2 X   1Y4  ';
  postal.dispatchEvent(new dom.window.Event('input'));
  const active = dom.window.document.querySelector('.dl-disp-quad-btn[aria-pressed="true"]');
  assert.equal(active.getAttribute('data-quad'), 'SE');
});

test('disposal: lowercase postal code resolves to correct quadrant', () => {
  const dom = bootstrap('<div data-calculator="dirt-disposal"></div>', DISP_SRC);
  const postal = dom.window.document.querySelector('.dl-disp-postal-input');
  postal.value = 't3a 1b2';
  postal.dispatchEvent(new dom.window.Event('input'));
  const active = dom.window.document.querySelector('.dl-disp-quad-btn[aria-pressed="true"]');
  assert.equal(active.getAttribute('data-quad'), 'NW');
});

test('disposal: unmapped postal does NOT change quadrant from current selection', () => {
  const dom = bootstrap('<div data-calculator="dirt-disposal"></div>', DISP_SRC);
  // User first picks NW manually
  dom.window.document.querySelector('.dl-disp-quad-btn[data-quad="NW"]').click();
  // Then types unmapped postal
  const postal = dom.window.document.querySelector('.dl-disp-postal-input');
  postal.value = 'M5V';  // Toronto FSA, not Calgary
  postal.dispatchEvent(new dom.window.Event('input'));
  const active = dom.window.document.querySelector('.dl-disp-quad-btn[aria-pressed="true"]');
  assert.equal(active.getAttribute('data-quad'), 'NW', 'user choice preserved');
  const hint = dom.window.document.querySelector('.dl-disp-postal-hint');
  assert.match(hint.textContent, /Couldn't match/);
});

test('disposal: short postal (<3 chars) shows neutral hint, not error', () => {
  const dom = bootstrap('<div data-calculator="dirt-disposal"></div>', DISP_SRC);
  const postal = dom.window.document.querySelector('.dl-disp-postal-input');
  postal.value = 'T';
  postal.dispatchEvent(new dom.window.Event('input'));
  const hint = dom.window.document.querySelector('.dl-disp-postal-hint');
  assert.match(hint.textContent, /Postal code or quadrant/);
});

// ── Disposal-cost: large numbers don't break output ──────────────────────────

test('disposal: 30 loads of mixed (max slider) produces a valid total without overflow', () => {
  const dom = bootstrap('<div data-calculator="dirt-disposal"></div>', DISP_SRC);
  const slider = dom.window.document.querySelector('input[type="range"]');
  slider.value = 30;
  slider.dispatchEvent(new dom.window.Event('input'));
  dom.window.document.querySelector('.dl-disp-mat-btn[data-mat="mixed"]').click();
  dom.window.document.querySelector('.dl-disp-quad-btn[data-quad="SW"]').click();

  const total = dom.window.document.querySelector('[id^="dld-total-"]').textContent;
  // 30 loads × 18t × $180/t = $97,200 tipping; trucking 30 × 2.5h × $120 = $9,000; total $106,200
  assert.equal(total, '$106,200');
});

test('disposal: cubic-yards hint stays accurate at max loads (30 × 14 = 420 yd³)', () => {
  const dom = bootstrap('<div data-calculator="dirt-disposal"></div>', DISP_SRC);
  const slider = dom.window.document.querySelector('input[type="range"]');
  slider.value = 30;
  slider.dispatchEvent(new dom.window.Event('input'));
  const hint = dom.window.document.querySelector('[id^="dld-loadsh-"]');
  assert.equal(hint.textContent, '(≈ 420 yd³)');
});

// ── Disposal-cost: email submit is single-shot ───────────────────────────────

test('disposal: email submit button disables itself while in-flight (no double-submit)', async () => {
  const dom = bootstrap('<div data-calculator="dirt-disposal"></div>', DISP_SRC);
  // Replace fetch with one that never resolves so we can observe the loading state
  dom.window.fetch = function () { return new Promise(() => {}); };

  const host = dom.window.document.querySelector('[data-calculator]');
  host.querySelector('[id^="dld-emailbtn-"]').click();
  const email = host.querySelector('input[type="email"]');
  email.value = 'real@example.com';
  host.querySelector('form').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));

  // Microtask flush
  await new Promise(r => setImmediate(r));

  const submit = host.querySelector('[id^="dld-emailsubmit-"]');
  assert.equal(submit.disabled, true, 'submit disabled during in-flight request');
  assert.match(submit.textContent, /Sending/);
});

test('disposal: invalid email shows error, does NOT call fetch', () => {
  const dom = bootstrap('<div data-calculator="dirt-disposal"></div>', DISP_SRC);
  let fetchCalled = false;
  dom.window.fetch = function () { fetchCalled = true; return new Promise(() => {}); };

  const host = dom.window.document.querySelector('[data-calculator]');
  host.querySelector('[id^="dld-emailbtn-"]').click();
  const email = host.querySelector('input[type="email"]');
  email.value = 'not-an-email';
  host.querySelector('form').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));

  assert.equal(fetchCalled, false, 'fetch not called for invalid email');
  assert.equal(email.getAttribute('aria-invalid'), 'true');
});

// ── Volume: edge cases ───────────────────────────────────────────────────────

test('volume: 0 area → 0 yd³, no crash, hides ≈ X loads hint', () => {
  const dom = bootstrap('<div data-calculator="volume"></div>', VOL_SRC);
  const host = dom.window.document.querySelector('[data-calculator]');
  const len = host.querySelector('input[id^="dl-vol-len-"]');
  const wid = host.querySelector('input[id^="dl-vol-wid-"]');
  len.value = 0; wid.value = 0;
  len.dispatchEvent(new dom.window.Event('input'));
  wid.dispatchEvent(new dom.window.Event('input'));
  const yd = host.querySelector('[id^="dl-vol-yd-"]');
  const loads = host.querySelector('[id^="dl-vol-loads-"]');
  assert.equal(yd.textContent, '0.0');
  assert.equal(loads.textContent, '');
});

test('volume: decimal inputs handled (3.5 ft × 7.25 ft × 6")', () => {
  const dom = bootstrap('<div data-calculator="volume"></div>', VOL_SRC);
  const host = dom.window.document.querySelector('[data-calculator]');
  const len = host.querySelector('input[id^="dl-vol-len-"]');
  const wid = host.querySelector('input[id^="dl-vol-wid-"]');
  const dep = host.querySelector('input[type="range"]');
  len.value = 3.5; wid.value = 7.25; dep.value = 6;
  ['input'].forEach(t => {
    [len, wid, dep].forEach(el => el.dispatchEvent(new dom.window.Event(t)));
  });
  const yd = host.querySelector('[id^="dl-vol-yd-"]');
  // 3.5 × 7.25 = 25.375 sqft × 6/12 = 12.6875 cuft / 27 = 0.47 yd³
  assert.equal(yd.textContent, '0.5');
});

test('volume: very large area (10,000 sq ft × 12") does not break layout — produces a finite number', () => {
  const dom = bootstrap('<div data-calculator="volume"></div>', VOL_SRC);
  const host = dom.window.document.querySelector('[data-calculator]');
  // Use sqft mode for big area
  host.querySelector('[data-dl-vol-toggle]').click();
  const sqft = host.querySelector('input[id^="dl-vol-sqft-"]');
  const dep = host.querySelector('input[type="range"]');
  sqft.value = 10000; dep.value = 12;
  sqft.dispatchEvent(new dom.window.Event('input'));
  dep.dispatchEvent(new dom.window.Event('input'));
  const yd = host.querySelector('[id^="dl-vol-yd-"]');
  // 10,000 × 1 / 27 = 370.4 yd³
  assert.equal(yd.textContent, '370.4');
  const loads = host.querySelector('[id^="dl-vol-loads-"]');
  assert.match(loads.textContent, /loads/);
});

test('volume: negative width treated as 0', () => {
  const dom = bootstrap('<div data-calculator="volume"></div>', VOL_SRC);
  const host = dom.window.document.querySelector('[data-calculator]');
  const wid = host.querySelector('input[id^="dl-vol-wid-"]');
  wid.value = -5;
  wid.dispatchEvent(new dom.window.Event('input'));
  const yd = host.querySelector('[id^="dl-vol-yd-"]');
  assert.equal(yd.textContent, '0.0');
});
