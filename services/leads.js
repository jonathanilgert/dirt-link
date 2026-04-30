// Lead capture service — used by the calculator widgets via POST /api/leads.
//
// Persists every submission to the `leads` table (system of record) and fires
// two emails: an admin notification to ADMIN_EMAIL so hot leads get acted on
// fast, and a templated estimate to the lead themselves.
//
// Email transport piggybacks on services/notifications.js' Nodemailer setup
// (same SMTP_* env vars). Both sends are non-blocking — if SMTP isn't
// configured the call is a no-op so dev environments still work.

const nodemailer = require('nodemailer');
const { v4: uuidv4 } = require('uuid');
const { run, get } = require('../database/init');

const FROM_EMAIL = process.env.FROM_EMAIL || 'noreply@dirtlink.ca';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'jonathanilgert@gmail.com';
const APP_URL = process.env.APP_URL || 'http://localhost:3000';

let transporter = null;
function getTransporter() {
  if (transporter) return transporter;
  if (!process.env.SMTP_HOST) return null;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
  return transporter;
}

function fmtMoney(n) {
  return '$' + Math.round(n).toLocaleString('en-CA');
}

const MATERIAL_LABELS = {
  'clean-fill': 'Clean Fill (soil/clay/gravel)',
  'topsoil':    'Topsoil',
  'sod':        'Has Sod',
  'mixed':      'Mixed / has debris'
};

const NARRATIVE_COPY = {
  'clean-fill': "Plus you skip Calgary's commercial clean-fill approval process.",
  'topsoil':    "Plus the topsoil ends up in someone's garden instead of the landfill.",
  'sod':        "Sod is charged at the basic sanitary rate ($113/tonne) at Calgary landfills — Dirtlink takers want it for landscaping.",
  'mixed':      "Mixed loads can hit the $180/tonne commercial surcharge. Dirtlink rehomes the usable portion."
};

