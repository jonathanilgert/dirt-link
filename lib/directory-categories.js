// Canonical category taxonomy for the Calgary suppliers directory.
// Order here is the rendering order on /calgary/suppliers and on profile-page
// breadcrumbs. Slugs are stable and used as anchor IDs (#aggregate-pits) plus
// the `category` value persisted to permanent_pins.category — do not rename.
//
// The leadIn copy is shown directly under each category h2 on the directory.
// Voice notes: direct, practical, contractor-friendly. Not aspirational.

const CATEGORIES = [
  {
    slug: 'aggregate-pits',
    label: 'Aggregate & Gravel Pits',
    leadIn: "Pits and quarries running aggregate, sand, road crush, and pit-run for Calgary builds. Tandem and triaxle pickup; some yards deliver."
  },
  {
    slug: 'topsoil-yards',
    label: 'Topsoil & Soil Yards',
    leadIn: "Yards supplying screened topsoil, lawn blends, and garden soil — most stocked April through October, some year-round."
  },
  {
    slug: 'landscape-supply',
    label: 'Landscape Supply Yards',
    leadIn: "Decorative rock, mulch, compost, slabs, and finishing materials for residential and commercial landscape work."
  },
  {
    slug: 'excavation-contractors',
    label: 'Excavation & Earthworks Contractors',
    leadIn: "Earthworks crews for residential digs, commercial site prep, basement excavations, and hauling-included projects."
  },
  {
    slug: 'hauling-trucking',
    label: 'Hauling & Trucking',
    leadIn: "Tandem, triaxle, end-dump, and truck-and-pup operators moving dirt, fill, and aggregate around Calgary and the surrounding markets."
  },
  {
    slug: 'demolition',
    label: 'Demolition Contractors',
    leadIn: "Residential and commercial demolition contractors — interior, structural, and full teardowns. Many also handle disposal and site cleanup."
  },
  {
    slug: 'concrete-recyclers',
    label: 'Concrete & Asphalt Recyclers',
    leadIn: "Sites that accept concrete and asphalt for recycling, and yards selling back recycled aggregate as road crush or fill substrate."
  },
  {
    slug: 'soil-testing',
    label: 'Soil Testing & Environmental Labs',
    leadIn: "Geotechnical and environmental labs offering soil sampling, contamination screening, and load classification for Calgary sites."
  },
  {
    slug: 'equipment-rental',
    label: 'Equipment Rental',
    leadIn: "Loaders, mini excavators, compactors, and skid-steers for self-perform work — by-the-day or longer."
  },
  {
    slug: 'sod-farms',
    label: 'Sod Farms & Turf Suppliers',
    leadIn: "Sod farms and turf suppliers serving Calgary, Airdrie, and surrounding markets through the spring-to-fall installation window."
  }
];

const BY_SLUG = Object.fromEntries(CATEGORIES.map(c => [c.slug, c]));

// Slugs that must NEVER be assigned to a supplier (would collide with route
// prefixes or be confusing). When ingesting / claiming, if a generated slug
// lands here, append a numeric suffix.
const RESERVED_SLUGS = new Set([
  'v',         // /calgary/suppliers/v/:vanityUrl prefix
  'api', 'admin', 'app', 'legal', 'calgary', 'data', 'uploads',
  'unsubscribe', 'login', 'logout', 'signup', 'register',
  'index', 'sitemap', 'robots',
  'claim', 'upgrade', 'billing', 'profile'
]);

function isReservedSlug(s) {
  return RESERVED_SLUGS.has(String(s || '').toLowerCase());
}

function getCategory(slug) {
  return BY_SLUG[slug] || null;
}

function getCategoryLabel(slug) {
  return BY_SLUG[slug]?.label || slug;
}

// Lowercase-hyphenate; strip non-alphanumerics. Used to derive a slug from a
// business name when generating profile URLs.
function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

module.exports = { CATEGORIES, getCategory, getCategoryLabel, slugify, RESERVED_SLUGS, isReservedSlug };
