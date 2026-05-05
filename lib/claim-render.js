// Server-side HTML for the claim landing page, the verify-result splash,
// the post-claim wizard, and the upgrade hold-page.
// All renderers are pure functions; the route handlers in server.js
// perform DB I/O and template substitution.

const { getCategory, CATEGORIES } = require('./directory-categories');
const { escapeHtml, escapeAttr } = require('./directory-render');

const SERVICE_AREA_VOCAB = [
  'Calgary Metro',
  'NE Calgary', 'NW Calgary', 'SE Calgary', 'SW Calgary', 'Centre Calgary',
  'Airdrie', 'Cochrane', 'Okotoks', 'Chestermere', 'Strathmore', 'Bragg Creek', 'High River'
];

const PLAN_DETAILS = {
  pro:        { name: 'Pro',        price: '$29/mo',  reveals: '10 reveals/month, $2.99 overage' },
  powerhouse: { name: 'Powerhouse', price: '$59/mo',  reveals: '40 reveals/month, $1.49 overage, proximity notifications' },
  enterprise: { name: 'Enterprise', price: '$149/mo', reveals: 'Unlimited reveals, private map view, all Powerhouse features' }
};

// ── Claim landing page ──────────────────────────────────────────────────
function renderClaimLanding({ supplier, viewer }) {
  const cat = getCategory(supplier.category);
  const catLabel = cat ? cat.label : (supplier.category || '—');

  if (!viewer || !viewer.userId) {
    const back = `/calgary/suppliers/${encodeURIComponent(supplier.slug)}`;
    return `
      <div class="container claim-page">
        <nav class="breadcrumbs" aria-label="Breadcrumb">
          <a href="/">Home</a><span class="sep">/</span><a href="/calgary/suppliers">Suppliers</a><span class="sep">/</span><a href="${escapeAttr(back)}">${escapeHtml(supplier.site_name)}</a><span class="sep">/</span><span aria-current="page">Claim</span>
        </nav>
        <section class="hero">
          <h1>Claim ${escapeHtml(supplier.site_name)}</h1>
          <p class="lede">Sign in to your DirtLink account, then come back to verify ownership of this listing. New here? Creating an account takes 60 seconds.</p>
          <div class="cta-row">
            <a class="btn btn-primary" href="/app?redirect=${encodeURIComponent('/claim/' + supplier.slug)}" data-cta="claim-signin">Sign in to continue</a>
            <a class="btn btn-secondary" href="${escapeAttr(back)}">Back to listing</a>
          </div>
        </section>
      </div>`;
  }

  if (supplier.claimed_by && supplier.claimed_by !== viewer.userId) {
    return `
      <div class="container claim-page">
        <section class="hero">
          <h1>Already claimed</h1>
          <p class="lede">${escapeHtml(supplier.site_name)} has already been claimed by another DirtLink user. If you believe that's a mistake, email <a href="mailto:support@dirtlink.ca?subject=Disputed%20claim:%20${encodeURIComponent(supplier.slug)}">support@dirtlink.ca</a>.</p>
          <div class="cta-row">
            <a class="btn btn-secondary" href="/calgary/suppliers/${encodeURIComponent(supplier.slug)}">Back to listing</a>
          </div>
        </section>
      </div>`;
  }

  if (supplier.claimed_by === viewer.userId) {
    return `
      <div class="container claim-page">
        <section class="hero">
          <h1>You already own this listing</h1>
          <p class="lede">Continue to the editor to fill out your profile.</p>
          <div class="cta-row">
            <a class="btn btn-primary" href="/claim/${encodeURIComponent(supplier.slug)}/wizard" data-cta="claim-resume-wizard">Continue to wizard →</a>
            <a class="btn btn-secondary" href="/calgary/suppliers/${encodeURIComponent(supplier.slug)}">View live profile</a>
          </div>
        </section>
      </div>`;
  }

  const back = `/calgary/suppliers/${encodeURIComponent(supplier.slug)}`;
  return `
      <div class="container claim-page">
        <nav class="breadcrumbs" aria-label="Breadcrumb">
          <a href="/">Home</a><span class="sep">/</span><a href="/calgary/suppliers">Suppliers</a><span class="sep">/</span><a href="${escapeAttr(back)}">${escapeHtml(supplier.site_name)}</a><span class="sep">/</span><span aria-current="page">Claim</span>
        </nav>
        <section class="hero">
          <div class="eyebrow">Calgary · ${escapeHtml(catLabel)}</div>
          <h1>Claim ${escapeHtml(supplier.site_name)}</h1>
          <p class="lede">Verifying takes a minute. We'll email a link to the address on file for this business and unlock the profile editor when you click through. If we can't reach the address, our team will review your request manually within one business day.</p>
        </section>
        <section class="section">
          <div class="container" style="padding:0;">
            <div class="card claim-confirm">
              <h3>You're claiming as</h3>
              <p style="margin-bottom:18px;">${escapeHtml(viewer.email || '')}<br><span class="muted">(your DirtLink account — change by signing in differently)</span></p>
              <button id="claim-start-btn" class="btn btn-primary" data-cta="claim-start" data-supplier-slug="${escapeAttr(supplier.slug)}">Send verification</button>
              <p id="claim-start-status" class="claim-status" role="status" aria-live="polite"></p>
            </div>
          </div>
        </section>
      </div>`;
}

