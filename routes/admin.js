const express = require('express');
const router = express.Router();
const { all, get, run } = require('../database/init');
const { PLANS, getRevealStatus } = require('../config/pricing');

// ── Auth middleware ──────────────────────────────────────────────────────────
function requireAdmin(req, res, next) {
  return next(); // TODO: re-enable auth once ADMIN_SECRET is confirmed
}

// ── Login page ───────────────────────────────────────────────────────────────
router.get('/login', (req, res) => {
  if (req.session.isAdmin) return res.redirect('/admin');
  res.send(loginPage(''));
});

router.post('/login', (req, res) => {
  const { password } = req.body;
  const secret = process.env.ADMIN_SECRET;
  if (!secret || password === secret) {
    req.session.isAdmin = true;
    return res.redirect('/admin');
  }
  res.send(loginPage('Incorrect password.'));
});

router.get('/logout', (req, res) => {
  req.session.isAdmin = false;
  res.redirect('/admin/login');
});

// ── Main dashboard ───────────────────────────────────────────────────────────
router.get('/', requireAdmin, (req, res) => {
  // Summary stats
  const totalUsers      = get('SELECT COUNT(*) AS n FROM users').n;
  const totalPins       = get('SELECT COUNT(*) AS n FROM pins WHERE is_active = 1').n;
  const totalPermit     = get('SELECT COUNT(*) AS n FROM permit_pins WHERE is_active = 1').n;
  const totalPermanent  = get('SELECT COUNT(*) AS n FROM permanent_pins WHERE is_active = 1').n;
  const totalMessages   = get('SELECT COUNT(*) AS n FROM messages').n;
  const totalRevenues   = get('SELECT COALESCE(SUM(amount),0) AS n FROM billing_history WHERE status = "completed"').n;
  const totalLeads      = get('SELECT COUNT(*) AS n FROM leads').n;
  const proUsers        = get("SELECT COUNT(*) AS n FROM users WHERE user_type != 'free'").n;

  // Members table — enriched
  const users = all(`
    SELECT
      u.id, u.company_name, u.contact_name, u.email, u.phone,
      u.user_type, u.created_at, u.reveals_used, u.reveals_reset_at,
      u.stripe_subscription_id, u.plan_started_at,
      (SELECT COUNT(*) FROM pins p WHERE p.user_id = u.id AND p.is_active = 1) AS active_pins,
      (SELECT COUNT(*) FROM pins p WHERE p.user_id = u.id) AS total_pins,
      (SELECT COUNT(*) FROM conversations c WHERE c.initiator_id = u.id OR c.owner_id = u.id) AS conversations,
      (SELECT COUNT(*) FROM messages m WHERE m.sender_id = u.id) AS messages_sent,
      (SELECT COALESCE(SUM(bh.amount),0) FROM billing_history bh WHERE bh.user_id = u.id AND bh.status = 'completed') AS total_spent,
      (SELECT COUNT(*) FROM reveal_purchases rp WHERE rp.user_id = u.id) AS reveal_purchases
    FROM users u
    ORDER BY u.created_at DESC
  `);

  // Attach live reveal status to each user
  users.forEach(u => {
    u._reveals = getRevealStatus(u, { all, run });
  });

  // Recent pins
  const recentPins = all(`
    SELECT p.*, u.company_name, u.email
    FROM pins p
    JOIN users u ON p.user_id = u.id
    ORDER BY p.created_at DESC
    LIMIT 20
  `);

  // Recent billing
  const billing = all(`
    SELECT bh.*, u.company_name, u.email
    FROM billing_history bh
    JOIN users u ON bh.user_id = u.id
    ORDER BY bh.created_at DESC
    LIMIT 30
  `);

  // Leads
  const leads = all(`SELECT * FROM leads ORDER BY created_at DESC LIMIT 30`);

  // Permit pin stats
  const permitStats = get(`SELECT
    COUNT(*) AS total,
    SUM(CASE WHEN status = 'claimed' THEN 1 ELSE 0 END) AS claimed,
    SUM(CASE WHEN status = 'unclaimed' THEN 1 ELSE 0 END) AS unclaimed
    FROM permit_pins WHERE is_active = 1`);

  res.send(dashboardPage({
    totalUsers, totalPins, totalPermit, totalPermanent,
    totalMessages, totalRevenues, totalLeads, proUsers,
    users, recentPins, billing, leads, permitStats
  }));
});

