// Dirtlink Disposal Cost Calculator — embeddable widget bundle.
//
// Usage on any page:
//   <div data-calculator="dirt-disposal"></div>
//   <script src="/dist/calculators/disposal-cost.js" defer></script>
//
// Optional placeholder attributes:
//   data-url-sync="false"      — disable read/write of ?loads=&type=&zone= URL params
//   data-list-cta-href-base    — override base URL for "List this fill" CTA
//                                (default "/calgary/list-fill")
//
// The widget is self-contained: math, styles, FSA→quadrant lookup, and event
// wiring all inline. Math is duplicated from lib/calculators/rates.js
// (canonical source — the Node tests in test/calculators.test.js guard it).
// If you change the formula here, mirror it there.
//
// The bundle is idempotent — loading the script twice is a no-op. Re-trigger
// discovery in SPA contexts via window.DirtLinkDisposalCalc.rehydrate().

(function () {
  'use strict';

  if (window.__DL_DISP_LOADED__) return;
  window.__DL_DISP_LOADED__ = true;

  var INSTANCE_COUNT = 0;

  // ── Default rates (mirrors /data/calgary-rates.json) ──────────────────────
  var DEFAULT_RATES = {
    tipping:  { 'clean-fill': 10, 'topsoil': 10, 'sod': 113, 'mixed': 180 },
    smallLoadFlat: 25,
    smallLoadThresholdKg: 250,
    trucking: { hourly: 120, tonnesPerLoad: 18 },
    tripTime: { 'NE': 1.5, 'NW': 2.0, 'SE': 1.0, 'SW': 2.5 }
  };
  var rates = DEFAULT_RATES;

  // Try to refresh rates from JSON (non-blocking; defaults work fine if it fails).
  try {
    if (typeof fetch === 'function') {
      fetch('/data/calgary-rates.json', { cache: 'force-cache' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) { if (j && j.tipping) rates = j; })
        .catch(function () {});
    }
  } catch (e) { /* not available — fall through */ }

  // ── Calgary FSA (3-char postal prefix) → quadrant lookup ──────────────────
  // Source: Canada Post / Wikipedia Calgary FSA mapping. Some prefixes span
  // quadrants; we use the dominant one. Unknown FSAs leave quadrant unchanged.
  var FSA_TO_QUADRANT = {
    // Northeast
    'T1Y':'NE','T2A':'NE','T2B':'NE','T2E':'NE',
    'T3J':'NE','T3K':'NE','T3N':'NE','T3P':'NE',
    // Northwest
    'T2K':'NW','T2L':'NW','T2M':'NW','T2N':'NW',
    'T3A':'NW','T3B':'NW','T3G':'NW','T3L':'NW','T3R':'NW',
    // Southeast
    'T2C':'SE','T2G':'SE','T2H':'SE','T2J':'SE',
    'T2X':'SE','T2Z':'SE','T3M':'SE','T3S':'SE',
    // Southwest
    'T2P':'SW','T2R':'SW','T2S':'SW','T2T':'SW','T2V':'SW',
    'T2W':'SW','T2Y':'SW','T3C':'SW','T3E':'SW','T3H':'SW'
  };

  function quadrantForPostal(raw) {
    if (!raw) return null;
    var fsa = String(raw).toUpperCase().replace(/\s+/g, '').slice(0, 3);
    return FSA_TO_QUADRANT[fsa] || null;
  }

  // ── Math (mirror of lib/calculators/rates.js calculateDisposalCost) ──────
  function num(v, fallback) {
    var n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  }

  var VALID_MATERIALS = ['clean-fill', 'topsoil', 'sod', 'mixed'];
  var VALID_QUADRANTS = ['NE', 'NW', 'SE', 'SW'];

  function calculateDisposalCost(input) {
    var loads = Math.max(0, Math.floor(num(input.loads, 0)));
    var materialType = VALID_MATERIALS.indexOf(input.materialType) >= 0 ? input.materialType : 'clean-fill';
    var quadrant = VALID_QUADRANTS.indexOf(input.quadrant) >= 0 ? input.quadrant : 'SE';

    var tonnesPerLoad = num(rates.trucking && rates.trucking.tonnesPerLoad, 18);
    var truckingHourly = num(rates.trucking && rates.trucking.hourly, 120);
    var tripHours = num(rates.tripTime && rates.tripTime[quadrant], 1.5);
    var tippingPerTonne = num(rates.tipping && rates.tipping[materialType], 0);
    var smallLoadFlat = num(rates.smallLoadFlat, 25);
    var smallLoadThresholdKg = num(rates.smallLoadThresholdKg, 250);

    var totalTonnes = loads * tonnesPerLoad;
    var totalWeightKg = totalTonnes * 1000;
    var tippingTotal = 0;
    var smallLoadApplied = false;
    if (loads > 0) {
      if (totalWeightKg < smallLoadThresholdKg) {
        tippingTotal = smallLoadFlat;
        smallLoadApplied = true;
      } else {
        tippingTotal = totalTonnes * tippingPerTonne;
      }
    }
    var truckingTotal = loads * tripHours * truckingHourly;
    var totalHours = loads * tripHours;
    var landfillTotal = tippingTotal + truckingTotal;
    var dirtlinkTotal = truckingTotal;
    var savings = landfillTotal - dirtlinkTotal;
    var savingsPct = landfillTotal > 0 ? Math.round(savings / landfillTotal * 100) : 0;

    return {
      loads: loads, materialType: materialType, quadrant: quadrant,
      totalTonnes: totalTonnes, totalWeightKg: totalWeightKg,
      tippingPerTonne: tippingPerTonne, tippingTotal: tippingTotal,
      truckingHourly: truckingHourly, tripHours: tripHours,
      totalHours: totalHours, truckingTotal: truckingTotal,
      landfillTotal: landfillTotal, dirtlinkTotal: dirtlinkTotal,
      savings: savings, savingsPct: savingsPct,
      smallLoadApplied: smallLoadApplied
    };
  }

  // ── Helpers ──────────────────────────────────────────────────────────────
  function fmtMoney(n) {
    return '$' + Math.round(n).toLocaleString('en-CA');
  }

  function track(event, props) {
    if (typeof window.gtag === 'function') {
      window.gtag('event', event, props || {});
    }
  }

  function escapeAttr(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
      .replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function escapeText(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function debounce(fn, ms) {
    var t = null;
    return function () {
      var args = arguments, ctx = this;
      if (t) clearTimeout(t);
      t = setTimeout(function () { fn.apply(ctx, args); }, ms);
    };
  }

  // ── Material display copy ─────────────────────────────────────────────────
  var MATERIAL_BUTTONS = [
    { key: 'clean-fill', label: 'Clean Fill', sub: 'soil / clay / gravel' },
    { key: 'topsoil',    label: 'Topsoil',    sub: '' },
    { key: 'sod',        label: 'Has Sod',    sub: 'changes the cost' },
    { key: 'mixed',      label: 'Mixed',      sub: 'has debris' }
  ];

  // Tipping line label — must match Stage 4 spec wording exactly.
  function tippingLabelFor(materialType, smallLoadApplied) {
    if (smallLoadApplied) return 'Tipping (small-load flat rate)';
    if (materialType === 'sod')   return 'Tipping (basic sanitary, $113/t)';
    if (materialType === 'mixed') return 'Tipping (commercial surcharge, $180/t)';
    if (materialType === 'topsoil')    return 'Tipping (topsoil, $10/t)';
    return 'Tipping (clean fill, $10/t)';
  }

  var NARRATIVE = {
    'clean-fill': "Plus you skip Calgary's commercial clean-fill approval process.",
    'topsoil':    "Plus the topsoil ends up in someone's garden instead of the landfill.",
    'sod':        "Sod is charged at the basic sanitary rate ($113/t) at Calgary landfills — Dirtlink takers want it for landscaping.",
    'mixed':      "Mixed loads can hit the $180/t commercial surcharge. Dirtlink rehomes the usable portion."
  };

  // ── Styles (injected once, scoped to .dl-disp) ────────────────────────────
  var STYLES = '' +
    '.dl-disp{font-family:Figtree,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#1A1410;background:#fff;border:1px solid #E2D9CF;border-radius:14px;padding:24px;max-width:680px;margin:0 auto;box-shadow:0 1px 4px rgba(26,18,13,0.06)}' +
    '.dl-disp *{box-sizing:border-box}' +
    '.dl-disp button{font-family:inherit}' +
    '.dl-disp .dl-disp-section{margin-bottom:20px}' +
    '.dl-disp label.dl-disp-lbl{display:flex;justify-content:space-between;align-items:baseline;font-size:13px;font-weight:700;color:#5A5048;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px}' +
    '.dl-disp .dl-disp-lbl-val{color:#1A1410;font-size:15px;font-weight:800;letter-spacing:-0.2px;text-transform:none}' +
    '.dl-disp .dl-disp-lbl-hint{color:#736657;font-size:12px;font-weight:600;letter-spacing:0;text-transform:none;margin-left:6px}' +
    '.dl-disp input[type=range]{width:100%;accent-color:#F59E0B}' +
    '.dl-disp input[type=range]:focus{outline:2px solid #F59E0B;outline-offset:3px;border-radius:4px}' +
    '.dl-disp .dl-disp-mat-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}' +
    '@media(min-width:480px){.dl-disp .dl-disp-mat-grid{grid-template-columns:repeat(4,1fr)}}' +
    '.dl-disp .dl-disp-mat-btn{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;border:1.5px solid #E2D9CF;background:#FAF8F5;border-radius:10px;padding:14px 8px;cursor:pointer;transition:border-color 0.15s,background 0.15s}' +
    '.dl-disp .dl-disp-mat-btn:hover{border-color:#736657}' +
    '.dl-disp .dl-disp-mat-btn:focus{outline:2px solid #F59E0B;outline-offset:2px}' +
    '.dl-disp .dl-disp-mat-btn[aria-pressed="true"]{border-color:#F59E0B;background:#FFFBEB;box-shadow:0 0 0 3px rgba(245,158,11,0.18)}' +
    '.dl-disp .dl-disp-mat-label{font-size:14px;font-weight:700;color:#1A1410}' +
    '.dl-disp .dl-disp-mat-sub{font-size:11px;color:#5A5048;margin-top:3px}' +
    '.dl-disp .dl-disp-loc-row{display:grid;grid-template-columns:1fr;gap:8px}' +
    '@media(min-width:480px){.dl-disp .dl-disp-loc-row{grid-template-columns:auto 1fr}}' +
    '.dl-disp .dl-disp-postal-wrap{display:flex;flex-direction:column}' +
    '.dl-disp .dl-disp-postal-input{padding:10px 12px;border:1.5px solid #E2D9CF;border-radius:8px;font-size:14px;font-family:inherit;background:#FAF8F5;color:#1A1410;font-weight:600;letter-spacing:1px;text-transform:uppercase;width:100%;max-width:140px}' +
    '.dl-disp .dl-disp-postal-input:focus{outline:none;border-color:#F59E0B;background:#fff}' +
    '.dl-disp .dl-disp-postal-hint{font-size:11px;color:#5A5048;margin-top:4px}' +
    '.dl-disp .dl-disp-postal-hint.matched{color:#16A34A;font-weight:600}' +
    '.dl-disp .dl-disp-quad-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;align-self:end}' +
    '.dl-disp .dl-disp-quad-btn{padding:10px 0;text-align:center;border:1.5px solid #E2D9CF;background:#FAF8F5;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer;color:#1A1410}' +
    '.dl-disp .dl-disp-quad-btn:hover{border-color:#736657}' +
    '.dl-disp .dl-disp-quad-btn:focus{outline:2px solid #F59E0B;outline-offset:2px}' +
    '.dl-disp .dl-disp-quad-btn[aria-pressed="true"]{border-color:#F59E0B;background:#FFFBEB}' +
    '.dl-disp .dl-disp-out{margin-top:24px;padding:20px;background:#FAF8F5;border:1px solid #E2D9CF;border-radius:12px}' +
    '.dl-disp .dl-disp-out-label{font-size:12px;color:#5A5048;text-transform:uppercase;letter-spacing:0.5px;font-weight:700;margin-bottom:6px}' +
    '.dl-disp .dl-disp-out-total{font-size:36px;font-weight:800;letter-spacing:-1px;line-height:1.1;color:#1A1410}' +
    '.dl-disp .dl-disp-breakdown{margin-top:16px;font-size:14px}' +
    '.dl-disp .dl-disp-breakdown-row{display:flex;justify-content:space-between;padding:5px 0;color:#1A1410;gap:12px}' +
    '.dl-disp .dl-disp-breakdown-row .dl-disp-label-l{color:#5A5048}' +
    '.dl-disp .dl-disp-divider{height:1px;background:#E2D9CF;margin:14px 0}' +
    '.dl-disp .dl-disp-savings{padding:14px 16px;background:#F0FDF4;border:1px solid #BBF7D0;border-radius:10px;margin-top:10px}' +
    '.dl-disp .dl-disp-savings-line1{font-size:13px;color:#15803D;font-weight:700;margin-bottom:3px}' +
    '.dl-disp .dl-disp-savings-line2{font-size:13px;color:#16803D;line-height:1.5}' +
    '.dl-disp .dl-disp-savings-amount{font-size:22px;font-weight:800;color:#15803D;margin-top:8px}' +
    '.dl-disp .dl-disp-narr{font-size:13px;color:#5A5048;line-height:1.5;margin-top:10px}' +
    '.dl-disp .dl-disp-cta-row{display:flex;flex-wrap:wrap;gap:10px;margin-top:18px}' +
    '.dl-disp .dl-disp-btn{display:inline-flex;align-items:center;justify-content:center;padding:12px 18px;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer;border:none;text-decoration:none;flex:1;min-width:180px}' +
    '.dl-disp .dl-disp-btn-primary{background:#F59E0B;color:#1A1410}' +
    '.dl-disp .dl-disp-btn-primary:hover{background:#D97706}' +
    '.dl-disp .dl-disp-btn-primary:focus{outline:2px solid #1A1410;outline-offset:2px}' +
    '.dl-disp .dl-disp-btn-secondary{background:#fff;color:#1A1410;border:1.5px solid #E2D9CF}' +
    '.dl-disp .dl-disp-btn-secondary:hover{border-color:#736657}' +
    '.dl-disp .dl-disp-btn-secondary:focus{outline:2px solid #F59E0B;outline-offset:2px}' +
    '.dl-disp .dl-disp-btn-ghost{background:transparent;color:#5A5048;font-weight:600;font-size:13px;padding:10px 14px;flex:0;min-width:0}' +
    '.dl-disp .dl-disp-btn-ghost:hover{color:#1A1410}' +
    '.dl-disp .dl-disp-btn-ghost:focus{outline:2px solid #F59E0B;outline-offset:2px;border-radius:4px}' +
    '.dl-disp .dl-disp-email-form{display:none;flex-direction:column;gap:8px;margin-top:14px;padding:14px;background:#fff;border:1px solid #E2D9CF;border-radius:10px}' +
    '.dl-disp .dl-disp-email-form.open{display:flex}' +
    '.dl-disp .dl-disp-email-form input{padding:10px 12px;border:1px solid #E2D9CF;border-radius:8px;font-size:14px;font-family:inherit;background:#FAF8F5;color:#1A1410}' +
    '.dl-disp .dl-disp-email-form input:focus{outline:none;border-color:#F59E0B;background:#fff}' +
    '.dl-disp .dl-disp-email-form-row{display:flex;gap:8px}' +
    '.dl-disp .dl-disp-email-form-row > *{flex:1}' +
    '.dl-disp .dl-disp-email-msg{font-size:13px;color:#16A34A;font-weight:700;margin-top:6px;display:none}' +
    '.dl-disp .dl-disp-email-msg.error{color:#DC2626}' +
    '.dl-disp .dl-disp-email-msg.show{display:block}' +
    '.dl-disp .dl-disp-success{display:none;flex-direction:column;align-items:flex-start;gap:4px;margin-top:14px;padding:14px;background:#F0FDF4;border:1px solid #BBF7D0;border-radius:10px;color:#15803D}' +
    '.dl-disp .dl-disp-success.show{display:flex}' +
    '@media(max-width:520px){' +
      '.dl-disp{padding:18px;border-radius:12px}' +
      '.dl-disp .dl-disp-out-total{font-size:32px}' +
      '.dl-disp .dl-disp-cta-row{position:sticky;bottom:0;background:#fff;padding-top:12px;margin-left:-18px;margin-right:-18px;padding-left:18px;padding-right:18px;padding-bottom:12px;border-top:1px solid #E2D9CF;margin-top:18px;z-index:5}' +
      '.dl-disp .dl-disp-btn-ghost{display:none}' +
    '}';

  function ensureStyles(doc) {
    if (doc.getElementById('dl-disp-styles')) return;
    var s = doc.createElement('style');
    s.id = 'dl-disp-styles';
    s.textContent = STYLES;
    doc.head.appendChild(s);
  }

  // ── URL state ─────────────────────────────────────────────────────────────
  function readUrlState(win) {
    var p = new (win.URLSearchParams)(win.location.search);
    var loads = parseInt(p.get('loads'), 10);
    var type = p.get('type');
    var zone = p.get('zone');
    var s = {};
    if (Number.isFinite(loads) && loads >= 1 && loads <= 30) s.loads = loads;
    if (VALID_MATERIALS.indexOf(type) >= 0) s.materialType = type;
    if (VALID_QUADRANTS.indexOf(zone) >= 0) s.quadrant = zone;
    return s;
  }

  function writeUrlState(win, state) {
    var p = new (win.URLSearchParams)(win.location.search);
    p.set('loads', state.loads);
    p.set('type', state.materialType);
    p.set('zone', state.quadrant);
    var url = win.location.pathname + '?' + p.toString();
    win.history.replaceState(null, '', url);
  }

  function buildResultsUrl(win, state) {
    return win.location.origin + win.location.pathname +
      '?loads=' + state.loads + '&type=' + state.materialType + '&zone=' + state.quadrant;
  }

  function buildListFillUrl(base, state) {
    var qp = 'loads=' + state.loads +
             '&type=' + encodeURIComponent(state.materialType) +
             '&zone=' + state.quadrant +
             '&source=calculator';
    return base + '?' + qp;
  }

  // ── Hydrate one placeholder ───────────────────────────────────────────────
  function hydrate(host) {
    var doc = host.ownerDocument || document;
    var win = doc.defaultView || window;
    ensureStyles(doc);

    var urlSyncEnabled = host.getAttribute('data-url-sync') !== 'false';
    var listCtaBase = host.getAttribute('data-list-cta-href-base') || '/calgary/list-fill';

    var fromUrl = urlSyncEnabled ? readUrlState(win) : {};
    var state = {
      loads: fromUrl.loads != null ? fromUrl.loads : 5,
      materialType: fromUrl.materialType || 'clean-fill',
      quadrant: fromUrl.quadrant || 'SE',
      postal: ''
    };
    var inputChangeFired = {};
    var n = ++INSTANCE_COUNT;
    var ids = {
      loads: 'dld-loads-' + n,
      loadsVal: 'dld-loadsv-' + n,
      loadsHint: 'dld-loadsh-' + n,
      total: 'dld-total-' + n,
      tip: 'dld-tip-' + n,
      tipLabel: 'dld-tipl-' + n,
      truck: 'dld-truck-' + n,
      truckLabel: 'dld-truckl-' + n,
      time: 'dld-time-' + n,
      haul: 'dld-haul-' + n,
      save: 'dld-save-' + n,
      pct: 'dld-pct-' + n,
      narr: 'dld-narr-' + n,
      list: 'dld-list-' + n,
      email: 'dld-email-' + n,
      name: 'dld-name-' + n,
      emailMsg: 'dld-emailmsg-' + n,
      emailSubmit: 'dld-emailsubmit-' + n,
      copy: 'dld-copy-' + n,
      emailBtn: 'dld-emailbtn-' + n,
      emailForm: 'dld-emailform-' + n,
      success: 'dld-success-' + n,
      postal: 'dld-postal-' + n,
      postalHint: 'dld-postalh-' + n
    };

    host.classList.add('dl-disp');
    host.setAttribute('role', 'region');
    host.setAttribute('aria-label', 'Calgary dirt disposal cost calculator');

    host.innerHTML =
      '<div class="dl-disp-section">' +
        '<label class="dl-disp-lbl" for="' + ids.loads + '">' +
          'How many loads of dirt?' +
          '<span class="dl-disp-lbl-val"><span id="' + ids.loadsVal + '">' + state.loads + '</span>' +
            '<span class="dl-disp-lbl-hint" id="' + ids.loadsHint + '">(≈ ' + (state.loads * 14) + ' yd³)</span>' +
          '</span>' +
        '</label>' +
        '<input id="' + ids.loads + '" type="range" min="1" max="30" step="1" value="' + state.loads + '">' +
      '</div>' +

      '<div class="dl-disp-section">' +
        '<label class="dl-disp-lbl">What kind of fill?</label>' +
        '<div class="dl-disp-mat-grid" role="group" aria-label="Fill type">' +
          MATERIAL_BUTTONS.map(function (m) {
            var pressed = state.materialType === m.key;
            return '<button type="button" class="dl-disp-mat-btn" aria-pressed="' + (pressed ? 'true' : 'false') + '" data-mat="' + m.key + '">' +
                     '<span class="dl-disp-mat-label">' + m.label + '</span>' +
                     (m.sub ? '<span class="dl-disp-mat-sub">' + m.sub + '</span>' : '') +
                   '</button>';
          }).join('') +
        '</div>' +
      '</div>' +

      '<div class="dl-disp-section">' +
        '<label class="dl-disp-lbl" for="' + ids.postal + '">Where in Calgary?</label>' +
        '<div class="dl-disp-loc-row">' +
          '<div class="dl-disp-postal-wrap">' +
            '<input id="' + ids.postal + '" class="dl-disp-postal-input" type="text" maxlength="7" autocomplete="postal-code" placeholder="T2X" aria-describedby="' + ids.postalHint + '">' +
            '<div id="' + ids.postalHint + '" class="dl-disp-postal-hint">Postal code or quadrant</div>' +
          '</div>' +
          '<div class="dl-disp-quad-grid" role="group" aria-label="Calgary quadrant">' +
            VALID_QUADRANTS.map(function (q) {
              var pressed = state.quadrant === q;
              return '<button type="button" class="dl-disp-quad-btn" aria-pressed="' + (pressed ? 'true' : 'false') + '" data-quad="' + q + '">' + q + '</button>';
            }).join('') +
          '</div>' +
        '</div>' +
      '</div>' +

      '<div class="dl-disp-out" aria-live="polite">' +
        '<div class="dl-disp-out-label">Estimated disposal cost</div>' +
        '<div class="dl-disp-out-total" id="' + ids.total + '">$0</div>' +
        '<div class="dl-disp-breakdown">' +
          '<div class="dl-disp-breakdown-row"><span class="dl-disp-label-l" id="' + ids.tipLabel + '">Tipping</span><span id="' + ids.tip + '">$0</span></div>' +
          '<div class="dl-disp-breakdown-row"><span class="dl-disp-label-l" id="' + ids.truckLabel + '">Trucking</span><span id="' + ids.truck + '">$0</span></div>' +
          '<div class="dl-disp-breakdown-row"><span class="dl-disp-label-l">Your time</span><span id="' + ids.time + '">~0 hours</span></div>' +
        '</div>' +
        '<div class="dl-disp-divider"></div>' +
        '<div class="dl-disp-savings">' +
          '<div class="dl-disp-savings-line1">✓ With Dirtlink: $0 for the fill</div>' +
          '<div class="dl-disp-savings-line2">You cover hauling only (<span id="' + ids.haul + '">$0</span>)</div>' +
          '<div class="dl-disp-savings-amount">You save: <span id="' + ids.save + '">$0</span> <span id="' + ids.pct + '" style="font-weight:600">(0%)</span></div>' +
        '</div>' +
        '<div class="dl-disp-narr" id="' + ids.narr + '"></div>' +
      '</div>' +

      '<div class="dl-disp-cta-row">' +
        '<a class="dl-disp-btn dl-disp-btn-primary" id="' + ids.list + '" href="' + escapeAttr(buildListFillUrl(listCtaBase, state)) + '">List this fill — free →</a>' +
        '<button type="button" class="dl-disp-btn dl-disp-btn-secondary" id="' + ids.emailBtn + '" aria-expanded="false" aria-controls="' + ids.emailForm + '">Email me this estimate</button>' +
        '<button type="button" class="dl-disp-btn dl-disp-btn-ghost" id="' + ids.copy + '">Copy link</button>' +
      '</div>' +

      '<form class="dl-disp-email-form" id="' + ids.emailForm + '" novalidate>' +
        '<div class="dl-disp-email-form-row">' +
          '<input type="email" id="' + ids.email + '" placeholder="you@email.com" required autocomplete="email" aria-required="true" aria-describedby="' + ids.emailMsg + '">' +
          '<input type="text" id="' + ids.name + '" placeholder="Name (optional)" autocomplete="name">' +
        '</div>' +
        '<div class="dl-disp-email-form-row">' +
          '<button type="submit" class="dl-disp-btn dl-disp-btn-primary" id="' + ids.emailSubmit + '">Send estimate</button>' +
        '</div>' +
        '<div class="dl-disp-email-msg" id="' + ids.emailMsg + '" role="status" aria-live="polite"></div>' +
      '</form>' +

      '<div class="dl-disp-success" id="' + ids.success + '" role="status" aria-live="polite">' +
        '<div style="font-weight:700">✓ Sent — check your inbox.</div>' +
        '<div style="font-size:13px">We also alerted Dirtlink so a real human can help if you need it.</div>' +
      '</div>';

    var $ = function (id) { return host.querySelector('#' + id); };
    var loadsEl = $(ids.loads);
    var loadsValEl = $(ids.loadsVal);
    var loadsHintEl = $(ids.loadsHint);
    var totalEl = $(ids.total);
    var tipEl = $(ids.tip);
    var tipLabelEl = $(ids.tipLabel);
    var truckEl = $(ids.truck);
    var truckLabelEl = $(ids.truckLabel);
    var timeEl = $(ids.time);
    var haulEl = $(ids.haul);
    var saveEl = $(ids.save);
    var pctEl = $(ids.pct);
    var narrEl = $(ids.narr);
    var listEl = $(ids.list);
    var copyBtn = $(ids.copy);
    var emailBtn = $(ids.emailBtn);
    var emailForm = $(ids.emailForm);
    var emailEl = $(ids.email);
    var nameEl = $(ids.name);
    var emailMsg = $(ids.emailMsg);
    var emailSubmit = $(ids.emailSubmit);
    var successEl = $(ids.success);
    var postalEl = $(ids.postal);
    var postalHintEl = $(ids.postalHint);

    function setMatActive(key) {
      Array.prototype.forEach.call(host.querySelectorAll('.dl-disp-mat-btn'), function (b) {
        b.setAttribute('aria-pressed', b.getAttribute('data-mat') === key ? 'true' : 'false');
      });
    }
    function setQuadActive(q) {
      Array.prototype.forEach.call(host.querySelectorAll('.dl-disp-quad-btn'), function (b) {
        b.setAttribute('aria-pressed', b.getAttribute('data-quad') === q ? 'true' : 'false');
      });
    }

    var debouncedUrlWrite = debounce(function () {
      if (urlSyncEnabled) writeUrlState(win, state);
    }, 300);

    function update(skipUrl) {
      var r = calculateDisposalCost(state);
      loadsValEl.textContent = state.loads;
      loadsHintEl.textContent = '(≈ ' + (state.loads * 14) + ' yd³)';
      totalEl.textContent = fmtMoney(r.landfillTotal);
      tipLabelEl.textContent = tippingLabelFor(state.materialType, r.smallLoadApplied);
      tipEl.textContent = fmtMoney(r.tippingTotal);
      truckLabelEl.textContent = 'Trucking (' + r.loads + ' trips × ' + r.tripHours + 'h × $' + r.truckingHourly + '/h)';
      truckEl.textContent = fmtMoney(r.truckingTotal);
      timeEl.textContent = '~' + r.totalHours + (r.totalHours === 1 ? ' hour' : ' hours');
      haulEl.textContent = fmtMoney(r.dirtlinkTotal);
      saveEl.textContent = fmtMoney(r.savings);
      pctEl.textContent = '(' + r.savingsPct + '%)';
      narrEl.textContent = NARRATIVE[state.materialType] || '';
      listEl.setAttribute('href', buildListFillUrl(listCtaBase, state));

      if (urlSyncEnabled && !skipUrl) debouncedUrlWrite();
    }

    function fireInputChange(field) {
      if (inputChangeFired[field]) return;
      inputChangeFired[field] = true;
      track('calculator_disposal_input_changed', {
        field: field,
        loads: state.loads,
        material_type: state.materialType,
        quadrant: state.quadrant
      });
    }

    // Wire inputs
    loadsEl.addEventListener('input', function () {
      state.loads = Math.floor(num(loadsEl.value, 5));
      fireInputChange('loads');
      update();
    });

    Array.prototype.forEach.call(host.querySelectorAll('.dl-disp-mat-btn'), function (btn) {
      btn.addEventListener('click', function () {
        state.materialType = btn.getAttribute('data-mat');
        setMatActive(state.materialType);
        fireInputChange('materialType');
        update();
      });
    });

    Array.prototype.forEach.call(host.querySelectorAll('.dl-disp-quad-btn'), function (btn) {
      btn.addEventListener('click', function () {
        state.quadrant = btn.getAttribute('data-quad');
        setQuadActive(state.quadrant);
        // Clear postal so user knows quadrant is now manual
        if (postalEl.value) {
          postalEl.value = '';
          postalHintEl.textContent = 'Postal code or quadrant';
          postalHintEl.classList.remove('matched');
        }
        fireInputChange('quadrant');
        update();
      });
    });

    postalEl.addEventListener('input', function () {
      var raw = postalEl.value;
      state.postal = raw;
      var matched = quadrantForPostal(raw);
      if (matched) {
        state.quadrant = matched;
        setQuadActive(matched);
        postalHintEl.textContent = 'Matched to ' + matched + ' Calgary';
        postalHintEl.classList.add('matched');
        fireInputChange('postal');
        update();
      } else {
        postalHintEl.classList.remove('matched');
        if (raw && raw.replace(/\s/g, '').length >= 3) {
          postalHintEl.textContent = "Couldn't match — pick a quadrant";
        } else {
          postalHintEl.textContent = 'Postal code or quadrant';
        }
      }
    });

    // Wire CTAs
    listEl.addEventListener('click', function () {
      track('calculator_disposal_list_cta_clicked', {
        loads: state.loads,
        material_type: state.materialType,
        quadrant: state.quadrant
      });
    });

    copyBtn.addEventListener('click', function () {
      var url = buildResultsUrl(win, state);
      var orig = copyBtn.textContent;
      var done = function () {
        copyBtn.textContent = '✓ Copied';
        setTimeout(function () { copyBtn.textContent = orig; }, 2000);
      };
      try {
        if (win.navigator && win.navigator.clipboard && win.navigator.clipboard.writeText) {
          win.navigator.clipboard.writeText(url).then(done, fallback);
        } else { fallback(); }
      } catch (_) { fallback(); }

      function fallback() {
        try {
          var t = doc.createElement('textarea');
          t.value = url;
          doc.body.appendChild(t);
          t.select();
          doc.execCommand && doc.execCommand('copy');
          doc.body.removeChild(t);
        } catch (_) { /* ignore */ }
        done();
      }

      track('calculator_disposal_link_copied', {
        loads: state.loads,
        material_type: state.materialType,
        quadrant: state.quadrant
      });
    });

    emailBtn.addEventListener('click', function () {
      var open = !emailForm.classList.contains('open');
      emailForm.classList.toggle('open', open);
      emailBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) emailEl.focus();
    });

    emailForm.addEventListener('submit', function (e) {
      e.preventDefault();
      emailMsg.classList.remove('show', 'error');
      var email = (emailEl.value || '').trim();
      var name = (nameEl.value || '').trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        emailMsg.textContent = 'Please enter a valid email.';
        emailMsg.classList.add('show', 'error');
        emailEl.setAttribute('aria-invalid', 'true');
        emailEl.focus();
        return;
      }
      emailEl.removeAttribute('aria-invalid');
      emailSubmit.disabled = true;
      emailSubmit.textContent = 'Sending…';

      win.fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email,
          name: name || undefined,
          source: 'calculator-disposal-cost-Calgary',
          inputs: { loads: state.loads, materialType: state.materialType, quadrant: state.quadrant },
          resultsUrl: buildResultsUrl(win, state)
        })
      }).then(function (r) {
        return r.json().then(function (j) { return { ok: r.ok, body: j }; });
      }).then(function (resp) {
        emailSubmit.disabled = false;
        emailSubmit.textContent = 'Send estimate';
        if (resp.ok) {
          // Replace form with success block (per Stage 4 spec)
          emailForm.classList.remove('open');
          emailForm.style.display = 'none';
          emailBtn.style.display = 'none';
          successEl.classList.add('show');
          track('calculator_disposal_email_submitted', {
            loads: state.loads,
            material_type: state.materialType,
            quadrant: state.quadrant
          });
        } else {
          emailMsg.textContent = (resp.body && resp.body.error) || 'Could not send. Please try again.';
          emailMsg.classList.add('show', 'error');
        }
      }).catch(function () {
        emailSubmit.disabled = false;
        emailSubmit.textContent = 'Send estimate';
        emailMsg.textContent = 'Network error. Please try again.';
        emailMsg.classList.add('show', 'error');
      });
    });

    track('calculator_disposal_viewed', {
      loads: state.loads,
      material_type: state.materialType,
      quadrant: state.quadrant
    });

    update(true);
    if (urlSyncEnabled && !win.location.search) writeUrlState(win, state);
  }

  function init() {
    var hosts = document.querySelectorAll('[data-calculator="dirt-disposal"]:not([data-dl-hydrated])');
    Array.prototype.forEach.call(hosts, function (host) {
      host.setAttribute('data-dl-hydrated', '1');
      try { hydrate(host); }
      catch (err) {
        console.error('[dl-disp] hydration failed', err);
        host.removeAttribute('data-dl-hydrated');
      }
    });
  }

  // Run init now (covers script-at-end-of-body case in real browsers AND
  // synchronous eval in jsdom). Guard against the script-in-head case via
  // DOMContentLoaded — idempotency makes both paths safe.
  init();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  }

  window.DirtLinkDisposalCalc = { rehydrate: init };
})();