// Splash shown after token verification (the email link land).
function renderClaimVerified({ supplier, alreadyApproved }) {
  return `
    <div class="container claim-page">
      <section class="hero">
        <h1>${alreadyApproved ? 'Already verified' : 'Listing verified'}</h1>
        <p class="lede">${alreadyApproved
          ? 'This claim was already approved. Continue to the editor to update your profile.'
          : `You now manage ${escapeHtml(supplier.site_name)} on DirtLink. Set up your profile in the editor.`}</p>
        <div class="cta-row">
          <a class="btn btn-primary" href="/claim/${encodeURIComponent(supplier.slug)}/wizard" data-cta="claim-verify-continue" data-supplier-slug="${escapeAttr(supplier.slug)}">Continue to editor →</a>
          <a class="btn btn-secondary" href="/calgary/suppliers/${encodeURIComponent(supplier.slug)}">View live profile</a>
        </div>
      </section>
    </div>`;
}

function renderClaimError({ reason, supplier }) {
  const explain = {
    'token_not_found': "That verification link isn't valid. Try restarting your claim.",
    'invalid_state':   "This claim has already been processed.",
    'wrong_user':      "This verification link was sent to a different account. Sign in as that account first.",
    'no_token':        "No verification token in the URL.",
    'race_lost':       "Someone else completed a claim for this listing first."
  }[reason] || "Something went wrong with verification.";
  return `
    <div class="container claim-page">
      <section class="hero">
        <h1>Verification failed</h1>
        <p class="lede">${escapeHtml(explain)}</p>
        <div class="cta-row">
          <a class="btn btn-secondary" href="${supplier ? `/calgary/suppliers/${encodeURIComponent(supplier.slug)}` : '/calgary/suppliers'}">Back to listing</a>
        </div>
      </section>
    </div>`;
}

