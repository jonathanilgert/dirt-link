// DirtLink - Main Application Logic
window.DirtLink = {
  user: null,
  pins: [],
  dropping: false,
  tempMarker: null,

  _currentPermit: null,
  _pendingPermitAction: null, // 'claim' or 'inquire' — set before auth redirect
  _materialFilters: new Set(),

  async init() {
    this.populateMaterialSelects();
    this.populateClaimMaterialSelect();
    this.buildLegend();
    this.bindEvents();
    await this.checkAuth();
    await this.loadPins();
    this.buildMaterialList();
    await this.loadExternalPins();
    this.pollUnread();
    this.initProximityBell();
    this.pollProximityAlerts();
    this._handleListFillIntent();
    // Mobile: set initial active view class
    document.body.classList.add('view-map-active');
  },

  // Detect ?action=list-fill in the URL (set by the disposal-cost calculator's
  // "List this fill" CTA via the /calgary/list-fill redirect) and kick the
  // user into the pin-drop flow with stashed pre-fill values for the modal.
  _handleListFillIntent() {
    try {
      const p = new URLSearchParams(window.location.search);
      if (p.get('action') !== 'list-fill') return;
      const loads = parseInt(p.get('loads'), 10);
      const type = p.get('type');
      const zone = p.get('zone');
      this._calcPrefill = {
        loads: Number.isFinite(loads) ? loads : null,
        type: type || null,
        zone: zone || null,
        source: p.get('source') || null
      };
      // Strip the action params so refresh / share doesn't re-trigger
      const clean = window.location.pathname;
      window.history.replaceState(null, '', clean);
      // Slight delay so the map is ready before the crosshair shows
      setTimeout(() => this.startPinDrop(), 250);
    } catch (e) { /* ignore — never break init on intent parse errors */ }
  },

  // Calculator material → dirt-link subcategory key (when we're confident).
  // Returns null for ambiguous cases so the user picks manually.
  _calcMaterialToSubcategory(type) {
    return ({
      'clean-fill': 'clean_fill',
      'topsoil':    'topsoil',
      'sod':        'organic_material'
      // 'mixed' intentionally omitted — too ambiguous, let user pick
    })[type] || null;
  },

  // Called from confirmPinLocation() right before the form modal opens.
  // No-op when there's no stashed pre-fill.
  _applyCalcPrefill() {
    if (!this._calcPrefill) return;
    const pre = this._calcPrefill;
    this._calcPrefill = null;  // single-shot

    // 1. Force HAVE since they're disposing of fill
    const haveRadio = document.querySelector('#form-pin input[name="pin_type"][value="have"]');
    if (haveRadio) haveRadio.checked = true;

    // 2. Pre-fill material when mapping is unambiguous
    const sub = this._calcMaterialToSubcategory(pre.type);
    if (sub) {
      const sel = document.getElementById('pin-material');
      if (sel) sel.value = sub;
    }

    // 3. Pre-fill quantity (loads × 14 yd³ per tandem)
    if (pre.loads != null) {
      const qty = document.getElementById('pin-qty');
      const unit = document.getElementById('pin-unit');
      if (qty && !qty.value) qty.value = String(pre.loads * 14);
      if (unit && !unit.value) unit.value = 'cubic_yards';
    }

    // 4. Title hint — only when blank
    const titleEl = document.getElementById('pin-title');
    if (titleEl && !titleEl.value) {
      const typeLabel = ({
        'clean-fill': 'Clean fill', 'topsoil': 'Topsoil',
        'sod': 'Sod', 'mixed': 'Mixed fill'
      })[pre.type] || 'Fill';
      const zoneSuffix = pre.zone ? ` (${pre.zone} Calgary)` : '';
      titleEl.value = `${typeLabel} — ~${pre.loads || ''} loads${zoneSuffix}`.replace('~ loads', 'loads');
    }

    // 5. Surface where the pre-fill came from in the location hint, so the
    //    user understands why fields are populated.
    const hint = document.getElementById('pin-location-hint');
    if (hint) {
      const existing = hint.textContent;
      hint.textContent = existing + ' · Pre-filled from disposal cost calculator';
    }
  },

  populateClaimMaterialSelect() {
    const sel = document.getElementById('claim-material');
    Object.entries(CATEGORIES).forEach(([catKey, cat]) => {
      const group = document.createElement('optgroup');
      group.label = cat.label;
      Object.entries(cat.subcategories).forEach(([subKey, sub]) => {
        const opt = document.createElement('option');
        opt.value = subKey;
        opt.textContent = sub.label;
        group.appendChild(opt);
      });
      sel.appendChild(group);
    });
  },

  // Populate material dropdowns with category > subcategory grouping
  populateMaterialSelects() {
    const filterSel = document.getElementById('filter-material');
    const pinSel = document.getElementById('pin-material');

    Object.entries(CATEGORIES).forEach(([catKey, cat]) => {
      // Filter dropdown: category-level options
      const filterOpt = document.createElement('option');
      filterOpt.value = 'cat:' + catKey;
      filterOpt.textContent = cat.label;
      filterSel.appendChild(filterOpt);

      // Pin form dropdown: optgroup with subcategories
      const group = document.createElement('optgroup');
      group.label = cat.label;
      Object.entries(cat.subcategories).forEach(([subKey, sub]) => {
        const opt = document.createElement('option');
        opt.value = subKey;
        opt.textContent = sub.label;
        group.appendChild(opt);
      });
      pinSel.appendChild(group);
    });
  },

  // Build the color legend — clickable to filter by category
  buildMaterialList() {
    const container = document.getElementById('material-filter-list');
    if (!container) return;
    container.innerHTML = '';

    const buildSection = (label, colorKey, pinType) => {
      // Section header
      const header = document.createElement('div');
      header.className = 'mat-section-header';
      header.innerHTML = `
        <span class="mat-section-title">${label}</span>
        <svg class="mat-chevron" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
      `;
      container.appendChild(header);

      // Items wrapper (collapsible)
      const group = document.createElement('div');
      group.className = 'mat-section-group';
      container.appendChild(group);

      header.addEventListener('click', () => {
        const collapsed = group.classList.toggle('collapsed');
        header.querySelector('.mat-chevron').style.transform = collapsed ? 'rotate(180deg)' : '';
      });

      Object.entries(CATEGORIES).forEach(([catKey, cat]) => {
        const color = cat[colorKey];
        const count = this.pins.filter(p =>
          MATERIALS[p.material_type]?.category === catKey && p.pin_type === pinType
        ).length;

        const item = document.createElement('div');
        item.className = 'mat-filter-item';
        item.dataset.catKey = catKey;
        item.dataset.pinType = pinType;
        item.innerHTML = `
          <div class="mat-dot-wrap">
            <span class="mat-dot" style="background:${color}"></span>
          </div>
          <span class="mat-filter-name">${cat.label}</span>
          <span class="mat-filter-count" id="mat-count-${catKey}-${pinType}">${count}</span>
        `;
        item.addEventListener('click', () => {
          this._materialFilters.has(catKey) ? this._materialFilters.delete(catKey) : this._materialFilters.add(catKey);
          const on = this._materialFilters.has(catKey);
          // Sync both have + need rows for same category
          document.querySelectorAll(`.mat-filter-item[data-cat-key="${catKey}"]`).forEach(el => {
            el.classList.toggle('checked', on);
          });
          this.applyFilters();
        });
        group.appendChild(item);
      });
    };

    buildSection('Have Material', 'haveColor', 'have');
    buildSection('Need Material', 'needColor', 'need');
  },

  updateMaterialCounts() {
    Object.entries(CATEGORIES).forEach(([catKey]) => {
      ['have', 'need'].forEach(pinType => {
        const el = document.getElementById(`mat-count-${catKey}-${pinType}`);
        if (!el) return;
        el.textContent = this.pins.filter(p =>
          MATERIALS[p.material_type]?.category === catKey && p.pin_type === pinType
        ).length;
      });
    });
  },

  syncMaterialSections(filterType) {
    const headers = document.querySelectorAll('.mat-section-header');
    headers.forEach(header => {
      const title = header.querySelector('.mat-section-title')?.textContent || '';
      const group = header.nextElementSibling;
      if (!group) return;
      if (filterType === 'all') {
        header.style.display = '';
        group.style.display = '';
        group.classList.remove('collapsed');
        header.querySelector('.mat-chevron').style.transform = '';
      } else if (filterType === 'have') {
        const hide = title.toLowerCase().includes('need');
        header.style.display = hide ? 'none' : '';
        group.style.display = hide ? 'none' : '';
      } else if (filterType === 'need') {
        const hide = title.toLowerCase().includes('have');
        header.style.display = hide ? 'none' : '';
        group.style.display = hide ? 'none' : '';
      }
    });
  },

  buildLegend() {
    const haveContainer = document.getElementById('legend-have-items');
    const needContainer = document.getElementById('legend-need-items');
    if (!haveContainer || !needContainer) return;

    Object.entries(CATEGORIES).forEach(([key, cat]) => {
      const haveItem = document.createElement('div');
      haveItem.className = 'legend-item';
      haveItem.dataset.cat = key;
      haveItem.dataset.pinType = 'have';
      haveItem.style.setProperty('--dot-color', cat.haveColor);
      haveItem.innerHTML = cat.label;
      haveContainer.appendChild(haveItem);

      const needItem = document.createElement('div');
      needItem.className = 'legend-item';
      needItem.dataset.cat = key;
      needItem.dataset.pinType = 'need';
      needItem.style.setProperty('--dot-color', cat.needColor);
      needItem.innerHTML = cat.label;
      needContainer.appendChild(needItem);
    });

    document.querySelectorAll('.legend-item').forEach(item => {
      item.addEventListener('click', () => {
        const cat = item.dataset.cat;
        const pinType = item.dataset.pinType;
        const isActive = item.classList.contains('active');

        // Clear all active states
        document.querySelectorAll('.legend-item').forEach(i => i.classList.remove('active'));

        if (isActive) {
          this._legendFilter = null;
        } else {
          item.classList.add('active');
          this._legendFilter = { cat, pinType };
        }

        this.applyFilters();
      });
    });
  },

  // Bind UI events
  bindEvents() {
    // Navigation
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(`view-${btn.dataset.view}`).classList.add('active');
        if (btn.dataset.view === 'messages') this.loadConversations();
        if (btn.dataset.view === 'my-pins') this.loadMyPins();
        if (btn.dataset.view === 'map' && window.map) window.map.invalidateSize();
        if (btn.dataset.view !== 'map') this.closePinPanel();
      });
    });

    // Click on map background closes panel
    document.getElementById('map').addEventListener('click', e => {
      if (e.target.closest('.leaflet-marker-icon')) return;
      this.closePinPanel();
    });

    // Auth buttons
    document.getElementById('btn-login').addEventListener('click', () => this.showAuthModal('login'));
    document.getElementById('btn-register').addEventListener('click', () => this.showAuthModal('register'));
    document.getElementById('btn-logout').addEventListener('click', () => this.logout());
    document.getElementById('btn-profile').addEventListener('click', () => this.showProfileModal());

    // Profile tabs
    document.querySelectorAll('.profile-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.profile-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById('form-profile').style.display = tab.dataset.ptab === 'details' ? 'flex' : 'none';
        document.getElementById('notifications-tab').style.display = tab.dataset.ptab === 'notifications' ? 'flex' : 'none';
        document.getElementById('billing-tab').style.display = tab.dataset.ptab === 'billing' ? 'flex' : 'none';
        document.getElementById('form-password').style.display = tab.dataset.ptab === 'password' ? 'flex' : 'none';
        document.getElementById('profile-error').textContent = '';
        document.getElementById('profile-success').textContent = '';
        document.getElementById('password-error').textContent = '';
        document.getElementById('password-success').textContent = '';
        document.getElementById('notification-success').textContent = '';
        if (tab.dataset.ptab === 'billing') this.loadBillingTab();
        if (tab.dataset.ptab === 'notifications') this.loadNotificationPrefs();
      });
    });


    // Profile form
    document.getElementById('form-profile').addEventListener('submit', async (e) => {
      e.preventDefault();
      const res = await fetch('/api/auth/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_name: document.getElementById('profile-company').value,
          contact_name: document.getElementById('profile-contact').value,
          phone:        document.getElementById('profile-phone').value
        })
      });
      if (res.ok) {
        this.user = await res.json();
        this.updateAuthUI();
        document.getElementById('profile-success').textContent = 'Changes saved.';
        document.getElementById('profile-error').textContent = '';
      } else {
        const err = await res.json();
        document.getElementById('profile-error').textContent = err.error;
      }
    });

    // Password form
    document.getElementById('form-password').addEventListener('submit', async (e) => {
      e.preventDefault();
      const newPw  = document.getElementById('pw-new').value;
      const confPw = document.getElementById('pw-confirm').value;
      if (newPw !== confPw) {
        document.getElementById('password-error').textContent = 'Passwords do not match.';
        return;
      }
      const res = await fetch('/api/auth/password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_password: document.getElementById('pw-current').value, new_password: newPw })
      });
      if (res.ok) {
        document.getElementById('password-success').textContent = 'Password updated.';
        document.getElementById('password-error').textContent = '';
        document.getElementById('form-password').reset();
      } else {
        const err = await res.json();
        document.getElementById('password-error').textContent = err.error;
      }
    });

    // Notification preferences save
    document.getElementById('btn-save-notifications').addEventListener('click', () => this.saveNotificationPrefs());

    // Proximity bell
    document.getElementById('btn-proximity-bell').addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleProximityDropdown();
    });
    document.getElementById('btn-mark-all-read').addEventListener('click', () => this.markAllProximityRead());
    document.getElementById('btn-save-proximity').addEventListener('click', () => this.saveProximitySettings());
    // Close dropdown when clicking elsewhere
    document.addEventListener('click', (e) => {
      const dropdown = document.getElementById('proximity-dropdown');
      if (dropdown.style.display !== 'none' && !e.target.closest('.proximity-bell-wrapper')) {
        dropdown.style.display = 'none';
      }
    });

    // Auth tabs
    document.querySelectorAll('#auth-tabs .tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('#auth-tabs .tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById('form-login').style.display = tab.dataset.tab === 'login' ? 'flex' : 'none';
        document.getElementById('form-register').style.display = tab.dataset.tab === 'register' ? 'flex' : 'none';
      });
    });

    // Auth forms
    document.getElementById('form-login').addEventListener('submit', e => this.handleLogin(e));
    document.getElementById('form-register').addEventListener('submit', e => this.handleRegister(e));

    // Drop pin
    document.getElementById('btn-drop-pin').addEventListener('click', () => this.startPinDrop());
    document.getElementById('btn-add-pin-quick').addEventListener('click', () => {
      // Switch to map view then start pin drop
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      document.querySelector('[data-view="map"]').classList.add('active');
      document.getElementById('view-map').classList.add('active');
      window.map.invalidateSize();
      this.startPinDrop();
    });

    // Pin form
    document.getElementById('form-pin').addEventListener('submit', e => this.handlePinSubmit(e));
    document.getElementById('pin-tested').addEventListener('change', e => {
      document.getElementById('test-report-row').style.display = e.target.checked ? 'block' : 'none';
    });

    // Address geocoding — when user types an address, move the pin to match
    let _addrTimer = null;
    document.getElementById('pin-address').addEventListener('input', () => {
      clearTimeout(_addrTimer);
      const val = document.getElementById('pin-address').value.trim();
      const status = document.getElementById('pin-address-status');
      if (!val) { status.textContent = ''; return; }
      status.style.color = '#8A7E74';
      status.textContent = 'Locating…';
      _addrTimer = setTimeout(async () => {
        try {
          const res = await fetch(`/api/geocode?q=${encodeURIComponent(val)}`);
          const results = await res.json();
          if (results.length > 0) {
            const lat = parseFloat(results[0].lat);
            const lng = parseFloat(results[0].lon);
            document.getElementById('pin-lat').value = lat;
            document.getElementById('pin-lng').value = lng;
            document.getElementById('pin-location-hint').textContent = `Location: ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
            // Move the temporary marker on the map
            if (window.DirtLink.tempMarker) {
              window.DirtLink.tempMarker.setLatLng([lat, lng]);
              window.map.panTo([lat, lng], { animate: true });
            }
            status.style.color = '#059669';
            status.textContent = '✓ Pin moved to this address';
          } else {
            status.style.color = '#8A7E74';
            status.textContent = 'Address not found — pin stays at map location';
          }
        } catch (e) {
          status.textContent = '';
        }
      }, 800);
    });

    // Photo preview
    document.getElementById('pin-photos').addEventListener('change', e => {
      const preview = document.getElementById('photo-preview');
      preview.innerHTML = '';
      const files = Array.from(e.target.files).slice(0, 5);
      files.forEach(file => {
        const reader = new FileReader();
        reader.onload = (ev) => {
          const img = document.createElement('img');
          img.src = ev.target.result;
          preview.appendChild(img);
        };
        reader.readAsDataURL(file);
      });
    });

    // Pin form timeline "Now" button
    document.getElementById('btn-pin-timeline-now').addEventListener('click', () => {
      document.getElementById('pin-timeline').value = '';
      document.getElementById('pin-timeline-value').value = 'now';
      document.getElementById('pin-timeline-hint').style.display = 'block';
      document.getElementById('pin-timeline-hint').textContent = 'Timeline set to: Immediate / Active';
      document.getElementById('btn-pin-timeline-now').classList.add('active');
    });
    document.getElementById('pin-timeline').addEventListener('input', (e) => {
      if (e.target.value) {
        document.getElementById('pin-timeline-value').value = e.target.value;
        document.getElementById('pin-timeline-hint').style.display = 'block';
        document.getElementById('pin-timeline-hint').textContent = `Timeline: ${new Date(e.target.value + 'T00:00').toLocaleDateString()}`;
        document.getElementById('btn-pin-timeline-now').classList.remove('active');
      }
    });

    // Active now toggle
    document.getElementById('filter-active-now').addEventListener('click', () => {
      const btn = document.getElementById('filter-active-now');
      btn.classList.toggle('active');
      const isOn = btn.classList.contains('active');
      btn.querySelector('.toggle-label').textContent = isOn ? 'On' : 'Off';
      this.applyFilters();
    });

    // Permit modal buttons
    document.getElementById('btn-permit-claim').addEventListener('click', () => this.startClaim());
    document.getElementById('btn-permit-inquire').addEventListener('click', () => this.startInquiry());
    document.getElementById('btn-confirm-inquiry').addEventListener('click', () => this.submitInquiry());
    document.getElementById('form-claim').addEventListener('submit', e => this.submitClaim(e));

    // Timeline "Now" button (claim form)
    document.getElementById('btn-timeline-now').addEventListener('click', () => {
      document.getElementById('claim-timeline').value = '';
      document.getElementById('claim-timeline-value').value = 'now';
      document.getElementById('timeline-hint').style.display = 'block';
      document.getElementById('timeline-hint').textContent = 'Timeline set to: Immediate / Active';
      document.getElementById('btn-timeline-now').classList.add('active');
    });
    document.getElementById('claim-timeline').addEventListener('change', (e) => {
      if (e.target.value) {
        document.getElementById('claim-timeline-value').value = e.target.value;
        document.getElementById('timeline-hint').style.display = 'block';
        document.getElementById('timeline-hint').textContent = `Timeline: ${new Date(e.target.value + 'T00:00').toLocaleDateString()}`;
        document.getElementById('btn-timeline-now').classList.remove('active');
      }
    });

    // Claim photo preview
    document.getElementById('claim-photos').addEventListener('change', e => {
      const preview = document.getElementById('claim-photo-preview');
      preview.innerHTML = '';
      Array.from(e.target.files).slice(0, 5).forEach(file => {
        const reader = new FileReader();
        reader.onload = (ev) => {
          const img = document.createElement('img');
          img.src = ev.target.result;
          preview.appendChild(img);
        };
        reader.readAsDataURL(file);
      });
    });

    // Filters
    document.querySelectorAll('.pin-type-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.pin-type-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.updateMaterialCounts();
        this.syncMaterialSections(btn.dataset.filterType);
        this.applyFilters();
      });
    });
    document.getElementById('filter-tested').addEventListener('change', () => this.applyFilters());
    document.getElementById('filter-my-company').addEventListener('change', () => this.applyFilters());
  },

  _showResetPasswordModal(token) {
    const modal = document.getElementById('modal-reset-password');
    modal.style.display = 'flex';
    document.getElementById('reset-pw-error').textContent = '';
    document.getElementById('reset-pw-success').style.display = 'none';
    document.getElementById('reset-pw-new').value = '';
    document.getElementById('reset-pw-confirm').value = '';

    document.getElementById('form-reset-password').onsubmit = async (e) => {
      e.preventDefault();
      const password = document.getElementById('reset-pw-new').value;
      const confirm = document.getElementById('reset-pw-confirm').value;
      if (password !== confirm) {
        document.getElementById('reset-pw-error').textContent = 'Passwords do not match';
        return;
      }
      const btn = e.target.querySelector('button[type=submit]');
      btn.disabled = true; btn.textContent = 'Saving…';

      try {
        const res = await fetch('/api/auth/reset-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, password })
        });
        const data = await res.json();
        if (res.ok) {
          document.getElementById('form-reset-password').style.display = 'none';
          const success = document.getElementById('reset-pw-success');
          success.style.display = 'block';
          success.textContent = 'Password updated! You can now log in.';
          setTimeout(() => {
            modal.style.display = 'none';
            document.getElementById('form-reset-password').style.display = 'flex';
            this.showAuthModal('login');
          }, 2000);
        } else {
          document.getElementById('reset-pw-error').textContent = data.error || 'Failed to reset password';
        }
      } catch (e) {
        document.getElementById('reset-pw-error').textContent = 'Something went wrong. Please try again.';
      }
      btn.disabled = false; btn.textContent = 'Set New Password';
    };
  },

  showForgotPassword() {
    document.getElementById('modal-auth').style.display = 'none';
    document.getElementById('modal-forgot-password').style.display = 'flex';
    document.getElementById('forgot-error').textContent = '';
    document.getElementById('forgot-email').value = '';
    document.getElementById('forgot-new-password').value = '';

    document.getElementById('form-forgot').onsubmit = async (e) => {
      e.preventDefault();
      const email = document.getElementById('forgot-email').value.trim();
      const password = document.getElementById('forgot-new-password').value;
      const btn = e.target.querySelector('button[type=submit]');
      btn.disabled = true; btn.textContent = 'Saving…';
      try {
        const res = await fetch('/api/auth/forgot-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        if (res.ok) {
          document.getElementById('modal-forgot-password').style.display = 'none';
          this.showAuthModal('login');
        } else {
          document.getElementById('forgot-error').textContent = data.error || 'Something went wrong.';
        }
      } catch (e) {
        document.getElementById('forgot-error').textContent = 'Something went wrong. Please try again.';
      }
      btn.disabled = false; btn.textContent = 'Set New Password';
    };
  },

  // Auth
  showAuthModal(tab) {
    document.getElementById('modal-auth').style.display = 'flex';
    document.querySelectorAll('#auth-tabs .tab').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === tab);
    });
    document.getElementById('form-login').style.display = tab === 'login' ? 'flex' : 'none';
    document.getElementById('form-register').style.display = tab === 'register' ? 'flex' : 'none';
  },

  async checkAuth() {
    try {
      const res = await fetch('/api/auth/me');
      if (res.ok) {
        this.user = await res.json();
        this.updateAuthUI();
      }
    } catch (e) { /* not logged in */ }
  },

  updateAuthUI() {
    if (this.user) {
      document.getElementById('auth-area').style.display = 'none';
      document.getElementById('user-area').style.display = 'flex';
      document.getElementById('user-company').textContent = this.user.company_name;
      const initial = (this.user.company_name || '?')[0].toUpperCase();
      document.querySelectorAll('#profile-avatar, #profile-avatar-lg').forEach(el => el.textContent = initial);
      document.getElementById('filter-company-group').style.display = 'flex';
      // Mobile drawer: show user section, hide auth section
      const drawerAuth = document.getElementById('mnd-auth-section');
      const drawerUser = document.getElementById('mnd-user-section');
      if (drawerAuth) drawerAuth.style.display = 'none';
      if (drawerUser) drawerUser.style.display = 'flex';
      const drawerCompany = document.getElementById('user-company-drawer');
      const drawerAvatar = document.getElementById('profile-avatar-drawer');
      if (drawerCompany) drawerCompany.textContent = this.user.company_name;
      if (drawerAvatar) drawerAvatar.textContent = initial;
    } else {
      document.getElementById('auth-area').style.display = 'flex';
      document.getElementById('user-area').style.display = 'none';
      document.getElementById('filter-company-group').style.display = 'none';
      // Mobile drawer: show auth section, hide user section
      const drawerAuth = document.getElementById('mnd-auth-section');
      const drawerUser = document.getElementById('mnd-user-section');
      if (drawerAuth) drawerAuth.style.display = 'flex';
      if (drawerUser) drawerUser.style.display = 'none';
    }
  },

  // Fetch and cache reveal status — used by pin panel
  async getRevealStatus() {
    try {
      const res = await fetch('/api/billing/status');
      if (!res.ok) return null;
      const { reveals } = await res.json();
      return reveals;
    } catch (e) { return null; }
  },

  showProfileModal(tab) {
    document.getElementById('profile-company').value  = this.user.company_name || '';
    document.getElementById('profile-contact').value  = this.user.contact_name || '';
    document.getElementById('profile-phone').value    = this.user.phone || '';
    document.getElementById('profile-email').value    = this.user.email || '';
    document.getElementById('profile-heading').textContent = this.user.company_name;
    const joined = this.user.created_at ? new Date(this.user.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : '';
    document.getElementById('profile-member-since').textContent = joined ? `Member since ${joined}` : '';
    // Reset tabs
    const activeTab = tab || 'details';
    document.querySelectorAll('.profile-tab').forEach(t => t.classList.toggle('active', t.dataset.ptab === activeTab));
    document.getElementById('form-profile').style.display = activeTab === 'details' ? 'flex' : 'none';
    document.getElementById('notifications-tab').style.display = activeTab === 'notifications' ? 'flex' : 'none';
    document.getElementById('billing-tab').style.display = activeTab === 'billing' ? 'flex' : 'none';
    document.getElementById('form-password').style.display = activeTab === 'password' ? 'flex' : 'none';
    document.getElementById('profile-error').textContent = '';
    document.getElementById('profile-success').textContent = '';
    document.getElementById('notification-success').textContent = '';
    if (activeTab === 'billing') this.loadBillingTab();
    // Navigate to account view
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('view-account').classList.add('active');
  },

  async handleLogin(e) {
    e.preventDefault();
    const form = e.target;
    const data = { email: form.email.value, password: form.password.value };
    const res = await fetch('/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
    });
    if (res.ok) {
      this.user = await res.json();
      this.updateAuthUI();
      document.getElementById('modal-auth').style.display = 'none';
      form.reset();
      this._resumePendingPermitAction();
    } else {
      const err = await res.json();
      document.getElementById('login-error').textContent = err.error;
    }
  },

  async handleRegister(e) {
    e.preventDefault();
    const form = e.target;
    const data = {
      email: form.email.value, password: form.password.value,
      company_name: form.company_name.value, contact_name: form.contact_name.value,
      phone: form.phone.value
    };
    const res = await fetch('/api/auth/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
    });
    if (res.ok) {
      this.user = await res.json();
      this.updateAuthUI();
      form.reset();
      this.showPlanPicker();
    } else {
      const err = await res.json();
      document.getElementById('register-error').textContent = err.error;
    }
  },

  showPlanPicker() {
    const PLANS = [
      {
        id: 'free',
        name: 'Free',
        price: '$0',
        per: '/mo',
        features: ['5 active pins', '3 contact reveals/mo', 'Basic map view', 'Direct messaging'],
        btnText: 'Start Free',
        btnClass: 'btn-free',
        href: null,
      },
      {
        id: 'pro',
        name: 'Pro',
        price: '$29',
        per: '/mo',
        features: ['25 active pins', '30 reveals/mo', 'Test report uploads', 'Priority listing'],
        btnText: 'Choose Pro',
        btnClass: 'btn-paid',
        href: 'https://buy.stripe.com/7sY6oGcAO3z8amc3xI3ZK0e',
      },
      {
        id: 'powerhouse',
        name: 'Powerhouse',
        price: '$59',
        per: '/mo',
        popular: true,
        features: ['Unlimited pins', '100 reveals/mo', 'Proximity alerts', 'Analytics dashboard'],
        btnText: 'Choose Powerhouse',
        btnClass: 'btn-amber',
        href: 'https://buy.stripe.com/00w4gy0S6fhQ8e45FQ3ZK0f',
      },
      {
        id: 'enterprise',
        name: 'Enterprise',
        price: '$199',
        per: '/mo',
        features: ['Everything in Powerhouse', 'Unlimited reveals', 'Dedicated support', 'Custom integrations'],
        btnText: 'Choose Enterprise',
        btnClass: 'btn-paid',
        href: 'https://buy.stripe.com/00w8wO30e8Tsamcecm3ZK0g',
      },
    ];

    const container = document.getElementById('mpp-plans');
    container.innerHTML = PLANS.map(p => `
      <div class="mpp-plan-card${p.popular ? ' mpp-popular' : ''}">
        ${p.popular ? '<div class="mpp-plan-badge">MOST POPULAR</div>' : ''}
        <div class="mpp-plan-name">${p.name}</div>
        <div class="mpp-plan-price">
          <span class="price-amt">${p.price}</span>
          <span class="price-per">${p.per}</span>
        </div>
        <ul class="mpp-plan-features">
          ${p.features.map(f => `<li>${f}</li>`).join('')}
        </ul>
        ${p.href
          ? `<a href="${p.href}" class="mpp-plan-btn ${p.btnClass}">${p.btnText}</a>`
          : `<button class="mpp-plan-btn ${p.btnClass}" onclick="document.getElementById('modal-auth').style.display='none'; window.DirtLink._resumePendingPermitAction();">${p.btnText}</button>`
        }
      </div>
    `).join('');

    // Switch to step 2 within the same auth modal
    document.getElementById('auth-step-1').style.display = 'none';
    document.getElementById('auth-step-2').style.display = '';
    // Widen modal for 4-column plan grid
    document.querySelector('#modal-auth .modal').classList.add('modal-plan-picker');
  },

  _resumePendingPermitAction() {
    if (!this._pendingPermitAction || !this._currentPermit) return;
    const action = this._pendingPermitAction;
    this._pendingPermitAction = null;
    if (action === 'claim') {
      this._showClaimForm();
    } else if (action === 'inquire') {
      this._showInquiryStep();
    }
  },

  async logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    this.user = null;
    this.updateAuthUI();

    // Clear messaging UI so previous user's conversations aren't visible
    const convList = document.getElementById('conv-list-items');
    if (convList) convList.innerHTML = '<p class="empty-state">Log in to see your messages.</p>';
    const thread = document.getElementById('thread-messages');
    if (thread) thread.innerHTML = '';
    const threadInput = document.getElementById('thread-input');
    if (threadInput) threadInput.style.display = 'none';
    if (window.Messaging) {
      window.Messaging.currentConversationId = null;
      clearInterval(window.Messaging.pollTimer);
      window.Messaging.pollTimer = null;
    }

    // Clear My Pins view too
    const pinsList = document.getElementById('my-pins-list');
    if (pinsList) pinsList.innerHTML = '<p class="empty-state">Log in to see your pins.</p>';
  },

  // Load external pins (permit + permanent) from API
  async loadExternalPins() {
    try {
      const [permitRes, permanentRes] = await Promise.all([
        fetch('/api/pins/permits'),
        fetch('/api/pins/permanent')
      ]);
      window._permitPins = permitRes.ok ? await permitRes.json() : [];
      window._permanentPins = permanentRes.ok ? await permanentRes.json() : [];
      // Re-render to include them
      if (window._permitPins.length || window._permanentPins.length) {
        window._permitPins.forEach(p => window.addPermitPinToMap(p));
        window._permanentPins.forEach(p => window.addPermanentPinToMap(p));
      }
    } catch (e) { console.error('Failed to load external pins', e); }
  },

  // Pins
  async loadPins() {
    try {
      const res = await fetch('/api/pins');
      if (res.ok) {
        this.pins = await res.json();
        window.renderPins(this.pins);
        this.updateMaterialCounts();
      }
    } catch (e) { console.error('Failed to load pins', e); }
  },

  startPinDrop() {
    if (!this.user) {
      this.showAuthModal('register');
      return;
    }
    // Step 1: Show crosshair overlay + instruction bar. User pans map to position.
    this.dropping = 'aiming'; // 'aiming' -> 'placed' -> done
    document.getElementById('map-crosshair').style.display = 'block';
    document.getElementById('drop-instruction').style.display = 'flex';
    document.getElementById('drop-instruction-text').textContent = 'Move the map to position the crosshair, then tap Place Pin';
    document.getElementById('btn-place-pin').style.display = 'inline-flex';
    document.getElementById('btn-confirm-pin').style.display = 'none';
  },

  // Step 2: User clicks "Place Pin" — drop a draggable marker at crosshair location
  placePinAtCrosshair() {
    const center = window.map.getCenter();
    const lat = center.lat;
    const lng = center.lng;

    // Hide crosshair, show draggable marker
    document.getElementById('map-crosshair').style.display = 'none';

    if (this.tempMarker) window.map.removeLayer(this.tempMarker);
    this.tempMarker = L.marker([lat, lng], {
      draggable: true,
      autoPan: true
    }).addTo(window.map);

    // Update form coords on drag
    this.tempMarker.on('dragend', () => {
      const pos = this.tempMarker.getLatLng();
      document.getElementById('pin-lat').value = pos.lat;
      document.getElementById('pin-lng').value = pos.lng;
    });

    document.getElementById('pin-lat').value = lat;
    document.getElementById('pin-lng').value = lng;

    // Update instruction bar to step 3
    this.dropping = 'placed';
    document.getElementById('drop-instruction-text').textContent = 'Drag the marker to fine-tune, then tap Continue';
    document.getElementById('btn-place-pin').style.display = 'none';
    document.getElementById('btn-confirm-pin').style.display = 'inline-flex';
  },

  // Step 3: User clicks "Continue" — open the form
  confirmPinLocation() {
    const lat = parseFloat(document.getElementById('pin-lat').value);
    const lng = parseFloat(document.getElementById('pin-lng').value);
    document.getElementById('btn-submit-pin').disabled = false;
    document.getElementById('btn-submit-pin').textContent = 'Create Pin';
    document.getElementById('pin-location-hint').textContent = `Location: ${lat.toFixed(5)}, ${lng.toFixed(5)}`;

    document.getElementById('drop-instruction').style.display = 'none';
    this._applyCalcPrefill();
    document.getElementById('modal-pin').style.display = 'flex';
  },

  cancelPinDrop() {
    this.dropping = false;
    document.getElementById('map-crosshair').style.display = 'none';
    document.getElementById('drop-instruction').style.display = 'none';
    if (this.tempMarker) {
      window.map.removeLayer(this.tempMarker);
      this.tempMarker = null;
    }
  },

  async handlePinSubmit(e) {
    e.preventDefault();
    const form = e.target;
    const formData = new FormData(form);

    let res;
    if (this._editingPinId) {
      // Update existing pin
      res = await fetch(`/api/pins/${this._editingPinId}`, { method: 'PUT', body: formData });
    } else {
      // Create new pin
      res = await fetch('/api/pins', { method: 'POST', body: formData });
    }

    if (res.ok) {
      document.getElementById('modal-pin').style.display = 'none';
      this.cancelPinDrop();
      this._editingPinId = null;
      form.reset();
      document.getElementById('test-report-row').style.display = 'none';
      document.getElementById('photo-preview').innerHTML = '';
      document.getElementById('pin-modal-title').textContent = 'Drop a Pin';
      document.getElementById('pin-timeline-hint').style.display = 'none';
      document.getElementById('pin-timeline-value').value = '';
      document.getElementById('btn-pin-timeline-now').classList.remove('active');
      // Reload all pins to reflect changes
      await this.loadPins();
      this.loadMyPins();
    } else {
      const err = await res.json();
      alert(err.error || 'Failed to save pin');
    }
  },

  applyFilters() {
    const typeBtn = document.querySelector('.pin-type-btn.active');
    const pinType = typeBtn ? typeBtn.dataset.filterType : 'all';
    const testedOnly = document.getElementById('filter-tested').checked;
    const myCompanyOnly = document.getElementById('filter-my-company').checked;
    const activeNowOnly = document.getElementById('filter-active-now').classList.contains('active');

    const filtered = this.pins.filter(p => {
      if (pinType !== 'all' && p.pin_type !== pinType) return false;
      if (this._materialFilters.size > 0 && !this._materialFilters.has(MATERIALS[p.material_type]?.category)) return false;
      if (testedOnly && !p.is_tested) return false;
      if (myCompanyOnly && this.user && p.company_name !== this.user.company_name) return false;
      if (activeNowOnly && p.timeline_date !== 'now') return false;
      return true;
    });

    window.renderPins(filtered);
  },

  // My Pins
  async loadMyPins() {
    if (!this.user) {
      document.getElementById('my-pins-list').innerHTML = '<p class="empty-state">Log in to see your pins.</p>';
      return;
    }
    const res = await fetch('/api/pins/user/mine');
    if (!res.ok) return;
    const pins = await res.json();
    const container = document.getElementById('my-pins-list');
    if (pins.length === 0) {
      container.innerHTML = '<p class="empty-state">You haven\'t dropped any pins yet.</p>';
      return;
    }

    // Fetch monitored pin IDs if eligible
    let monitoredPinIds = new Set();
    if (this._isProximityEligible()) {
      try {
        const settingsRes = await fetch('/api/proximity/settings');
        if (settingsRes.ok) {
          const data = await settingsRes.json();
          monitoredPinIds = new Set(data.monitoredPins.map(mp => mp.pin_id));
        }
      } catch (e) { /* ignore */ }
    }

    const activePins   = pins.filter(p =>  p.is_active);
    const archivedPins = pins.filter(p => !p.is_active);

    const renderCard = (p, archived = false) => {
      const timelineHtml = archived ? '' : this._getTimelineBadgeHtml(p);
      const staleHtml    = archived ? '' : this._getStaleBadgeHtml(p);
      const isMonitored  = monitoredPinIds.has(p.id);
      const monitorBtn   = this._isProximityEligible() && p.is_active
        ? `<button class="btn btn-sm ${isMonitored ? 'btn-monitor-active' : 'btn-outline'}" onclick="DirtLink.togglePinMonitoring('${p.id}', ${!isMonitored}).then(() => DirtLink.loadMyPins())" title="${isMonitored ? 'Stop monitoring' : 'Monitor for nearby sites'}">
            ${isMonitored ? 'Monitoring' : 'Monitor'}
          </button>`
        : '';
      return `
      <div class="pin-card ${p.pin_type}${archived ? ' archived' : ''}">
        <div class="pin-card-header">
          <span class="pin-type-badge" style="background:${getPinColor(p.pin_type, p.material_type)}">
            ${p.pin_type === 'have' ? '&#9650; HAVE' : '&#9660; NEED'}
          </span>
          <span class="pin-material">${MATERIALS[p.material_type]?.label || p.material_type}</span>
          ${p.is_tested ? '<span class="tested-badge">Tested</span>' : ''}
          ${timelineHtml}
          ${!archived ? `<span class="pin-status active">Active</span>` : ''}
        </div>
        ${staleHtml}
        <h4>${this.escapeHtml(p.title)}</h4>
        <p>${this.escapeHtml(p.description || '')}</p>
        ${p.quantity_estimate ? `<p class="pin-qty">${p.quantity_estimate} ${p.quantity_unit?.replace('_', ' ')}</p>` : ''}
        ${p.photos && p.photos.length > 0 ? `
          <div class="pin-photo-gallery" style="margin:8px 0">
            ${p.photos.map(ph => `<img src="${ph.file_path}" alt="Photo" style="width:60px;height:45px">`).join('')}
          </div>
        ` : ''}
        <div class="pin-card-actions">
          ${!archived ? `
            <button class="btn btn-sm btn-primary" onclick="DirtLink.editPin('${p.id}')">Edit</button>
            <button class="btn btn-sm btn-outline" onclick="DirtLink.repositionPin('${p.id}')">Reposition</button>
            <button class="btn btn-sm btn-outline" onclick="DirtLink.deactivatePin('${p.id}')">Mark Complete</button>
            ${monitorBtn}
          ` : `
            <button class="btn btn-sm btn-outline" onclick="DirtLink.reactivatePin('${p.id}')">Reactivate</button>
          `}
        </div>
      </div>
    `;
    };

    let html = '';

    if (activePins.length === 0 && archivedPins.length === 0) {
      html = '<p class="empty-state">You haven\'t dropped any pins yet.</p>';
    } else {
      if (activePins.length > 0) {
        html += activePins.map(p => renderCard(p, false)).join('');
      } else {
        html += '<p class="empty-state" style="margin-bottom:32px">No active pins. Drop a pin on the map to get started.</p>';
      }

      if (archivedPins.length > 0) {
        html += `
          <div class="archive-section-header">
            <span>Archive</span>
            <span class="archive-count">${archivedPins.length}</span>
          </div>
          ${archivedPins.map(p => renderCard(p, true)).join('')}
        `;
      }
    }

    container.innerHTML = html;
  },

  // Edit pin — open form pre-filled with existing data
  async editPin(id) {
    const res = await fetch(`/api/pins/${id}`);
    if (!res.ok) return;
    const pin = await res.json();

    // Pre-fill form
    const form = document.getElementById('form-pin');
    document.getElementById('pin-modal-title').textContent = 'Edit Pin';
    document.getElementById('pin-lat').value = pin.latitude;
    document.getElementById('pin-lng').value = pin.longitude;
    document.getElementById('pin-location-hint').textContent = `Location: ${pin.latitude.toFixed(5)}, ${pin.longitude.toFixed(5)}`;

    // Set radio
    const radioHave = form.querySelector('input[name="pin_type"][value="have"]');
    const radioNeed = form.querySelector('input[name="pin_type"][value="need"]');
    if (pin.pin_type === 'have') radioHave.checked = true;
    else radioNeed.checked = true;

    document.getElementById('pin-material').value = pin.material_type;
    document.getElementById('pin-title').value = pin.title;
    document.getElementById('pin-desc').value = pin.description || '';
    document.getElementById('pin-qty').value = pin.quantity_estimate || '';
    document.getElementById('pin-unit').value = pin.quantity_unit || 'cubic_yards';
    document.getElementById('pin-address').value = pin.address || '';
    document.getElementById('pin-tested').checked = !!pin.is_tested;
    document.getElementById('test-report-row').style.display = pin.is_tested ? 'block' : 'none';

    // Pre-fill timeline
    if (pin.timeline_date === 'now') {
      document.getElementById('pin-timeline').value = '';
      document.getElementById('pin-timeline-value').value = 'now';
      document.getElementById('pin-timeline-hint').style.display = 'block';
      document.getElementById('pin-timeline-hint').textContent = 'Timeline set to: Immediate / Active';
      document.getElementById('btn-pin-timeline-now').classList.add('active');
    } else if (pin.timeline_date) {
      document.getElementById('pin-timeline').value = pin.timeline_date;
      document.getElementById('pin-timeline-value').value = pin.timeline_date;
      document.getElementById('pin-timeline-hint').style.display = 'block';
      document.getElementById('pin-timeline-hint').textContent = `Timeline: ${new Date(pin.timeline_date + 'T00:00').toLocaleDateString()}`;
      document.getElementById('btn-pin-timeline-now').classList.remove('active');
    } else {
      document.getElementById('pin-timeline').value = '';
      document.getElementById('pin-timeline-value').value = '';
      document.getElementById('pin-timeline-hint').style.display = 'none';
      document.getElementById('btn-pin-timeline-now').classList.remove('active');
    }

    // Set submit to update mode
    document.getElementById('btn-submit-pin').disabled = false;
    document.getElementById('btn-submit-pin').textContent = 'Save Changes';
    this._editingPinId = id;

    document.getElementById('modal-pin').style.display = 'flex';
  },

  // Reposition pin — switch to map with draggable marker
  async repositionPin(id) {
    const res = await fetch(`/api/pins/${id}`);
    if (!res.ok) return;
    const pin = await res.json();

    // Switch to map view
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelector('[data-view="map"]').classList.add('active');
    document.getElementById('view-map').classList.add('active');
    window.map.invalidateSize();

    // Center on pin and zoom in
    window.map.setView([pin.latitude, pin.longitude], 15);

    // Place draggable marker
    if (this.tempMarker) window.map.removeLayer(this.tempMarker);
    this.tempMarker = L.marker([pin.latitude, pin.longitude], {
      draggable: true,
      autoPan: true
    }).addTo(window.map);

    this._repositionPinId = id;

    // Show instruction bar with save button
    document.getElementById('drop-instruction').style.display = 'flex';
    document.getElementById('drop-instruction-text').textContent = 'Drag the marker to the new location, then tap Save Position';
    document.getElementById('btn-place-pin').style.display = 'none';
    document.getElementById('btn-confirm-pin').style.display = 'none';

    // Add a temporary save button
    let saveBtn = document.getElementById('btn-save-reposition');
    if (!saveBtn) {
      saveBtn = document.createElement('button');
      saveBtn.id = 'btn-save-reposition';
      saveBtn.className = 'btn btn-sm';
      saveBtn.style.cssText = 'background:white;color:var(--primary);font-weight:700;';
      saveBtn.textContent = 'Save Position';
      saveBtn.onclick = () => this.saveReposition();
      document.getElementById('drop-instruction').insertBefore(saveBtn, document.querySelector('#drop-instruction .btn-outline'));
    }
    saveBtn.style.display = 'inline-flex';
  },

  async saveReposition() {
    if (!this._repositionPinId || !this.tempMarker) return;
    const pos = this.tempMarker.getLatLng();

    await fetch(`/api/pins/${this._repositionPinId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ latitude: pos.lat, longitude: pos.lng })
    });

    // Clean up
    window.map.removeLayer(this.tempMarker);
    this.tempMarker = null;
    this._repositionPinId = null;
    document.getElementById('drop-instruction').style.display = 'none';
    const saveBtn = document.getElementById('btn-save-reposition');
    if (saveBtn) saveBtn.style.display = 'none';

    // Reload pins
    await this.loadPins();
  },

  async deactivatePin(id) {
    if (!confirm('Mark this pin as complete? It will be hidden from the map.')) return;
    await fetch(`/api/pins/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: 0 })
    });
    this.loadMyPins();
    this.loadPins();
  },

  async reactivatePin(id) {
    await fetch(`/api/pins/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: 1 })
    });
    this.loadMyPins();
    this.loadPins();
  },

  async deletePin(id) {
    if (!confirm('Permanently delete this pin? This cannot be undone.')) return;
    await fetch(`/api/pins/${id}`, { method: 'DELETE' });
    this.loadMyPins();
    this.loadPins();
  },

  // Open right-side pin detail panel
  openPinPanel(pinOrId) {
    const panel = document.getElementById('pin-panel');
    const content = document.getElementById('pin-panel-content');
    content.innerHTML = '<div class="pp-panel-loading">Loading…</div>';
    panel.classList.add('open');
    if (window.map) window.map.invalidateSize();

    const id = typeof pinOrId === 'object' ? pinOrId.id : pinOrId;
    this.showPinDetail(id);
  },

  closePinPanel() {
    const panel = document.getElementById('pin-panel');
    panel.classList.remove('open');
    if (window.map) setTimeout(() => window.map.invalidateSize(), 230);
    if (window.clearActiveMarker) window.clearActiveMarker();
  },

  // Mobile: switch view via bottom nav or drawer
  switchView(viewName, btn) {
    document.querySelectorAll('.nav-btn, .mobile-nav-item, .mnd-nav-item').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    // Mark desktop nav, bottom nav, AND drawer nav items active
    document.querySelectorAll(`[data-view="${viewName}"]`).forEach(b => b.classList.add('active'));
    const viewEl = document.getElementById(`view-${viewName}`);
    if (viewEl) viewEl.classList.add('active');
    if (viewName === 'messages') this.loadConversations();
    if (viewName === 'my-pins') this.loadMyPins();
    if (viewName === 'account') { this.showProfileModal(); }
    if (viewName === 'map' && window.map) window.map.invalidateSize();
    if (viewName !== 'map') this.closePinPanel();
    document.body.classList.toggle('view-map-active', viewName === 'map');
  },

  // Mobile: nav drawer (burger menu)
  toggleMobileMenu() {
    const drawer = document.getElementById('mobile-nav-drawer');
    const overlay = document.getElementById('mobile-nav-overlay');
    const isOpen = drawer.classList.contains('open');
    drawer.classList.toggle('open', !isOpen);
    overlay.classList.toggle('active', !isOpen);
  },

  closeMobileMenu() {
    document.getElementById('mobile-nav-drawer').classList.remove('open');
    document.getElementById('mobile-nav-overlay').classList.remove('active');
  },

  // Mobile: sidebar filter drawer
  toggleMobileSidebar() {
    const sidebar = document.getElementById('map-sidebar');
    const overlay = document.getElementById('mobile-sidebar-overlay');
    const isOpen = sidebar.classList.contains('mobile-open');
    sidebar.classList.toggle('mobile-open', !isOpen);
    overlay.classList.toggle('active', !isOpen);
  },

  closeMobileSidebar() {
    document.getElementById('map-sidebar').classList.remove('mobile-open');
    document.getElementById('mobile-sidebar-overlay').classList.remove('active');
  },

  // Mobile: messages back button
  closeMobileThread() {
    const messagesLayout = document.querySelector('.messages-layout');
    if (messagesLayout) messagesLayout.classList.remove('thread-open');
    const backBtn = document.getElementById('btn-back-to-convos');
    if (backBtn) backBtn.style.display = 'none';
  },

  // Pin detail — renders into right panel
  async showPinDetail(pinId) {
    const [pinRes, reveals] = await Promise.all([
      fetch(`/api/pins/${pinId}`),
      this.user ? this.getRevealStatus() : Promise.resolve(null)
    ]);
    if (!pinRes.ok) return;
    const pin = await pinRes.json();
    const color = getPinColor(pin.pin_type, pin.material_type);
    const materialLabel = MATERIALS[pin.material_type]?.label || pin.material_type;
    const isHave = pin.pin_type === 'have';

    // Timeline
    let timelineHtml = '';
    if (pin.timeline_date === 'now') {
      timelineHtml = `<div class="pp-timeline-panel"><span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--primary);margin-right:2px"></span>Active Now</div>`;
    } else if (pin.timeline_date) {
      const d = new Date(pin.timeline_date + 'T00:00');
      const today = new Date(); today.setHours(0,0,0,0);
      const isPast = d < today;
      timelineHtml = `<div class="pp-timeline-panel${isPast ? ' stale' : ''}">${isPast ? '⚠ ' : ''}${isHave ? 'Remove by' : 'Need by'}: ${d.toLocaleDateString()}</div>`;
    }

    // Photos
    const photosHtml = pin.photos && pin.photos.length > 0
      ? pin.photos.map(ph => `<a href="${ph.file_path}" target="_blank"><img src="${ph.file_path}" alt="Photo"></a>`).join('')
      : '<div class="pp-no-photos">No photos uploaded</div>';

    // Actions
    // Reveals remaining note
    let revealsNote = '';
    if (this.user && reveals && reveals.limit !== -1 && this.user.id !== pin.user_id) {
      const low = reveals.remaining <= Math.ceil(reveals.limit * 0.3);
      const empty = reveals.remaining === 0;
      const color2 = empty ? '#DC2626' : low ? '#B45309' : 'var(--text-muted)';
      const buyBtn = (low || empty)
        ? `<button onclick="DirtLink.buyReveal()" class="btn btn-outline btn-sm" style="font-size:11px;padding:3px 10px;height:auto;line-height:1.4">Buy reveal</button>`
        : '';
      revealsNote = `<div style="display:flex;align-items:center;justify-content:center;gap:8px">
        <span style="font-size:11px;color:${color2}">${empty ? '0 reveals left' : `${reveals.remaining} reveal${reveals.remaining !== 1 ? 's' : ''} left`}</span>
        ${buyBtn}
      </div>`;
    }

    let actionsHtml = '';
    if (!this.user) {
      actionsHtml = `<button class="btn btn-outline" onclick="DirtLink.showAuthModal('login')">Log in to contact</button>`;
    } else if (this.user.id === pin.user_id) {
      actionsHtml = `<span style="font-size:13px;color:var(--text-muted);padding:4px 0">This is your pin</span>`;
    } else {
      actionsHtml = `
        <div style="display:flex;flex-direction:column;gap:8px;width:100%">
          ${revealsNote ? `<div style="text-align:center">${revealsNote}</div>` : ''}
          <button class="btn btn-primary btn-full" onclick="DirtLink.startConversation('${pin.id}')">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:5px"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            Message site
          </button>
        </div>
      `;
    }

    const shortId = pin.id ? pin.id.toString().slice(0,6).toUpperCase() : '——';

    document.getElementById('pin-panel-content').innerHTML = `
      <div class="pp-meta-row">
        <span class="pp-listing-id">Listing · #${shortId}</span>
        <span class="pp-type-badge" style="background:${color}">${isHave ? '▲ HAVE' : '▼ NEED'}</span>
      </div>

      <div class="pp-main">
        <div class="pp-title-lg">${this.escapeHtml(pin.title)}</div>
        <div class="pp-company-lg">${this.escapeHtml(pin.company_name)}</div>
        ${timelineHtml}
      </div>

      <div class="pp-stats">
        <div class="pp-stat-row">
          <span class="pp-stat-label">Material</span>
          <span class="pp-stat-value">${this.escapeHtml(materialLabel)}</span>
        </div>
        ${pin.quantity_estimate ? `
        <div class="pp-stat-row">
          <span class="pp-stat-label">Quantity</span>
          <span class="pp-stat-value">~${pin.quantity_estimate} ${(pin.quantity_unit || '').replace('_', ' ')}</span>
        </div>` : ''}
        ${pin.address ? `
        <div class="pp-stat-row">
          <span class="pp-stat-label">Address</span>
          <span class="pp-stat-value" style="max-width:180px;text-align:right">${this.escapeHtml(pin.address)}</span>
        </div>` : ''}
        ${pin.is_tested ? `
        <div class="pp-stat-row">
          <span class="pp-stat-label">Access</span>
          <span class="pp-stat-value" style="color:var(--success);font-weight:600">✓ Tested</span>
        </div>` : ''}
        ${pin.description ? `
        <div class="pp-stat-row" style="align-items:flex-start">
          <span class="pp-stat-label">Notes</span>
          <span class="pp-stat-value pp-description" style="max-width:190px;text-align:right">${this.escapeHtml(pin.description)}</span>
        </div>` : ''}
      </div>

      <div class="pp-section">
        <div class="pp-section-title">Site Photos</div>
        <div class="pp-photos">${photosHtml}</div>
        ${pin.test_report_path ? `<a href="${pin.test_report_path}" target="_blank" class="btn btn-sm btn-outline" style="margin-top:10px;display:inline-flex">View Test Report</a>` : ''}
      </div>

      <div class="pp-section">
        <div class="pp-section-title">Owner</div>
        <div class="pp-owner">
          <div class="pp-owner-avatar">${(pin.company_name || '?')[0].toUpperCase()}</div>
          <div>
            <div class="pp-owner-name">${this.escapeHtml(pin.company_name)}</div>
            ${pin.contact_name ? `<div class="pp-owner-sub">${this.escapeHtml(pin.contact_name)}</div>` : ''}
          </div>
        </div>
      </div>

      <div class="pp-panel-actions">
        ${actionsHtml}
      </div>
    `;
  },

  // Permanent pin detail modal — clean grouped layout
  async showPermanentPinDetail(pinId) {
    const res = await fetch(`/api/pins/permanent/${pinId}`);
    if (!res.ok) return;
    const pin = await res.json();
    const cfg = getSiteConfig(pin.site_type);

    const row = (label, value, isLink) => {
      if (!value) return '';
      const escaped = this.escapeHtml(value);
      const content = isLink
        ? `<a href="${escaped}" target="_blank" rel="noopener" style="color:${cfg.color};word-break:break-all;">${escaped}</a>`
        : escaped;
      return `<div class="perm-detail-row"><span class="perm-detail-label">${label}</span><span class="perm-detail-value">${content}</span></div>`;
    };

    const phoneLink = pin.contact_phone
      ? `<a href="tel:${this.escapeHtml(pin.contact_phone)}" style="color:${cfg.color}">${this.escapeHtml(pin.contact_phone)}</a>`
      : null;
    const emailLink = pin.contact_email
      ? `<a href="mailto:${this.escapeHtml(pin.contact_email)}" style="color:${cfg.color}">${this.escapeHtml(pin.contact_email)}</a>`
      : null;

    const isMine = this.user && pin.claimed_by === this.user.id;
    const canClaim = this.user && !pin.claimed_by;

    document.getElementById('pin-panel-content').innerHTML = `
      <div class="pp-meta-row">
        <span class="pp-listing-id">${cfg.tooltip}</span>
        <span class="pp-type-badge" style="background:${cfg.color}">&#9632; SITE</span>
      </div>

      <div class="pp-main">
        <div class="pp-title-lg">${this.escapeHtml(pin.site_name)}</div>
        ${pin.address ? `<div class="pp-company-lg">${this.escapeHtml(pin.address)}</div>` : ''}
        ${pin.claimed_company ? `<div class="pp-timeline-panel" style="color:var(--success)">&#10003; Managed by ${this.escapeHtml(pin.claimed_company)}</div>` : ''}
      </div>

      <div class="pp-stats">
        ${pin.hours_of_operation ? `<div class="pp-stat-row"><span class="pp-stat-label">Hours</span><span class="pp-stat-value">${this.escapeHtml(pin.hours_of_operation)}</span></div>` : ''}
        ${pin.accepted_materials ? `<div class="pp-stat-row"><span class="pp-stat-label">Accepts</span><span class="pp-stat-value" style="max-width:180px;text-align:right">${this.escapeHtml(pin.accepted_materials)}</span></div>` : ''}
        ${pin.rates_fees ? `<div class="pp-stat-row"><span class="pp-stat-label">Rates</span><span class="pp-stat-value" style="max-width:180px;text-align:right">${this.escapeHtml(pin.rates_fees)}</span></div>` : ''}
        ${pin.services ? `<div class="pp-stat-row"><span class="pp-stat-label">Services</span><span class="pp-stat-value" style="max-width:180px;text-align:right">${this.escapeHtml(pin.services)}</span></div>` : ''}
      </div>

      ${pin.description ? `<div class="pp-section"><div class="pp-section-title">About</div><p style="font-size:13px;color:var(--text-muted);line-height:1.5;margin:0">${this.escapeHtml(pin.description)}</p></div>` : ''}

      ${pin.notes ? `<div class="pp-section"><div class="pp-section-title">Notes</div><p style="font-size:13px;color:var(--text-muted);line-height:1.5;margin:0">${this.escapeHtml(pin.notes)}</p></div>` : ''}

      ${(pin.contact_phone || pin.contact_email || pin.website_url) ? `
      <div class="pp-stats">
        <div class="pp-stat-row" style="padding-top:0"><span class="pp-stat-label" style="font-size:10px;letter-spacing:.06em">CONTACT</span></div>
        ${pin.contact_phone ? `<div class="pp-stat-row"><span class="pp-stat-label">Phone</span><span class="pp-stat-value"><a href="tel:${this.escapeHtml(pin.contact_phone)}" style="color:${cfg.color}">${this.escapeHtml(pin.contact_phone)}</a></span></div>` : ''}
        ${pin.contact_email ? `<div class="pp-stat-row"><span class="pp-stat-label">Email</span><span class="pp-stat-value"><a href="mailto:${this.escapeHtml(pin.contact_email)}" style="color:${cfg.color};word-break:break-all">${this.escapeHtml(pin.contact_email)}</a></span></div>` : ''}
        ${pin.website_url ? `<div class="pp-stat-row"><span class="pp-stat-label">Web</span><span class="pp-stat-value"><a href="${this.escapeHtml(pin.website_url)}" target="_blank" rel="noopener" style="color:${cfg.color};word-break:break-all">${this.escapeHtml(pin.website_url)}</a></span></div>` : ''}
      </div>` : ''}

      <div class="pp-panel-actions" style="flex-direction:column;gap:8px">
        ${pin.directory_listing && pin.slug ? `<a class="btn btn-outline btn-full" href="/calgary/suppliers/${encodeURIComponent(pin.slug)}" style="text-align:center">View full profile &#8594;</a>` : ''}
        ${canClaim ? `<button class="btn btn-primary btn-full" onclick="DirtLink.claimPermanentPin('${pin.id}')">Claim This Listing</button>` : ''}
        ${isMine ? `<button class="btn btn-outline btn-full" onclick="DirtLink.editPermanentPin('${pin.id}')">Edit Listing</button>` : ''}
        ${!pin.claimed_by && !this.user ? `<button class="btn btn-primary btn-full" onclick="DirtLink.showAuthModal('register')">Log in to claim</button>` : ''}
        ${pin.claimed_by && !isMine ? `<button class="btn btn-outline btn-full" onclick="DirtLink.startConversation('${pin.id}')">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:5px"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          Message Site
        </button>` : ''}
      </div>
    `;
  },

  async claimPermanentPin(pinId) {
    if (!this.user) { this.showAuthModal('register'); return; }
    const res = await fetch(`/api/pins/permanent/claim/${pinId}`, { method: 'POST' });
    if (res.ok) {
      await this.loadExternalPins();
      await this.loadPins();
      this.showPermanentPinDetail(pinId);
    } else {
      const err = await res.json();
      alert(err.error || 'Could not claim this listing.');
    }
  },

  async editPermanentPin(pinId) {
    // For now, re-show detail. Full edit form is a future enhancement.
    alert('To update your listing details, please contact support or use the API. Full self-service editing is coming soon.');
  },

  async startConversation(pinId) {
    const res = await fetch('/api/messages/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin_id: pinId })
    });

    if (res.status === 402) {
      // No reveals — show gate
      this._showRevealGate();
      return;
    }

    if (!res.ok) {
      const err = await res.json();
      alert(err.error || 'Failed to start conversation');
      return;
    }

    // Close any open panels/modals
    document.getElementById('modal-pin-detail').style.display = 'none';
    document.getElementById('pin-panel').classList.remove('open');

    // Switch to messages view
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelector('[data-view="messages"]').classList.add('active');
    document.getElementById('view-messages').classList.add('active');

    const data = await res.json();
    await this.loadConversations();
    window.Messaging.openConversation(data.conversation.id);
  },

  async _showRevealGate() {
    // Fetch current reveal status for the gate UI
    let reveals = { overageRate: 4.99, plan: this.user?.user_type || 'free', remaining: 0 };
    try {
      const r = await fetch('/api/billing/status');
      if (r.ok) { const s = await r.json(); reveals = s.reveals; }
    } catch (e) {}

    const modal = document.getElementById('modal-reveal-gate');
    if (modal) {
      const container = document.getElementById('reveal-gate-content');
      if (container) {
        container.innerHTML = `
          <h3 style="margin:0 0 8px">No Reveals Left</h3>
          <p style="color:var(--text-muted);margin:0 0 20px;font-size:0.95rem">You need a reveal to contact this site. Each reveal unlocks one new connection.</p>
          <div id="reveal-gate-options-inner"></div>`;
        this._buildRevealGateOptions(document.getElementById('reveal-gate-options-inner'), reveals);
      }
      modal.style.display = 'flex';
    }
  },

  // ── Notification Preferences ──
  loadNotificationPrefs() {
    if (!this.user) return;
    const plan = this.user.user_type || 'free';
    const hasAccess = plan === 'powerhouse' || plan === 'enterprise';

    const gate = document.getElementById('notifications-upgrade-gate');
    const body = document.getElementById('notifications-settings-body');
    const saveBtn = document.getElementById('btn-save-notifications');

    if (!hasAccess) {
      gate.style.display = 'block';
      body.style.display = 'none';
      saveBtn.style.display = 'none';
      return;
    }

    gate.style.display = 'none';
    body.style.display = 'flex';
    body.style.flexDirection = 'column';
    body.style.gap = '16px';
    saveBtn.style.display = '';

    document.getElementById('pref-email-notifications').checked = !!this.user.email_notifications;
    document.getElementById('pref-sms-notifications').checked = !!this.user.sms_notifications;
    const phoneHint = document.getElementById('sms-phone-hint');
    if (this.user.phone) {
      phoneHint.textContent = `SMS will be sent to: ${this.user.phone}`;
    } else {
      phoneHint.innerHTML = 'No phone number on file. <a href="#" onclick="document.querySelector(\'[data-ptab=details]\').click(); return false;">Add one in Company Details</a>.';
    }
    // Load proximity settings if eligible
    this.loadProximitySettings();
  },

  async deleteAccount() {
    const confirmed = confirm(
      'Are you sure you want to permanently delete your account?\n\nThis will remove all your pins, messages, and data. This cannot be undone.'
    );
    if (!confirmed) return;

    const btn = document.getElementById('btn-delete-account');
    btn.textContent = 'Deleting…';
    btn.disabled = true;

    try {
      const res = await fetch('/api/auth/account', { method: 'DELETE' });
      if (res.ok) {
        alert('Your account has been deleted. You will now be redirected.');
        window.location.href = '/';
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.error || 'Failed to delete account. Please try again.');
        btn.textContent = 'Delete My Account';
        btn.disabled = false;
      }
    } catch {
      alert('Network error. Please try again.');
      btn.textContent = 'Delete My Account';
      btn.disabled = false;
    }
  },

  async saveNotificationPrefs() {
    const emailOn = document.getElementById('pref-email-notifications').checked;
    const smsOn = document.getElementById('pref-sms-notifications').checked;

    const res = await fetch('/api/auth/notifications', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email_notifications: emailOn, sms_notifications: smsOn })
    });

    if (res.ok) {
      this.user.email_notifications = emailOn ? 1 : 0;
      this.user.sms_notifications = smsOn ? 1 : 0;
      document.getElementById('notification-success').textContent = 'Preferences saved.';
    }
  },

  // Poll for unread messages
  async pollUnread() {
    if (!this.user) return;
    try {
      const res = await fetch('/api/messages/unread-count');
      if (res.ok) {
        const { count } = await res.json();
        const badge = document.getElementById('unread-badge');
        const mobileBadge = document.getElementById('mobile-unread-badge');
        const drawerBadge = document.getElementById('mobile-unread-badge-drawer');
        if (count > 0) {
          badge.textContent = count;
          badge.style.display = 'inline';
          if (mobileBadge) { mobileBadge.textContent = count; mobileBadge.style.display = 'flex'; }
          if (drawerBadge) { drawerBadge.textContent = count; drawerBadge.style.display = 'flex'; }
        } else {
          badge.style.display = 'none';
          if (mobileBadge) mobileBadge.style.display = 'none';
          if (drawerBadge) drawerBadge.style.display = 'none';
        }
      }
    } catch (e) { /* ignore */ }
    setTimeout(() => this.pollUnread(), 15000);
  },

  // Conversations
  async loadConversations() {
    if (!this.user) return;
    await window.Messaging.loadConversations();
  },

  // ============================================================
  // PERMIT PIN — Claim & Inquiry Flows
  // ============================================================

  // Open permit pin in the right panel
  openPermitPanel(permit) {
    this._currentPermit = permit;
    const panel = document.getElementById('pin-panel');
    const content = document.getElementById('pin-panel-content');
    panel.classList.add('open');
    if (window.map) window.map.invalidateSize();

    const claimBtn = this.user
      ? `<button class="btn btn-primary btn-full" onclick="DirtLink.startClaim()">
           <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:5px"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
           This Is My Site
         </button>
         <button class="btn btn-outline btn-full" onclick="DirtLink.startInquiry()">
           <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:5px"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
           Connect With This Site
         </button>`
      : `<button class="btn btn-primary btn-full" onclick="DirtLink.showAuthModal('register')">
           Log in to connect
         </button>`;

    content.innerHTML = `
      <div class="pp-meta-row">
        <span class="pp-listing-id">Development Permit</span>
        <span class="pp-type-badge" style="background:#6B7280">&#9650; SITE</span>
      </div>

      <div class="pp-main">
        <div class="pp-title-lg">${this.escapeHtml(permit.address)}</div>
        ${permit.project_description ? `<div class="pp-company-lg">${this.escapeHtml(permit.project_description)}</div>` : ''}
      </div>

      <div class="pp-stats">
        ${permit.permit_number ? `<div class="pp-stat-row"><span class="pp-stat-label">Permit #</span><span class="pp-stat-value">${this.escapeHtml(permit.permit_number)}</span></div>` : ''}
        ${permit.permit_type ? `<div class="pp-stat-row"><span class="pp-stat-label">Type</span><span class="pp-stat-value">${this.escapeHtml(permit.permit_type)}</span></div>` : ''}
        ${permit.permit_date ? `<div class="pp-stat-row"><span class="pp-stat-label">Issued</span><span class="pp-stat-value">${this.escapeHtml(permit.permit_date)}</span></div>` : ''}
        ${permit.estimated_project_size ? `<div class="pp-stat-row"><span class="pp-stat-label">Est. Size</span><span class="pp-stat-value">${this.escapeHtml(permit.estimated_project_size)}</span></div>` : ''}
      </div>

      <div class="pp-section">
        <div class="pp-section-title">About This Pin</div>
        <p style="font-size:13px;color:var(--text-muted);line-height:1.5;margin:0">This site has an active development permit. If this is your project, claim it to list available or needed material. Otherwise, connect to inquire about fill opportunities.</p>
      </div>

      <div class="pp-panel-actions" style="flex-direction:column;gap:8px">
        ${claimBtn}
      </div>
    `;
  },

  // Open permanent site pin in the right panel
  openPermanentPanel(pin) {
    const panel = document.getElementById('pin-panel');
    const content = document.getElementById('pin-panel-content');
    content.innerHTML = '<div class="pp-panel-loading">Loading…</div>';
    panel.classList.add('open');
    if (window.map) window.map.invalidateSize();
    this.showPermanentPinDetail(pin.id);
  },

  openPermitModal(permit) {
    this._currentPermit = permit;
    this.showPermitOptions();
    // Fill permit info
    const details = document.getElementById('permit-info-details');
    details.innerHTML = `
      <div class="permit-detail-row"><strong>Address:</strong> ${this.escapeHtml(permit.address)}</div>
      ${permit.permit_number ? `<div class="permit-detail-row"><strong>Permit #:</strong> ${this.escapeHtml(permit.permit_number)}</div>` : ''}
      ${permit.permit_type ? `<div class="permit-detail-row"><strong>Type:</strong> ${this.escapeHtml(permit.permit_type)}</div>` : ''}
      ${permit.permit_date ? `<div class="permit-detail-row"><strong>Date:</strong> ${this.escapeHtml(permit.permit_date)}</div>` : ''}
      ${permit.project_description ? `<div class="permit-detail-row"><strong>Description:</strong> ${this.escapeHtml(permit.project_description)}</div>` : ''}
      ${permit.estimated_project_size ? `<div class="permit-detail-row"><strong>Est. Size:</strong> ${this.escapeHtml(permit.estimated_project_size)}</div>` : ''}
    `;
    document.getElementById('modal-permit').style.display = 'flex';
  },

  showPermitOptions() {
    document.getElementById('permit-step-options').style.display = 'block';
    document.getElementById('permit-step-claim').style.display = 'none';
    document.getElementById('permit-step-inquire').style.display = 'none';
  },

  closePermitModal() {
    document.getElementById('modal-permit').style.display = 'none';
    this._currentPermit = null;
    this._pendingPermitAction = null;
    document.getElementById('claim-error').textContent = '';
    document.getElementById('inquiry-error').textContent = '';
    document.getElementById('form-claim').reset();
    document.getElementById('claim-photo-preview').innerHTML = '';
    document.getElementById('timeline-hint').style.display = 'none';
    document.getElementById('claim-timeline').value = '';
    document.getElementById('claim-timeline-value').value = '';
    document.getElementById('btn-timeline-now').classList.remove('active');
  },

  // Called when user clicks "This Is My Site"
  startClaim() {
    if (!this.user) {
      this._pendingPermitAction = 'claim';
      this.showAuthModal('register');
      return;
    }
    this._showClaimForm();
  },

  _showClaimForm() {
    const permit = this._currentPermit;
    if (!permit) return;
    document.getElementById('permit-step-options').style.display = 'none';
    document.getElementById('permit-step-claim').style.display = 'block';
    document.getElementById('claim-permit-id').value = permit.id;
    document.getElementById('claim-address').value = permit.address || '';
    document.getElementById('claim-address-hint').textContent = `Permit #${permit.permit_number} — ${permit.address}`;
    // Pre-fill contact from user profile
    if (this.user) {
      document.getElementById('claim-phone').value = this.user.phone || '';
      document.getElementById('claim-email').value = this.user.email || '';
    }
  },

  // Called when user clicks "I'd Like to Connect"
  startInquiry() {
    if (!this.user) {
      this._pendingPermitAction = 'inquire';
      this.showAuthModal('register');
      return;
    }
    this._showInquiryStep();
  },

  async _showInquiryStep() {
    const permit = this._currentPermit;
    if (!permit) return;
    document.getElementById('permit-step-options').style.display = 'none';
    document.getElementById('permit-step-inquire').style.display = 'block';
    document.getElementById('inquiry-confirm').style.display = 'block';
    document.getElementById('inquiry-no-reveals').style.display = 'none';
    document.getElementById('inquiry-success').style.display = 'none';
    document.getElementById('inquiry-error').textContent = '';

    // Show permit summary
    document.getElementById('inquiry-permit-summary').innerHTML = `
      <div class="permit-detail-row"><strong>Address:</strong> ${this.escapeHtml(permit.address)}</div>
      ${permit.permit_number ? `<div class="permit-detail-row"><strong>Permit #:</strong> ${this.escapeHtml(permit.permit_number)}</div>` : ''}
    `;

    // Check reveals
    try {
      const res = await fetch('/api/pins/reveals');
      if (res.ok) {
        const reveals = await res.json();
        const counter = document.getElementById('reveal-counter');
        if (reveals.remaining === -1) {
          counter.innerHTML = '<span class="reveals-unlimited">Unlimited reveals (Enterprise)</span>';
        } else if (reveals.remaining > 0) {
          counter.innerHTML = `This will use <strong>1</strong> of your <strong>${reveals.remaining}</strong> remaining reveals this month.`;
          // Show nudge if applicable
          if (reveals.nudge) {
            counter.innerHTML += `<div class="reveal-nudge">${reveals.nudge.message} <a href="#" onclick="event.preventDefault(); DirtLink.showBillingFromInquiry()">View plans</a></div>`;
          }
        } else {
          // No reveals left — show overage/upgrade options
          document.getElementById('inquiry-confirm').style.display = 'none';
          document.getElementById('inquiry-no-reveals').style.display = 'block';
          this._buildRevealGateOptions(document.getElementById('inquiry-reveal-gate-options'), reveals);
          return;
        }
      }
    } catch (e) { /* proceed anyway */ }
  },

  async submitInquiry() {
    const permit = this._currentPermit;
    if (!permit) return;
    const btn = document.getElementById('btn-confirm-inquiry');
    btn.disabled = true;
    btn.textContent = 'Submitting...';
    document.getElementById('inquiry-error').textContent = '';

    try {
      const res = await fetch(`/api/pins/inquire/${permit.id}`, { method: 'POST' });
      if (res.ok) {
        document.getElementById('inquiry-confirm').style.display = 'none';
        document.getElementById('inquiry-success').style.display = 'block';
      } else {
        const err = await res.json();
        if (err.upgrade_needed) {
          document.getElementById('inquiry-confirm').style.display = 'none';
          document.getElementById('inquiry-no-reveals').style.display = 'block';
        } else {
          document.getElementById('inquiry-error').textContent = err.error || 'Failed to submit inquiry';
        }
      }
    } catch (e) {
      document.getElementById('inquiry-error').textContent = 'Network error. Please try again.';
    }
    btn.disabled = false;
    btn.textContent = 'Confirm — Use 1 Reveal';
  },

  async submitClaim(e) {
    e.preventDefault();
    const form = e.target;
    const permitId = document.getElementById('claim-permit-id').value;
    const formData = new FormData(form);
    // Add pin_type from radio
    const pinType = form.querySelector('input[name="claim_pin_type"]:checked')?.value;
    if (!pinType) {
      document.getElementById('claim-error').textContent = 'Please select Have or Need.';
      return;
    }
    formData.set('pin_type', pinType);
    formData.delete('claim_pin_type');

    // Handle timeline
    const timelineVal = document.getElementById('claim-timeline').value;
    if (!timelineVal && !formData.get('timeline_date')) {
      // No date set — that's ok, it's optional
    }

    document.getElementById('claim-error').textContent = '';
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = 'Claiming...';

    try {
      const res = await fetch(`/api/pins/claim/${permitId}`, {
        method: 'POST',
        body: formData
      });
      if (res.ok) {
        this.closePermitModal();
        // Reload all pins — the permit pin is now a regular pin
        await this.loadPins();
        await this.loadExternalPins();
        this.loadMyPins();
      } else {
        const err = await res.json();
        document.getElementById('claim-error').textContent = err.error || 'Failed to claim site';
      }
    } catch (e) {
      document.getElementById('claim-error').textContent = 'Network error. Please try again.';
    }
    btn.disabled = false;
    btn.textContent = 'Claim & Activate Listing';
  },

  // ============================================================
  // BILLING & PLAN MANAGEMENT
  // ============================================================

  async loadBillingTab() {
    const [statusRes, historyRes] = await Promise.all([
      fetch('/api/billing/status'),
      fetch('/api/billing/history')
    ]);

    if (!statusRes.ok) return;
    const status = await statusRes.json();
    const history = historyRes.ok ? await historyRes.json() : [];

    // Cache reveal rate for picker
    if (status.reveals?.overageRate) this._lastRevealRate = status.reveals.overageRate;

    // Current Plan card
    document.getElementById('billing-current-plan').innerHTML = `
      <div class="billing-plan-card current">
        <div class="billing-plan-card-left">
          <div class="billing-plan-badge">${this.escapeHtml(status.planName)}</div>
          <div class="billing-plan-price">${status.planPrice > 0 ? `$${status.planPrice}<span>/mo</span>` : 'Free forever'}</div>
        </div>
        <div class="billing-plan-card-actions">
          ${status.stripeSubscriptionId ? `<button class="btn btn-sm btn-danger" onclick="DirtLink.cancelSubscription()">Cancel Plan</button>` : ''}
        </div>
      </div>
    `;

    // Reveal usage
    const rev = status.reveals;
    let revealHtml;
    if (rev.limit === -1) {
      revealHtml = `
        <div class="billing-reveals-card">
          <div class="billing-reveals-label">Monthly Reveals</div>
          <div class="billing-reveals-value">Unlimited</div>
        </div>`;
    } else {
      const pct = rev.limit > 0 ? Math.min(100, (rev.used / (rev.limit + rev.overagePurchasedThisCycle)) * 100) : 0;
      const pctColor = pct >= 90 ? 'var(--have)' : pct >= 60 ? 'var(--primary-dark)' : 'var(--primary)';
      revealHtml = `
        <div class="billing-reveals-card">
          <div class="billing-reveals-top">
            <div>
              <div class="billing-reveals-label">Monthly Reveals</div>
              <div class="billing-reveals-value"><strong>${rev.remaining}</strong> remaining</div>
            </div>
            <button class="btn btn-sm btn-primary" onclick="DirtLink.buyReveal()">+ Buy Reveal — $${rev.overageRate.toFixed(2)}</button>
          </div>
          <div class="billing-progress-track" style="margin-top:10px">
            <div class="billing-progress-fill" style="width:${pct}%; background:${pctColor}"></div>
          </div>
          <div class="billing-reveal-info" style="margin-top:6px">
            <span class="billing-reveal-detail">${rev.used} of ${rev.limit} included used${rev.overagePurchasedThisCycle > 0 ? ` · ${rev.overagePurchasedThisCycle} extra purchased` : ''}</span>
            ${rev.overageSpentThisCycle > 0 ? `<span class="billing-overage-spent">$${rev.overageSpentThisCycle.toFixed(2)} spent on extras</span>` : ''}
          </div>
        </div>`;
    }
    document.getElementById('billing-reveals').innerHTML = revealHtml;

    // Inline plan cards
    await this._renderPlanCards(status.plan);

    // Smart nudge
    const nudgeEl = document.getElementById('billing-nudge');
    if (status.nudge) {
      nudgeEl.style.display = 'block';
      nudgeEl.innerHTML = `
        <div class="nudge-card">
          <p>${this.escapeHtml(status.nudge.message)}</p>
          <button class="btn btn-sm btn-primary" onclick="DirtLink.startCheckout('${status.nudge.targetPlan}')">Upgrade to ${this.escapeHtml(status.nudge.targetPlan.charAt(0).toUpperCase() + status.nudge.targetPlan.slice(1))}</button>
        </div>
      `;
    } else {
      nudgeEl.style.display = 'none';
    }

    // Billing history
    const historyEl = document.getElementById('billing-history-list');
    if (history.length === 0) {
      historyEl.innerHTML = '<p class="empty-state" style="padding:12px">No billing history yet.</p>';
    } else {
      historyEl.innerHTML = history.map(h => `
        <div class="billing-history-item">
          <div class="billing-history-desc">
            <span>${this.escapeHtml(h.description)}</span>
            <span class="billing-history-date">${new Date(h.created_at).toLocaleDateString()}</span>
          </div>
          <div class="billing-history-amount">${h.amount > 0 ? '$' + (h.amount / 100).toFixed(2) : 'Free'}</div>
        </div>
      `).join('');
    }
  },

  async _renderPlanCards(currentPlan) {
    const res = await fetch('/api/billing/plans');
    if (!res.ok) return;
    const plans = await res.json();

    document.getElementById('billing-plans').innerHTML = `
      <div class="plan-cards-grid">
        ${plans.map(p => `
          <div class="plan-card ${p.key === currentPlan ? 'plan-current' : ''} ${p.key === 'powerhouse' && p.key !== currentPlan ? 'plan-recommended' : ''}">
            ${p.key === 'powerhouse' && p.key !== currentPlan ? '<div class="plan-recommended-badge">Most Popular</div>' : ''}
            <div class="plan-card-tier">${this.escapeHtml(p.name)}</div>
            <div class="plan-price">${p.price > 0 ? `$${p.price}<span>/mo</span>` : `$0<span>/mo</span>`}</div>
            <ul class="plan-features">
              ${p.features.map(f => `<li>${this.escapeHtml(f)}</li>`).join('')}
            </ul>
            ${p.key === currentPlan
              ? '<div class="plan-current-label">✓ Your current plan</div>'
              : p.key === 'free'
                ? `<button class="btn btn-outline btn-full btn-sm" onclick="DirtLink.cancelSubscription()">Downgrade to Free</button>`
                : `<button class="btn ${p.key === 'powerhouse' ? 'btn-primary' : 'btn-outline'} btn-full btn-sm" onclick="DirtLink.startCheckout('${p.key}')">
                    ${this._planIndex(p.key) > this._planIndex(currentPlan) ? 'Upgrade' : 'Switch'} to ${this.escapeHtml(p.name)}
                  </button>`
            }
          </div>
        `).join('')}
      </div>
    `;
  },

  _planIndex(key) {
    return ['free', 'pro', 'powerhouse', 'enterprise'].indexOf(key);
  },

  _buildRevealGateOptions(container, reveals) {
    const rate = reveals.overageRate || 4.99;
    const plan = reveals.plan || 'free';
    const plans = { free: { next: 'pro', nextName: 'Pro', nextPrice: 29 }, pro: { next: 'powerhouse', nextName: 'Powerhouse', nextPrice: 59 }, powerhouse: { next: 'enterprise', nextName: 'Enterprise', nextPrice: 149 } };
    const upgrade = plans[plan];

    let html = `
      <button class="btn btn-primary btn-full reveal-gate-buy" onclick="DirtLink.buyReveal()">
        Buy 1 Reveal — $${rate.toFixed(2)}
      </button>
    `;

    if (upgrade) {
      html += `
        <div class="reveal-gate-upgrade">
          <p>Or upgrade to <strong>${upgrade.nextName}</strong> for $${upgrade.nextPrice}/mo and get more included reveals.</p>
          <button class="btn btn-outline btn-full" onclick="DirtLink.startCheckout('${upgrade.next}')">
            Upgrade to ${upgrade.nextName}
          </button>
        </div>
      `;
    }

    container.innerHTML = html;
  },

  showBillingFromInquiry() {
    this.closePermitModal();
    this.showProfileModal('billing');
  },

  async startCheckout(plan) {
    const STRIPE_LINKS = {
      pro:         'https://buy.stripe.com/7sY6oGcAO3z8amc3xI3ZK0e',
      powerhouse:  'https://buy.stripe.com/00w4gy0S6fhQ8e45FQ3ZK0f',
      enterprise:  'https://buy.stripe.com/00w8wO30e8Tsamcecm3ZK0g',
    };
    if (STRIPE_LINKS[plan]) {
      window.location.href = STRIPE_LINKS[plan];
      return;
    }
    const res = await fetch('/api/billing/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan })
    });
    if (res.ok) {
      const { url } = await res.json();
      if (url) {
        window.location.href = url;
      } else {
        alert('Stripe is not configured. In production, this would redirect to checkout.');
      }
    } else {
      const err = await res.json();
      alert(err.error || 'Failed to start checkout');
    }
  },

  showRevealPicker() {
    // Get current overage rate from cached billing status
    const rate = this._lastRevealRate || 4.99;
    const packs = [
      { qty: 1, label: '1 Reveal', savings: null },
      { qty: 3, label: '3 Reveals', savings: '~save a trip' },
      { qty: 5, label: '5 Reveals', savings: 'most popular' },
      { qty: 10, label: '10 Reveals', savings: 'best value' }
    ];

    const existing = document.getElementById('modal-reveal-picker');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'modal-reveal-picker';
    modal.className = 'modal-overlay';
    modal.style.cssText = 'display:flex;z-index:9999';
    modal.innerHTML = `
      <div class="modal-box" style="max-width:420px;width:92%">
        <button class="modal-close" onclick="document.getElementById('modal-reveal-picker').remove()">✕</button>
        <h3 style="margin:0 0 6px;font-size:1.2rem">Buy Reveals</h3>
        <p style="margin:0 0 20px;color:var(--text-muted);font-size:0.9rem">$${rate.toFixed(2)} each at your plan rate</p>
        <div style="display:flex;flex-direction:column;gap:10px">
          ${packs.map(p => `
            <button class="reveal-pack-btn" data-qty="${p.qty}" onclick="DirtLink._confirmRevealPurchase(${p.qty})" style="
              display:flex;align-items:center;justify-content:space-between;
              padding:14px 18px;border:1.5px solid var(--border);border-radius:10px;
              background:#fff;cursor:pointer;font-size:1rem;font-family:inherit;
              transition:border-color 0.15s,background 0.15s
            ">
              <span style="font-weight:600">${p.label}</span>
              <span style="display:flex;align-items:center;gap:10px">
                ${p.savings ? `<span style="font-size:0.78rem;color:var(--primary-dark);background:#FEF3C7;padding:2px 8px;border-radius:12px">${p.savings}</span>` : ''}
                <span style="font-weight:700;color:var(--text)">$${(rate * p.qty).toFixed(2)}</span>
              </span>
            </button>
          `).join('')}
        </div>
      </div>`;

    // Hover effect
    modal.addEventListener('mouseover', e => {
      const btn = e.target.closest('.reveal-pack-btn');
      if (btn) { btn.style.borderColor = 'var(--primary)'; btn.style.background = '#FFFBF0'; }
    });
    modal.addEventListener('mouseout', e => {
      const btn = e.target.closest('.reveal-pack-btn');
      if (btn) { btn.style.borderColor = 'var(--border)'; btn.style.background = '#fff'; }
    });
    modal.addEventListener('click', e => {
      if (e.target === modal) modal.remove();
    });

    document.body.appendChild(modal);
  },

  async _confirmRevealPurchase(qty) {
    document.getElementById('modal-reveal-picker')?.remove();

    const allBtns = document.querySelectorAll('.reveal-gate-buy');
    allBtns.forEach(b => { b.disabled = true; b.textContent = 'Processing…'; });

    try {
      const res = await fetch('/api/billing/buy-reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity: qty })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.url) {
          window.location.href = data.url;
        } else if (data.devMode) {
          // Dev mode — reveals granted immediately
          document.getElementById('inquiry-no-reveals') && (document.getElementById('inquiry-no-reveals').style.display = 'none');
          document.getElementById('inquiry-confirm') && (document.getElementById('inquiry-confirm').style.display = 'block');
          if (document.getElementById('reveal-counter')) {
            document.getElementById('reveal-counter').innerHTML = `<strong>${data.reveals.remaining}</strong> reveals remaining.`;
          }
          document.getElementById('modal-reveal-gate') && (document.getElementById('modal-reveal-gate').style.display = 'none');
          // Refresh billing tab if open
          if (document.getElementById('tab-billing')?.classList.contains('active') ||
              document.querySelector('[data-ptab="billing"]')?.classList.contains('active')) {
            this.loadBillingTab();
          }
        }
      } else {
        const err = await res.json();
        alert(err.error || 'Failed to purchase reveal');
      }
    } catch (e) {
      alert('Network error — please try again');
    }
    allBtns.forEach(b => { b.disabled = false; b.textContent = 'Buy Reveals'; });
  },

  buyReveal() {
    this._confirmRevealPurchase(1);
  },

  async cancelSubscription() {
    if (!confirm('Cancel your subscription? You will keep your current plan until the end of the billing period, then be downgraded to Free.')) return;
    const res = await fetch('/api/billing/cancel', { method: 'POST' });
    if (res.ok) {
      alert('Subscription cancelled. Your plan remains active until the end of the current billing period.');
      this.loadBillingTab();
      // Refresh user data
      await this.checkAuth();
    } else {
      const err = await res.json();
      alert(err.error || 'Failed to cancel subscription');
    }
  },

  // Show reveal gate modal (used when clicking a claimed pin to see contact info)
  showRevealGate(reveals, onRevealGranted) {
    this._onRevealGranted = onRevealGranted;
    const content = document.getElementById('reveal-gate-content');
    const rate = reveals.overageRate || (this.user ? (this.user.overageRate || 4.99) : 4.99);
    const plan = reveals.plan || (this.user ? this.user.user_type : 'free');

    content.innerHTML = `
      <h2>No Reveals Remaining</h2>
      <p style="color:var(--text-muted); margin-bottom:20px;">You've used all ${reveals.limit} of your included reveals this month.</p>
      <div class="reveal-gate-options" id="modal-reveal-gate-options"></div>
    `;

    this._buildRevealGateOptions(document.getElementById('modal-reveal-gate-options'), { ...reveals, overageRate: rate, plan });
    document.getElementById('modal-reveal-gate').style.display = 'flex';
  },

  // Timeline helpers
  _getTimelineBadgeHtml(pin) {
    if (pin.timeline_date === 'now') {
      return '<span class="now-badge">Active Now</span>';
    }
    if (pin.timeline_date && pin.timeline_date !== 'now') {
      const d = new Date(pin.timeline_date + 'T00:00');
      return `<span class="timeline-badge">${d.toLocaleDateString()}</span>`;
    }
    return '';
  },

  _getStaleBadgeHtml(pin) {
    if (!pin.timeline_date || pin.timeline_date === 'now' || !pin.is_active) return '';
    const d = new Date(pin.timeline_date + 'T00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (d < today) {
      return '<div class="stale-warning">Timeline date has passed — please update or mark as complete.</div>';
    }
    return '';
  },

  _getTimelineDetailHtml(pin) {
    if (pin.timeline_date === 'now') {
      return `<p class="timeline-detail now"><span class="now-pulse-inline"></span><strong>Active Now</strong> — material needs to be moved immediately</p>`;
    }
    if (pin.timeline_date) {
      const d = new Date(pin.timeline_date + 'T00:00');
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const isPast = d < today;
      const label = pin.pin_type === 'have' ? 'Material removal by' : 'Material needed by';
      return `<p class="timeline-detail ${isPast ? 'stale' : ''}"><strong>${label}:</strong> ${d.toLocaleDateString()}${isPast ? ' <span class="stale-tag">Past due</span>' : ''}</p>`;
    }
    return '';
  },

  // ============================================================
  // PROXIMITY ALERTS
  // ============================================================

  _isProximityEligible() {
    return this.user && (this.user.user_type === 'powerhouse' || this.user.user_type === 'enterprise');
  },

  initProximityBell() {
    const wrapper = document.getElementById('proximity-bell-wrapper');
    if (this._isProximityEligible()) {
      wrapper.style.display = 'block';
    } else {
      wrapper.style.display = 'none';
    }
  },

  async pollProximityAlerts() {
    if (!this._isProximityEligible()) return;
    try {
      const res = await fetch('/api/proximity/notifications/count');
      if (res.ok) {
        const { count } = await res.json();
        const badge = document.getElementById('proximity-badge');
        if (count > 0) {
          badge.textContent = count;
          badge.style.display = 'inline';
        } else {
          badge.style.display = 'none';
        }
      }
    } catch (e) { /* ignore */ }
    setTimeout(() => this.pollProximityAlerts(), 30000);
  },

  async toggleProximityDropdown() {
    const dropdown = document.getElementById('proximity-dropdown');
    if (dropdown.style.display !== 'none') {
      dropdown.style.display = 'none';
      return;
    }
    dropdown.style.display = 'block';
    await this.loadProximityNotifications();
  },

  async loadProximityNotifications() {
    const list = document.getElementById('proximity-dropdown-list');
    list.innerHTML = '<p class="empty-state">Loading...</p>';

    try {
      const res = await fetch('/api/proximity/notifications?limit=20');
      if (!res.ok) throw new Error();
      const { notifications } = await res.json();

      if (notifications.length === 0) {
        list.innerHTML = '<p class="empty-state">No proximity alerts yet.</p>';
        return;
      }

      list.innerHTML = notifications.map(n => `
        <div class="proximity-notif-item ${n.is_read ? '' : 'unread'}" data-id="${n.id}">
          <div class="proximity-notif-title">${this.escapeHtml(n.title)}</div>
          <div class="proximity-notif-body">${this.escapeHtml(n.body)}</div>
          <div class="proximity-notif-time">${this._timeAgo(n.created_at)}</div>
        </div>
      `).join('');

      // Click to mark as read and navigate
      list.querySelectorAll('.proximity-notif-item.unread').forEach(item => {
        item.addEventListener('click', async () => {
          await fetch('/api/proximity/notifications/read', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ notification_ids: [item.dataset.id] })
          });
          item.classList.remove('unread');
          this.pollProximityAlerts();
        });
      });
    } catch (e) {
      list.innerHTML = '<p class="empty-state">Failed to load alerts.</p>';
    }
  },

  async markAllProximityRead() {
    await fetch('/api/proximity/notifications/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ all: true })
    });
    document.getElementById('proximity-badge').style.display = 'none';
    document.querySelectorAll('.proximity-notif-item.unread').forEach(el => el.classList.remove('unread'));
  },

  async loadProximitySettings() {
    const section = document.getElementById('proximity-settings-section');
    if (!this._isProximityEligible()) {
      section.style.display = 'none';
      return;
    }
    section.style.display = 'block';

    try {
      const res = await fetch('/api/proximity/settings');
      if (!res.ok) throw new Error();
      const data = await res.json();

      document.getElementById('proximity-default-radius').value = data.defaultRadius || 10;
      document.getElementById('proximity-global-pause').checked = !!data.globalPaused;

      const container = document.getElementById('proximity-monitored-pins');
      if (data.monitoredPins.length === 0) {
        container.innerHTML = '<p class="empty-state">No pins are being monitored yet. Go to My Pins and enable monitoring on any active listing.</p>';
      } else {
        container.innerHTML = data.monitoredPins.map(mp => `
          <div class="monitored-pin-card" data-setting-id="${mp.setting_id}">
            <div class="monitored-pin-info">
              <strong>${this.escapeHtml(mp.title || mp.address || 'Untitled')}</strong>
              <span class="monitored-pin-type ${mp.pin_type}">${mp.pin_type === 'have' ? 'HAVE' : 'NEED'}</span>
            </div>
            <div class="monitored-pin-controls">
              <select class="monitored-radius" data-setting-id="${mp.setting_id}">
                ${[5, 10, 25, 50].map(r => `<option value="${r}" ${r === mp.radius_km ? 'selected' : ''}>${r} km</option>`).join('')}
              </select>
              <label class="toggle-label toggle-sm">
                <input type="checkbox" class="monitored-pause" data-setting-id="${mp.setting_id}" ${mp.is_paused ? 'checked' : ''}>
                <span class="toggle-switch"></span>
                <span>Pause</span>
              </label>
              <button class="btn btn-sm btn-danger" onclick="DirtLink.removeMonitoring('${mp.setting_id}')">Remove</button>
            </div>
          </div>
        `).join('');
      }
    } catch (e) {
      // Not eligible or error
    }
  },

  async saveProximitySettings() {
    const radius = parseInt(document.getElementById('proximity-default-radius').value);
    const paused = document.getElementById('proximity-global-pause').checked;

    const res = await fetch('/api/proximity/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ default_radius_km: radius, paused })
    });

    // Save individual pin settings
    const cards = document.querySelectorAll('.monitored-pin-card');
    for (const card of cards) {
      const settingId = card.dataset.settingId;
      const radiusEl = card.querySelector('.monitored-radius');
      const pauseEl = card.querySelector('.monitored-pause');
      await fetch(`/api/proximity/monitor/${settingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          radius_km: parseInt(radiusEl.value),
          is_paused: pauseEl.checked
        })
      });
    }

    const msg = document.getElementById('proximity-success');
    msg.textContent = res.ok ? 'Proximity settings saved.' : 'Failed to save settings.';
  },

  async removeMonitoring(settingId) {
    await fetch(`/api/proximity/monitor/${settingId}`, { method: 'DELETE' });
    this.loadProximitySettings();
  },

  async togglePinMonitoring(pinId, enable) {
    if (enable) {
      const res = await fetch(`/api/proximity/monitor/${pinId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      return res.ok;
    } else {
      // Find setting for this pin and delete it
      const settingsRes = await fetch('/api/proximity/settings');
      if (settingsRes.ok) {
        const data = await settingsRes.json();
        const setting = data.monitoredPins.find(mp => mp.pin_id === pinId);
        if (setting) {
          await fetch(`/api/proximity/monitor/${setting.setting_id}`, { method: 'DELETE' });
        }
      }
      return true;
    }
  },

  _timeAgo(dateStr) {
    const now = new Date();
    const d = new Date(dateStr + (dateStr.includes('Z') ? '' : 'Z'));
    const diffMs = now - d;
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  },

  toggleLegendGroup(headerEl) {
    const group = headerEl.closest('.legend-group');
    group.classList.toggle('collapsed');
  },

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
};

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
  DirtLink.init();

  // Handle password reset link — /reset-password?token=xxx
  const params = new URLSearchParams(window.location.search);
  const resetToken = params.get('token');
  if (resetToken && window.location.pathname === '/reset-password') {
    DirtLink._showResetPasswordModal(resetToken);
    // Clean up URL
    history.replaceState(null, '', '/app');
  }
});
