// Run with: node --test test/calculators.test.js
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  calculateDisposalCost,
  calculateVolume,
  DEFAULT_RATES
} = require('../lib/calculators/rates');

// ── Disposal cost ────────────────────────────────────────────────────────────

test('disposal: 0 loads → everything zero', () => {
  const r = calculateDisposalCost({ loads: 0, materialType: 'clean-fill', quadrant: 'SE' });
  assert.equal(r.loads, 0);
  assert.equal(r.totalTonnes, 0);
  assert.equal(r.tippingTotal, 0);
  assert.equal(r.truckingTotal, 0);
  assert.equal(r.totalHours, 0);
  assert.equal(r.landfillTotal, 0);
  assert.equal(r.dirtlinkTotal, 0);
  assert.equal(r.savings, 0);
  assert.equal(r.savingsPct, 0);
  assert.equal(r.smallLoadApplied, false);
});

test('disposal: small load <250 kg triggers $25 flat rate', () => {
  // Override tonnesPerLoad to 0.2 t = 200 kg, under the 250 kg threshold.
  const rates = {
    ...DEFAULT_RATES,
    trucking: { ...DEFAULT_RATES.trucking, tonnesPerLoad: 0.2 }
  };
  const r = calculateDisposalCost({
    loads: 1, materialType: 'clean-fill', quadrant: 'SE', rates
  });
  assert.equal(r.totalWeightKg, 200);
  assert.equal(r.smallLoadApplied, true);
  assert.equal(r.tippingTotal, 25);             // $25 flat, NOT 0.2 * $10 = $2
  assert.equal(r.truckingTotal, 1 * 1.0 * 120); // trucking unaffected
});

test('disposal: at exactly 250 kg the flat rate does NOT apply (threshold is strict <)', () => {
  const rates = {
    ...DEFAULT_RATES,
    trucking: { ...DEFAULT_RATES.trucking, tonnesPerLoad: 0.25 }
  };
  const r = calculateDisposalCost({
    loads: 1, materialType: 'clean-fill', quadrant: 'SE', rates
  });
  assert.equal(r.totalWeightKg, 250);
  assert.equal(r.smallLoadApplied, false);
  assert.equal(r.tippingTotal, 0.25 * 10);
});

test('disposal: sod billed at $113/tonne (basic sanitary)', () => {
  const r = calculateDisposalCost({ loads: 5, materialType: 'sod', quadrant: 'SE' });
  assert.equal(r.tippingPerTonne, 113);
  assert.equal(r.totalTonnes, 90);
  assert.equal(r.tippingTotal, 90 * 113); // 10,170
  assert.equal(r.narrativeKey, 'sod');
});

test('disposal: mixed billed at $180/tonne (commercial surcharge)', () => {
  const r = calculateDisposalCost({ loads: 5, materialType: 'mixed', quadrant: 'SE' });
  assert.equal(r.tippingPerTonne, 180);
  assert.equal(r.tippingTotal, 90 * 180); // 16,200
  assert.equal(r.narrativeKey, 'mixed');
});

test('disposal: clean-fill — low tipping, real trucking', () => {
  const r = calculateDisposalCost({ loads: 5, materialType: 'clean-fill', quadrant: 'SE' });
  assert.equal(r.tippingPerTonne, 10);
  assert.equal(r.tippingTotal, 90 * 10);          // 900
  assert.equal(r.truckingTotal, 5 * 1.0 * 120);   // 600
  assert.equal(r.landfillTotal, 1500);
  assert.equal(r.dirtlinkTotal, 600);             // tipping disappears
  assert.equal(r.savings, 900);
  assert.equal(r.savingsPct, 60);
  assert.equal(r.narrativeKey, 'clean-fill');
});

test('disposal: topsoil uses $10/tonne and topsoil narrative', () => {
  const r = calculateDisposalCost({ loads: 3, materialType: 'topsoil', quadrant: 'NW' });
  assert.equal(r.tippingPerTonne, 10);
  assert.equal(r.tripHours, 2.0);
  assert.equal(r.truckingTotal, 3 * 2.0 * 120); // 720
  assert.equal(r.narrativeKey, 'topsoil');
});

