// Progressive enhancement for /calgary/suppliers/:slug profile pages.
// 1. Initialises a tiny Leaflet map for the supplier's lat/lng.
// 2. Wires GA4 events for profile interactions.
// 3. Handles the lead-capture form submission with fetch + simple UX.

(function () {
  // ── Map (lazy-loaded) ──────────────────────────────────────────────────
  // Leaflet is ~43KB JS + ~15KB CSS + tile fetches. The map sits below
  // the fold on most profile pages, so loading Leaflet eagerly hurts LCP
  // for no reason. We swap the bundle in only when the map div enters the
  // viewport. If IntersectionObserver isn't available, fall back to a
  // single load on first scroll/click.
  var LEAFLET_CSS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
  var LEAFLET_JS  = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
  var leafletPromise = null;

  function loadLeaflet() {
    if (leafletPromise) return leafletPromise;
    leafletPromise = new Promise(function (resolve, reject) {
      var link = document.createElement('link');
      link.rel = 'stylesheet'; link.href = LEAFLET_CSS; link.crossOrigin = '';
      document.head.appendChild(link);
      var s = document.createElement('script');
      s.src = LEAFLET_JS; s.crossOrigin = ''; s.async = true;
      s.onload = function () { resolve(window.L); };
      s.onerror = reject;
      document.body.appendChild(s);
    });
    return leafletPromise;
  }

  function initMap() {
    var el = document.getElementById('profile-map');
    if (!el) return;
    var lat = parseFloat(el.getAttribute('data-lat'));
    var lng = parseFloat(el.getAttribute('data-lng'));
    var name = el.getAttribute('data-name') || '';
    if (!isFinite(lat) || !isFinite(lng)) return;
    if (el.dataset.loaded === '1') return;
    el.dataset.loaded = '1';

    loadLeaflet().then(function (L) {
      var map = L.map(el, { scrollWheelZoom: false }).setView([lat, lng], 14);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap'
      }).addTo(map);
      L.marker([lat, lng]).addTo(map).bindTooltip(name, { permanent: false });
    });
  }

  function setupMapLazy() {
    var el = document.getElementById('profile-map');
    if (!el) return;
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        for (var i = 0; i < entries.length; i++) {
          if (entries[i].isIntersecting) {
            io.disconnect();
            initMap();
            break;
          }
        }
      }, { rootMargin: '200px' });
      io.observe(el);
    } else {
      // Fallback: load on first scroll or 3s timeout.
      var fired = false;
      function once() { if (fired) return; fired = true; initMap(); window.removeEventListener('scroll', once); }
      window.addEventListener('scroll', once, { passive: true });
      setTimeout(once, 3000);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupMapLazy);
  } else {
    setupMapLazy();
  }

  // ── GA4 events ────────────────────────────────────────────────────────
  function fire(name, payload) {
    if (typeof gtag !== 'function') return;
    gtag('event', name, payload || {});
  }

  document.querySelectorAll('a[data-cta="profile-website"]').forEach(function (a) {
    a.addEventListener('click', function () {
      fire('profile_website_clicked', {
        supplier_slug: a.getAttribute('data-supplier-slug'),
        supplier_tier: a.getAttribute('data-supplier-tier')
      });
    });
  });

  document.querySelectorAll('a[data-cta="profile-phone"]').forEach(function (a) {
    a.addEventListener('click', function () {
      fire('profile_phone_clicked', {
        supplier_slug: a.getAttribute('data-supplier-slug'),
        supplier_tier: a.getAttribute('data-supplier-tier')
      });
    });
  });

  document.querySelectorAll('a[data-cta="profile-claim"]').forEach(function (a) {
    a.addEventListener('click', function () {
      fire('profile_claim_clicked', {
        supplier_slug: a.getAttribute('data-supplier-slug'),
        supplier_tier: a.getAttribute('data-supplier-tier')
      });
    });
  });

  document.querySelectorAll('a[data-cta="profile-sibling"]').forEach(function (a) {
    a.addEventListener('click', function () {
      fire('profile_sibling_clicked', {
        supplier_slug: a.getAttribute('data-supplier-slug')
      });
    });
  });

  // ── Lead capture form (Powerhouse+ only — element only present then) ─
  var form = document.querySelector('form.lead-form');
  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = form.querySelector('button[type="submit"]');
      if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }

      var fd = new FormData(form);
      var body = {};
      fd.forEach(function (v, k) { body[k] = v; });

      fetch(form.getAttribute('action'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
        .then(function (r) {
          if (!r.ok) throw new Error('lead submission failed');
          fire('profile_lead_form_submitted', {
            supplier_slug: form.getAttribute('data-supplier-slug'),
            supplier_tier: form.getAttribute('data-supplier-tier')
          });
          form.innerHTML = '<p class="lede" style="margin:0;">Thanks — we\'ve sent your request to ' +
            (form.getAttribute('data-supplier-slug') || 'the supplier') +
            '. They typically respond during business hours.</p>';
        })
        .catch(function () {
          if (btn) { btn.disabled = false; btn.textContent = 'Send quote request'; }
          alert("Sorry — we couldn't send that. Try again or email support@dirtlink.ca.");
        });
    });
  }
})();
