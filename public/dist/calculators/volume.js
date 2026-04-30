// Dirtlink Volume Calculator — embeddable widget bundle.
//
// Usage on any page (no module system, no framework needed):
//   <div data-calculator="volume"
//        data-material-type="topsoil"
//        data-cta-label="Browse topsoil listings"
//        data-cta-href="/calgary/topsoil#listings"></div>
//   <script src="/dist/calculators/volume.js" defer></script>
//
// Placeholder data attributes:
//   data-material-type   — slug used in analytics + as a fallback for cta-label
//   data-cta-label       — exact CTA button text (overrides the material-derived label)
//   data-cta-href        — CTA destination URL
//
// The widget is self-contained: it inlines its math, styles, and dependencies.
// Math is duplicated from lib/calculators/rates.js (canonical source). If you
// change the formula here, mirror it there and re-run test/calculators.test.js.
//
// Bundle is idempotent — script can be loaded twice without double-hydrating
// any placeholder. Re-trigger discovery in SPA contexts via:
//   window.DirtLinkVolumeCalc.rehydrate()

(function () {
  'use strict';

  // Idempotency guard — second script load is a no-op
  if (window.__DL_VOL_LOADED__) return;
  window.__DL_VOL_LOADED__ = true;

  var INSTANCE_COUNT = 0;

  // ── Math (mirror of lib/calculators/rates.js calculateVolume) ──
  function calculateVolume(input) {
    var depthInches = num(input.depthInches, 0);
    var sqFt = input.sqFt != null
      ? num(input.sqFt, 0)
      : num(input.lengthFt, 0) * num(input.widthFt, 0);
    var cubicFeet = sqFt * (depthInches / 12);
    var cubicYards = cubicFeet / 27;
    return {
      sqFt: sqFt,
      depthInches: depthInches,
      cubicFeet: cubicFeet,
      cubicYards: cubicYards,
      approxLoads: cubicYards / 14   // 14 yd³ per tandem load
    };
  }

  function num(v, fallback) {
    var n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  }

  // ── Analytics shim — works whether GA4 is loaded or not ──
  function track(event, props) {
    if (typeof window.gtag === 'function') {
      window.gtag('event', event, props || {});
    }
  }

  var MATERIAL_LABEL = {
    'topsoil':         'topsoil',
    'gravel':          'gravel',
    'sand':            'sand',
    'mulch':           'mulch',
    'compost':         'compost',
    'landscape-rock':  'landscape rock',
    'river-rock':      'river rock',
    'road-crush':      'road crush',
    'pit-run':         'pit run',
    'loam':            'loam'
  };

  // ── Styles (injected once, scoped to .dl-vol) ──
  var STYLES = '' +
    '.dl-vol{font-family:Figtree,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#1A1410;background:#fff;border:1px solid #E2D9CF;border-radius:12px;padding:20px;max-width:520px;margin:0 auto}' +
    '.dl-vol *{box-sizing:border-box}' +
    '.dl-vol .dl-vol-title{font-size:16px;font-weight:700;margin-bottom:14px}' +
    '.dl-vol .dl-vol-row{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:6px}' +
    '.dl-vol .dl-vol-sqft-row{margin-bottom:6px}' +
    '.dl-vol label{display:block;font-size:12px;font-weight:700;color:#5A5048;text-transform:uppercase;letter-spacing:0.4px;margin-bottom:5px}' +
    '.dl-vol input[type=number]{width:100%;padding:9px 11px;font-size:15px;border:1px solid #E2D9CF;border-radius:8px;background:#FAF8F5;color:#1A1410;font-family:inherit}' +
    '.dl-vol input[type=number]:focus{outline:none;border-color:#F59E0B;background:#fff}' +
    '.dl-vol input[type=range]{width:100%;accent-color:#F59E0B;margin-top:2px}' +
    '.dl-vol input[type=range]:focus{outline:2px solid #F59E0B;outline-offset:3px;border-radius:4px}' +
    '.dl-vol .dl-vol-toggle{background:none;border:none;color:#5A5048;font-size:12px;font-weight:600;text-decoration:underline;cursor:pointer;padding:4px 0;font-family:inherit;margin-bottom:12px}' +
    '.dl-vol .dl-vol-toggle:hover{color:#1A1410}' +
    '.dl-vol .dl-vol-toggle:focus{outline:2px solid #F59E0B;outline-offset:2px;border-radius:4px}' +
    '.dl-vol .dl-vol-presets{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}' +
    '.dl-vol .dl-vol-preset{font-size:12px;padding:6px 11px;border-radius:999px;border:1px solid #E2D9CF;background:#FAF8F5;cursor:pointer;color:#1A1410;font-family:inherit;font-weight:600}' +
    '.dl-vol .dl-vol-preset:hover{border-color:#F59E0B}' +
    '.dl-vol .dl-vol-preset:focus{outline:2px solid #F59E0B;outline-offset:2px}' +
    '.dl-vol .dl-vol-preset[aria-pressed="true"]{background:#F59E0B;border-color:#F59E0B;color:#1A1410}' +
    '.dl-vol .dl-vol-depth-val{font-size:13px;color:#5A5048;margin-left:8px;font-weight:600;text-transform:none;letter-spacing:0}' +
    '.dl-vol .dl-vol-out{margin-top:14px;padding:14px 16px;background:#FAF8F5;border:1px solid #E2D9CF;border-radius:8px;text-align:center}' +
    '.dl-vol .dl-vol-out-label{font-size:12px;color:#5A5048;text-transform:uppercase;letter-spacing:0.5px;font-weight:700;margin-bottom:6px}' +
    '.dl-vol .dl-vol-out-num{font-size:32px;font-weight:800;line-height:1.1;letter-spacing:-0.5px}' +
    '.dl-vol .dl-vol-out-unit{font-size:14px;color:#5A5048;margin-top:2px}' +
    '.dl-vol .dl-vol-out-loads{font-size:13px;color:#5A5048;margin-top:8px;min-height:1em}' +
    '.dl-vol .dl-vol-cta{display:block;text-align:center;background:#F59E0B;color:#1A1410;text-decoration:none;font-weight:700;padding:11px 20px;border-radius:8px;margin-top:14px}' +
    '.dl-vol .dl-vol-cta:hover{background:#D97706}' +
    '.dl-vol .dl-vol-cta:focus{outline:2px solid #1A1410;outline-offset:2px}' +
    '@media(max-width:380px){.dl-vol{padding:16px}.dl-vol .dl-vol-out-num{font-size:28px}}';

  function ensureStyles(doc) {
    if (doc.getElementById('dl-vol-styles')) return;
    var style = doc.createElement('style');
    style.id = 'dl-vol-styles';
    style.textContent = STYLES;
    doc.head.appendChild(style);
  }

  function ctaLabelFor(materialType, override) {
    if (override) return override;
    var m = MATERIAL_LABEL[materialType];
    return m ? 'Browse ' + m + ' listings' : 'Browse listings';
  }

  // ── Per-instance render ──
  function hydrate(host) {
    ensureStyles(host.ownerDocument || document);

    var materialType = host.getAttribute('data-material-type') || '';
    var ctaLabelOverride = host.getAttribute('data-cta-label') || '';
    var ctaHref = host.getAttribute('data-cta-href') ||
      (materialType ? '/?material=' + encodeURIComponent(materialType) : '/');
    var ctaLabel = ctaLabelFor(materialType, ctaLabelOverride);

    var n = ++INSTANCE_COUNT;
    var ids = {
      len:   'dl-vol-len-' + n,
      wid:   'dl-vol-wid-' + n,
      sqft:  'dl-vol-sqft-' + n,
      dep:   'dl-vol-dep-' + n,
      depV:  'dl-vol-depv-' + n,
      yd:    'dl-vol-yd-' + n,
      loads: 'dl-vol-loads-' + n
    };

    var state = {
      mode: 'lw',          // 'lw' | 'sqft'
      lengthFt: 10,
      widthFt: 10,
      sqFt: 100,
      depthInches: 4
    };
    var inputChangeFired = false;   // fires once per widget per session

    host.classList.add('dl-vol');
    host.setAttribute('role', 'region');
    host.setAttribute('aria-label', 'Material volume calculator' + (materialType ? ' for ' + materialType : ''));

    host.innerHTML =
      '<div class="dl-vol-title">How much do you need?</div>' +

      // Length × Width inputs
      '<div class="dl-vol-row" data-dl-vol-mode="lw">' +
        '<div><label for="' + ids.len + '">Length (ft)</label>' +
          '<input id="' + ids.len + '" type="number" inputmode="decimal" min="0" step="0.5" value="10"></div>' +
        '<div><label for="' + ids.wid + '">Width (ft)</label>' +
          '<input id="' + ids.wid + '" type="number" inputmode="decimal" min="0" step="0.5" value="10"></div>' +
      '</div>' +

      // Square-feet input (hidden initially)
      '<div class="dl-vol-sqft-row" data-dl-vol-mode="sqft" style="display:none">' +
        '<label for="' + ids.sqft + '">Square feet</label>' +
        '<input id="' + ids.sqft + '" type="number" inputmode="decimal" min="0" step="1" value="100">' +
      '</div>' +

      // Mode toggle
      '<button type="button" class="dl-vol-toggle" data-dl-vol-toggle aria-pressed="false">' +
        'Or enter square feet directly' +
      '</button>' +

      // Depth slider + presets
      '<div style="margin-bottom:6px">' +
        '<label for="' + ids.dep + '">Depth' +
          '<span class="dl-vol-depth-val" id="' + ids.depV + '">4 in</span>' +
        '</label>' +
        '<input id="' + ids.dep + '" type="range" min="0.5" max="24" step="0.5" value="4" aria-valuemin="0.5" aria-valuemax="24">' +
        '<div class="dl-vol-presets" role="group" aria-label="Depth presets">' +
          '<button type="button" class="dl-vol-preset" data-depth="1" aria-pressed="false">Lawn top-dress (1″)</button>' +
          '<button type="button" class="dl-vol-preset" data-depth="4" aria-pressed="true">New lawn / driveway (4″)</button>' +
          '<button type="button" class="dl-vol-preset" data-depth="12" aria-pressed="false">Garden bed (12″)</button>' +
        '</div>' +
      '</div>' +

      // Output
      '<div class="dl-vol-out" aria-live="polite">' +
        '<div class="dl-vol-out-label">You need approximately</div>' +
        '<div class="dl-vol-out-num"><span id="' + ids.yd + '">1.2</span></div>' +
        '<div class="dl-vol-out-unit">cubic yards</div>' +
        '<div class="dl-vol-out-loads" id="' + ids.loads + '"></div>' +
      '</div>' +

      // CTA
      '<a class="dl-vol-cta" data-dl-vol-cta href="' + escapeAttr(ctaHref) + '">' + escapeText(ctaLabel) + ' →</a>';

    var lwRow    = host.querySelector('[data-dl-vol-mode="lw"]');
    var sqftRow  = host.querySelector('[data-dl-vol-mode="sqft"]');
    var toggle   = host.querySelector('[data-dl-vol-toggle]');
    var lenEl    = host.querySelector('#' + ids.len);
    var widEl    = host.querySelector('#' + ids.wid);
    var sqftEl   = host.querySelector('#' + ids.sqft);
    var depEl    = host.querySelector('#' + ids.dep);
    var depValEl = host.querySelector('#' + ids.depV);
    var ydEl     = host.querySelector('#' + ids.yd);
    var loadsEl  = host.querySelector('#' + ids.loads);
    var ctaEl    = host.querySelector('[data-dl-vol-cta]');

    function update() {
      // Read state from whichever input mode is active
      if (state.mode === 'lw') {
        state.lengthFt = num(lenEl.value, 0);
        state.widthFt = num(widEl.value, 0);
      } else {
        state.sqFt = num(sqftEl.value, 0);
      }
      state.depthInches = num(depEl.value, 0);

      var calcInput = state.mode === 'lw'
        ? { lengthFt: state.lengthFt, widthFt: state.widthFt, depthInches: state.depthInches }
        : { sqFt: state.sqFt, depthInches: state.depthInches };
      var r = calculateVolume(calcInput);

      ydEl.textContent = (Math.round(r.cubicYards * 10) / 10).toFixed(1);
      depValEl.textContent =
        (state.depthInches % 1 === 0 ? state.depthInches : state.depthInches.toFixed(1)) + ' in';

      if (r.cubicYards > 10) {
        var loads = Math.round(r.approxLoads * 10) / 10;
        loadsEl.textContent = '≈ ' + loads + ' ' + (loads === 1 ? 'load' : 'loads');
      } else {
        loadsEl.textContent = '';
      }

      // Sync preset aria-pressed
      Array.prototype.forEach.call(host.querySelectorAll('.dl-vol-preset'), function (b) {
        var pressed = Number(b.getAttribute('data-depth')) === state.depthInches;
        b.setAttribute('aria-pressed', pressed ? 'true' : 'false');
      });
    }

    function fireInputChange() {
      if (inputChangeFired) return;
      inputChangeFired = true;
      track('calculator_volume_input_changed', {
        material_type: materialType
      });
    }

    function setMode(mode) {
      state.mode = mode;
      if (mode === 'sqft') {
        // Carry current L×W into the sqft field so toggling is non-destructive
        state.sqFt = state.lengthFt * state.widthFt;
        sqftEl.value = state.sqFt;
        lwRow.style.display = 'none';
        sqftRow.style.display = '';
        toggle.textContent = 'Use length × width instead';
        toggle.setAttribute('aria-pressed', 'true');
      } else {
        lwRow.style.display = '';
        sqftRow.style.display = 'none';
        toggle.textContent = 'Or enter square feet directly';
        toggle.setAttribute('aria-pressed', 'false');
      }
      update();
    }

    lenEl.addEventListener('input', function () { fireInputChange(); update(); });
    widEl.addEventListener('input', function () { fireInputChange(); update(); });
    sqftEl.addEventListener('input', function () { fireInputChange(); update(); });
    depEl.addEventListener('input', function () { fireInputChange(); update(); });

    Array.prototype.forEach.call(host.querySelectorAll('.dl-vol-preset'), function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        depEl.value = btn.getAttribute('data-depth');
        fireInputChange();
        update();
      });
    });

    toggle.addEventListener('click', function () {
      setMode(state.mode === 'lw' ? 'sqft' : 'lw');
      fireInputChange();
    });

    ctaEl.addEventListener('click', function () {
      track('calculator_volume_cta_clicked', {
        material_type: materialType,
        cubic_yards: Math.round(calculateVolume(
          state.mode === 'lw'
            ? { lengthFt: state.lengthFt, widthFt: state.widthFt, depthInches: state.depthInches }
            : { sqFt: state.sqFt, depthInches: state.depthInches }
        ).cubicYards * 10) / 10
      });
    });

    track('calculator_volume_viewed', { material_type: materialType });
    update();
  }

  // ── Tiny escape helpers (keeps malicious data attrs from breaking out) ──
  function escapeAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
      .replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function escapeText(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function init() {
    var hosts = document.querySelectorAll('[data-calculator="volume"]:not([data-dl-hydrated])');
    Array.prototype.forEach.call(hosts, function (host) {
      host.setAttribute('data-dl-hydrated', '1');
      try { hydrate(host); }
      catch (err) {
        console.error('[dl-vol] hydration failed', err);
        host.removeAttribute('data-dl-hydrated');  // allow retry
      }
    });
  }

  // Run init now — if script is at end-of-body (typical), placeholders are
  // already parsed and hydrate immediately. If the script was injected in
  // <head> before placeholders, init() finds nothing and the DOMContentLoaded
  // fallback below picks them up. The data-dl-hydrated guard makes both paths
  // idempotent so it's safe to run init() more than once.
  init();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  }

  window.DirtLinkVolumeCalc = { rehydrate: init };
})();
