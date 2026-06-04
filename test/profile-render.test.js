const test = require('node:test');
const assert = require('node:assert/strict');

const { renderProfileBody, renderProfileSchemas } = require('../lib/profile-render');

function supplier(overrides = {}) {
  return {
    slug: 'koomen-contracting-ltd',
    site_name: 'Koomen Contracting Ltd.',
    category: 'excavation-contractors',
    tier: 'free',
    directory_listing: 1,
    public_phone: 1,
    public_address: 1,
    contact_phone: '587-333-3200',
    address: 'Calgary, Airdrie, Cochrane, Okotoks, Chestermere, High River, S. Alberta',
    website_url: 'https://koomencontracting.ca',
    description: 'Residential, commercial and acreage excavation: site prep, grading, trenching, demolition, concrete crushing.',
    service_area: JSON.stringify(['Calgary', 'Airdrie', 'Cochrane', 'Okotoks', 'Chestermere', 'High River', 'S. Alberta']),
    services: JSON.stringify(['Excavation & Earthworks Contractors']),
    latitude: 51.0447,
    longitude: -114.0719,
    claimed_by: null,
    ...overrides
  };
}

test('free outreach directory profiles render supplied contact fields, website, and description', () => {
  const html = renderProfileBody(supplier(), [], null);

  assert.match(html, /Residential, commercial and acreage excavation/);
  assert.match(html, /<span class="profile-fact__label">Address<\/span> Calgary, Airdrie/);
  assert.match(html, /<span class="profile-fact__label">Phone<\/span> <a href="tel:587-333-3200"/);
  assert.match(html, /<span class="profile-fact__label">Website<\/span> <a href="https:\/\/koomencontracting\.ca" rel="nofollow noopener" target="_blank"/);
});

test('free non-directory profiles still do not expose paid-only website and description', () => {
  const html = renderProfileBody(supplier({ directory_listing: 0, public_phone: 0, public_address: 0 }), [], null);

  assert.doesNotMatch(html, /Residential, commercial and acreage excavation/);
  assert.doesNotMatch(html, /koomencontracting\.ca/);
  assert.doesNotMatch(html, /587-333-3200/);
  assert.doesNotMatch(html, /<span class="profile-fact__label">Address<\/span>/);
});

test('directory profile schema includes outreach description, phone, address, and sameAs', () => {
  const schemas = renderProfileSchemas(supplier());
  const localBusiness = JSON.parse(schemas.localBusiness);

  assert.equal(localBusiness.description, 'Residential, commercial and acreage excavation: site prep, grading, trenching, demolition, concrete crushing.');
  assert.equal(localBusiness.telephone, '587-333-3200');
  assert.deepEqual(localBusiness.sameAs, ['https://koomencontracting.ca']);
  assert.equal(localBusiness.address.streetAddress, 'Calgary, Airdrie, Cochrane, Okotoks, Chestermere, High River, S. Alberta');
});

test('directory profile schema JSON-LD neutralizes script delimiters in supplied descriptions', () => {
  const schemas = renderProfileSchemas(supplier({
    description: 'Supplier text </script><script>alert(1)</script> still describes the listing.'
  }));

  assert.doesNotMatch(schemas.localBusiness, /<\/script>/i);
  assert.match(schemas.localBusiness, /\\u003c\/script\\u003e/);

  const localBusiness = JSON.parse(schemas.localBusiness);
  assert.equal(localBusiness.description, 'Supplier text </script><script>alert(1)</script> still describes the listing.');
});
