// Unit + E2E tests for the disposal-cost calculator widget.
// Run with: node --test test/disposal-cost-widget.test.js
//
// Same pattern as volume-widget.test.js — uses runScripts:'outside-only' +
// window.eval() so the widget runs synchronously and we can assert immediately.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const WIDGET_PATH = path.join(__dirname, '..', 'public', 'dist', 'calculators', 'disposal-cost.js');
const WIDGET_SRC = fs.readFileSync(WIDGET_PATH, 'utf8');
const HOST_PAGE_PATH = path.join(__dirname, '..', 'public', 'calgary', 'dirt-disposal-cost.html');
const HOST_PAGE_HTML = fs.readFileSync(HOST_PAGE_PATH, 'utf8');

function bootstrap(placeholderHtml, opts) {
  opts = opts || {};
  const search = opts.search || '';
  const html =
    '<!DOCTYPE html><html><head></head><body>' +
    (placeholderHtml || '<div data-calculator="dirt-disposal"></div>') +
    '</body></html>';
  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    url: 'https://dirtlink.ca/calgary/dirt-disposal-cost' + search
  });
  if (opts.preScript) dom.window.eval(opts.preScript);
  // Stub fetch so the rates JSON refresh doesn't try to make network calls
  dom.window.fetch = function () { return Promise.reject(new Error('stubbed')); };
  dom.window.eval(WIDGET_SRC);
  return { dom, window: dom.window, document: dom.window.document };
}

function bootstrapHostPage(opts) {
  opts = opts || {};
  const search = opts.search || '';
  // Inject empty GA id (the runtime template-replace happens in Express, not in tests)
  let html = HOST_PAGE_HTML.replace(/\{\{GA_MEASUREMENT_ID\}\}/g, '');
  // Remove the GA loader script and the deferred widget script — we eval the
  // widget directly so execution order is deterministic
  html = html.replace(/<script src="\/dist\/calculators\/disposal-cost\.js"[^>]*><\/script>/, '');
  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    url: 'https://dirtlink.ca/calgary/dirt-disposal-cost' + search
  });
  dom.window.fetch = function () { return Promise.reject(new Error('stubbed')); };
  dom.window.eval(WIDGET_SRC);
  return { dom, window: dom.window, document: dom.window.document };
}

// ── Hydration ────────────────────────────────────────────────────────────────

test('widget hydrates the placeholder with default state', () => {
  const { document } = bootstrap();
  const host = document.querySelector('[data-calculator="dirt-disposal"]');
  assert.equal(host.getAttribute('data-dl-hydrated'), '1');
  assert.ok(host.classList.contains('dl-disp'));
  assert.ok(host.querySelector('input[type="range"]'), 'has loads slider');
  assert.equal(host.querySelectorAll('.dl-disp-mat-btn').length, 4);
  assert.equal(host.querySelectorAll('.dl-disp-quad-btn').length, 4);
  assert.ok(host.querySelector('.dl-disp-postal-input'), 'has postal input');
});

test('default state: 5 loads, clean-fill, SE quadrant', () => {
  const { document } = bootstrap();
  const host = document.querySelector('[data-calculator="dirt-disposal"]');
  const slider = host.querySelector('input[type="range"]');
  assert.equal(slider.value, '5');
  const matPressed = host.querySelector('.dl-disp-mat-btn[aria-pressed="true"]');
  assert.equal(matPressed.getAttribute('data-mat'), 'clean-fill');
  const quadPressed = host.querySelector('.dl-disp-quad-btn[aria-pressed="true"]');
  assert.equal(quadPressed.getAttribute('data-quad'), 'SE');
});

test('idempotent: loading the script twice is a no-op', () => {
  const { window, document } = bootstrap();
  const host = document.querySelector('[data-calculator="dirt-disposal"]');
  const before = host.innerHTML;
  window.eval(WIDGET_SRC);
  assert.equal(window.__DL_DISP_LOADED__, true);
  assert.equal(host.innerHTML, before);
});

// ── URL state sync ───────────────────────────────────────────────────────────