test('disposal: invalid material type falls back to clean-fill (no crash)', () => {
  assert.doesNotThrow(() => {
    const r = calculateDisposalCost({ loads: 5, materialType: 'lava', quadrant: 'SE' });
    assert.equal(r.materialType, 'clean-fill');
    assert.equal(r.tippingPerTonne, 10);
  });
});

test('disposal: invalid quadrant falls back to SE', () => {
  const r = calculateDisposalCost({ loads: 1, materialType: 'clean-fill', quadrant: 'XX' });
  assert.equal(r.quadrant, 'SE');
  assert.equal(r.tripHours, 1.0);
});

test('disposal: missing inputs (empty object) does not crash', () => {
  assert.doesNotThrow(() => {
    const r = calculateDisposalCost({});
    assert.equal(r.loads, 0);
    assert.equal(r.materialType, 'clean-fill');
    assert.equal(r.quadrant, 'SE');
    assert.equal(r.landfillTotal, 0);
  });
});

test('disposal: no inputs at all does not crash', () => {
  assert.doesNotThrow(() => {
    const r = calculateDisposalCost();
    assert.equal(r.loads, 0);
  });
});

test('disposal: negative loads coerce to 0', () => {
  const r = calculateDisposalCost({ loads: -5, materialType: 'sod', quadrant: 'SE' });
  assert.equal(r.loads, 0);
  assert.equal(r.tippingTotal, 0);
});

test('disposal: NaN loads coerce to 0', () => {
  const r = calculateDisposalCost({ loads: 'banana', materialType: 'sod', quadrant: 'SE' });
  assert.equal(r.loads, 0);
});

test('disposal: 100 loads of mixed — no overflow, math holds', () => {
  const r = calculateDisposalCost({ loads: 100, materialType: 'mixed', quadrant: 'SW' });
  assert.equal(r.totalTonnes, 1800);
  assert.equal(r.tippingTotal, 1800 * 180);     // 324,000
  assert.equal(r.truckingTotal, 100 * 2.5 * 120); // 30,000
  assert.equal(r.landfillTotal, 354000);
  assert.equal(r.dirtlinkTotal, 30000);
  assert.equal(r.savings, 324000);
  assert(Number.isFinite(r.landfillTotal));
});

test('disposal: 500 loads — still finite, no overflow', () => {
  const r = calculateDisposalCost({ loads: 500, materialType: 'mixed', quadrant: 'SW' });
  assert(Number.isFinite(r.landfillTotal));
  assert(Number.isFinite(r.savings));
  assert(r.savingsPct >= 0 && r.savingsPct <= 100);
});

// ── Volume ───────────────────────────────────────────────────────────────────

test('volume: 10×10 at 4 inches → ~1.23 yd³', () => {
  const r = calculateVolume({ lengthFt: 10, widthFt: 10, depthInches: 4 });
  assert.equal(r.sqFt, 100);
  // 100 * (4/12) / 27 = 1.2345...
  assert(Math.abs(r.cubicYards - 1.2346) < 0.001);
});

test('volume: 27 sq ft at 12 inches → exactly 1 yd³', () => {
  const r = calculateVolume({ sqFt: 27, depthInches: 12 });
  assert.equal(r.cubicYards, 1);
});

test('volume: sqFt overrides length × width when both provided', () => {
  const r = calculateVolume({ lengthFt: 99, widthFt: 99, sqFt: 100, depthInches: 12 });
  assert.equal(r.sqFt, 100);
});

test('volume: 0 area → 0 yards, no crash', () => {
  assert.doesNotThrow(() => {
    const r = calculateVolume({ lengthFt: 0, widthFt: 0, depthInches: 4 });
    assert.equal(r.cubicYards, 0);
    assert.equal(r.approxLoads, 0);
  });
});

test('volume: missing inputs do not crash', () => {
  assert.doesNotThrow(() => {
    const r = calculateVolume({});
    assert.equal(r.cubicYards, 0);
  });
});

test('volume: negative dimensions coerce to 0', () => {
  const r = calculateVolume({ lengthFt: -10, widthFt: 10, depthInches: 4 });
  assert.equal(r.sqFt, 0);
});

test('volume: very large area (100,000 sq ft × 36") stays finite', () => {
  const r = calculateVolume({ sqFt: 100_000, depthInches: 36 });
  assert(Number.isFinite(r.cubicYards));
  assert(r.cubicYards > 0);
});
