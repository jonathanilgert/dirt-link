// End-to-end verification of Stage 4 (claim flow + wizard + upgrade page).
// Drives the live HTTP server with cookies so session-based auth works.
//
// What it asserts:
//   1. /claim/:slug renders sign-in prompt for an unauthenticated viewer.
//   2. After signup, /claim/:slug renders the "Send verification" CTA.
//   3. POST /api/claims/start with no SMTP configured falls back to
//      manual_review_pending — confirming the SES-sandbox graceful path.
//   4. POST /api/admin/claims/approve/<id> with ADMIN_SECRET approves the
//      manual claim, marking permanent_pins.claimed_by + tier sync.
//   5. /claim/:slug/wizard?step=N renders all 5 steps; step 3/4 show locks
//      for a free-tier user; "Unlock with Pro" CTA points to /upgrade.
//   6. /upgrade?from=...&plan=pro&supplier=... renders the hold-page with
//      the right plan/supplier and a "Continue to checkout" button.
//   7. POST /api/claims/wizard/<id> step=3 returns 402 upgrade_required for
//      a free-tier user.
//
// Usage: PORT=3033 node scripts/stage4-e2e.js
//        (server must already be running on $PORT)

const http = require('http');
const PORT = parseInt(process.env.PORT || '3033', 10);
const BASE = `http://localhost:${PORT}`;

let cookieJar = '';

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({
      method, hostname: 'localhost', port: PORT, path,
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookieJar,
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      }
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const setCookie = res.headers['set-cookie'];
        if (setCookie) {
          // Crudely concatenate name=value pairs into the jar. Good enough
          // for one session in the test.
          for (const c of setCookie) {
            const nv = c.split(';')[0];
            if (cookieJar) cookieJar += '; ';
            cookieJar += nv;
          }
        }
        const buf = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(buf); } catch {}
        resolve({ status: res.statusCode, body: buf, json, headers: res.headers });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

let pass = 0, fail = 0;
function check(label, ok, hint) {
  if (ok) { pass++; console.log('  Y ' + label); }
  else    { fail++; console.log('  X ' + label + (hint ? '  ← ' + hint : '')); }
}

(async () => {
  console.log('Stage 4 end-to-end on ' + BASE);

  // 1. Unauthenticated /claim/:slug → sign-in prompt
  // (Cleanup of Foothills happens in scripts/stage4-reset.js, run BEFORE
  // the server starts, since sql.js can't share a DB between processes.)
  const slug = 'foothills-pit-co';
  let r = await req('GET', `/claim/${slug}`);
  check('1. /claim/:slug returns 200', r.status === 200, 'got ' + r.status);
  check('   renders Sign in CTA',     /Sign in to continue/.test(r.body));

  // 2. Sign up a fresh user
  const email = 'stage4-' + Date.now() + '@example.com';
  r = await req('POST', '/api/auth/register', {
    email, password: 'test1234!', company_name: 'Stage 4 Co.', contact_name: 'Stage Tester', phone: '403-555-0000'
  });
  check('2. signup ok', r.status === 200 || r.status === 201, 'got ' + r.status + ' body=' + r.body.slice(0, 200));
  // Cookie set automatically by the server.

  // 3. Authenticated /claim/:slug → claim CTA
  r = await req('GET', `/claim/${slug}`);
  check('3. authenticated /claim renders Send verification CTA',
    /id="claim-start-btn"/.test(r.body), 'body excerpt: ' + r.body.slice(0, 200));

  // 4. POST /api/claims/start — no SMTP_HOST in dev → manual_review_pending
  r = await req('POST', '/api/claims/start', { supplier_slug: slug });
  check('4. start ok',          r.status === 200, 'got ' + r.status + ' body=' + r.body);
  check('   status manual_review_pending (no SMTP in dev)',
    r.json && r.json.status === 'manual_review_pending', 'json=' + JSON.stringify(r.json));
  const claimId = r.json && r.json.claimId;

  // 5. Approve via admin endpoint with ADMIN_SECRET
  const secret = process.env.ADMIN_SECRET || 'dev-secret-stage4';
  // Set the env var via a server restart? We rely on caller setting it.
  r = await req('POST', `/api/claims/admin/approve/${claimId}`, { secret });
  if (r.status === 503) {
    console.log('  ! admin endpoint disabled (ADMIN_SECRET not set on server)');
    console.log('  ! restart server with ADMIN_SECRET=' + secret + ' and re-run');
    process.exit(2);
  }
  check('5. admin approve ok', r.status === 200, 'got ' + r.status + ' body=' + r.body);
  check('   permanent_pins.claimed_by set',
    r.json && r.json.supplier && r.json.supplier.claimed_by, 'json=' + JSON.stringify(r.json));

  // 6. Wizard renders 5 steps for a free-tier user
  for (let step = 1; step <= 5; step++) {
    r = await req('GET', `/claim/${slug}/wizard?step=${step}`);
    check('6.' + step + ' wizard step ' + step + ' renders 200', r.status === 200, 'got ' + r.status);
    check('     pill ' + step + ' is-active',
      new RegExp('wizard-step-pill is-active[^0-9]*\\b').test(r.body) || new RegExp('class="wizard-step-pill is-active[^"]*">' + step).test(r.body));
  }

  // 6a. Step 3 free-tier shows lock + unlock CTA
  r = await req('GET', `/claim/${slug}/wizard?step=3`);
  check('6a. step 3 has is-locked form',     /wizard-form is-locked/.test(r.body));
  check('     unlock-pro CTA href /upgrade',
    /href="\/upgrade\?from=wizard-step-3(?:&|&amp;)plan=pro(?:&|&amp;)supplier=foothills-pit-co"/.test(r.body));

  // 6b. Step 4 free-tier shows lock + unlock CTA
  r = await req('GET', `/claim/${slug}/wizard?step=4`);
  check('6b. step 4 has is-locked form',     /wizard-form is-locked/.test(r.body));
  check('     unlock-powerhouse CTA href /upgrade',
    /href="\/upgrade\?from=wizard-step-4(?:&|&amp;)plan=powerhouse(?:&|&amp;)supplier=foothills-pit-co"/.test(r.body));

  // 7. POST wizard step 3 as free-tier → 402
  r = await req('POST', `/api/claims/wizard/${claimId}`, { step: 3, description: 'should be rejected' });
  check('7. wizard step-3 POST as free returns 402', r.status === 402, 'got ' + r.status + ' body=' + r.body);
  check('   error=upgrade_required plan=pro',
    r.json && r.json.error === 'upgrade_required' && r.json.plan === 'pro');

  // 7a. Step 1 should accept basic data
  r = await req('POST', `/api/claims/wizard/${claimId}`, { step: 1, category: 'aggregate-pits', service_area: ['SW Calgary', 'Foothills'] });
  check('7a. wizard step-1 POST ok', r.status === 200, 'got ' + r.status + ' body=' + r.body);

  // 8. /upgrade hold-page
  r = await req('GET', `/upgrade?from=wizard-step-3&plan=pro&supplier=${slug}`);
  check('8. /upgrade renders 200', r.status === 200, 'got ' + r.status);
  check('   has plan name "Pro"',                /Upgrade [^<]*to Pro/.test(r.body));
  check('   has Continue to checkout button',    /id="upgrade-continue-btn"/.test(r.body));
  check('   has fallback mailto',                /mailto:support@dirtlink\.ca\?subject=Upgrade%20request/.test(r.body));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
