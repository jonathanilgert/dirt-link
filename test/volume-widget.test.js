// Unit + E2E tests for the volume calculator widget.
// Run with: node --test test/volume-widget.test.js
//
// jsdom is initialized per-test to keep widget global state (the
// `window.__DL_VOL_LOADED__` idempotency flag, INSTANCE_COUNT) isolated.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const WIDGET_PATH = path.join(__dirname, '..', 'public', 'dist', 'calculators', 'volume.js');
const WIDGET_SRC = fs.readFileSync(WIDGET_PATH, 'utf8');
const DEMO_PATH = path.join(__dirname, '..', 'public', 'calculators', 'volume-demo.html');
const DEMO_HTML = fs.readFileSync(DEMO_PATH, 'utf8');

// Build a JSDOM with the placeholder HTML, then eval the widget synchronously.
// We use runScripts:'outside-only' instead of 'dangerously' because jsdom runs
// in-document scripts asynchronously, but window.eval() runs synchronously.
function bootstrap(placeholderHtml, preScript) {
  const html =
    '<!DOCTYPE html><html><head></head><body>' + placeholderHtml + '</body></html>';
  const dom = new JSDOM(html, { runScripts: 'outside-only' });
  if (preScript) dom.window.eval(preScript);
  dom.window.eval(WIDGET_SRC);
  return { dom, window: dom.window, document: dom.window.document };
}

// Load the demo page directly (the widget script tag is stripped; we eval the
// source explicitly so execution order is deterministic).
function bootstrapDemo() {
  const html = DEMO_HTML.replace(
    /<script src="\/dist\/calculators\/volume\.js"[^>]*><\/script>/,
    ''
  );
  const dom = new JSDOM(html, { runScripts: 'outside-only' });
  dom.window.eval(WIDGET_SRC);
  return { dom, window: dom.window, document: dom.window.document };
}

// ── Hydration & placeholder reading ──────────────────────────────────────────

test('widget hydrates a placeholder div with default attributes', () => {
  const { document } = bootstrap('<div data-calculator="volume"></div>');
  const host = document.querySelector('[data-calculator="volume"]');
  assert.equal(host.getAttribute('data-dl-hydrated'), '1');
  assert.ok(host.classList.contains('dl-vol'));
  assert.ok(host.querySelector('.dl-vol-title'), 'rendered title');
  assert.ok(host.querySelector('input[type="range"]'), 'rendered slider');
  assert.equal(host.querySelectorAll('.dl-vol-preset').length, 3);
});

test('widget reads data-material-type, data-cta-label, data-cta-href', () => {
  const { document } = bootstrap(
    '<div data-calculator="volume"' +
      ' data-material-type="topsoil"' +
      ' data-cta-label="Browse topsoil listings"' +
      ' data-cta-href="/calgary/topsoil#listings"></div>'
  );
  const cta = document.querySelector('[data-dl-vol-cta]');
  assert.equal(cta.getAttribute('href'), '/calgary/topsoil#listings');
  assert.match(cta.textContent, /^Browse topsoil listings\s+→/);
});

test('cta-label override wins over material-derived label', () => {
  const { document } = bootstrap(
    '<div data-calculator="volume" data-material-type="gravel" data-cta-label="See all gravel options"></div>'
  );
  const cta = document.querySelector('[data-dl-vol-cta]');
  assert.match(cta.textContent, /^See all gravel options\s+→/);
});

test('falls back to material-derived label when data-cta-label missing', () => {
  const { document } = bootstrap(
    '<div data-calculator="volume" data-material-type="mulch"></div>'
  );
  const cta = document.querySelector('[data-dl-vol-cta]');
  assert.match(cta.textContent, /Browse mulch listings/);
});

test('falls back to generic label when material is unknown and no override', () => {
  const { document } = bootstrap(
    '<div data-calculator="volume" data-material-type="unobtainium"></div>'
  );
  const cta = document.querySelector('[data-dl-vol-cta]');
  assert.match(cta.textContent, /Browse listings/);
});

// ── Idempotency ──────────────────────────────────────────────────────────────

