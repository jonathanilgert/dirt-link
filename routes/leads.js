// POST /api/leads — calculator lead capture.
//
// Important: result is recomputed server-side from the inputs. We never
// trust whatever the client posted in `result` — the email and DB row both
// reflect the server's calculation, which is the source of truth.

const express = require('express');
const { calculateDisposalCost } = require('../lib/calculators/rates');
const { insertLead, sendAdminNotification, sendEstimateToUser } = require('../services/leads');

const router = express.Router();

const VALID_SOURCES = new Set([
  'calculator-disposal-cost-Calgary'
]);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Pure validation + recompute. Returns either { error, status } or
// { cleanEmail, cleanName, source, cleanInputs, result }. Exported for tests.
function validateAndCompute(body) {
  body = body || {};
  const { email, name, source, inputs } = body;

  if (!email || typeof email !== 'string' || !EMAIL_RE.test(email.trim())) {
    return { error: 'Valid email is required', status: 400 };
  }
  if (!source || !VALID_SOURCES.has(source)) {
    return { error: 'Unknown lead source', status: 400 };
  }
  if (!inputs || typeof inputs !== 'object') {
    return { error: 'Missing inputs', status: 400 };
  }

  const cleanEmail = email.trim().toLowerCase();
  let cleanName = null;
  if (name && typeof name === 'string') {
    const trimmed = name.trim().slice(0, 120);
    if (trimmed) cleanName = trimmed;
  }

  // Server-side recompute — never trust client-submitted dollar amounts.
  const result = calculateDisposalCost({
    loads: inputs.loads,
    materialType: inputs.materialType,
    quadrant: inputs.quadrant
  });

  const cleanInputs = {
    loads: result.loads,
    materialType: result.materialType,
    quadrant: result.quadrant
  };

  return { cleanEmail, cleanName, source, cleanInputs, result };
}

router.post('/', async (req, res) => {
  const v = validateAndCompute(req.body);
  if (v.error) return res.status(v.status).json({ error: v.error });

  const { cleanEmail, cleanName, source, cleanInputs, result } = v;
  const resultsUrl = req.body && req.body.resultsUrl;

  let lead;
  try {
    lead = insertLead({
      email: cleanEmail,
      name: cleanName,
      source,
      inputs: cleanInputs,
      result
    });
  } catch (err) {
    console.error('[leads] insert failed:', err);
    return res.status(500).json({ error: 'Could not save lead' });
  }

  // Fire-and-forget emails — don't make the user wait on SMTP.
  Promise.allSettled([
    sendAdminNotification({ email: cleanEmail, name: cleanName, source, inputs: cleanInputs, result }),
    sendEstimateToUser({ email: cleanEmail, name: cleanName, source, inputs: cleanInputs, result, resultsUrl })
  ]).catch(err => console.error('[leads] email batch error:', err));

  res.status(201).json({
    id: lead.id,
    status: 'received',
    message: 'Estimate sent to your email.'
  });
});

module.exports = router;
module.exports.validateAndCompute = validateAndCompute;
module.exports.VALID_SOURCES = VALID_SOURCES;
