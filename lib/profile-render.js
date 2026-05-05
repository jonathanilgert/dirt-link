// Tier-gated rendering for /calgary/suppliers/:slug profile pages.
// Pure functions: take the supplier row + (optionally) sibling rows + a
// `viewer` object, return HTML strings. The route handler in server.js
// performs DB I/O and template substitution.
//
// SEO note on outbound supplier-website links: every <a> rendered to an
// external supplier URL must use rel="nofollow noopener" target="_blank".
// Selling dofollow links violates Google's link-spam policy and would risk
// dirtlink.ca's organic rankings; noopener prevents window.opener
// exploitation. The renderOutboundLink() helper enforces this — do not
// bypass it when adding new link sites.

const crypto = require('crypto');
const { getCategory, getCategoryLabel } = require('./directory-categories');
const { escapeHtml, escapeAttr, parseList, sortSuppliers, TIER_LABEL } = require('./directory-render');

const TIER_RANK = { enterprise: 0, powerhouse: 1, pro: 2, free: 3 };

// Tier capability gates. A profile renders a Pro field iff isPaid('pro', supplier).
// This is the single source of truth for what renders at what tier.
function tierAtLeast(actual, target) {
  return (TIER_RANK[actual] ?? 9) <= (TIER_RANK[target] ?? 9);
}
function isPaid(supplier) {
  return supplier.tier && supplier.tier !== 'free';
}

