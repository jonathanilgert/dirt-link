// Client logic for the claim flow + wizard + upgrade hold-page.
// All POSTs are JSON. Server enforces auth/ownership/tier — this script
// only manages UX (button states, flash messages, GA events).

(function () {
  function fire(name, payload) {
    if (typeof gtag !== 'function') return;
    gtag('event', name, payload || {});
  }

  // ── Claim landing page: "Send verification" button ───────────────────
  var startBtn = document.getElementById('claim-start-btn');
  if (startBtn) {
    startBtn.addEventListener('click', function () {
      var status = document.getElementById('claim-start-status');
      var slug = startBtn.getAttribute('data-supplier-slug');
      startBtn.disabled = true;
      startBtn.textContent = 'Sending…';
      if (status) status.textContent = '';
      fetch('/api/claims/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ supplier_slug: slug })
      })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (out) {
          if (!out.ok) {
            if (status) status.textContent = 'Could not start claim: ' + (out.j.error || 'unknown error');
            startBtn.disabled = false;
            startBtn.textContent = 'Send verification';
            return;
          }
          if (out.j.status === 'email_sent') {
            startBtn.style.display = 'none';
            if (status) status.innerHTML = '<strong>Check your email</strong> at ' +
              (out.j.sentTo || 'the address on file') +
              ' for a verification link. Click through and you’ll land in the editor.';
          } else if (out.j.status === 'manual_review_pending') {
            startBtn.style.display = 'none';
            if (status) status.innerHTML = '<strong>We’ve received your claim.</strong> ' +
              'Our team will verify it within 1 business day and email you once approved.';
          }
        })
        .catch(function () {
          if (status) status.textContent = 'Network error — please try again.';
          startBtn.disabled = false;
          startBtn.textContent = 'Send verification';
        });
    });
  }

  // ── Wizard form save ─────────────────────────────────────────────────
  var wizardPage = document.querySelector('.wizard-page');
  if (wizardPage) {
    var claimId = wizardPage.getAttribute('data-claim-id');
    var slug = wizardPage.getAttribute('data-supplier-slug');
    var step = wizardPage.getAttribute('data-step');
    fire('upgrade_wizard_step_viewed', { step_number: parseInt(step, 10), supplier_slug: slug });

    var form = wizardPage.querySelector('form.wizard-form');
    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var stepNum = parseInt(form.getAttribute('data-step'), 10);
        var body = { step: stepNum };

        if (stepNum === 1) {
          var sel = form.querySelector('select[name="category"]');
          body.category = sel ? sel.value : null;
          body.service_area = Array.from(form.querySelectorAll('input[name="service_area"]:checked')).map(function (i) { return i.value; });
        } else if (stepNum === 2) {
          body.public_phone   = form.querySelector('input[name="public_phone"]').checked;
          body.public_address = form.querySelector('input[name="public_address"]').checked;
        } else if (stepNum === 3) {
          body.description = form.querySelector('textarea[name="description"]').value;
          body.website_url = form.querySelector('input[name="website_url"]').value;
          body.logo_url    = form.querySelector('input[name="logo_url"]').value;
          var hours = {};
          ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'].forEach(function (d) {
            var openEl  = form.querySelector('input[name="hours_' + d + '_open"]');
            var closeEl = form.querySelector('input[name="hours_' + d + '_close"]');
            if (openEl && closeEl && openEl.value && closeEl.value) {
              hours[d] = { open: openEl.value, close: closeEl.value };
            }
          });
          body.business_hours = hours;
        }

        var btn = form.querySelector('button[type="submit"]');
        if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

        fetch('/api/claims/wizard/' + encodeURIComponent(claimId), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify(body)
        })
          .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
          .then(function (out) {
            if (!out.ok) {
              if (btn) { btn.disabled = false; btn.textContent = 'Save and continue →'; }
              alert('Save failed: ' + (out.j.error || 'unknown'));
              return;
            }
            window.location.href = '?step=' + (stepNum + 1);
          })
          .catch(function () {
            if (btn) { btn.disabled = false; btn.textContent = 'Save and continue →'; }
            alert('Network error.');
          });
      });
    }

    // GA events for unlock buttons
    document.querySelectorAll('a[data-cta="wizard-unlock-pro"]').forEach(function (a) {
      a.addEventListener('click', function () {
        fire('upgrade_wizard_unlock_pro_clicked', {
          supplier_slug: a.getAttribute('data-supplier-slug'),
          from_step: parseInt(a.getAttribute('data-from-step'), 10)
        });
      });
    });
    document.querySelectorAll('a[data-cta="wizard-unlock-powerhouse"]').forEach(function (a) {
      a.addEventListener('click', function () {
        fire('upgrade_wizard_unlock_powerhouse_clicked', {
          supplier_slug: a.getAttribute('data-supplier-slug'),
          from_step: parseInt(a.getAttribute('data-from-step'), 10)
        });
      });
    });
  }

  // ── Upgrade hold-page ────────────────────────────────────────────────
  var upgradePage = document.querySelector('.upgrade-page');
  if (upgradePage) {
    var plan = upgradePage.getAttribute('data-plan');
    var slug = upgradePage.getAttribute('data-supplier-slug');
    var fromStep = upgradePage.getAttribute('data-from-step');
    fire('upgrade_holdpage_viewed', { plan: plan, supplier_slug: slug, from_step: fromStep });

    var continueBtn = document.getElementById('upgrade-continue-btn');
    var fallback    = document.getElementById('upgrade-fallback');
    if (continueBtn) {
      continueBtn.addEventListener('click', function () {
        fire('upgrade_holdpage_continue_clicked', { plan: plan, supplier_slug: slug, from_step: fromStep });
        continueBtn.disabled = true;
        continueBtn.textContent = 'Routing to checkout…';
        fetch('/api/billing/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ plan: plan })
        })
          .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
          .then(function (out) {
            if (out.ok && out.j.url) {
              window.location.href = out.j.url;
              return;
            }
            // Checkout not ready — surface the mailto fallback.
            if (fallback) fallback.style.display = 'block';
            continueBtn.disabled = false;
            continueBtn.textContent = 'Continue to checkout →';
          })
          .catch(function () {
            if (fallback) fallback.style.display = 'block';
            continueBtn.disabled = false;
            continueBtn.textContent = 'Continue to checkout →';
          });
      });
    }
  }
})();
