// Pure calculation utilities for the DirtLink calculators.
// No I/O, no DOM, no globals — safe to import in Node tests and the browser.
//
// Rates source: /data/calgary-rates.json (City of Calgary landfill rate sheets).
// See marketing/calgary-launch/04-calculator-design.md for the design spec.

const path = require('path');
const fs = require('fs');

const DEFAULT_RATES = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'calgary-rates.json'), 'utf8')
);

const VALID_MATERIALS = ['clean-fill', 'topsoil', 'sod', 'mixed'];
const VALID_QUADRANTS = ['NE', 'NW', 'SE', 'SW'];

const NARRATIVE_KEY = {
  'clean-fill': 'clean-fill',
  'topsoil': 'topsoil',
  'sod': 'sod',
  'mixed': 'mixed'
};

// Coerce to a non-negative finite number, or fall back.
function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

// ── Calculator 1: Disposal cost ──────────────────────────────────────────────
//
// inputs: { loads, materialType, quadrant, rates? }
//   loads        — integer 0+, number of tandem loads
//   materialType — 'clean-fill' | 'topsoil' | 'sod' | 'mixed'
//   quadrant     — 'NE' | 'NW' | 'SE' | 'SW'
//   rates        — optional override for testing/runtime config
//
// returns:
//   {
//     loads, materialType, quadrant,
//     totalTonnes, totalWeightKg,
//     tippingPerTonne, tippingTotal,
//     truckingHourly, tripHours, totalHours, truckingTotal,
//     landfillTotal, dirtlinkTotal, savings, savingsPct,
//     smallLoadApplied, narrativeKey
//   }
function calculateDisposalCost(inputs = {}) {
  const rates = inputs.rates || DEFAULT_RATES;

  const loadsRaw = num(inputs.loads, 0);
  const loads = Math.max(0, Math.floor(loadsRaw));

  const materialType = VALID_MATERIALS.includes(inputs.materialType)
    ? inputs.materialType
    : 'clean-fill';

  const quadrant = VALID_QUADRANTS.includes(inputs.quadrant)
    ? inputs.quadrant
    : 'SE';

  const tonnesPerLoad = num(rates.trucking?.tonnesPerLoad, 18);
  const truckingHourly = num(rates.trucking?.hourly, 120);
  const tripHours = num(rates.tripTime?.[quadrant], 1.5);
  const tippingPerTonne = num(rates.tipping?.[materialType], 0);
  const smallLoadFlat = num(rates.smallLoadFlat, 25);
  const smallLoadThresholdKg = num(rates.smallLoadThresholdKg, 250);

  const totalTonnes = loads * tonnesPerLoad;
  const totalWeightKg = totalTonnes * 1000;

  // 0 loads → everything is zero, including tipping (no flat fee for nothing).
  let tippingTotal = 0;
  let smallLoadApplied = false;
  if (loads > 0) {
    if (totalWeightKg < smallLoadThresholdKg) {
      tippingTotal = smallLoadFlat;
      smallLoadApplied = true;
    } else {
      tippingTotal = totalTonnes * tippingPerTonne;
    }
  }

  const truckingTotal = loads * tripHours * truckingHourly;
  const totalHours = loads * tripHours;

  const landfillTotal = tippingTotal + truckingTotal;
  const dirtlinkTotal = truckingTotal;
  const savings = landfillTotal - dirtlinkTotal;
  const savingsPct = landfillTotal > 0
    ? Math.round((savings / landfillTotal) * 100)
    : 0;

  return {
    loads,
    materialType,
    quadrant,
    totalTonnes,
    totalWeightKg,
    tippingPerTonne,
    tippingTotal,
    truckingHourly,
    tripHours,
    totalHours,
    truckingTotal,
    landfillTotal,
    dirtlinkTotal,
    savings,
    savingsPct,
    smallLoadApplied,
    narrativeKey: NARRATIVE_KEY[materialType]
  };
}

// ── Calculator 2: Volume ─────────────────────────────────────────────────────
//
// inputs: { lengthFt, widthFt, depthInches, sqFt?, rates? }
//   - Pass either (lengthFt + widthFt) OR sqFt directly. sqFt wins if both given.
//
// returns:
//   { sqFt, depthInches, cubicFeet, cubicYards, approxLoads }
function calculateVolume(inputs = {}) {
  const rates = inputs.rates || DEFAULT_RATES;
  const tonnesPerLoad = num(rates.trucking?.tonnesPerLoad, 18);

  const depthInches = num(inputs.depthInches, 0);
  let sqFt;
  if (inputs.sqFt != null) {
    sqFt = num(inputs.sqFt, 0);
  } else {
    sqFt = num(inputs.lengthFt, 0) * num(inputs.widthFt, 0);
  }

  const cubicFeet = sqFt * (depthInches / 12);
  const cubicYards = cubicFeet / 27;

  // Tandem load ≈ tonnesPerLoad tonnes; rough conversion ~1 yd³ topsoil ≈ 1.3 t.
  // For the "≈ X tandem loads" hint we treat 1 load as ~14 yd³ (matches the
  // disposal-cost calculator's "X cubic yards" hint at 14 yd³/load).
  const yardsPerLoad = 14;
  const approxLoads = cubicYards / yardsPerLoad;

  return {
    sqFt,
    depthInches,
    cubicFeet,
    cubicYards,
    approxLoads,
    tonnesPerLoad
  };
}

module.exports = {
  calculateDisposalCost,
  calculateVolume,
  DEFAULT_RATES,
  VALID_MATERIALS,
  VALID_QUADRANTS
};