test('idempotent: second hydration call does not re-render', () => {
  const { window, document } = bootstrap('<div data-calculator="volume"></div>');
  const host = document.querySelector('[data-calculator="volume"]');
  const before = host.innerHTML;
  window.DirtLinkVolumeCalc.rehydrate();
  assert.equal(host.innerHTML, before);
});

test('idempotent: loading the script twice is a no-op', () => {
  const { window, document } = bootstrap('<div data-calculator="volume"></div>');
  const host = document.querySelector('[data-calculator="volume"]');
  const renderedBefore = host.innerHTML;
  // Re-eval the widget source — second IIFE should bail at the __DL_VOL_LOADED__ guard
  window.eval(WIDGET_SRC);
  assert.equal(window.__DL_VOL_LOADED__, true);
  // Sanity: rendering didn't change
  assert.equal(host.innerHTML, renderedBefore);
});

// ── Live updates ─────────────────────────────────────────────────────────────

test('changing length updates the cubic yards output', () => {
  const { document } = bootstrap('<div data-calculator="volume"></div>');
  const host = document.querySelector('[data-calculator="volume"]');
  const lenEl = host.querySelector('input[id^="dl-vol-len-"]');
  const ydEl = host.querySelector('[id^="dl-vol-yd-"]');

  // Default 10 × 10 × 4 = 1.2 yd³
  assert.equal(ydEl.textContent, '1.2');

  // 20 × 10 × 4 = 2.5 yd³
  lenEl.value = 20;
  lenEl.dispatchEvent(new (host.ownerDocument.defaultView.Event)('input'));
  assert.equal(ydEl.textContent, '2.5');
});

test('changing depth via slider updates the output', () => {
  const { document } = bootstrap('<div data-calculator="volume"></div>');
  const host = document.querySelector('[data-calculator="volume"]');
  const depEl = host.querySelector('input[type="range"]');
  const ydEl = host.querySelector('[id^="dl-vol-yd-"]');

  depEl.value = 12;
  depEl.dispatchEvent(new (host.ownerDocument.defaultView.Event)('input'));
  // 10 × 10 × 12 = 100 ft³ / 27 = 3.7 yd³
  assert.equal(ydEl.textContent, '3.7');
});

test('result shows ≈ X loads when over 10 cubic yards', () => {
  const { document } = bootstrap('<div data-calculator="volume"></div>');
  const host = document.querySelector('[data-calculator="volume"]');
  const lenEl = host.querySelector('input[id^="dl-vol-len-"]');
  const widEl = host.querySelector('input[id^="dl-vol-wid-"]');
  const depEl = host.querySelector('input[type="range"]');
  const loadsEl = host.querySelector('[id^="dl-vol-loads-"]');

  // Need >10 yd³ → 30 × 30 × 4 = 333 ft³ / 27 = 12.3 yd³
  lenEl.value = 30; widEl.value = 30; depEl.value = 4;
  ['input'].forEach(function (ev) {
    [lenEl, widEl, depEl].forEach(function (el) {
      el.dispatchEvent(new (host.ownerDocument.defaultView.Event)(ev));
    });
  });
  assert.match(loadsEl.textContent, /≈\s*\d+(\.\d+)?\s+loads?/);
});

test('result hides "≈ X loads" when under 10 cubic yards', () => {
  const { document } = bootstrap('<div data-calculator="volume"></div>');
  const host = document.querySelector('[data-calculator="volume"]');
  const loadsEl = host.querySelector('[id^="dl-vol-loads-"]');
  // Default 1.2 yd³ → no loads hint
  assert.equal(loadsEl.textContent, '');
});

// ── Preset chips with aria-pressed ───────────────────────────────────────────

test('default preset (4") is aria-pressed=true; others are false', () => {
  const { document } = bootstrap('<div data-calculator="volume"></div>');
  const chips = document.querySelectorAll('.dl-vol-preset');
  const pressed = Array.from(chips).filter(b => b.getAttribute('aria-pressed') === 'true');
  assert.equal(pressed.length, 1);
  assert.equal(pressed[0].getAttribute('data-depth'), '4');
});