// THE ONLY function that renders an outbound supplier website URL. See
// the file-level comment about the dofollow policy — never inline an
// `<a target="_blank">` to a supplier URL elsewhere; route through here.
function renderOutboundLink(href, label, dataAttrs = {}) {
  const safe = String(href || '').trim();
  if (!safe || !/^https?:\/\//i.test(safe)) return '';
  const attrs = Object.entries(dataAttrs)
    .map(([k, v]) => ` data-${escapeAttr(k)}="${escapeAttr(v)}"`).join('');
  return `<a href="${escapeAttr(safe)}" rel="nofollow noopener" target="_blank"${attrs}>${escapeHtml(label || safe)}</a>`;
}

function tierBadge(tier) {
  if (!tier || tier === 'free') return '';
  const label = TIER_LABEL[tier] || '';
  return `<span class="tier-badge tier-${escapeAttr(tier)}">${escapeHtml(label)}</span>`;
}

function verifiedBadge(supplier) {
  if (!supplier.claimed_by) return '';
  return '<span class="verified-badge" title="Claimed and verified by the business owner">Verified</span>';
}

function featuredBadge(supplier) {
  // Powerhouse+ qualifies for the "Featured" badge on their profile. The
  // Enterprise sponsored-slot callout is rendered separately below.
  if (!tierAtLeast(supplier.tier, 'powerhouse')) return '';
  const cat = supplier.category ? getCategoryLabel(supplier.category) : 'Calgary';
  return `<span class="featured-badge">Featured ${escapeHtml(cat)}</span>`;
}

function premierBadge(supplier) {
  if (supplier.tier !== 'enterprise') return '';
  return '<span class="premier-badge">Premier</span>';
}

function sponsoredCallout(supplier) {
  if (supplier.tier !== 'enterprise' || !supplier.is_sponsored_slot) return '';
  const cat = supplier.category ? getCategoryLabel(supplier.category) : 'Calgary';
  return `<div class="sponsored-callout">Featured ${escapeHtml(cat)} — Sponsored</div>`;
}

function renderClaimCta(supplier, viewer) {
  if (viewer && viewer.userId && viewer.userId === supplier.claimed_by) return '';
  return `
        <a class="claim-cta" href="/claim/${encodeURIComponent(supplier.slug)}" data-cta="profile-claim" data-supplier-slug="${escapeAttr(supplier.slug)}" data-supplier-tier="${escapeAttr(supplier.tier || 'free')}">Is this your business? Claim free →</a>`;
}

function renderHoursTable(rawHours) {
  if (!tierAtLeast(arguments[1] && arguments[1].tier, 'pro')) {
    // Caller controls gating; this guard is defensive.
  }
  let hours;
  try { hours = typeof rawHours === 'string' ? JSON.parse(rawHours) : rawHours; }
  catch { hours = null; }
  if (!hours || typeof hours !== 'object') return '';
  const days = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
  const dayLabel = { monday:'Mon', tuesday:'Tue', wednesday:'Wed', thursday:'Thu', friday:'Fri', saturday:'Sat', sunday:'Sun' };
  const rows = days.map(d => {
    const slot = hours[d];
    const txt = slot && slot.open && slot.close
      ? `${escapeHtml(slot.open)}–${escapeHtml(slot.close)}`
      : '<span class="hours-closed">Closed</span>';
    return `<tr><th>${dayLabel[d]}</th><td>${txt}</td></tr>`;
  }).join('');
  return `<table class="rate-table hours-table"><tbody>${rows}</tbody></table>`;
}

function renderPhotoGallery(rawPhotos, supplier) {
  const photos = parseList(rawPhotos);
  if (!photos.length) return '';
  const limit = tierAtLeast(supplier.tier, 'powerhouse') ? 10
              : tierAtLeast(supplier.tier, 'pro') ? 3 : 0;
  if (limit === 0) return '';
  const items = photos.slice(0, limit).map((src, i) => `
        <figure class="profile-photo">
          <img src="${escapeAttr(src)}" alt="${escapeAttr(supplier.site_name)} — photo ${i + 1}" loading="lazy">
        </figure>`).join('');
  return `
    <section class="section">
      <div class="container">
        <h2>Photos</h2>
        <div class="profile-gallery">${items}
        </div>
      </div>
    </section>`;
}

function renderLeadForm(supplier) {
  if (!tierAtLeast(supplier.tier, 'powerhouse')) return '';
  // The form posts to /api/leads (Stage 5 wires routeLead() into that
  // handler). For Stage 3 we just need the form rendered — submission
  // creates a lead row via the existing endpoint.
  return `
    <section class="section profile-leadform" id="contact">
      <div class="container">
        <h2>Request a quote from ${escapeHtml(supplier.site_name)}</h2>
        <p class="lede">Send a direct quote request. ${escapeHtml(supplier.site_name)} responds during business hours.</p>
        <form class="lead-form" method="post" action="/api/leads/profile" data-supplier-slug="${escapeAttr(supplier.slug)}" data-supplier-tier="${escapeAttr(supplier.tier)}">
          <input type="hidden" name="supplier_slug" value="${escapeAttr(supplier.slug)}">
          <input type="hidden" name="source" value="profile_lead_form">
          <div class="lead-form__row">
            <label>Your name<input type="text" name="name" required maxlength="120"></label>
            <label>Email<input type="email" name="email" required maxlength="240"></label>
          </div>
          <div class="lead-form__row">
            <label>Phone<input type="tel" name="phone" maxlength="40"></label>
            <label>Materials needed<input type="text" name="materials_needed" placeholder="e.g. 20 yards screened topsoil" maxlength="240"></label>
          </div>
          <label>Quantity / details<textarea name="message" rows="3" maxlength="2000"></textarea></label>
          <button type="submit" class="btn btn-primary" data-cta="profile-leadform-submit">Send quote request</button>
        </form>
      </div>
    </section>`;
}

function renderOwnerAnalytics(supplier, viewer) {
  if (!tierAtLeast(supplier.tier, 'powerhouse')) return '';
  if (!viewer || !viewer.userId || viewer.userId !== supplier.claimed_by) return '';
  // Stage 5 will populate real numbers. For now we render the panel with
  // zeros and a note — the conditional rendering on owner identity is
  // what's important to validate at this stage.
  return `
    <section class="section profile-owner-analytics">
      <div class="container">
        <h2>Your profile, this month</h2>
        <p class="lede">Visible only to you as the owner of this listing.</p>
        <div class="grid-3">
          <div class="card"><h3>0</h3><p>Profile views</p></div>
          <div class="card"><h3>0</h3><p>Profile clicks</p></div>
          <div class="card"><h3>0</h3><p>Leads received</p></div>
        </div>
        <p style="font-size:13.5px;color:var(--ink-3);">Live numbers ship in the lead-routing rollout.</p>
      </div>
    </section>`;
}

function renderSiblings(siblings, currentSlug, currentCategory) {
  const siblings4 = siblings.filter(s => s.slug !== currentSlug).slice(0, 6);
  if (!siblings4.length) return '';
  const cat = currentCategory ? getCategoryLabel(currentCategory) : 'Calgary';
  const items = siblings4.map(s => `
          <a class="sibling-card" href="/calgary/suppliers/${encodeURIComponent(s.slug)}" data-cta="profile-sibling" data-supplier-slug="${escapeAttr(s.slug)}">
            <span class="sibling-card__name">${escapeHtml(s.site_name)} ${tierBadge(s.tier)}</span>
            <span class="sibling-card__arrow">→</span>
          </a>`).join('');
  return `
    <section class="section profile-siblings">
      <div class="container">
        <h2>Other ${escapeHtml(cat)} in Calgary</h2>
        <div class="sibling-grid">${items}
        </div>
      </div>
    </section>`;
}

// Pick siblings: tier-prioritized first (Enterprise → Powerhouse → Pro →
// Free), then deterministic-by-date within tier so each siblings list
// rotates daily but stably within the day. Mirrors the directory page sort.
function pickSiblings(allInCategory, currentSlug, today = new Date()) {
  const sorted = sortSuppliers(allInCategory, today);
  return sorted.filter(s => s.slug !== currentSlug);
}

function renderProfileBody(supplier, siblings, viewer) {
  const cat = getCategory(supplier.category);
  const catLabel = cat ? cat.label : (supplier.category || '—');
  const catSlug  = cat ? cat.slug  : '';
  const serviceArea = parseList(supplier.service_area);
  const services = parseList(supplier.services);

  // Phone visibility: Pro+ always shows; Free gated on public_phone.
  const showPhone = isPaid(supplier) || !!supplier.public_phone;
  const showAddress = !!supplier.public_address; // applies all tiers

  // Outbound website: Pro+ only.
  const websiteHtml = (tierAtLeast(supplier.tier, 'pro') && supplier.website_url)
    ? renderOutboundLink(supplier.website_url, supplier.website_url.replace(/^https?:\/\/(www\.)?/, ''), {
        cta: 'profile-website',
        'supplier-slug': supplier.slug,
        'supplier-tier': supplier.tier
      })
    : '';

  const description = (tierAtLeast(supplier.tier, 'pro') && supplier.description)
    ? `<p class="lede profile-desc">${escapeHtml(supplier.description.slice(0, 250))}</p>`
    : '';

  const logoHtml = (tierAtLeast(supplier.tier, 'pro') && supplier.logo_url)
    ? `<div class="profile-logo"><img src="${escapeAttr(supplier.logo_url)}" alt="${escapeAttr(supplier.site_name)} logo"></div>`
    : '';

  const phoneHtml = showPhone && supplier.contact_phone
    ? `<div class="profile-fact"><span class="profile-fact__label">Phone</span> <a href="tel:${escapeAttr(supplier.contact_phone)}" data-cta="profile-phone" data-supplier-slug="${escapeAttr(supplier.slug)}" data-supplier-tier="${escapeAttr(supplier.tier)}">${escapeHtml(supplier.contact_phone)}</a></div>`
    : '';

  const addressHtml = showAddress && supplier.address
    ? `<div class="profile-fact"><span class="profile-fact__label">Address</span> ${escapeHtml(supplier.address)}</div>`
    : '';

  const serviceAreaHtml = serviceArea.length
    ? `<div class="profile-fact"><span class="profile-fact__label">Service area</span> ${escapeHtml(serviceArea.join(', '))}</div>`
    : '';

  const servicesHtml = services.length
    ? `<div class="profile-fact profile-tags"><span class="profile-fact__label">Materials &amp; services</span>
         <span class="tag-row">${services.map(s => `<span class="tag">${escapeHtml(s)}</span>`).join(' ')}</span>
       </div>`
    : '';

  const websiteFact = websiteHtml
    ? `<div class="profile-fact"><span class="profile-fact__label">Website</span> ${websiteHtml}</div>`
    : '';

  const hoursHtml = tierAtLeast(supplier.tier, 'pro') && supplier.business_hours
    ? `<section class="section">
         <div class="container">
           <h2>Business hours</h2>
           ${renderHoursTable(supplier.business_hours, supplier)}
         </div>
       </section>`
    : '';

  const galleryHtml = renderPhotoGallery(supplier.photos, supplier);
  const leadFormHtml = renderLeadForm(supplier);
  const ownerAnalyticsHtml = renderOwnerAnalytics(supplier, viewer);
  const siblingsHtml = renderSiblings(siblings || [], supplier.slug, supplier.category);

  return `
  <div class="container">
    <nav class="breadcrumbs" aria-label="Breadcrumb">
      <a href="/">Home</a><span class="sep">/</span><a href="/calgary">Calgary</a><span class="sep">/</span><a href="/calgary/suppliers">Suppliers</a><span class="sep">/</span><a href="/calgary/suppliers#${escapeAttr(catSlug)}">${escapeHtml(catLabel)}</a><span class="sep">/</span><span aria-current="page">${escapeHtml(supplier.site_name)}</span>
    </nav>

    <header class="profile-header">
      ${logoHtml}
      <div class="profile-header__body">
        <div class="eyebrow">Calgary · <a href="/calgary/suppliers#${escapeAttr(catSlug)}">${escapeHtml(catLabel)}</a></div>
        <h1>${escapeHtml(supplier.site_name)}</h1>
        <div class="profile-badges">
          ${premierBadge(supplier)}
          ${tierBadge(supplier.tier)}
          ${featuredBadge(supplier)}
          ${verifiedBadge(supplier)}
        </div>
        ${sponsoredCallout(supplier)}
        ${description}
      </div>
    </header>
  </div>

  <section class="section">
    <div class="container">
      <div class="profile-facts">
        ${serviceAreaHtml}
        ${servicesHtml}
        ${addressHtml}
        ${phoneHtml}
        ${websiteFact}
      </div>
      <div class="profile-cta-row">
        ${tierAtLeast(supplier.tier, 'powerhouse') ? `<a class="btn btn-primary" href="#contact" data-cta="profile-jump-contact" data-supplier-slug="${escapeAttr(supplier.slug)}">Request a quote</a>` : ''}
        <a class="btn btn-secondary" href="/app?supplier=${encodeURIComponent(supplier.slug)}" data-cta="profile-view-on-map" data-supplier-slug="${escapeAttr(supplier.slug)}">View on map</a>
        ${renderClaimCta(supplier, viewer)}
      </div>
    </div>
  </section>

  ${hoursHtml}
  ${galleryHtml}

  <section class="section">
    <div class="container">
      <h2>Location</h2>
      <div id="profile-map"
           class="profile-map"
           role="region"
           data-lat="${escapeAttr(supplier.latitude)}"
           data-lng="${escapeAttr(supplier.longitude)}"
           data-name="${escapeAttr(supplier.site_name)}"
           aria-label="Map showing ${escapeAttr(supplier.site_name)} location">
        <noscript>
          Map of ${escapeHtml(supplier.site_name)}: ${escapeHtml(supplier.address || '')}
        </noscript>
      </div>
    </div>
  </section>

  ${leadFormHtml}
  ${ownerAnalyticsHtml}
  ${siblingsHtml}
`;
}

function renderProfileSchemas(supplier) {
  const cat = getCategory(supplier.category);
  const catLabel = cat ? cat.label : '';
  const showPhone = isPaid(supplier) || !!supplier.public_phone;
  const showAddress = !!supplier.public_address;

  const localBusiness = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: supplier.site_name,
    url: `https://dirtlink.ca/calgary/suppliers/${supplier.slug}`,
    description: tierAtLeast(supplier.tier, 'pro') && supplier.description ? supplier.description.slice(0, 250) : undefined,
    telephone: showPhone && supplier.contact_phone ? supplier.contact_phone : undefined,
    address: showAddress && supplier.address ? {
      '@type': 'PostalAddress',
      streetAddress: supplier.address,
      addressLocality: 'Calgary',
      addressRegion: 'AB',
      addressCountry: 'CA'
    } : undefined,
    areaServed: parseList(supplier.service_area),
    makesOffer: parseList(supplier.services).map(s => ({ '@type': 'Offer', name: s })),
    image: tierAtLeast(supplier.tier, 'pro') && supplier.logo_url ? supplier.logo_url : undefined,
    geo: { '@type': 'GeoCoordinates', latitude: supplier.latitude, longitude: supplier.longitude },
    sameAs: tierAtLeast(supplier.tier, 'pro') && supplier.website_url ? [supplier.website_url] : undefined
  };
  // Strip undefined keys for cleaner JSON-LD output
  Object.keys(localBusiness).forEach(k => localBusiness[k] === undefined && delete localBusiness[k]);

  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home',     item: 'https://dirtlink.ca/' },
      { '@type': 'ListItem', position: 2, name: 'Calgary',  item: 'https://dirtlink.ca/calgary' },
      { '@type': 'ListItem', position: 3, name: 'Suppliers', item: 'https://dirtlink.ca/calgary/suppliers' },
      ...(catLabel ? [{ '@type': 'ListItem', position: 4, name: catLabel, item: `https://dirtlink.ca/calgary/suppliers#${supplier.category}` }] : []),
      { '@type': 'ListItem', position: catLabel ? 5 : 4, name: supplier.site_name, item: `https://dirtlink.ca/calgary/suppliers/${supplier.slug}` }
    ]
  };

  const place = {
    '@context': 'https://schema.org',
    '@type': 'Place',
    name: supplier.site_name,
    geo: { '@type': 'GeoCoordinates', latitude: supplier.latitude, longitude: supplier.longitude }
  };

  return {
    localBusiness: JSON.stringify(localBusiness),
    breadcrumb: JSON.stringify(breadcrumb),
    place: JSON.stringify(place)
  };
}

module.exports = {
  renderProfileBody,
  renderProfileSchemas,
  renderOutboundLink,
  pickSiblings,
  isPaid,
  tierAtLeast,
  TIER_RANK
};