// ── Post-claim wizard ───────────────────────────────────────────────────
function renderWizardStep({ supplier, viewer, userTier, step }) {
  const stepNum = parseInt(step, 10) || 1;
  const userTierRank = { free: 3, pro: 2, powerhouse: 1, enterprise: 0 };
  const atLeast = (target) => userTierRank[userTier] <= userTierRank[target];

  const stepNav = [1, 2, 3, 4, 5].map(n => `
        <span class="wizard-step-pill ${n === stepNum ? 'is-active' : ''} ${n < stepNum ? 'is-done' : ''}">${n}</span>`).join('');
  const navBlock = `
    <nav class="wizard-nav" aria-label="Wizard progress">${stepNav}
    </nav>`;

  let body = '';
  if (stepNum === 1) {
    body = renderStep1(supplier);
  } else if (stepNum === 2) {
    body = renderStep2(supplier);
  } else if (stepNum === 3) {
    body = renderStep3(supplier, atLeast('pro'));
  } else if (stepNum === 4) {
    body = renderStep4(supplier, atLeast('powerhouse'));
  } else if (stepNum === 5) {
    body = renderStep5(supplier);
  } else {
    body = `<p class="lede">Unknown step.</p>`;
  }

  return `
    <div class="container wizard-page" data-claim-id="${escapeAttr(viewer.claimId)}" data-supplier-slug="${escapeAttr(supplier.slug)}" data-step="${stepNum}">
      <nav class="breadcrumbs" aria-label="Breadcrumb">
        <a href="/">Home</a><span class="sep">/</span><a href="/calgary/suppliers/${encodeURIComponent(supplier.slug)}">${escapeHtml(supplier.site_name)}</a><span class="sep">/</span><span aria-current="page">Editor</span>
      </nav>
      ${navBlock}
      ${body}
    </div>`;
}

function renderStep1(supplier) {
  const currentArea = (function() {
    try { return JSON.parse(supplier.service_area || '[]'); } catch { return []; }
  })();
  const areaCheckboxes = SERVICE_AREA_VOCAB.map(a => `
        <label class="check-row"><input type="checkbox" name="service_area" value="${escapeAttr(a)}" ${currentArea.includes(a) ? 'checked' : ''}> ${escapeHtml(a)}</label>`).join('');
  const catOpts = CATEGORIES.map(c => `<option value="${escapeAttr(c.slug)}" ${supplier.category === c.slug ? 'selected' : ''}>${escapeHtml(c.label)}</option>`).join('');
  return `
      <section class="hero">
        <div class="eyebrow">Step 1 of 5 · Basics</div>
        <h1>Confirm the basics</h1>
        <p class="lede">Make sure ${escapeHtml(supplier.site_name)} is in the right category and serving the right areas. These show on your public listing.</p>
      </section>
      <form class="wizard-form" data-step="1">
        <label>Business name<input type="text" name="site_name" value="${escapeAttr(supplier.site_name)}" disabled></label>
        <label>Category<select name="category">${catOpts}</select></label>
        <fieldset>
          <legend>Service area</legend>
          <div class="check-grid">${areaCheckboxes}
          </div>
        </fieldset>
        <div class="cta-row">
          <button type="submit" class="btn btn-primary" data-cta="wizard-step-save" data-step="1">Save and continue →</button>
        </div>
      </form>`;
}

function renderStep2(supplier) {
  return `
      <section class="hero">
        <div class="eyebrow">Step 2 of 5 · Visibility</div>
        <h1>What can buyers see?</h1>
        <p class="lede">By default DirtLink only displays contact info you explicitly approve. Toggle these on to show your phone or address publicly. (Pro-tier listings always display the phone.)</p>
      </section>
      <form class="wizard-form" data-step="2">
        <label class="check-row"><input type="checkbox" name="public_phone" ${supplier.public_phone ? 'checked' : ''}> Show my phone number publicly</label>
        <label class="check-row"><input type="checkbox" name="public_address" ${supplier.public_address ? 'checked' : ''}> Show my address publicly</label>
        <div class="cta-row">
          <button type="submit" class="btn btn-primary" data-cta="wizard-step-save" data-step="2">Save and continue →</button>
          <a class="btn btn-ghost" href="?step=1" data-cta="wizard-step-back">← Back</a>
        </div>
      </form>`;
}