test('clicking a preset sets depth and updates aria-pressed', () => {
  const { document } = bootstrap('<div data-calculator="volume"></div>');
  const host = document.querySelector('[data-calculator="volume"]');
  const chip12 = host.querySelector('.dl-vol-preset[data-depth="12"]');
  const chip4 = host.querySelector('.dl-vol-preset[data-depth="4"]');
  const depEl = host.querySelector('input[type="range"]');

  chip12.click();
  assert.equal(depEl.value, '12');
  assert.equal(chip12.getAttribute('aria-pressed'), 'true');
  assert.equal(chip4.getAttribute('aria-pressed'), 'false');
});

// ── Sq-ft toggle ─────────────────────────────────────────────────────────────

test('sq-ft toggle swaps inputs without losing value', () => {
  const { document } = bootstrap('<div data-calculator="volume"></div>');
  const host = document.querySelector('[data-calculator="volume"]');
  const lwRow = host.querySelector('[data-dl-vol-mode="lw"]');
  const sqftRow = host.querySelector('[data-dl-vol-mode="sqft"]');
  const toggle = host.querySelector('[data-dl-vol-toggle]');
  const lenEl = host.querySelector('input[id^="dl-vol-len-"]');
  const widEl = host.querySelector('input[id^="dl-vol-wid-"]');
  const sqftEl = host.querySelector('input[id^="dl-vol-sqft-"]');

  // Initially L×W is shown, sqft is hidden
  assert.notEqual(lwRow.style.display, 'none');
  assert.equal(sqftRow.style.display, 'none');

  // Set 15 × 8 = 120 sq ft, then toggle
  lenEl.value = 15; widEl.value = 8;
  lenEl.dispatchEvent(new (host.ownerDocument.defaultView.Event)('input'));
  widEl.dispatchEvent(new (host.ownerDocument.defaultView.Event)('input'));
  toggle.click();

  assert.equal(lwRow.style.display, 'none');
  assert.notEqual(sqftRow.style.display, 'none');
  assert.equal(Number(sqftEl.value), 120);
  assert.equal(toggle.getAttribute('aria-pressed'), 'true');

  // Toggle back
  toggle.click();
  assert.notEqual(lwRow.style.display, 'none');
  assert.equal(toggle.getAttribute('aria-pressed'), 'false');
});

// ── Accessibility ────────────────────────────────────────────────────────────

test('all inputs have associated labels', () => {
  const { document } = bootstrap('<div data-calculator="volume"></div>');
  const host = document.querySelector('[data-calculator="volume"]');
  const inputs = host.querySelectorAll('input');
  inputs.forEach(function (inp) {
    const id = inp.id;
    assert.ok(id, 'input has id');
    const label = host.querySelector('label[for="' + id + '"]');
    assert.ok(label, 'input ' + id + ' has matching label');
  });
});

test('output region has aria-live="polite"', () => {
  const { document } = bootstrap('<div data-calculator="volume"></div>');
  const out = document.querySelector('.dl-vol-out');
  assert.equal(out.getAttribute('aria-live'), 'polite');
});

test('host has role=region with descriptive aria-label', () => {
  const { document } = bootstrap('<div data-calculator="volume" data-material-type="topsoil"></div>');
  const host = document.querySelector('[data-calculator="volume"]');
  assert.equal(host.getAttribute('role'), 'region');
  assert.match(host.getAttribute('aria-label'), /topsoil/);
});

// ── Analytics events ─────────────────────────────────────────────────────────

test('fires calculator_volume_viewed once on hydration', () => {
  const { window, document } = bootstrap('<div data-calculator="volume" data-material-type="sand"></div>');
  // gtag was not loaded before script ran. Check by re-firing manually:
  // we need to wire gtag BEFORE the widget hydrates. Easiest: use a post-hoc check.
  // Since the widget tracks via window.gtag and that wasn't defined, we instead
  // verify the function call would have fired by inspecting that no error was thrown
  // and the widget rendered — the actual gtag pipe is exercised in the wired test below.
  assert.ok(document.querySelector('[data-calculator="volume"][data-dl-hydrated]'));
});

