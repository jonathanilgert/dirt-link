// Static accessibility scan via axe-core in jsdom.
//
// Limitations: jsdom doesn't run a real layout engine, so contrast/visibility
// checks based on computed CSS won't fire. This catches attribute-, role-,
// label-, and structure-based violations only. Lighthouse covers contrast.
//
// Run: node --test test/a11y-axe.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const axe = require('axe-core');

const WIDGET_VOL = fs.readFileSync(path.join(__dirname, '..', 'public', 'dist', 'calculators', 'volume.js'), 'utf8');
const WIDGET_DISP = fs.readFileSync(path.join(__dirname, '..', 'public', 'dist', 'calculators', 'disposal-cost.js'), 'utf8');
const HOST_DISP = fs.readFileSync(path.join(__dirname, '..', 'public', 'calgary', 'dirt-disposal-cost.html'), 'utf8');
const HOST_VOL = fs.readFileSync(path.join(__dirname, '..', 'public', 'calculators', 'volume-demo.html'), 'utf8');

async function runAxe(html, widgetSrc) {
  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    url: 'https://dirtlink.ca/'
  });
  dom.window.fetch = () => Promise.reject(new Error('stub'));
  if (widgetSrc) dom.window.eval(widgetSrc);
  // Inject axe and run
  dom.window.eval(axe.source);
  const result = await dom.window.axe.run(dom.window.document, {
    runOnly: ['wcag2a', 'wcag2aa']
  });
  return result;
}

function summarize(violations) {
  return violations.map(v => ({
    id: v.id, impact: v.impact, count: v.nodes.length,
    help: v.help
  }));
}

test('disposal-cost host page: no axe-core violations (jsdom)', async () => {
  // Strip the GA template placeholder + the deferred widget tag; we eval directly
  const html = HOST_DISP
    .replace(/\{\{GA_MEASUREMENT_ID\}\}/g, '')
    .replace(/<script src="\/dist\/calculators\/disposal-cost\.js"[^>]*><\/script>/, '');
  const result = await runAxe(html, WIDGET_DISP);
  if (result.violations.length) {
    console.log('Violations:', JSON.stringify(summarize(result.violations), null, 2));
  }
  assert.equal(result.violations.length, 0, 'no a11y violations');
});

test('volume-demo host page: no axe-core violations (jsdom)', async () => {
  const result = await runAxe(HOST_VOL, WIDGET_VOL);
  if (result.violations.length) {
    console.log('Violations:', JSON.stringify(summarize(result.violations), null, 2));
  }
  assert.equal(result.violations.length, 0, 'no a11y violations');
});

test('disposal widget standalone: no a11y violations', async () => {
  const html =
    '<!DOCTYPE html><html lang="en"><head><title>t</title></head><body>' +
    '<main><div data-calculator="dirt-disposal"></div></main>' +
    '</body></html>';
  const result = await runAxe(html, WIDGET_DISP);
  if (result.violations.length) {
    console.log('Violations:', JSON.stringify(summarize(result.violations), null, 2));
  }
  assert.equal(result.violations.length, 0);
});

test('volume widget standalone (single instance): no a11y violations', async () => {
  const html =
    '<!DOCTYPE html><html lang="en"><head><title>t</title></head><body>' +
    '<main><div data-calculator="volume" data-material-type="topsoil" data-cta-label="Browse topsoil listings" data-cta-href="/calgary/topsoil"></div></main>' +
    '</body></html>';
  const result = await runAxe(html, WIDGET_VOL);
  if (result.violations.length) {
    console.log('Violations:', JSON.stringify(summarize(result.violations), null, 2));
  }
  assert.equal(result.violations.length, 0);
});