test('URL params populate inputs on load', () => {
  const { document } = bootstrap(null, { search: '?loads=12&type=sod&zone=NW' });
  const host = document.querySelector('[data-calculator="dirt-disposal"]');
  assert.equal(host.querySelector('input[type="range"]').value, '12');
  assert.equal(host.querySelector('.dl-disp-mat-btn[aria-pressed="true"]').getAttribute('data-mat'), 'sod');
  assert.equal(host.querySelector('.dl-disp-quad-btn[aria-pressed="true"]').getAttribute('data-quad'), 'NW');
});

test('invalid URL params fall back to defaults', () => {
  const { document } = bootstrap(null, { search: '?loads=99&type=lava&zone=ZZ' });
  const host = document.querySelector('[data-calculator="dirt-disposal"]');
  assert.equal(host.querySelector('input[type="range"]').value, '5');
  assert.equal(host.querySelector('.dl-disp-mat-btn[aria-pressed="true"]').getAttribute('data-mat'), 'clean-fill');
  assert.equal(host.querySelector('.dl-disp-quad-btn[aria-pressed="true"]').getAttribute('data-quad'), 'SE');
});

test('URL writes are debounced — they update history.replaceState after 300ms', async () => {
  const { window, document } = bootstrap();
  const host = document.querySelector('[data-calculator="dirt-disposal"]');
  const slider = host.querySelector('input[type="range"]');
  const initialUrl = window.location.search;

  // Fire several rapid input events
  for (let v = 6; v <= 10; v++) {
    slider.value = v;
    slider.dispatchEvent(new window.Event('input'));
  }
  // URL should NOT have updated yet (debounce pending)
  // We can't introspect history queue, but we can check that the URL still
  // reflects only the most-recent change after waiting 350ms.
  await new Promise(r => setTimeout(r, 350));
  const finalSearch = window.location.search;
  assert.match(finalSearch, /loads=10/);
  assert.match(finalSearch, /type=clean-fill/);
  assert.match(finalSearch, /zone=SE/);
});

// ── Postal code → quadrant lookup ────────────────────────────────────────────

test('postal code prefix sets quadrant and shows match hint', () => {
  const { window, document } = bootstrap();
  const host = document.querySelector('[data-calculator="dirt-disposal"]');
  const postal = host.querySelector('.dl-disp-postal-input');
  postal.value = 'T2X 1Y4';
  postal.dispatchEvent(new window.Event('input'));
  const quadActive = host.querySelector('.dl-disp-quad-btn[aria-pressed="true"]');
  assert.equal(quadActive.getAttribute('data-quad'), 'SE');
  const hint = host.querySelector('.dl-disp-postal-hint');
  assert.ok(hint.classList.contains('matched'));
  assert.match(hint.textContent, /SE/);
});

