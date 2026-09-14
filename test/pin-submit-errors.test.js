const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const APP = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

test('pin form has an inline live status region for upload feedback', () => {
  assert.match(HTML, /id="pin-submit-status"[^>]*role="status"[^>]*aria-live="polite"/);
});

test('pin submission reports reverse-proxy 413 responses instead of silently failing JSON parsing', () => {
  assert.match(APP, /res\.status === 413/);
  assert.match(APP, /The upload is too large/);
  assert.match(APP, /catch \(err\)/);
  assert.match(APP, /form-submit-status is-error/);
});

test('pin form prevents duplicate submissions while an upload is in flight', () => {
  assert.match(APP, /submitButton\.disabled = true/);
  assert.match(APP, /Creating Pin…/);
});

test('API upload errors are returned as JSON', () => {
  assert.match(SERVER, /LIMIT_FILE_SIZE/);
  assert.match(SERVER, /res\.status\(413\)\.json/);
});

test('pin edits enforce the five-photo aggregate limit and clean rejected uploads', () => {
  const pinsRoute = fs.readFileSync(path.join(__dirname, '..', 'routes', 'pins.js'), 'utf8');
  assert.match(pinsRoute, /existingPhotoCount \+ photoFiles\.length > 5/);
  assert.match(pinsRoute, /removeUploadedFiles\(req\.files\)/);
  assert.match(APP, /existingPhotoCount \+ files\.length > 5/);
});

test('app bundle cache key is bumped for the pin upload fix', () => {
  assert.match(HTML, /\/js\/app\.js\?v=3/);
});

function pinSubmitHarness(fetchImpl) {
  const dom = new JSDOM(`
    <div id="modal-pin" style="display:flex">
      <form id="form-pin"></form>
      <div id="pin-submit-status" class="form-submit-status"></div>
      <button id="btn-submit-pin">Create Pin</button>
    </div>
  `, { runScripts: 'outside-only', url: 'https://dirtlink.ca/app' });
  dom.window.fetch = fetchImpl;
  dom.window.console.error = () => {};
  dom.window.eval(APP.split('// Initialize on load')[0]);
  return dom;
}

test('HTTP 413 with an HTML body produces a visible upload error and restores the button', async () => {
  const dom = pinSubmitHarness(async () => ({
    ok: false,
    status: 413,
    json: async () => { throw new SyntaxError('Unexpected token <'); }
  }));
  const form = dom.window.document.getElementById('form-pin');

  await dom.window.DirtLink.handlePinSubmit({ preventDefault() {}, target: form });

  const status = dom.window.document.getElementById('pin-submit-status');
  const button = dom.window.document.getElementById('btn-submit-pin');
  assert.match(status.textContent, /upload is too large/i);
  assert.ok(status.classList.contains('is-error'));
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, 'Create Pin');
});

test('HTTP 401 produces a visible expired-login message', async () => {
  const dom = pinSubmitHarness(async () => ({
    ok: false,
    status: 401,
    json: async () => ({ error: 'Unauthorized' })
  }));
  const form = dom.window.document.getElementById('form-pin');

  await dom.window.DirtLink.handlePinSubmit({ preventDefault() {}, target: form });

  assert.match(dom.window.document.getElementById('pin-submit-status').textContent, /login expired/i);
});

test('network failures produce a visible retryable error', async () => {
  const dom = pinSubmitHarness(async () => { throw new Error('Network connection lost'); });
  const form = dom.window.document.getElementById('form-pin');

  await dom.window.DirtLink.handlePinSubmit({ preventDefault() {}, target: form });

  const status = dom.window.document.getElementById('pin-submit-status');
  assert.equal(status.textContent, 'Network connection lost');
  assert.ok(status.classList.contains('is-error'));
});