// ── HTML helpers ─────────────────────────────────────────────────────────────
function esc(str) {
  if (str == null) return '—';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtDate(str) {
  if (!str) return '—';
  return new Date(str).toLocaleDateString('en-CA', { year:'numeric', month:'short', day:'numeric' });
}

function fmtMoney(cents) {
  if (!cents) return '$0';
  return '$' + (cents / 100).toFixed(2);
}

function planBadge(type) {
  const colors = { free: '#94a3b8', pro: '#f59e0b', powerhouse: '#8b5cf6', enterprise: '#0891b2' };
  const color = colors[type] || '#6b7280';
  return `<span style="background:${color};color:#fff;padding:2px 8px;border-radius:99px;font-size:11px;font-weight:600;white-space:nowrap">${esc(type)}</span>`;
}

function loginPage(error) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>DirtLink Admin</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,sans-serif;background:#F3F0EB;display:flex;align-items:center;justify-content:center;min-height:100vh}
  .card{background:#fff;border-radius:12px;padding:40px;width:360px;box-shadow:0 4px 24px rgba(0,0,0,0.08)}
  h1{font-size:20px;font-weight:700;margin-bottom:4px;color:#1A1410}
  .sub{font-size:13px;color:#8A7E74;margin-bottom:28px}
  label{font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;display:block;margin-bottom:6px}
  input{width:100%;border:1.5px solid #E2D9CF;border-radius:8px;padding:10px 12px;font-size:15px;outline:none;transition:border .15s}
  input:focus{border-color:#F59E0B}
  button{width:100%;margin-top:16px;background:#F59E0B;color:#fff;border:none;border-radius:8px;padding:12px;font-size:15px;font-weight:600;cursor:pointer}
  button:hover{background:#D97706}
  .error{color:#DC2626;font-size:13px;margin-top:12px}
</style></head><body>
<div class="card">
  <h1>DirtLink Admin</h1>
  <p class="sub">Sign in to access the dashboard</p>
  <form method="POST" action="/admin/login">
    <label>Admin Password</label>
    <input type="password" name="password" autofocus required>
    <button type="submit">Sign In</button>
    ${error ? `<p class="error">${esc(error)}</p>` : ''}
  </form>
</div>
</body></html>`;
}

function dashboardPage(d) {
  const statCard = (label, value, color = '#F59E0B') =>
    `<div class="stat-card"><div class="stat-value" style="color:${color}">${value}</div><div class="stat-label">${label}</div></div>`;

  const usersRows = d.users.map(u => {
    const rv = u._reveals;
    const isUnlimited = rv.limit === -1;
    const revealBar = isUnlimited
      ? `<span style="color:#059669;font-weight:600">∞ Unlimited</span>`
      : (() => {
          const pct = rv.limit > 0 ? Math.round((rv.remaining / rv.limit) * 100) : 0;
          const barColor = rv.remaining === 0 ? '#DC2626' : rv.remaining <= Math.ceil(rv.limit * 0.3) ? '#F59E0B' : '#059669';
          return `
            <div style="display:flex;align-items:center;gap:8px">
              <div style="flex:1;min-width:60px;background:#F3F0EB;border-radius:99px;height:6px;overflow:hidden">
                <div style="width:${pct}%;height:100%;background:${barColor};border-radius:99px"></div>
              </div>
              <span style="color:${barColor};font-weight:600;white-space:nowrap">${rv.remaining} / ${rv.limit}</span>
            </div>
            <div style="font-size:11px;color:#8A7E74;margin-top:2px">Used ${rv.used} · ${rv.overagePurchasedThisCycle} overage bought</div>
          `;
        })();
    return `
    <tr>
      <td><strong>${esc(u.company_name)}</strong><br><span class="muted">${esc(u.contact_name)}</span></td>
      <td><a href="mailto:${esc(u.email)}">${esc(u.email)}</a>${u.phone ? `<br><span class="muted">${esc(u.phone)}</span>` : ''}</td>
      <td>${planBadge(u.user_type)}</td>
      <td class="num">${u.active_pins} <span class="muted">/ ${u.total_pins}</span></td>
      <td style="min-width:160px">${revealBar}</td>
      <td class="num">${u.conversations}</td>
      <td class="num">${u.messages_sent}</td>
      <td class="num">${fmtMoney(u.total_spent)}</td>
      <td class="muted small">${fmtDate(u.created_at)}</td>
    </tr>`;
  }).join('');

  const pinRows = d.recentPins.map(p => `
    <tr>
      <td>${esc(p.company_name)}<br><span class="muted small">${esc(p.email)}</span></td>
      <td><span class="badge" style="background:${p.pin_type==='have'?'#DC2626':'#2563EB'}">${p.pin_type.toUpperCase()}</span></td>
      <td>${esc(p.material_type?.replace(/_/g,' '))}</td>
      <td>${esc(p.address)}</td>
      <td class="num">${p.quantity_estimate || '—'} ${p.quantity_estimate ? esc(p.quantity_unit?.replace(/_/g,' ')) : ''}</td>
      <td class="muted small">${fmtDate(p.created_at)}</td>
    </tr>`).join('');

  const billingRows = d.billing.map(b => `
    <tr>
      <td>${esc(b.company_name)}<br><span class="muted small">${esc(b.email)}</span></td>
      <td>${esc(b.description)}</td>
      <td>${esc(b.type)}</td>
      <td class="num">${fmtMoney(b.amount)}</td>
      <td><span class="badge" style="background:${b.status==='completed'?'#059669':'#6b7280'}">${b.status}</span></td>
      <td class="muted small">${fmtDate(b.created_at)}</td>
    </tr>`).join('');

  const leadRows = d.leads.map(l => `
    <tr>
      <td>${esc(l.name || '—')}</td>
      <td><a href="mailto:${esc(l.email)}">${esc(l.email)}</a></td>
      <td>${esc(l.source)}</td>
      <td><span class="badge" style="background:${l.status==='new'?'#F59E0B':'#6b7280'}">${l.status}</span></td>
      <td class="muted small">${fmtDate(l.created_at)}</td>
    </tr>`).join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>DirtLink Admin</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#F3F0EB;color:#1A1410;font-size:13px}

  /* Nav */
  .top-nav{background:#1A1410;color:#fff;padding:0 24px;display:flex;align-items:center;justify-content:space-between;height:52px;position:sticky;top:0;z-index:100}
  .top-nav .logo{font-weight:700;font-size:16px;letter-spacing:-.3px}
  .top-nav .logo span{color:#F59E0B}
  .top-nav nav{display:flex;gap:4px}
  .top-nav nav a{color:rgba(255,255,255,.7);text-decoration:none;padding:6px 12px;border-radius:6px;font-size:13px;font-weight:500;transition:all .15s}
  .top-nav nav a:hover,.top-nav nav a.active{background:rgba(255,255,255,.1);color:#fff}
  .top-nav .logout{color:rgba(255,255,255,.5);text-decoration:none;font-size:12px}
  .top-nav .logout:hover{color:#fff}

  /* Layout */
  .page{max-width:1400px;margin:0 auto;padding:28px 24px}
  h2{font-size:20px;font-weight:700;margin-bottom:4px}
  .page-sub{color:#8A7E74;font-size:13px;margin-bottom:24px}

  /* Stat cards */
  .stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:14px;margin-bottom:32px}
  .stat-card{background:#fff;border-radius:12px;padding:18px 20px;border:1px solid #E2D9CF}
  .stat-value{font-size:28px;font-weight:700;line-height:1}
  .stat-label{font-size:12px;color:#8A7E74;margin-top:6px;font-weight:500}

  /* Sections */
  .section{margin-bottom:36px}
  .section-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
  .section-title{font-size:15px;font-weight:700}
  .section-count{font-size:12px;color:#8A7E74;background:#F3F0EB;padding:2px 10px;border-radius:99px}

  /* Table */
  .table-wrap{background:#fff;border-radius:12px;border:1px solid #E2D9CF;overflow:auto}
  table{width:100%;border-collapse:collapse}
  th{text-align:left;padding:10px 14px;font-size:11px;font-weight:600;color:#8A7E74;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #E2D9CF;white-space:nowrap;background:#fff;position:sticky;top:0}
  td{padding:10px 14px;border-bottom:1px solid #F3F0EB;vertical-align:top;line-height:1.4}
  tr:last-child td{border-bottom:none}
  tr:hover td{background:#FAFAF8}
  .num{text-align:right;font-variant-numeric:tabular-nums}
  .muted{color:#8A7E74}
  .small{font-size:11px}
  a{color:#D97706;text-decoration:none}
  a:hover{text-decoration:underline}

  /* Badges */
  .badge{display:inline-block;padding:2px 8px;border-radius:99px;font-size:11px;font-weight:600;color:#fff;white-space:nowrap}

  /* Permit summary */
  .permit-summary{display:flex;gap:12px;margin-bottom:32px}
  .permit-card{background:#fff;border-radius:12px;padding:16px 20px;border:1px solid #E2D9CF;flex:1}
  .permit-card .n{font-size:22px;font-weight:700}
  .permit-card .l{font-size:12px;color:#8A7E74;margin-top:4px}

  /* Tabs */
  .tabs{display:flex;gap:2px;background:#E2D9CF;border-radius:8px;padding:3px;margin-bottom:20px;width:fit-content}
  .tab{padding:6px 16px;border-radius:6px;font-size:13px;font-weight:500;cursor:pointer;color:#8A7E74;transition:all .15s}
  .tab.active{background:#fff;color:#1A1410;font-weight:600;box-shadow:0 1px 3px rgba(0,0,0,.08)}

  @media(max-width:768px){.page{padding:16px 12px}.stats-grid{grid-template-columns:1fr 1fr}.top-nav nav{display:none}}
</style>
</head>
<body>

<nav class="top-nav">
  <div class="logo">Dirt<span>Link</span> <span style="font-size:11px;color:rgba(255,255,255,.4);font-weight:400;margin-left:4px">Admin</span></div>
  <nav>
    <a href="#members" class="active" onclick="showTab('members',this)">Members</a>
    <a href="#pins" onclick="showTab('pins',this)">Pins</a>
    <a href="#billing" onclick="showTab('billing',this)">Billing</a>
    <a href="#leads" onclick="showTab('leads',this)">Leads</a>
    <a href="#permits" onclick="showTab('permits',this)">Permits</a>
  </nav>
  <a href="/admin/logout" class="logout">Sign out</a>
</nav>

<div class="page">
  <h2>Dashboard</h2>
  <p class="page-sub">Live data · Refreshes on page load</p>

  <div class="stats-grid">
    ${statCard('Total Members', d.totalUsers, '#1A1410')}
    ${statCard('Paid Members', d.proUsers, '#F59E0B')}
    ${statCard('Active Pins', d.totalPins, '#DC2626')}
    ${statCard('Permit Sites', d.totalPermit, '#6B7280')}
    ${statCard('Perm. Sites', d.totalPermanent, '#059669')}
    ${statCard('Messages Sent', d.totalMessages, '#2563EB')}
    ${statCard('Calculator Leads', d.totalLeads, '#8b5cf6')}
    ${statCard('Total Revenue', fmtMoney(d.totalRevenues), '#059669')}
  </div>

  <!-- Members -->
  <div class="section" id="tab-members">
    <div class="section-header">
      <span class="section-title">Members</span>
      <span class="section-count">${d.totalUsers} total</span>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>Company</th><th>Contact</th><th>Plan</th>
          <th class="num">Active Pins</th><th>Reveals Remaining</th>
          <th class="num">Convos</th><th class="num">Msgs</th>
          <th class="num">Spent</th><th>Joined</th>
        </tr></thead>
        <tbody>${usersRows || '<tr><td colspan="10" style="text-align:center;padding:24px;color:#8A7E74">No members yet</td></tr>'}</tbody>
      </table>
    </div>
  </div>

  <!-- Pins -->
  <div class="section" id="tab-pins" style="display:none">
    <div class="section-header">
      <span class="section-title">Recent Pins</span>
      <span class="section-count">${d.totalPins} active</span>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>Member</th><th>Type</th><th>Material</th><th>Address</th><th class="num">Quantity</th><th>Date</th>
        </tr></thead>
        <tbody>${pinRows || '<tr><td colspan="6" style="text-align:center;padding:24px;color:#8A7E74">No pins yet</td></tr>'}</tbody>
      </table>
    </div>
  </div>

  <!-- Billing -->
  <div class="section" id="tab-billing" style="display:none">
    <div class="section-header">
      <span class="section-title">Billing History</span>
      <span class="section-count">${fmtMoney(d.totalRevenues)} total</span>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>Member</th><th>Description</th><th>Type</th><th class="num">Amount</th><th>Status</th><th>Date</th>
        </tr></thead>
        <tbody>${billingRows || '<tr><td colspan="6" style="text-align:center;padding:24px;color:#8A7E74">No billing records yet</td></tr>'}</tbody>
      </table>
    </div>
  </div>

  <!-- Leads -->
  <div class="section" id="tab-leads" style="display:none">
    <div class="section-header">
      <span class="section-title">Calculator Leads</span>
      <span class="section-count">${d.totalLeads} total</span>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>Name</th><th>Email</th><th>Source</th><th>Status</th><th>Date</th>
        </tr></thead>
        <tbody>${leadRows || '<tr><td colspan="5" style="text-align:center;padding:24px;color:#8A7E74">No leads yet</td></tr>'}</tbody>
      </table>
    </div>
  </div>

  <!-- Permits -->
  <div class="section" id="tab-permits" style="display:none">
    <div class="section-header">
      <span class="section-title">Development Permits</span>
      <span class="section-count">${d.totalPermit} active</span>
    </div>
    <div class="permit-summary">
      <div class="permit-card"><div class="n">${d.permitStats.total}</div><div class="l">Total permit pins</div></div>
      <div class="permit-card"><div class="n" style="color:#059669">${d.permitStats.claimed}</div><div class="l">Claimed</div></div>
      <div class="permit-card"><div class="n" style="color:#F59E0B">${d.permitStats.unclaimed}</div><div class="l">Unclaimed (available)</div></div>
      <div class="permit-card"><div class="n">${d.totalPermanent}</div><div class="l">Permanent sites</div></div>
    </div>
  </div>

</div>

<script>
  function showTab(name, el) {
    document.querySelectorAll('[id^="tab-"]').forEach(t => t.style.display = 'none');
    document.getElementById('tab-' + name).style.display = 'block';
    document.querySelectorAll('.top-nav nav a').forEach(a => a.classList.remove('active'));
    el.classList.add('active');
  }
</script>
</body></html>`;
}

module.exports = router;