function renderStep3(supplier, isPro) {
  const lockClass = isPro ? '' : 'is-locked';
  const lockIcon = (label) => isPro ? '' : `<span class="lock" aria-label="Unlock with Pro plan" title="Unlock with Pro plan">🔒</span>`;
  const upgradeUrl = `/upgrade?from=wizard-step-3&plan=pro&supplier=${encodeURIComponent(supplier.slug)}`;
  return `
      <section class="hero">
        <div class="eyebrow">Step 3 of 5 · Pro features</div>
        <h1>Make your profile stand out</h1>
        <p class="lede">Pro listings get a description, logo, photos, business hours, and an outbound link to your website. ${isPro ? 'You’re on the Pro plan — fill these in.' : 'Locked on the Free plan. Upgrade to unlock.'}</p>
      </section>
      <form class="wizard-form ${lockClass}" data-step="3">
        <label>Description (250 char max) ${lockIcon()}
          <textarea name="description" maxlength="250" rows="3" ${isPro ? '' : 'disabled aria-disabled="true"'}>${escapeHtml(supplier.description || '')}</textarea>
        </label>
        <label>Website URL ${lockIcon()}
          <input type="url" name="website_url" placeholder="https://example.com" value="${escapeAttr(supplier.website_url || '')}" ${isPro ? '' : 'disabled aria-disabled="true"'}>
        </label>
        <label>Logo URL ${lockIcon()}
          <input type="url" name="logo_url" placeholder="https://your-logo.png" value="${escapeAttr(supplier.logo_url || '')}" ${isPro ? '' : 'disabled aria-disabled="true"'}>
        </label>
        <fieldset ${isPro ? '' : 'disabled aria-disabled="true"'}>
          <legend>Business hours ${lockIcon()}</legend>
          ${renderHoursInputs(supplier)}
        </fieldset>
        <div class="cta-row">
          ${isPro
            ? `<button type="submit" class="btn btn-primary" data-cta="wizard-step-save" data-step="3">Save and continue →</button>`
            : `<a class="btn btn-primary" href="${escapeAttr(upgradeUrl)}" data-cta="wizard-unlock-pro" data-supplier-slug="${escapeAttr(supplier.slug)}" data-from-step="3">Unlock all of these — Upgrade to Pro for $29/mo</a>`}
          <a class="btn btn-ghost" href="?step=4" data-cta="wizard-step-skip">Skip for now →</a>
          <a class="btn btn-ghost" href="?step=2" data-cta="wizard-step-back">← Back</a>
        </div>
      </form>`;
}

function renderHoursInputs(supplier) {
  let hours = {};
  try { hours = JSON.parse(supplier.business_hours || '{}'); } catch {}
  const days = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
  return days.map(d => {
    const cap = d.charAt(0).toUpperCase() + d.slice(1);
    const slot = hours[d] || {};
    return `        <div class="hours-row">
          <span class="hours-day">${cap}</span>
          <input type="time" name="hours_${d}_open"  value="${escapeAttr(slot.open  || '')}">
          <input type="time" name="hours_${d}_close" value="${escapeAttr(slot.close || '')}">
        </div>`;
  }).join('\n');
}

function renderStep4(supplier, isPowerhouse) {
  const lockClass = isPowerhouse ? '' : 'is-locked';
  const upgradeUrl = `/upgrade?from=wizard-step-4&plan=powerhouse&supplier=${encodeURIComponent(supplier.slug)}`;
  return `
      <section class="hero">
        <div class="eyebrow">Step 4 of 5 · Powerhouse features</div>
        <h1>Capture leads from your profile</h1>
        <p class="lede">Powerhouse listings get an embedded "request a quote" form, more photos (up to 10), and priority on routed leads in your area. ${isPowerhouse ? 'You’re on Powerhouse — the form is already live.' : 'Locked on the current plan. Upgrade to unlock.'}</p>
      </section>
      <form class="wizard-form ${lockClass}" data-step="4">
        <label class="check-row"><input type="checkbox" ${isPowerhouse ? 'checked disabled' : 'disabled aria-disabled="true"'}> Enable lead-capture form on profile (Powerhouse)</label>
        <p class="muted">Buyers fill in their name, email, materials, and quantity, and the system routes the request to you with a 15-min head-start over Pro listings.</p>
        <div class="cta-row">
          ${isPowerhouse
            ? `<a class="btn btn-primary" href="?step=5" data-cta="wizard-step-save" data-step="4">Continue →</a>`
            : `<a class="btn btn-primary" href="${escapeAttr(upgradeUrl)}" data-cta="wizard-unlock-powerhouse" data-supplier-slug="${escapeAttr(supplier.slug)}" data-from-step="4">Unlock with Powerhouse for $59/mo</a>`}
          <a class="btn btn-ghost" href="?step=5" data-cta="wizard-step-skip">Skip for now →</a>
          <a class="btn btn-ghost" href="?step=3" data-cta="wizard-step-back">← Back</a>
        </div>
      </form>`;
}

