// Pure rendering helpers for /calgary/suppliers and (Stage 3) profile pages.
// All functions in this module take data and return HTML strings — no DB,
// no req/res. The server route in server.js handles I/O and template
// substitution.
//
// SEO note on outbound supplier-website links: every <a> rendered to an
// external supplier URL must use rel="nofollow noopener" target="_blank".
// Selling dofollow links violates Google's link-spam policy and would
// risk dirtlink.ca's organic rankings; noopener prevents
// window.opener exploitation. The renderOutboundLink() helper enforces
// this — do not bypass it when adding new link sites.

const crypto = require('crypto');
const { CATEGORIES } = require('./directory-categories');

const TIER_RANK = { enterprise: 0, powerhouse: 1, pro: 2, free: 3 };
const TIER_LABEL = { pro: 'Pro', powerhouse: 'Powerhouse', enterprise: 'Premier' };

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(s) {
  return escapeHtml(s);
}

function truncate(s, n) {
  if (!s) return '';
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trimEnd() + '…';
}

// Daily-rotation tiebreaker for Powerhouse listings — same set of suppliers
// surfaces in a different order every day so each gets a turn at the top.
function dailyRotationKey(slug, dateStr) {
  return crypto.createHash('sha1').update(`${dateStr}|${slug}`).digest('hex');
}

function sortSuppliers(suppliers, today = new Date()) {
  const dateStr = today.toISOString().slice(0, 10);
  return [...suppliers].sort((a, b) => {
    const ar = TIER_RANK[a.tier] ?? 9;
    const br = TIER_RANK[b.tier] ?? 9;
    if (ar !== br) return ar - br;
    if (a.tier === 'powerhouse' && b.tier === 'powerhouse') {
      return dailyRotationKey(a.slug || a.id, dateStr)
        .localeCompare(dailyRotationKey(b.slug || b.id, dateStr));
    }
    // pro / free / enterprise → alphabetical
    return (a.site_name || '').localeCompare(b.site_name || '');
  });
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

function profileUrl(supplier) {
  return `/calgary/suppliers/${encodeURIComponent(supplier.slug)}`;
}

function mapUrl(supplier) {
  return `/app?supplier=${encodeURIComponent(supplier.slug)}`;
}

function renderSupplierCard(supplier) {
  const isPaid = supplier.tier && supplier.tier !== 'free';
  const cardClass = `supplier-card supplier-card--${escapeAttr(supplier.tier || 'free')}`;
  const serviceArea = parseList(supplier.service_area).join(', ');

  let descPreview = '';
  if (isPaid && supplier.description) {
    descPreview = `<p class="supplier-card__desc">${escapeHtml(truncate(supplier.description, 80))}</p>`;
  }

  let logo = '';
  if (isPaid && supplier.logo_url) {
    logo = `<div class="supplier-card__logo"><img src="${escapeAttr(supplier.logo_url)}" alt="" loading="lazy"></div>`;
  }

  return `
        <article class="${cardClass}" data-supplier-tier="${escapeAttr(supplier.tier || 'free')}">
          ${logo}
          <div class="supplier-card__body">
            <h3 class="supplier-card__name"><a href="${escapeAttr(profileUrl(supplier))}">${escapeHtml(supplier.site_name)}</a> ${tierBadge(supplier.tier)} ${verifiedBadge(supplier)}</h3>
            <div class="supplier-card__meta">
              ${serviceArea ? `<span class="supplier-card__area">${escapeHtml(serviceArea)}</span>` : ''}
            </div>
            ${descPreview}
            <div class="supplier-card__actions">
              <a class="supplier-card__cta" href="${escapeAttr(profileUrl(supplier))}" data-cta="directory-supplier" data-supplier-slug="${escapeAttr(supplier.slug)}" data-supplier-tier="${escapeAttr(supplier.tier || 'free')}" data-category="${escapeAttr(supplier.category || '')}">View profile →</a>
              <a class="supplier-card__cta supplier-card__cta--ghost" href="${escapeAttr(mapUrl(supplier))}" data-cta="directory-view-on-map" data-supplier-slug="${escapeAttr(supplier.slug)}">View on map →</a>
            </div>
          </div>
        </article>`;
}

function renderEmptyCategoryCard(category) {
  const subject = encodeURIComponent(`Suggest supplier: ${category.label}`);
  return `
        <div class="supplier-card supplier-card--empty">
          <p>Coming soon — know a Calgary <strong>${escapeHtml(category.label.toLowerCase())}</strong>?
          <a href="mailto:support@dirtlink.ca?subject=${subject}">Suggest an addition →</a></p>
        </div>`;
}

function renderCategorySection(category, suppliers) {
  const list = sortSuppliers(suppliers);
  const cards = list.length
    ? list.map(renderSupplierCard).join('')
    : renderEmptyCategoryCard(category);
  return `
    <section class="directory-section" id="${escapeAttr(category.slug)}">
      <div class="container">
        <div class="directory-section__head">
          <h2>${escapeHtml(category.label)}</h2>
          <p class="lede">${escapeHtml(category.leadIn)}</p>
        </div>
        <div class="supplier-grid">
          ${cards}
        </div>
      </div>
    </section>`;
}

function renderJumpNav() {
  const items = CATEGORIES.map(c => `
        <a href="#${escapeAttr(c.slug)}" data-cta="directory-jumpnav" data-category="${escapeAttr(c.slug)}">${escapeHtml(c.label)}</a>`).join('');
  const options = CATEGORIES.map(c => `<option value="#${escapeAttr(c.slug)}">${escapeHtml(c.label)}</option>`).join('');
  return `
    <nav class="directory-jumpnav" aria-label="Jump to category">
      <div class="container">
        <div class="directory-jumpnav__inner">${items}
        </div>
        <label class="directory-jumpnav__select-wrap">
          <span class="visually-hidden">Jump to category</span>
          <select class="directory-jumpnav__select" aria-label="Jump to category">
            <option value="">Jump to category…</option>${options}
          </select>
        </label>
      </div>
    </nav>`;
}

const DIRECTORY_FAQ = [
  ["How does this directory work?",
   "Live listings of Calgary-area dirt suppliers, contractors, and trades. All entries are free. Suppliers can claim and edit their own listing."],
  ["How do I get added?",
   "Email support@dirtlink.ca with your business name, category, service area, and contact info. Listings are reviewed and added within 2 business days."],
  ["How do I claim a listing that's already here?",
   "Click \"Claim this listing\" on any profile page. We verify ownership via business email or phone. Free to claim."],
  ["What do paid plans add to my listing?",
   "Pro adds your website link, photos, custom description, and business hours. Powerhouse adds featured placement and lead notifications. Enterprise adds sponsored category slots and first look at buyer leads in your service area."],
  ["How current is the data?",
   "Listings are reviewed quarterly. Claimed listings can be updated by the owner anytime."],
  ["Why is some contact info missing?",
   "We only display contact info that the business has explicitly approved for public listing."]
];

function renderFAQHtml() {
  const items = DIRECTORY_FAQ.map(([q, a]) => `
        <details class="faq-item"><summary>${escapeHtml(q)}</summary><div class="faq-body">${escapeHtml(a)}</div></details>`).join('');
  return `
    <section class="section">
      <div class="container">
        <h2>Frequently asked questions</h2>
        <div class="faq-list">${items}
        </div>
      </div>
    </section>`;
}

function renderFAQSchema() {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: DIRECTORY_FAQ.map(([q, a]) => ({
      '@type': 'Question',
      name: q,
      acceptedAnswer: { '@type': 'Answer', text: a }
    }))
  });
}