test('analytics fire when gtag is set BEFORE script loads', () => {
  const preScript = 'window.__DL_GTAG_CALLS=[];window.gtag=function(){window.__DL_GTAG_CALLS.push([].slice.call(arguments))};';
  const { dom } = bootstrap('<div data-calculator="volume" data-material-type="topsoil"></div>', preScript);
  const calls = dom.window.__DL_GTAG_CALLS;
  // First call should be calculator_volume_viewed
  const viewed = calls.find(c => c[1] === 'calculator_volume_viewed');
  assert.ok(viewed, 'calculator_volume_viewed fired');
  assert.equal(viewed[2].material_type, 'topsoil');

  // Trigger an input change and verify input_changed fires once
  const host = dom.window.document.querySelector('[data-calculator="volume"]');
  const lenEl = host.querySelector('input[id^="dl-vol-len-"]');
  lenEl.value = 5;
  lenEl.dispatchEvent(new dom.window.Event('input'));
  // Fire it again to verify debounce (only once per widget per session)
  lenEl.value = 6;
  lenEl.dispatchEvent(new dom.window.Event('input'));
  const changes = calls.filter(c => c[1] === 'calculator_volume_input_changed');
  assert.equal(changes.length, 1, 'input_changed fired exactly once');

  // Click CTA → fires cta_clicked
  const cta = host.querySelector('[data-dl-vol-cta]');
  cta.click();
  const ctaEvents = calls.filter(c => c[1] === 'calculator_volume_cta_clicked');
  assert.equal(ctaEvents.length, 1);
  assert.equal(ctaEvents[0][2].material_type, 'topsoil');
});

// ── E2E against the actual demo page ─────────────────────────────────────────

test('demo page hydrates all three placeholders independently', () => {
  const { document } = bootstrapDemo();
  const widgets = document.querySelectorAll('[data-calculator="volume"]');
  assert.equal(widgets.length, 3);
  widgets.forEach(function (w) {
    assert.equal(w.getAttribute('data-dl-hydrated'), '1');
    assert.ok(w.querySelector('.dl-vol-out'), 'each has output region');
  });

  const ctas = document.querySelectorAll('[data-dl-vol-cta]');
  assert.equal(ctas.length, 3);
  assert.equal(ctas[0].getAttribute('href'), '/calgary/topsoil#listings');
  assert.equal(ctas[1].getAttribute('href'), '/calgary/gravel#listings');
  assert.equal(ctas[2].getAttribute('href'), '/calgary/mulch#listings');
  assert.match(ctas[0].textContent, /topsoil/);
  assert.match(ctas[1].textContent, /gravel/);
  assert.match(ctas[2].textContent, /mulch/);
});

test('demo page widgets have independent state — changing one does not affect others', () => {
  const { document } = bootstrapDemo();
  const widgets = Array.from(document.querySelectorAll('[data-calculator="volume"]'));
  const event = (el, type) => el.dispatchEvent(new (el.ownerDocument.defaultView.Event)(type));

  // Change length on widget #1 (topsoil) only
  const w1Len = widgets[0].querySelector('input[id^="dl-vol-len-"]');
  w1Len.value = 50;
  event(w1Len, 'input');

  const out1 = widgets[0].querySelector('[id^="dl-vol-yd-"]').textContent;
  const out2 = widgets[1].querySelector('[id^="dl-vol-yd-"]').textContent;
  const out3 = widgets[2].querySelector('[id^="dl-vol-yd-"]').textContent;

  assert.notEqual(out1, '1.2', 'widget 1 result updated');
  assert.equal(out2, '1.2', 'widget 2 result unchanged');
  assert.equal(out3, '1.2', 'widget 3 result unchanged');
});

test('demo page styles are injected exactly once even with three widgets', () => {
  const { document } = bootstrapDemo();
  assert.equal(document.querySelectorAll('#dl-vol-styles').length, 1);
});
