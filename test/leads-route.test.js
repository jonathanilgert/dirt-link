// Tests the pure validation + recompute logic in routes/leads.js.
// The HTTP shell + DB writes + emails are covered by the smoke test.

const test = require('node:test');
const assert = require('node:assert/strict');

const { validateAndCompute, VALID_SOURCES } = require('../routes/leads');

function valid(body) {
  return Object.assign({
    email: 'someone@example.com',
    source: 'calculator-disposal-cost-Calgary',
    inputs: { loads: 5, materialType: 'sod', quadrant: 'SE' }
  }, body || {});
}

test('leads: rejects missing email', () => {
  const v = validateAndCompute(valid({ email: undefined }));
  assert.equal(v.status, 400);
  assert.match(v.error, /email/i);
});

test('leads: rejects malformed email', () => {
  const v = validateAndCompute(valid({ email: 'notanemail' }));
  assert.equal(v.status, 400);
});

test('leads: rejects unknown source', () => {
  const v = validateAndCompute(valid({ source: 'random-form' }));
  assert.equal(v.status, 400);
  assert.match(v.error, /source/i);
});

test('leads: rejects missing inputs', () => {
  const v = validateAndCompute(valid({ inputs: undefined }));
  assert.equal(v.status, 400);
});

test('leads: accepts a complete valid payload and recomputes the result', () => {
  const v = validateAndCompute(valid());
  assert.equal(v.error, undefined);
  assert.equal(v.cleanEmail, 'someone@example.com');
  assert.equal(v.source, 'calculator-disposal-cost-Calgary');
  // Recomputed result, not whatever the client claimed
  assert.equal(v.result.loads, 5);
  assert.equal(v.result.materialType, 'sod');
  assert.equal(v.result.tippingTotal, 5 * 18 * 113); // 10,170
  assert.equal(v.result.dirtlinkTotal, v.result.truckingTotal);
});

test('leads: server result ignores any client-supplied result field', () => {
  const v = validateAndCompute(valid({
    // Client tries to claim $0 savings
    inputs: { loads: 5, materialType: 'sod', quadrant: 'SE' },
    result: { landfillTotal: 0, savings: 0, savingsPct: 0 }
  }));
  assert.equal(v.result.landfillTotal, 5 * 18 * 113 + 5 * 1.0 * 120);
  assert(v.result.savings > 0);
});

test('leads: invalid material in inputs falls back to clean-fill (no crash)', () => {
  const v = validateAndCompute(valid({
    inputs: { loads: 3, materialType: 'gold-bullion', quadrant: 'NW' }
  }));
  assert.equal(v.error, undefined);
  assert.equal(v.result.materialType, 'clean-fill');
  assert.equal(v.cleanInputs.materialType, 'clean-fill');
});

test('leads: cleanInputs match recomputed (post-coercion) state', () => {
  const v = validateAndCompute(valid({
    inputs: { loads: '7', materialType: 'mixed', quadrant: 'BAD' }  // numeric string + bad quadrant
  }));
  assert.equal(v.cleanInputs.loads, 7);
  assert.equal(v.cleanInputs.quadrant, 'SE');                 // fallback
  assert.equal(v.cleanInputs.materialType, 'mixed');
});

test('leads: name is trimmed and capped at 120 chars', () => {
  const v = validateAndCompute(valid({ name: '   ' + 'x'.repeat(200) + '   ' }));
  assert.equal(v.cleanName.length, 120);
});

test('leads: empty name becomes null', () => {
  const v = validateAndCompute(valid({ name: '   ' }));
  assert.equal(v.cleanName, null);
});

test('leads: email is lowercased', () => {
  const v = validateAndCompute(valid({ email: 'FooBar@EXAMPLE.com' }));
  assert.equal(v.cleanEmail, 'foobar@example.com');
});

test('leads: source whitelist contains the calculator source', () => {
  assert(VALID_SOURCES.has('calculator-disposal-cost-Calgary'));
});