function renderItemListSchema(suppliers) {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Calgary Dirt Suppliers, Earthworks Contractors & Trades',
    numberOfItems: suppliers.length,
    itemListElement: suppliers.map((s, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: `https://dirtlink.ca${profileUrl(s)}`,
      name: s.site_name
    }))
  });
}

function renderBreadcrumbSchema() {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home',     item: 'https://dirtlink.ca/' },
      { '@type': 'ListItem', position: 2, name: 'Calgary',  item: 'https://dirtlink.ca/calgary' },
      { '@type': 'ListItem', position: 3, name: 'Suppliers', item: 'https://dirtlink.ca/calgary/suppliers' }
    ]
  });
}

function parseList(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter(Boolean);
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter(Boolean);
  } catch {}
  return String(raw).split(/[,;]/).map(s => s.trim()).filter(Boolean);
}

// Build the full directory body HTML, given a flat list of supplier rows
// (each with `category`, `tier`, `slug`, etc. resolved).
function renderDirectoryBody(suppliers) {
  const byCat = new Map(CATEGORIES.map(c => [c.slug, []]));
  for (const s of suppliers) {
    const cat = s.category && byCat.has(s.category) ? s.category : null;
    if (cat) byCat.get(cat).push(s);
  }
  const sections = CATEGORIES.map(c => renderCategorySection(c, byCat.get(c.slug))).join('');
  return renderJumpNav() + sections + renderFAQHtml();
}

module.exports = {
  renderDirectoryBody,
  renderFAQSchema,
  renderItemListSchema,
  renderBreadcrumbSchema,
  // Exported for testing / Stage 3 reuse:
  renderSupplierCard,
  sortSuppliers,
  parseList,
  escapeHtml,
  escapeAttr,
  truncate,
  TIER_RANK,
  TIER_LABEL
};
