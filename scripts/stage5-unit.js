// Pure-function unit tests for the lead-routing pieces. No HTTP, no DB —
// just exercises selectMatchingSuppliers + planDelays across the four
// scenarios called out in the brief:
//   1. Enterprise present
//   2. Enterprise absent + Powerhouse present
//   3. Only Pro available
//   4. No paid suppliers
// Plus a Free-only scenario to lock in C3 behavior.

const { selectMatchingSuppliers, planDelays } = require('../services/lead-routing');

let pass = 0, fail = 0;
function check(label, ok, hint) {
  if (ok) { pass++; console.log('  Y ' + label); }
  else    { fail++; console.log('  X ' + label + (hint ? '  ← ' + hint : '')); }
}

function lead(area, category) {
  return { id: 'lead-test', location_area: area, categories: JSON.stringify([category]) };
}

function s(id, tier, category, areas) {
  return { id, slug: id, tier, category, service_area: JSON.stringify(areas) };
}

// ── Scenario 1: Enterprise present ──────────────────────────────────────
{
  console.log('Scenario 1: Enterprise present');
  const suppliers = [
    s('e1', 'enterprise', 'aggregate-pits', ['SE Calgary']),
    s('p1', 'powerhouse', 'aggregate-pits', ['SE Calgary']),
    s('r1', 'pro',        'aggregate-pits', ['SE Calgary']),
    s('f1', 'free',       'aggregate-pits', ['SE Calgary']) // C3: never matched
  ];
  const byTier = selectMatchingSuppliers({ lead: lead('SE Calgary', 'aggregate-pits'), suppliers });
  check('  enterprise count = 1', byTier.enterprise.length === 1);
  check('  powerhouse count = 1', byTier.powerhouse.length === 1);
  check('  pro count = 1',        byTier.pro.length === 1);
  const sched = planDelays(byTier);
  check('  schedule has enterprise=0',     sched.enterprise === 0);
  check('  schedule has powerhouse=15',    sched.powerhouse === 15);
  check('  schedule has pro=45',           sched.pro === 45);
}

// ── Scenario 2: Enterprise absent, Powerhouse present ──────────────────
{
  console.log('Scenario 2: Enterprise absent, Powerhouse present');
  const suppliers = [
    s('p1', 'powerhouse', 'aggregate-pits', ['SE Calgary']),
    s('r1', 'pro',        'aggregate-pits', ['SE Calgary']),
    s('f1', 'free',       'aggregate-pits', ['SE Calgary'])
  ];
  const byTier = selectMatchingSuppliers({ lead: lead('SE Calgary', 'aggregate-pits'), suppliers });
  const sched = planDelays(byTier);
  check('  no enterprise',      byTier.enterprise.length === 0);
  check('  schedule has powerhouse=0',     sched.powerhouse === 0);
  check('  schedule has pro=15',           sched.pro === 15);
  check('  schedule does not have enterprise', sched.enterprise === undefined);
}

// ── Scenario 3: Only Pro available ─────────────────────────────────────
{
  console.log('Scenario 3: Only Pro available');
  const suppliers = [
    s('r1', 'pro', 'aggregate-pits', ['SE Calgary']),
    s('r2', 'pro', 'aggregate-pits', ['SE Calgary']),
    s('f1', 'free','aggregate-pits', ['SE Calgary'])
  ];
  const byTier = selectMatchingSuppliers({ lead: lead('SE Calgary', 'aggregate-pits'), suppliers });
  const sched = planDelays(byTier);
  check('  pro count = 2',  byTier.pro.length === 2);
  check('  schedule has pro=0',     sched.pro === 0);
  check('  schedule does not have powerhouse', sched.powerhouse === undefined);
}

// ── Scenario 4: No paid suppliers ──────────────────────────────────────
{
  console.log('Scenario 4: No paid suppliers in area+category');
  const suppliers = [
    s('f1', 'free', 'aggregate-pits', ['SE Calgary']),
    s('e1', 'enterprise', 'topsoil-yards', ['SE Calgary'])  // wrong category
  ];
  const byTier = selectMatchingSuppliers({ lead: lead('SE Calgary', 'aggregate-pits'), suppliers });
  const sched = planDelays(byTier);
  check('  no paid suppliers matched',
    byTier.enterprise.length === 0 && byTier.powerhouse.length === 0 && byTier.pro.length === 0);
  check('  planDelays returns null',  sched === null);
}

// ── Free-tier exclusion (C3) ───────────────────────────────────────────
{
  console.log('C3: Free tier never receives auto-routed leads');
  const suppliers = [
    s('f1', 'free', 'aggregate-pits', ['SE Calgary']),
    s('f2', 'free', 'aggregate-pits', ['Calgary Metro'])
  ];
  const byTier = selectMatchingSuppliers({ lead: lead('SE Calgary', 'aggregate-pits'), suppliers });
  check('  zero suppliers matched (free excluded)',
    byTier.enterprise.length === 0 && byTier.powerhouse.length === 0 && byTier.pro.length === 0);
}

// ── Calgary Metro umbrella expansion ────────────────────────────────────
{
  console.log('Calgary Metro umbrella');
  const suppliers = [
    s('e1', 'enterprise', 'aggregate-pits', ['Calgary Metro']),
    s('p1', 'powerhouse', 'aggregate-pits', ['NE Calgary'])  // wrong quadrant
  ];
  const byTier = selectMatchingSuppliers({ lead: lead('SE Calgary', 'aggregate-pits'), suppliers });
  check('  Calgary Metro supplier matches SE Calgary lead',
    byTier.enterprise.length === 1 && byTier.enterprise[0].id === 'e1');
  check('  NE Calgary supplier does NOT match SE lead',
    byTier.powerhouse.length === 0);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