function insertLead({ email, name, source, inputs, result }) {
  const id = uuidv4();
  run(
    `INSERT INTO leads (id, email, name, source, inputs, result)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      id,
      email,
      name || null,
      source,
      JSON.stringify(inputs || {}),
      JSON.stringify(result || {})
    ]
  );
  return get('SELECT * FROM leads WHERE id = ?', [id]);
}

async function sendAdminNotification({ email, name, source, inputs, result }) {
  const tx = getTransporter();
  if (!tx) {
    console.log(`[leads] (SMTP not configured — skipping admin alert for ${email})`);
    return;
  }

  const subject = `[Dirtlink Lead] ${email} — ${source}`;
  const lines = [
    `New lead from the Dirtlink calculator.`,
    ``,
    `Email:  ${email}`,
    `Name:   ${name || '(not provided)'}`,
    `Source: ${source}`,
    ``,
    `── Inputs ──`,
    `Loads:    ${inputs.loads}`,
    `Material: ${MATERIAL_LABELS[inputs.materialType] || inputs.materialType}`,
    `Quadrant: ${inputs.quadrant}`,
    ``,
    `── Their estimate ──`,
    `Tipping:        ${fmtMoney(result.tippingTotal)}  (${result.smallLoadApplied ? '$25 small-load flat' : `$${result.tippingPerTonne}/t × ${result.totalTonnes}t`})`,
    `Trucking:       ${fmtMoney(result.truckingTotal)}  (${inputs.loads} trips × ${result.tripHours}h × $${result.truckingHourly}/h)`,
    `Landfill total: ${fmtMoney(result.landfillTotal)}`,
    `Dirtlink total: ${fmtMoney(result.dirtlinkTotal)}  (hauling only)`,
    `Savings:        ${fmtMoney(result.savings)} (${result.savingsPct}%)`,
    ``,
    `Open in Dirtlink admin: ${APP_URL}/admin/leads (TODO build admin view)`
  ];

  try {
    await tx.sendMail({
      from: FROM_EMAIL,
      to: ADMIN_EMAIL,
      subject,
      text: lines.join('\n')
    });
  } catch (err) {
    console.error('[leads] admin notification failed:', err.message);
  }
}

async function sendEstimateToUser({ email, name, source, inputs, result, resultsUrl }) {
  const tx = getTransporter();
  if (!tx) {
    console.log(`[leads] (SMTP not configured — skipping estimate to ${email})`);
    return;
  }

  const greeting = name ? `Hi ${name},` : 'Hi there,';
  const narrative = NARRATIVE_COPY[inputs.materialType] || '';

  const text = [
    greeting,
    ``,
    `Here's the estimate from the Dirtlink calculator:`,
    ``,
    `${inputs.loads} ${inputs.loads === 1 ? 'load' : 'loads'} of ${MATERIAL_LABELS[inputs.materialType] || inputs.materialType} from the ${inputs.quadrant} quadrant`,
    ``,
    `Estimated disposal cost: ${fmtMoney(result.landfillTotal)}`,
    `  • Tipping:  ${fmtMoney(result.tippingTotal)}`,
    `  • Trucking: ${fmtMoney(result.truckingTotal)} (~${result.totalHours} hours of your time)`,
    ``,
    `With Dirtlink: ${fmtMoney(result.dirtlinkTotal)} (you cover hauling only)`,
    `You save:      ${fmtMoney(result.savings)} (${result.savingsPct}%)`,
    ``,
    narrative,
    ``,
    `Open your saved estimate: ${resultsUrl || APP_URL + '/calgary/dirt-disposal-cost'}`,
    ``,
    `List your fill — free: ${APP_URL}`,
    ``,
    `— The Dirtlink team`,
    ``,
    `Numbers based on City of Calgary published landfill rates. Trucking is a Calgary tandem-hauler estimate.`
  ].join('\n');

  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;color:#1A1410">
      <p>${greeting}</p>
      <p>Here's the estimate from the Dirtlink calculator:</p>
      <p style="background:#FAF8F5;border:1px solid #E2D9CF;border-radius:8px;padding:14px 16px;margin:0 0 18px 0">
        <strong>${inputs.loads} ${inputs.loads === 1 ? 'load' : 'loads'}</strong> of
        <strong>${MATERIAL_LABELS[inputs.materialType] || inputs.materialType}</strong>
        from the <strong>${inputs.quadrant}</strong> quadrant
      </p>
      <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:15px">
        <tr><td style="padding:6px 0;color:#8A7E74">Tipping</td><td style="padding:6px 0;text-align:right">${fmtMoney(result.tippingTotal)}</td></tr>
        <tr><td style="padding:6px 0;color:#8A7E74">Trucking</td><td style="padding:6px 0;text-align:right">${fmtMoney(result.truckingTotal)}</td></tr>
        <tr><td style="padding:6px 0;color:#8A7E74">Your time</td><td style="padding:6px 0;text-align:right">~${result.totalHours} hours</td></tr>
        <tr><td colspan="2" style="border-top:1px solid #E2D9CF;padding-top:10px"></td></tr>
        <tr><td style="padding:6px 0;font-weight:700">Landfill total</td><td style="padding:6px 0;text-align:right;font-weight:700">${fmtMoney(result.landfillTotal)}</td></tr>
        <tr><td style="padding:6px 0;color:#16A34A">With Dirtlink</td><td style="padding:6px 0;text-align:right;color:#16A34A">${fmtMoney(result.dirtlinkTotal)}</td></tr>
        <tr><td style="padding:6px 0;font-weight:800;color:#16A34A">You save</td><td style="padding:6px 0;text-align:right;font-weight:800;color:#16A34A">${fmtMoney(result.savings)} (${result.savingsPct}%)</td></tr>
      </table>
      ${narrative ? `<p style="color:#8A7E74;margin-top:18px;font-size:14px;line-height:1.5">${narrative}</p>` : ''}
      <p style="margin-top:24px">
        <a href="${resultsUrl || APP_URL + '/calgary/dirt-disposal-cost'}" style="display:inline-block;background:#F59E0B;color:#1A1410;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:8px">List your fill — free →</a>
      </p>
      <p style="color:#B0A49A;font-size:12px;margin-top:32px;line-height:1.5">
        Numbers based on City of Calgary published landfill rates. Trucking is a Calgary tandem-hauler estimate.
      </p>
    </div>
  `;

  try {
    await tx.sendMail({
      from: FROM_EMAIL,
      to: email,
      subject: `Your Dirtlink disposal estimate — save ${fmtMoney(result.savings)}`,
      text,
      html
    });
  } catch (err) {
    console.error('[leads] user estimate failed:', err.message);
  }
}

module.exports = {
  insertLead,
  sendAdminNotification,
  sendEstimateToUser
};
