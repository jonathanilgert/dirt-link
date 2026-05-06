const express = require('express');
const bcrypt = require('bcryptjs');
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
  body{font-family:-apple-system,'Segoe UI',sans-serif;background:#F7F7F8;display:flex;align-items:center;justify-content:center;min-height:100vh}
  .card{background:#fff;border-radius:16px;padding:44px 40px;width:380px;box-shadow:0 1px 3px rgba(0,0,0,.06),0 8px 32px rgba(0,0,0,.08)}
  .brand{display:flex;align-items:center;gap:10px;margin-bottom:28px}
  .brand-dot{width:32px;height:32px;background:#F59E0B;border-radius:8px;display:flex;align-items:center;justify-content:center}
  .brand-dot svg{width:18px;height:18px;fill:#fff}
  .brand-name{font-size:16px;font-weight:700;color:#111;letter-spacing:-.3px}
  .brand-name span{color:#9ca3af;font-weight:400;font-size:13px;margin-left:4px}
  h1{font-size:22px;font-weight:700;color:#111;letter-spacing:-.4px;margin-bottom:6px}
  .sub{font-size:14px;color:#6b7280;margin-bottom:28px}
  label{font-size:12px;font-weight:600;color:#374151;display:block;margin-bottom:6px}
  input{width:100%;border:1.5px solid #e5e7eb;border-radius:10px;padding:11px 14px;font-size:14px;color:#111;outline:none;transition:border .15s,box-shadow .15s}
  input:focus{border-color:#F59E0B;box-shadow:0 0 0 3px rgba(245,158,11,.12)}
  button{width:100%;margin-top:20px;background:#111;color:#fff;border:none;border-radius:10px;padding:12px;font-size:14px;font-weight:600;cursor:pointer;transition:background .15s}
  button:hover{background:#222}
  .error{color:#DC2626;font-size:13px;margin-top:12px;padding:10px 14px;background:#fef2f2;border-radius:8px}
</style></head><body>
<div class="card">
  <div class="brand">
    <div class="brand-dot"><svg viewBox="0 0 24 24"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/></svg></div>
    <div class="brand-name">DirtLink <span>Admin</span></div>
  </div>
  <h1>Welcome back</h1>
  <p class="sub">Sign in to access the admin panel</p>
  <form method="POST" action="/admin/login">
    <label>Password</label>
    <input type="password" name="password" autofocus required placeholder="Enter admin password">
    <button type="submit">Sign In</button>
    ${error ? `<p class="error">${esc(error)}</p>` : ''}
  </form>
</div>
</body></html>`;
}

function dashboardPage(d) {
  const statCard = (label, value) =>
    `<div class="stat-card"><div class="stat-value">${value}</div><div class="stat-label">${label}</div></div>`;

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
              <div style="flex:1;min-width:60px;background:#f3f4f6;border-radius:99px;height:6px;overflow:hidden">
                <div style="width:${pct}%;height:100%;background:${barColor};border-radius:99px"></div>
              </div>
              <span style="color:${barColor};font-weight:600;white-space:nowrap">${rv.remaining} / ${rv.limit}</span>
            </div>
            <div style="font-size:11px;color:#9ca3af;margin-top:2px">Used ${rv.used} · ${rv.overagePurchasedThisCycle} overage bought</div>
          `;
        })();
    return `
    <tr>
      <td data-label="Company"><strong>${esc(u.company_name)}</strong><br><span class="muted">${esc(u.contact_name)}</span></td>
      <td data-label="Contact"><a href="mailto:${esc(u.email)}">${esc(u.email)}</a>${u.phone ? `<br><span class="muted">${esc(u.phone)}</span>` : ''}</td>
      <td data-label="Plan">${planBadge(u.user_type)}</td>
      <td data-label="Active Pins" class="num">${u.active_pins} <span class="muted">/ ${u.total_pins}</span></td>
      <td data-label="Reveals" style="min-width:160px">${revealBar}</td>
      <td data-label="Convos" class="num">${u.conversations}</td>
      <td data-label="Msgs" class="num">${u.messages_sent}</td>
      <td data-label="Spent" class="num">${fmtMoney(u.total_spent)}</td>
      <td data-label="Joined" class="muted small">${fmtDate(u.created_at)}</td>
      <td data-label="Actions">
        <select onchange="setPlan('${esc(u.id)}','${esc(u.email)}',this.value);this.value=''" class="plan-select" style="width:100%">
          <option value="">Set plan…</option>
          <option value="free">Free</option>
          <option value="pro">Pro</option>
          <option value="powerhouse">Powerhouse</option>
          <option value="enterprise">Enterprise</option>
        </select>
      </td>
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
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#F7F7F8;color:#111;font-size:13px;line-height:1.5}

  /* ── Nav ── */
  .nav{background:#fff;border-bottom:1px solid #e5e7eb;padding:0 28px;display:flex;align-items:center;justify-content:space-between;height:56px;position:sticky;top:0;z-index:100}
  .nav-brand{display:flex;align-items:center;gap:10px;text-decoration:none}
  .nav-dot{width:28px;height:28px;background:#F59E0B;border-radius:7px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
  .nav-dot svg{width:15px;height:15px;fill:#fff}
  .nav-name{font-size:15px;font-weight:700;color:#111;letter-spacing:-.3px}
  .nav-name em{color:#9ca3af;font-style:normal;font-weight:400;font-size:12px;margin-left:5px}
  .nav-tabs{display:flex;gap:2px}
  .nav-tabs a{color:#6b7280;text-decoration:none;padding:6px 13px;border-radius:7px;font-size:13px;font-weight:500;transition:all .15s;white-space:nowrap}
  .nav-tabs a:hover{background:#f3f4f6;color:#111}
  .nav-tabs a.active{background:#111;color:#fff}
  .nav-right{display:flex;align-items:center;gap:12px}
  .nav-refresh{font-size:12px;color:#9ca3af}
  .nav-logout{font-size:12px;color:#6b7280;text-decoration:none;padding:5px 12px;border:1px solid #e5e7eb;border-radius:7px;transition:all .15s}
  .nav-logout:hover{background:#f3f4f6;color:#111}

  /* ── Layout ── */
  .page{max-width:1440px;margin:0 auto;padding:28px}

  /* ── Stats ── */
  .stats-grid{display:grid;grid-template-columns:repeat(8,1fr);gap:12px;margin-bottom:28px}
  .stat-card{background:#111;border-radius:14px;padding:18px 20px;box-shadow:0 2px 8px rgba(0,0,0,.10),0 8px 24px rgba(0,0,0,.08);transition:transform .15s,box-shadow .15s;cursor:default}
  .stat-card:hover{transform:translateY(-2px);box-shadow:0 4px 16px rgba(0,0,0,.14),0 12px 32px rgba(0,0,0,.10)}
  .stat-value{font-size:26px;font-weight:700;letter-spacing:-.6px;line-height:1;color:#fff}
  .stat-label{font-size:11px;color:rgba(255,255,255,.45);margin-top:7px;font-weight:500;text-transform:uppercase;letter-spacing:.05em}

  /* ── Section ── */
  .section{margin-bottom:28px}
  .section-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
  .section-title{font-size:14px;font-weight:600;color:#111}
  .section-meta{font-size:12px;color:#9ca3af}

  /* ── Table ── */
  .table-wrap{background:#fff;border-radius:12px;border:1px solid #e5e7eb;overflow:auto}
  table{width:100%;border-collapse:collapse}
  th{text-align:left;padding:11px 16px;font-size:11px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #f3f4f6;white-space:nowrap;background:#fff}
  td{padding:11px 16px;border-bottom:1px solid #f9fafb;vertical-align:middle;line-height:1.4;color:#111}
  tr:last-child td{border-bottom:none}
  tr:hover td{background:#fafafa}
  .num{text-align:right;font-variant-numeric:tabular-nums}
  .muted{color:#9ca3af}
  .small{font-size:11px}
  a{color:#D97706;text-decoration:none}
  a:hover{text-decoration:underline}
  strong{font-weight:600}

  /* ── Badges ── */
  .badge{display:inline-block;padding:2px 9px;border-radius:99px;font-size:11px;font-weight:600;color:#fff;white-space:nowrap}

  /* ── Permit cards ── */
  .permit-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
  .permit-card{background:#fff;border-radius:12px;padding:20px 22px;border:1px solid #e5e7eb}
  .permit-card .n{font-size:26px;font-weight:700;letter-spacing:-.5px;line-height:1}
  .permit-card .l{font-size:11px;color:#9ca3af;margin-top:6px;text-transform:uppercase;letter-spacing:.04em;font-weight:500}

  /* ── Empty state ── */
  .empty{text-align:center;padding:40px 24px;color:#9ca3af;font-size:13px}

  /* ── Plan select ── */
  .plan-select{font-size:12px;padding:5px 8px;border:1px solid #e5e7eb;border-radius:7px;background:#fff;color:#374151;cursor:pointer;outline:none;transition:border .15s}
  .plan-select:hover{border-color:#d1d5db}
  .plan-select:focus{border-color:#F59E0B;box-shadow:0 0 0 3px rgba(245,158,11,.1)}

  @media(max-width:1100px){.stats-grid{grid-template-columns:repeat(4,1fr)}}
  @media(max-width:768px){
    .page{padding:16px}
    .stats-grid{grid-template-columns:repeat(2,1fr)}
    .nav-tabs{display:none}
    .permit-grid{grid-template-columns:repeat(2,1fr)}
    #tab-members .table-wrap{background:transparent;border:none;overflow:visible}
    #tab-members table,#tab-members thead,#tab-members tbody,
    #tab-members th,#tab-members td,#tab-members tr{display:block;width:100%}
    #tab-members thead{display:none}
    #tab-members tbody tr{background:#fff;border:1px solid #e5e7eb;border-radius:12px;margin-bottom:10px;padding:4px 0;overflow:hidden}
    #tab-members tbody tr:hover td{background:transparent}
    #tab-members td{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding:8px 14px;border-bottom:1px solid #f9fafb;text-align:left!important}
    #tab-members td:last-child{border-bottom:none}
    #tab-members td::before{content:attr(data-label);font-size:10px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:.05em;white-space:nowrap;flex-shrink:0;padding-top:2px;min-width:80px}
    #tab-members td[data-label="Reveals"]{flex-direction:column;align-items:flex-start}
    #tab-members td[data-label="Actions"]{flex-direction:column;align-items:flex-start;gap:6px}
    #tab-members td[data-label="Actions"] select{width:100%}
  }
</style>
</head>
<body>

<nav class="nav">
  <a class="nav-brand" href="/admin">
    <div class="nav-dot"><svg viewBox="0 0 24 24"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/></svg></div>
    <span class="nav-name">DirtLink <em>Admin</em></span>
  </a>
  <div class="nav-tabs">
    <a href="#" class="active" onclick="showTab('members',this);return false">Members</a>
    <a href="#" onclick="showTab('pins',this);return false">Pins</a>
    <a href="#" onclick="showTab('billing',this);return false">Billing</a>
    <a href="#" onclick="showTab('leads',this);return false">Leads</a>
    <a href="#" onclick="showTab('permits',this);return false">Permits</a>
  </div>
  <div class="nav-right">
    <span class="nav-refresh">Live data</span>
    <a href="/admin/logout" class="nav-logout">Sign out</a>
  </div>
</nav>

<div class="page">

  <div class="stats-grid">
    ${statCard('Total Members',   d.totalUsers)}
    ${statCard('Paid Members',    d.proUsers)}
    ${statCard('Active Pins',     d.totalPins)}
    ${statCard('Permit Sites',    d.totalPermit)}
    ${statCard('Perm. Sites',     d.totalPermanent)}
    ${statCard('Messages Sent',   d.totalMessages)}
    ${statCard('Calc. Leads',     d.totalLeads)}
    ${statCard('Revenue',         fmtMoney(d.totalRevenues))}
  </div>

  <!-- Members -->
  <div class="section" id="tab-members">
    <div class="section-header">
      <span class="section-title">Members</span>
      <span class="section-meta">${d.totalUsers} total</span>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>Company</th><th>Contact</th><th>Plan</th>
          <th class="num">Pins</th><th>Reveals</th>
          <th class="num">Convos</th><th class="num">Msgs</th>
          <th class="num">Spent</th><th>Joined</th><th>Actions</th>
        </tr></thead>
        <tbody>${usersRows || '<tr><td colspan="10"><div class="empty">No members yet</div></td></tr>'}</tbody>
      </table>
    </div>
  </div>

  <!-- Pins -->
  <div class="section" id="tab-pins" style="display:none">
    <div class="section-header">
      <span class="section-title">Recent Pins</span>
      <span class="section-meta">${d.totalPins} active</span>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>Member</th><th>Type</th><th>Material</th><th>Address</th><th class="num">Quantity</th><th>Date</th>
        </tr></thead>
        <tbody>${pinRows || '<tr><td colspan="6"><div class="empty">No pins yet</div></td></tr>'}</tbody>
      </table>
    </div>
  </div>

  <!-- Billing -->
  <div class="section" id="tab-billing" style="display:none">
    <div class="section-header">
      <span class="section-title">Billing History</span>
      <span class="section-meta">${fmtMoney(d.totalRevenues)} total</span>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>Member</th><th>Description</th><th>Type</th><th class="num">Amount</th><th>Status</th><th>Date</th>
        </tr></thead>
        <tbody>${billingRows || '<tr><td colspan="6"><div class="empty">No billing records yet</div></td></tr>'}</tbody>
      </table>
    </div>
  </div>

  <!-- Leads -->
  <div class="section" id="tab-leads" style="display:none">
    <div class="section-header">
      <span class="section-title">Calculator Leads</span>
      <span class="section-meta">${d.totalLeads} total</span>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>Name</th><th>Email</th><th>Source</th><th>Status</th><th>Date</th>
        </tr></thead>
        <tbody>${leadRows || '<tr><td colspan="5"><div class="empty">No leads yet</div></td></tr>'}</tbody>
      </table>
    </div>
  </div>

  <!-- Permits -->
  <div class="section" id="tab-permits" style="display:none">
    <div class="section-header">
      <span class="section-title">Development Permits</span>
      <span class="section-meta">${d.totalPermit} active</span>
    </div>
    <div class="permit-grid">
      <div class="permit-card"><div class="n">${d.permitStats.total}</div><div class="l">Total permit pins</div></div>
      <div class="permit-card"><div class="n" style="color:#059669">${d.permitStats.claimed}</div><div class="l">Claimed</div></div>
      <div class="permit-card"><div class="n" style="color:#F59E0B">${d.permitStats.unclaimed}</div><div class="l">Unclaimed</div></div>
      <div class="permit-card"><div class="n">${d.totalPermanent}</div><div class="l">Permanent sites</div></div>
    </div>
  </div>

</div>

<script>
  async function setPlan(userId, email, plan) {
    if (!plan) return;
    const res = await fetch('/admin/set-plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, plan })
    });
    const data = await res.json();
    if (res.ok) { alert(email + ' \u2192 ' + plan); location.reload(); }
    else alert(data.error || 'Failed');
  }

  function showTab(name, el) {
    document.querySelectorAll('[id^="tab-"]').forEach(t => t.style.display = 'none');
    document.getElementById('tab-' + name).style.display = 'block';
    document.querySelectorAll('.nav-tabs a').forEach(a => a.classList.remove('active'));
    el.classList.add('active');
  }
</script>
</body></html>`;
}

// ── POST /admin/set-plan — update a user's plan ──────────────────────────────
router.post('/set-plan', requireAdmin, (req, res) => {
  const { email, userId, plan } = req.body;
  if (!['free', 'pro', 'powerhouse', 'enterprise'].includes(plan)) {
    return res.status(400).json({ error: 'Invalid plan' });
  }
  const user = userId
    ? get('SELECT id FROM users WHERE id = ?', [userId])
    : get('SELECT id FROM users WHERE email = ?', [email]);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const priority = plan === 'powerhouse' || plan === 'enterprise' ? 1 : 0;
  run(`UPDATE users SET user_type = ?, priority_notifications = ?, updated_at = datetime('now') WHERE id = ?`,
    [plan, priority, user.id]);

  res.json({ ok: true, plan });
});



module.exports = router;