function renderStep5(supplier) {
  return `
      <section class="hero">
        <div class="eyebrow">Step 5 of 5 · You're live</div>
        <h1>${escapeHtml(supplier.site_name)} is published</h1>
        <p class="lede">Your free listing is live in the directory. Upgrade later from your profile or pricing page to unlock more.</p>
        <div class="cta-row">
          <a class="btn btn-primary" href="/calgary/suppliers/${encodeURIComponent(supplier.slug)}" data-cta="wizard-done-view-live">View my live profile →</a>
          <a class="btn btn-secondary" href="/upgrade?from=wizard-step-5&plan=pro&supplier=${encodeURIComponent(supplier.slug)}" data-cta="wizard-done-upgrade">Upgrade now to unlock more</a>
        </div>
      </section>`;
}

// ── Upgrade hold-page ───────────────────────────────────────────────────
function renderUpgradeHoldPage({ plan, supplierSlug, supplierName, fromStep }) {
  const planInfo = PLAN_DETAILS[plan];
  if (!planInfo) {
    return `
      <div class="container">
        <section class="hero">
          <h1>Plan not recognised</h1>
          <p class="lede">The plan you tried to upgrade to isn't in our catalog. Email <a href="mailto:support@dirtlink.ca">support@dirtlink.ca</a> if you think this is a mistake.</p>
        </section>
      </div>`;
  }
  const supplierLabel = supplierName ? supplierName : (supplierSlug ? supplierSlug : 'your listing');
  const mailto = `mailto:support@dirtlink.ca?subject=${encodeURIComponent(`Upgrade request: ${supplierSlug || 'unknown'} to ${plan}`)}&body=${encodeURIComponent(`I'd like to upgrade ${supplierLabel} to the ${planInfo.name} plan.`)}`;
  return `
    <div class="container upgrade-page" data-plan="${escapeAttr(plan)}" data-supplier-slug="${escapeAttr(supplierSlug || '')}" data-from-step="${escapeAttr(fromStep || '')}">
      <nav class="breadcrumbs" aria-label="Breadcrumb">
        <a href="/">Home</a><span class="sep">/</span><span aria-current="page">Upgrade</span>
      </nav>
      <section class="hero">
        <div class="eyebrow">Upgrade · ${escapeHtml(planInfo.name)}</div>
        <h1>Upgrade ${escapeHtml(supplierLabel)} to ${escapeHtml(planInfo.name)}</h1>
        <p class="lede">${escapeHtml(planInfo.price)} · ${escapeHtml(planInfo.reveals)}.</p>
      </section>
      <section class="section">
        <div class="container" style="padding:0;">
          <div class="card upgrade-card">
            <p>We'll route you to checkout for the <strong>${escapeHtml(planInfo.name)}</strong> plan. After payment, your listing will automatically reflect the new tier — no extra step needed.</p>
            <button id="upgrade-continue-btn" class="btn btn-primary" data-cta="upgrade-holdpage-continue" data-plan="${escapeAttr(plan)}" data-supplier-slug="${escapeAttr(supplierSlug || '')}" data-from-step="${escapeAttr(fromStep || '')}">Continue to checkout →</button>
            <p id="upgrade-fallback" class="claim-status" style="display:none;">
              Checkout isn't ready yet — email
              <a href="${escapeAttr(mailto)}">support@dirtlink.ca</a>
              and we'll set you up manually.
            </p>
          </div>
        </div>
      </section>
    </div>`;
}

module.exports = {
  renderClaimLanding,
  renderClaimVerified,
  renderClaimError,
  renderWizardStep,
  renderUpgradeHoldPage,
  SERVICE_AREA_VOCAB,
  PLAN_DETAILS
};
