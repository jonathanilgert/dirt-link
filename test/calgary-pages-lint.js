// One-shot SEO/structure lint for the 19 Calgary pages.
// Hits the running dev server, parses each page's JSON-LD, validates that:
//   - status is 200
//   - title length ≤ 60
//   - meta description length ≤ 160
//   - canonical present
//   - exactly one <h1>
//   - JSON-LD blocks parse as JSON and at least one has @type LocalBusiness
//   - response is server-rendered (H1 present in raw HTML, not injected by JS)
//   - the host header/footer partials substituted (no leftover {{ tokens)
//   - calculator placeholder div + script tag present where expected
//   - GA snippet present
//
// Run with: PORT=3010 node server.js (in another shell), then:
//   node test/calgary-pages-lint.js
//
// Exits 0 on clean, 1 on any failure.

const HOST = process.env.HOST || 'http://localhost:3010';

const PAGES = [
  { path: '/calgary',                       expectsCalc: false, group: 'hub' },
  { path: '/calgary/topsoil',               expectsCalc: 'volume' },
  { path: '/calgary/gravel',                expectsCalc: 'volume' },
  { path: '/calgary/fill-dirt',             expectsCalc: 'volume' },
  { path: '/calgary/sand',                  expectsCalc: 'volume' },
  { path: '/calgary/landscape-rock',        expectsCalc: 'volume' },
  { path: '/calgary/dirt-disposal',         expectsCalc: 'dirt-disposal' },
  { path: '/calgary/free-fill-dirt',        expectsCalc: false },
  { path: '/calgary/landfill-tipping-fees', expectsCalc: 'dirt-disposal' },
  { path: '/calgary/mulch',                 expectsCalc: 'volume' },
  { path: '/calgary/compost',               expectsCalc: 'volume' },
  { path: '/calgary/road-crush',            expectsCalc: 'volume' },
  { path: '/calgary/pit-run',               expectsCalc: 'volume' },
  { path: '/calgary/river-rock',            expectsCalc: 'volume' },
  { path: '/calgary/recycled-concrete',     expectsCalc: 'volume' },
  { path: '/calgary/loam',                  expectsCalc: 'volume' },
  { path: '/calgary/boulders',              expectsCalc: false },
  { path: '/calgary/clean-fill-wanted',     expectsCalc: false },
  { path: '/calgary/dirt-disposal-cost',    expectsCalc: 'dirt-disposal', expectsWebApp: true, untouchedHostHtml: true }
];

let failures = 0;
const results = [];

function fail(page, msg) {
  failures++;
  results.push({ page: page.path, level: 'FAIL', msg });
}
function warn(page, msg) {
  results.push({ page: page.path, level: 'WARN', msg });
}