test('unknown postal prefix shows "couldn\'t match" hint', () => {
  const { window, document } = bootstrap();
  const host = document.querySelector('[data-calculator="dirt-disposal"]');
  const postal = host.querySelector('.dl-disp-postal-input');
  postal.value = 'ZZZ';
  postal.dispatchEvent(new window.Event('input'));
  const hint = host.querySelector('.dl-disp-postal-hint');
  assert.match(hint.textContent, /Couldn't match/);
  assert.equal(hint.classList.contains('matched'), false);
});

test('all four quadrants are reachable via FSAs', () => {
  const fsas = { 'T1Y': 'NE', 'T3A': 'NW', 'T2X': 'SE', 'T2P': 'SW' };
  Object.keys(fsas).forEach(function (fsa) {
    const { window, document } = bootstrap();
    const host = document.querySelector('[data-calculator="dirt-disposal"]');
    const postal = host.querySelector('.dl-disp-postal-input');
    postal.value = fsa;
    postal.dispatchEvent(new window.Event('input'));
    const active = host.querySelector('.dl-disp-quad-btn[aria-pressed="true"]');
    assert.equal(active.getAttribute('data-quad'), fsas[fsa], `${fsa} → ${fsas[fsa]}`);
  });
});

// ── Tipping label wording (Stage 4 spec exact) ───────────────────────────────

test('tipping label: clean-fill → "Tipping (clean fill, $10/t)"', () => {
  const { document } = bootstrap();
  const host = document.querySelector('[data-calculator="dirt-disposal"]');
  const tipLabel = host.querySelector('[id^="dld-tipl-"]');
  assert.equal(tipLabel.textContent, 'Tipping (clean fill, $10/t)');
});

test('tipping label: sod → "Tipping (basic sanitary, $113/t)"', () => {
  const { window, document } = bootstrap();
  const host = document.querySelector('[data-calculator="dirt-disposal"]');
  host.querySelector('.dl-disp-mat-btn[data-mat="sod"]').click();
  const tipLabel = host.querySelector('[id^="dld-tipl-"]');
  assert.equal(tipLabel.textContent, 'Tipping (basic sanitary, $113/t)');
});

test('tipping label: mixed → "Tipping (commercial surcharge, $180/t)"', () => {
  const { document } = bootstrap();
  const host = document.querySelector('[data-calculator="dirt-disposal"]');
  host.querySelector('.dl-disp-mat-btn[data-mat="mixed"]').click();
  const tipLabel = host.querySelector('[id^="dld-tipl-"]');
  assert.equal(tipLabel.textContent, 'Tipping (commercial surcharge, $180/t)');
});

// ── Live updates ─────────────────────────────────────────────────────────────

test('changing loads slider updates the total', () => {
  const { window, document } = bootstrap();
  const host = document.querySelector('[data-calculator="dirt-disposal"]');
  const slider = host.querySelector('input[type="range"]');
  const totalEl = host.querySelector('[id^="dld-total-"]');
  const before = totalEl.textContent;
  slider.value = 20;
  slider.dispatchEvent(new window.Event('input'));
  assert.notEqual(totalEl.textContent, before);
  // 20 loads of clean fill at SE: tipping = 20*18*10 = 3600, trucking = 20*1*120 = 2400, total = 6000
  assert.equal(totalEl.textContent, '$6,000');
});

test('cubic-yards hint updates next to loads value', () => {
  const { window, document } = bootstrap();
  const host = document.querySelector('[data-calculator="dirt-disposal"]');
  const slider = host.querySelector('input[type="range"]');
  slider.value = 8;
  slider.dispatchEvent(new window.Event('input'));
  const hint = host.querySelector('[id^="dld-loadsh-"]');
  assert.equal(hint.textContent, '(≈ 112 yd³)');  // 8 × 14
});

test('selecting sod material shows sod narrative', () => {
  const { document } = bootstrap();
  const host = document.querySelector('[data-calculator="dirt-disposal"]');
  host.querySelector('.dl-disp-mat-btn[data-mat="sod"]').click();
  const narr = host.querySelector('[id^="dld-narr-"]');
  assert.match(narr.textContent, /basic sanitary rate/);
});

// ── List CTA URL construction ────────────────────────────────────────────────

test('List CTA href includes loads, type, zone, source=calculator', () => {
  const { document } = bootstrap();
  const host = document.querySelector('[data-calculator="dirt-disposal"]');
  const cta = host.querySelector('[id^="dld-list-"]');
  const href = cta.getAttribute('href');
  assert.match(href, /^\/calgary\/list-fill\?/);
  assert.match(href, /loads=5/);
  assert.match(href, /type=clean-fill/);
  assert.match(href, /zone=SE/);
  assert.match(href, /source=calculator/);
});

test('List CTA href updates as inputs change', () => {
  const { window, document } = bootstrap();
  const host = document.querySelector('[data-calculator="dirt-disposal"]');
  host.querySelector('.dl-disp-mat-btn[data-mat="sod"]').click();
  host.querySelector('.dl-disp-quad-btn[data-quad="NW"]').click();
  const cta = host.querySelector('[id^="dld-list-"]');
  const href = cta.getAttribute('href');
  assert.match(href, /type=sod/);
  assert.match(href, /zone=NW/);
});

// ── Email form validation ────────────────────────────────────────────────────

test('email form: invalid email shows error message and aria-invalid', () => {
  const { window, document } = bootstrap();
  const host = document.querySelector('[data-calculator="dirt-disposal"]');
  host.querySelector('[id^="dld-emailbtn-"]').click();
  const email = host.querySelector('input[type="email"]');
  email.value = 'not-an-email';
  host.querySelector('form').dispatchEvent(new window.Event('submit', { cancelable: true }));
  const msg = host.querySelector('[id^="dld-emailmsg-"]');
  assert.ok(msg.classList.contains('show'));
  assert.ok(msg.classList.contains('error'));
  assert.equal(email.getAttribute('aria-invalid'), 'true');
});

test('email form: clicking the toggle button opens it and sets aria-expanded', () => {
  const { window, document } = bootstrap();
  const host = document.querySelector('[data-calculator="dirt-disposal"]');
  const btn = host.querySelector('[id^="dld-emailbtn-"]');
  const form = host.querySelector('form.dl-disp-email-form');
  assert.equal(btn.getAttribute('aria-expanded'), 'false');
  btn.click();
  assert.equal(btn.getAttribute('aria-expanded'), 'true');
  assert.ok(form.classList.contains('open'));
});

test('email form: aria-describedby on email input points at the message div', () => {
  const { document } = bootstrap();
  const host = document.querySelector('[data-calculator="dirt-disposal"]');
  const email = host.querySelector('input[type="email"]');
  const msg = host.querySelector('[id^="dld-emailmsg-"]');
  assert.equal(email.getAttribute('aria-describedby'), msg.id);
});

// ── Accessibility ────────────────────────────────────────────────────────────

test('output region has aria-live="polite"', () => {
  const { document } = bootstrap();
  const out = document.querySelector('.dl-disp-out');
  assert.equal(out.getAttribute('aria-live'), 'polite');
});

test('material buttons have aria-pressed (radio-like behavior)', () => {
  const { document } = bootstrap();
  const host = document.querySelector('[data-calculator="dirt-disposal"]');
  const buttons = host.querySelectorAll('.dl-disp-mat-btn');
  buttons.forEach(b => assert.ok(b.hasAttribute('aria-pressed')));
  const pressed = Array.from(buttons).filter(b => b.getAttribute('aria-pressed') === 'true');
  assert.equal(pressed.length, 1);
});

test('quadrant buttons have aria-pressed', () => {
  const { document } = bootstrap();
  const host = document.querySelector('[data-calculator="dirt-disposal"]');
  const buttons = host.querySelectorAll('.dl-disp-quad-btn');
  buttons.forEach(b => assert.ok(b.hasAttribute('aria-pressed')));
});

test('host has role=region with descriptive aria-label', () => {
  const { document } = bootstrap();
  const host = document.querySelector('[data-calculator="dirt-disposal"]');
  assert.equal(host.getAttribute('role'), 'region');
  assert.match(host.getAttribute('aria-label'), /Calgary dirt disposal cost calculator/);
});

// ── Analytics events ─────────────────────────────────────────────────────────

test('analytics: fires calculator_disposal_viewed on hydration', () => {
  const preScript = 'window.__GTAG=[];window.gtag=function(){window.__GTAG.push([].slice.call(arguments))};';
  const { window } = bootstrap(null, { preScript });
  const calls = window.__GTAG;
  const viewed = calls.find(c => c[1] === 'calculator_disposal_viewed');
  assert.ok(viewed, 'calculator_disposal_viewed fired');
  assert.equal(viewed[2].material_type, 'clean-fill');
  assert.equal(viewed[2].quadrant, 'SE');
});

test('analytics: input_changed fires once per field', () => {
  const preScript = 'window.__GTAG=[];window.gtag=function(){window.__GTAG.push([].slice.call(arguments))};';
  const { window, document } = bootstrap(null, { preScript });
  const host = document.querySelector('[data-calculator="dirt-disposal"]');

  const slider = host.querySelector('input[type="range"]');
  slider.value = 7;
  slider.dispatchEvent(new window.Event('input'));
  slider.value = 9;
  slider.dispatchEvent(new window.Event('input'));

  host.querySelector('.dl-disp-mat-btn[data-mat="sod"]').click();
  host.querySelector('.dl-disp-mat-btn[data-mat="mixed"]').click();

  const changes = window.__GTAG.filter(c => c[1] === 'calculator_disposal_input_changed');
  // One per unique field (loads + materialType), each only fires once
  assert.equal(changes.length, 2);
  // Compare element-by-element (JSDOM-realm arrays trip deepStrictEqual)
  const fields = Array.from(changes).map(c => String(c[2].field)).sort();
  assert.equal(fields[0], 'loads');
  assert.equal(fields[1], 'materialType');
});

test('analytics: list_cta_clicked fires when the list CTA is clicked', () => {
  const preScript = 'window.__GTAG=[];window.gtag=function(){window.__GTAG.push([].slice.call(arguments))};';
  const { window, document } = bootstrap(null, { preScript });
  const host = document.querySelector('[data-calculator="dirt-disposal"]');
  host.querySelector('[id^="dld-list-"]').click();
  const evt = window.__GTAG.find(c => c[1] === 'calculator_disposal_list_cta_clicked');
  assert.ok(evt);
});

test('analytics: link_copied fires when copy button clicked', () => {
  const preScript = 'window.__GTAG=[];window.gtag=function(){window.__GTAG.push([].slice.call(arguments))};';
  const { window, document } = bootstrap(null, { preScript });
  const host = document.querySelector('[data-calculator="dirt-disposal"]');
  host.querySelector('[id^="dld-copy-"]').click();
  const evt = window.__GTAG.find(c => c[1] === 'calculator_disposal_link_copied');
  assert.ok(evt);
});

// ── E2E against the real host page ───────────────────────────────────────────

test('E2E: host page hydrates the calculator placeholder', () => {
  const { document } = bootstrapHostPage();
  const host = document.querySelector('[data-calculator="dirt-disposal"]');
  assert.equal(host.getAttribute('data-dl-hydrated'), '1');
  assert.ok(host.querySelector('input[type="range"]'));
  assert.ok(host.querySelector('.dl-disp-postal-input'));
});

test('E2E: host page contains the H1 and FAQ content from the spec', () => {
  const { document } = bootstrapHostPage();
  assert.match(document.querySelector('h1').textContent,
    /Calgary Dirt Disposal Cost Calculator/);
  assert.match(document.body.textContent, /How accurate is the calculator/);
  assert.match(document.body.textContent, /Does Dirtlink charge a fee/);
});

test('E2E: host page has Article + LocalBusiness + FAQPage JSON-LD', () => {
  const { document } = bootstrapHostPage();
  const blocks = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
  const types = blocks.map(b => {
    try { return JSON.parse(b.textContent)['@type']; } catch { return null; }
  });
  assert.ok(types.includes('Article'));
  assert.ok(types.includes('LocalBusiness'));
  assert.ok(types.includes('FAQPage'));
});

test('E2E: shareable URL round-trip — change inputs, read from URL, re-bootstrap, inputs match', async () => {
  const { window, document } = bootstrapHostPage();
  let host = document.querySelector('[data-calculator="dirt-disposal"]');

  // Change inputs
  const slider = host.querySelector('input[type="range"]');
  slider.value = 12;
  slider.dispatchEvent(new window.Event('input'));
  host.querySelector('.dl-disp-mat-btn[data-mat="mixed"]').click();
  host.querySelector('.dl-disp-quad-btn[data-quad="NW"]').click();

  // Wait for the debounced URL write
  await new Promise(r => setTimeout(r, 350));
  const search = window.location.search;
  assert.match(search, /loads=12/);
  assert.match(search, /type=mixed/);
  assert.match(search, /zone=NW/);

  // Now re-bootstrap with that URL — inputs should pre-populate
  const round = bootstrapHostPage({ search });
  host = round.document.querySelector('[data-calculator="dirt-disposal"]');
  assert.equal(host.querySelector('input[type="range"]').value, '12');
  assert.equal(host.querySelector('.dl-disp-mat-btn[aria-pressed="true"]').getAttribute('data-mat'), 'mixed');
  assert.equal(host.querySelector('.dl-disp-quad-btn[aria-pressed="true"]').getAttribute('data-quad'), 'NW');
});
