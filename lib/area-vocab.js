// Controlled vocabulary for service-area + match algorithm. Per C4 in the
// open-questions reply, suppliers can only set service_area to entries
// from this list — both the post-claim wizard and the Hubert ingestion
// endpoint enforce this.
//
// Matching at launch is string-contains over the controlled vocab. The
// "Calgary Metro" entry is an umbrella that matches any of the five
// Calgary quadrants. When (b) lat/lng + radius matching ships post-launch
// (within 60 days), the same vocab maps cleanly to centroids.

const CALGARY_QUADRANTS = [
  'NE Calgary', 'NW Calgary', 'SE Calgary', 'SW Calgary', 'Centre Calgary'
];

const SURROUNDING = [
  'Airdrie', 'Cochrane', 'Okotoks', 'Chestermere',
  'Strathmore', 'Bragg Creek', 'High River'
];

const SERVICE_AREA_VOCAB = [
  'Calgary Metro',
  ...CALGARY_QUADRANTS,
  ...SURROUNDING
];

const VOCAB_SET = new Set(SERVICE_AREA_VOCAB);

function isValidArea(s) {
  return VOCAB_SET.has(s);
}

// Validate + normalize a list. Returns { ok, areas, errors }.
function normalizeAreas(raw) {
  if (raw == null) return { ok: false, errors: ['service_area required'] };
  const list = Array.isArray(raw) ? raw : [raw];
  const errors = [];
  const out = [];
  const seen = new Set();
  for (const item of list) {
    if (typeof item !== 'string') {
      errors.push(`service_area entry must be string, got ${typeof item}`);
      continue;
    }
    const trimmed = item.trim();
    if (!isValidArea(trimmed)) {
      errors.push(`"${trimmed}" is not in the service-area vocabulary`);
      continue;
    }
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  if (out.length === 0 && errors.length === 0) errors.push('service_area is empty');
  return errors.length ? { ok: false, errors } : { ok: true, areas: out };
}

// Map a raw lead location (quadrant string from the calculator, or free
// text from the profile form) to the closest controlled-vocab entry.
// Returns null if no confident match.
function leadLocationToArea(rawLocation) {
  if (!rawLocation) return null;
  const s = String(rawLocation).trim();
  if (!s) return null;

  // Direct hit on the vocab.
  if (VOCAB_SET.has(s)) return s;

  // Calculator emits 2-letter quadrants ("SE", "NW", ...).
  const upper = s.toUpperCase();
  if (/^(NE|NW|SE|SW)$/.test(upper)) return `${upper} Calgary`;
  if (upper === 'CENTRE' || upper === 'CENTER' || upper === 'C') return 'Centre Calgary';

  // Free-text fallback: scan vocab entries case-insensitively for a hit.
  const lower = s.toLowerCase();
  for (const entry of SERVICE_AREA_VOCAB) {
    if (lower.includes(entry.toLowerCase())) return entry;
  }
  return null;
}

// True iff a supplier whose service_area is `supplierAreas` should be
// considered as a candidate for a lead in `leadArea`.
//
// supplierAreas: array of vocab strings (already validated)
// leadArea:      single vocab string (or null/empty → match any)
function matchesArea(supplierAreas, leadArea) {
  if (!supplierAreas || !supplierAreas.length) return false;
  if (!leadArea) return true; // unknown lead area → match all candidates
  if (supplierAreas.includes(leadArea)) return true;
  // Calgary Metro umbrella: a supplier that lists "Calgary Metro" matches
  // any of the five Calgary quadrants.
  if (supplierAreas.includes('Calgary Metro') && CALGARY_QUADRANTS.includes(leadArea)) return true;
  return false;
}

module.exports = {
  SERVICE_AREA_VOCAB,
  CALGARY_QUADRANTS,
  SURROUNDING,
  isValidArea,
  normalizeAreas,
  leadLocationToArea,
  matchesArea
};