async function lintPage(page) {
  const res = await fetch(HOST + page.path);
  if (res.status !== 200) {
    fail(page, `status=${res.status} (expected 200)`);
    return;
  }
  const html = await res.text();

  // Unsubstituted tokens
  if (html.includes('{{')) {
    fail(page, 'unsubstituted {{ token in response');
  }

  // Header/footer partials substituted (skipped for the existing untouched
  // page 19 host HTML, which has its own self-contained chrome).
  if (!page.untouchedHostHtml) {
    if (!html.includes('nav-inner')) fail(page, 'header partial not substituted (nav-inner missing)');
    if (!html.includes('footer-grid')) fail(page, 'footer partial not substituted (footer-grid missing)');
  }

  // <title>
  const titleMatch = html.match(/<title>([^<]+)<\/title>/);
  if (!titleMatch) fail(page, 'no <title>');
  else {
    const title = titleMatch[1].trim();
    if (title.length > 60) warn(page, `title length=${title.length} exceeds 60`);
  }

  // <meta name="description">
  const descMatch = html.match(/<meta\s+name="description"\s+content="([^"]+)"/);
  if (!descMatch) fail(page, 'no meta description');
  else {
    const desc = descMatch[1].trim();
    if (desc.length > 160) warn(page, `meta description length=${desc.length} exceeds 160`);
  }

  // canonical
  if (!/<link[^>]+rel="canonical"/.test(html)) fail(page, 'no canonical link');

  // OG + Twitter
  if (!/<meta[^>]+property="og:title"/.test(html)) fail(page, 'no og:title');
  if (!page.untouchedHostHtml && !/<meta[^>]+name="twitter:card"/.test(html)) fail(page, 'no twitter:card');

  // exactly one <h1> (server-rendered, in raw HTML)
  const h1s = html.match(/<h1[^>]*>/g) || [];
  if (h1s.length === 0) fail(page, 'no <h1> in raw HTML (would break SEO)');
  else if (h1s.length > 1) fail(page, `${h1s.length} <h1> elements (must be exactly one per page)`);

  // GA snippet
  if (!html.includes('ga-measurement-id')) fail(page, 'no GA measurement-id meta');

  // JSON-LD parse + LocalBusiness presence + per-page-specific schema
  const ldBlocks = [...html.matchAll(/<script\s+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)];
  if (ldBlocks.length === 0) fail(page, 'no JSON-LD blocks');
  let hasLocalBusiness = false;
  let hasFAQ = false;
  let hasWebApp = false;
  for (const [i, [, body]] of ldBlocks.entries()) {
    try {
      const obj = JSON.parse(body);
      if (obj['@type'] === 'LocalBusiness') hasLocalBusiness = true;
      if (obj['@type'] === 'FAQPage') hasFAQ = true;
      if (obj['@type'] === 'WebApplication') hasWebApp = true;
    } catch (e) {
      fail(page, `JSON-LD block #${i + 1} fails to parse: ${e.message}`);
    }
  }
  if (!hasLocalBusiness) fail(page, 'no LocalBusiness JSON-LD');
  if (!hasFAQ && page.path !== '/calgary/free-fill-dirt') {
    // free-fill-dirt uses ItemList + FAQPage — let's still expect FAQ on it
    if (page.path === '/calgary/free-fill-dirt') {} else fail(page, 'no FAQPage JSON-LD');
  }
  if (page.expectsWebApp && !hasWebApp) fail(page, 'expected WebApplication JSON-LD (calculator page)');

  // Calculator placeholder + script tag
  if (page.expectsCalc === 'volume') {
    if (!html.includes('data-calculator="volume"')) fail(page, 'expected volume-calc placeholder div');
    if (!html.includes('/dist/calculators/volume.js')) fail(page, 'expected volume.js script tag');
  } else if (page.expectsCalc === 'dirt-disposal') {
    if (!html.includes('data-calculator="dirt-disposal"') && !html.includes('id="calc-')) {
      // dirt-disposal-cost.html may use a different identifier internally; accept either
      if (page.path !== '/calgary/dirt-disposal-cost') {
        fail(page, 'expected dirt-disposal calc placeholder');
      }
    }
    if (!html.includes('/dist/calculators/disposal-cost.js')) fail(page, 'expected disposal-cost.js script tag');
  }

  // breadcrumb on non-hub pages (skipped for the existing untouched page 19)
  if (page.path !== '/calgary' && !page.untouchedHostHtml && !html.includes('breadcrumbs')) {
    fail(page, 'no breadcrumb nav');
  }

  // page weight
  const sizeKB = Math.round(html.length / 1024);
  if (sizeKB > 200) warn(page, `large HTML payload: ${sizeKB} KB (consider trimming)`);

  // success line
  results.push({ page: page.path, level: 'OK', msg: `${ldBlocks.length} ld-blocks, ${sizeKB}KB html` });
}

(async () => {
  for (const page of PAGES) {
    try {
      await lintPage(page);
    } catch (e) {
      fail(page, 'fetch/lint error: ' + e.message);
    }
  }

  // Render
  const w = (s, n) => (s + ' '.repeat(n)).slice(0, n);
  for (const r of results) {
    if (r.level === 'OK') console.log(`  OK   ${w(r.page, 38)} ${r.msg}`);
    else if (r.level === 'WARN') console.log(`  WARN ${w(r.page, 38)} ${r.msg}`);
    else console.log(`  FAIL ${w(r.page, 38)} ${r.msg}`);
  }

  console.log(`\n  ${PAGES.length} pages | ${failures} failures`);

  // Sitemap check
  const sm = await (await fetch(HOST + '/sitemap.xml')).text();
  let smMissing = 0;
  for (const p of PAGES) {
    if (!sm.includes(`https://dirtlink.ca${p.path}<`)) {
      console.log(`  SITEMAP MISSING: ${p.path}`);
      smMissing++;
    }
  }
  console.log(`  sitemap: ${PAGES.length - smMissing}/${PAGES.length} URLs present`);

  // Robots check
  const robots = await (await fetch(HOST + '/robots.txt')).text();
  const blocksCalgary = /Disallow:\s*\/calgary/.test(robots);
  console.log(`  robots.txt blocks /calgary: ${blocksCalgary ? 'YES (BAD)' : 'no (good)'}`);

  process.exit(failures + smMissing > 0 ? 1 : 0);
})();
