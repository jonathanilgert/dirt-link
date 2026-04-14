// DirtLink - Main Application Logic
window.DirtLink = {
  user: null,
  pins: [],
  dropping: false,
  tempMarker: null,

  _currentPermit: null,
  _pendingPermitAction: null, // 'claim' or 'inquire' — set before auth redirect

  async init() {
    this.populateMaterialSelects();
    this.populateClaimMaterialSelect();
    this.buildLegend();
    this.bindEvents();
    await this.checkAuth();
    await this.loadPins();
    await this.loadExternalPins();
    this.pollUnread();
    this.initProximityBell();
    this.pollProximityAlerts();
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
  buildLegend() {
    const haveContainer = document.getElementById('legend-have-items');
    const needContainer = document.getElementById('legend-need-items');

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
      });
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
        this.applyFilters();
      });
    });
    document.getElementById('filter-material').addEventListener('change', () => {
      this._legendFilter = null;
      document.querySelectorAll('.legend-item').forEach(i => i.classList.remove('active'));
      document.querySelectorAll('.legend-item').forEach(i => i.classList.remove('active'));
      this.applyFilters();
    });
    document.getElementById('filter-tested').addEventListener('change', () => this.applyFilters());
    document.getElementById('filter-my-company').addEventListener('change', () => this.applyFilters());
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
      document.getElementById('filter-company-group').style.display = 'block';
    } else {
      document.getElementById('auth-area').style.display = 'flex';
      document.getElementById('user-area').style.display = 'none';
      document.getElementById('filter-company-group').style.display = 'none';
    }
  },

  showProfileModal() {
    document.getElementById('profile-company').value  = this.user.company_name || '';
    document.getElementById('profile-contact').value  = this.user.contact_name || '';
    document.getElementById('profile-phone').value    = this.user.phone || '';
    document.getElementById('profile-email').value    = this.user.email || '';
    document.getElementById('profile-heading').textContent = this.user.company_name;
    const joined = this.user.created_at ? new Date(this.user.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : '';
    document.getElementById('profile-member-since').textContent = joined ? `Member since ${joined}` : '';
    // Reset tabs to details
    document.querySelectorAll('.profile-tab').forEach(t => t.classList.toggle('active', t.dataset.ptab === 'details'));
    document.getElementById('form-profile').style.display = 'flex';
    document.getElementById('notifications-tab').style.display = 'none';
    document.getElementById('billing-tab').style.display = 'none';
    document.getElementById('form-password').style.display = 'none';
    document.getElementById('profile-error').textContent = '';
    document.getElementById('profile-success').textContent = '';
    document.getElementById('notification-success').textContent = '';
    document.getElementById('modal-profile').style.display = 'flex';
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
      document.getElementById('modal-auth').style.display = 'none';
      form.reset();
      this._resumePendingPermitAction();
    } else {
      const err = await res.json();
      document.getElementById('register-error').textContent = err.error;
    }
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
    const materialFilter = document.getElementById('filter-material').value;
    const testedOnly = document.getElementById('filter-tested').checked;
    const myCompanyOnly = document.getElementById('filter-my-company').checked;
    const activeNowOnly = document.getElementById('filter-active-now').classList.contains('active');
    const legendFilter = this._legendFilter || null;

    const filtered = this.pins.filter(p => {
      if (pinType !== 'all' && p.pin_type !== pinType) return false;
      // Legend filter overrides material select — filters by type AND category independently
      if (legendFilter) {
        if (p.pin_type !== legendFilter.pinType) return false;
        const mat = MATERIALS[p.material_type];
        if (!mat || mat.category !== legendFilter.cat) return false;
      } else if (materialFilter) {
        if (materialFilter.startsWith('cat:')) {
          const catKey = materialFilter.replace('cat:', '');
          const mat = MATERIALS[p.material_type];
          if (!mat || mat.category !== catKey) return false;
        } else {
          if (p.material_type !== materialFilter) return false;
        }
      }
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

    container.innerHTML = pins.map(p => {
      const timelineHtml = this._getTimelineBadgeHtml(p);
      const staleHtml = this._getStaleBadgeHtml(p);
      const isMonitored = monitoredPinIds.has(p.id);
      const monitorBtn = this._isProximityEligible() && p.is_active
        ? `<button class="btn btn-sm ${isMonitored ? 'btn-monitor-active' : 'btn-outline'}" onclick="DirtLink.togglePinMonitoring('${p.id}', ${!isMonitored}).then(() => DirtLink.loadMyPins())" title="${isMonitored ? 'Stop monitoring' : 'Monitor for nearby sites'}">
            ${isMonitored ? 'Monitoring' : 'Monitor'}
          </button>`
        : '';
      return `
      <div class="pin-card ${p.pin_type}">
        <div class="pin-card-header">
          <span class="pin-type-badge" style="background:${getPinColor(p.pin_type, p.material_type)}">
            ${p.pin_type === 'have' ? '&#9650; HAVE' : '&#9660; NEED'}
          </span>
          <span class="pin-material">${MATERIALS[p.material_type]?.label || p.material_type}</span>
          ${p.is_tested ? '<span class="tested-badge">Tested</span>' : ''}
          ${timelineHtml}
          <span class="pin-status ${p.is_active ? 'active' : 'inactive'}">${p.is_active ? 'Active' : 'Closed'}</span>
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
          ${p.is_active ? `
            <button class="btn btn-sm btn-primary" onclick="DirtLink.editPin('${p.id}')">Edit</button>
            <button class="btn btn-sm btn-outline" onclick="DirtLink.repositionPin('${p.id}')">Reposition</button>
            <button class="btn btn-sm btn-outline" onclick="DirtLink.deactivatePin('${p.id}')">Mark Complete</button>
            ${monitorBtn}
          ` : `
            <button class="btn btn-sm btn-outline" onclick="DirtLink.reactivatePin('${p.id}')">Reactivate</button>
          `}
          <button class="btn btn-sm btn-danger" onclick="DirtLink.deletePin('${p.id}')">Delete</button>
        </div>
      </div>
    `}).join('');
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

  // Pin detail popup
  async showPinDetail(pinId) {
    const res = await fetch(`/api/pins/${pinId}`);
    if (!res.ok) return;
    const pin = await res.json();
    const color = getPinColor(pin.pin_type, pin.material_type);

    const timelineDetailHtml = this._getTimelineDetailHtml(pin);
    document.getElementById('pin-detail-content').innerHTML = `
      <div class="pin-detail">
        <div class="pin-detail-header" style="border-left: 4px solid ${color}">
          <span class="pin-type-badge" style="background:${color}">
            ${pin.pin_type === 'have' ? '&#9650; HAVE' : '&#9660; NEED'}
          </span>
          <span class="pin-material-lg">${MATERIALS[pin.material_type]?.label || pin.material_type}</span>
          ${pin.is_tested ? '<span class="tested-badge">Tested</span>' : ''}
          ${pin.timeline_date === 'now' ? '<span class="now-badge">Active Now</span>' : ''}
        </div>
        <h2>${this.escapeHtml(pin.title)}</h2>
        <p class="pin-company">${this.escapeHtml(pin.company_name)} &mdash; ${this.escapeHtml(pin.contact_name)}</p>
        ${timelineDetailHtml}
        ${pin.description ? `<p class="pin-description">${this.escapeHtml(pin.description)}</p>` : ''}
        ${pin.quantity_estimate ? `<p><strong>Quantity:</strong> ~${pin.quantity_estimate} ${pin.quantity_unit?.replace('_', ' ')}</p>` : ''}
        ${pin.address ? `<p><strong>Address:</strong> ${this.escapeHtml(pin.address)}</p>` : ''}
        ${pin.photos && pin.photos.length > 0 ? `
          <div class="pin-photo-gallery">
            ${pin.photos.map(ph => `<a href="${ph.file_path}" target="_blank"><img src="${ph.file_path}" alt="Material photo"></a>`).join('')}
          </div>
        ` : ''}
        ${pin.test_report_path ? `<p><a href="${pin.test_report_path}" target="_blank" class="btn btn-sm btn-outline">View Test Report</a></p>` : ''}
        ${pin.is_tested && !pin.test_report_path ? '<p><em>Material tested (report not uploaded)</em></p>' : ''}
        <hr>
        ${this.user && this.user.id !== pin.user_id
          ? `<button class="btn btn-primary" onclick="DirtLink.startConversation('${pin.id}')">Send Message</button>`
          : this.user ? '<p class="hint">This is your pin</p>' : '<p class="hint">Log in to send a message</p>'}
      </div>
    `;
    document.getElementById('modal-pin-detail').style.display = 'flex';
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

    document.getElementById('pin-detail-content').innerHTML = `
      <div class="perm-detail">
        <div class="perm-detail-header" style="background:${cfg.color}">
          <span class="perm-detail-type">${cfg.tooltip}</span>
          ${pin.claimed_company ? `<span class="perm-detail-claimed">Claimed</span>` : ''}
        </div>
        <h2 class="perm-detail-name">${this.escapeHtml(pin.site_name)}</h2>
        ${pin.description ? `<p class="perm-detail-desc">${this.escapeHtml(pin.description)}</p>` : ''}

        <div class="perm-detail-section">
          <div class="perm-detail-section-title">Location & Contact</div>
          ${row('Address', pin.address)}
          ${pin.contact_phone ? `<div class="perm-detail-row"><span class="perm-detail-label">Phone</span><span class="perm-detail-value">${phoneLink}</span></div>` : ''}
          ${pin.contact_email ? `<div class="perm-detail-row"><span class="perm-detail-label">Email</span><span class="perm-detail-value">${emailLink}</span></div>` : ''}
          ${row('Website', pin.website_url, true)}
        </div>

        <div class="perm-detail-section">
          <div class="perm-detail-section-title">Details</div>
          ${row('Hours', pin.hours_of_operation)}
          ${row('Accepted Materials', pin.accepted_materials)}
          ${row('Services', pin.services)}
          ${row('Rates & Fees', pin.rates_fees)}
          ${row('Category', pin.category)}
        </div>

        ${pin.notes ? `
        <div class="perm-detail-section">
          <div class="perm-detail-section-title">Notes</div>
          <p class="perm-detail-notes">${this.escapeHtml(pin.notes)}</p>
        </div>` : ''}

        ${pin.claimed_company ? `<div class="perm-detail-claimed-by">Managed by <strong>${this.escapeHtml(pin.claimed_company)}</strong></div>` : ''}

        <div class="perm-detail-actions">
          ${canClaim ? `<button class="btn btn-primary" onclick="DirtLink.claimPermanentPin('${pin.id}')">Claim This Listing</button>` : ''}
          ${isMine ? `<button class="btn btn-outline" onclick="DirtLink.editPermanentPin('${pin.id}')">Edit Listing</button>` : ''}
          ${!pin.claimed_by && !this.user ? `<p class="hint">Log in to claim this listing</p>` : ''}
        </div>
      </div>
    `;
    document.getElementById('modal-pin-detail').style.display = 'flex';
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
    document.getElementById('modal-pin-detail').style.display = 'none';
    // Switch to messages view
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelector('[data-view="messages"]').classList.add('active');
    document.getElementById('view-messages').classList.add('active');

    const res = await fetch('/api/messages/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin_id: pinId })
    });
    if (res.ok) {
      const data = await res.json();
      await this.loadConversations();
      window.Messaging.openConversation(data.conversation.id);
    }
  },

  // ── Notification Preferences ──
  loadNotificationPrefs() {
    if (!this.user) return;
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
        if (count > 0) {
          badge.textContent = count;
          badge.style.display = 'inline';
        } else {
          badge.style.display = 'none';
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

    // Current Plan card
    document.getElementById('billing-current-plan').innerHTML = `
      <div class="billing-plan-card current">
        <div class="billing-plan-badge">${this.escapeHtml(status.planName)}</div>
        <div class="billing-plan-price">${status.planPrice > 0 ? `$${status.planPrice}/mo` : 'Free'}</div>
        ${status.stripeSubscriptionId ? `<button class="btn btn-sm btn-danger" onclick="DirtLink.cancelSubscription()">Cancel Subscription</button>` : ''}
      </div>
    `;

    // Reveal usage
    const rev = status.reveals;
    let revealHtml;
    if (rev.limit === -1) {
      revealHtml = '<div class="billing-reveal-bar"><span class="reveals-unlimited">Unlimited reveals</span></div>';
    } else {
      const pct = rev.limit > 0 ? Math.min(100, (rev.used / (rev.limit + rev.overagePurchasedThisCycle)) * 100) : 0;
      revealHtml = `
        <div class="billing-reveal-info">
          <span><strong>${rev.remaining}</strong> reveals remaining</span>
          <span class="billing-reveal-detail">${rev.used} used of ${rev.limit} included${rev.overagePurchasedThisCycle > 0 ? ` + ${rev.overagePurchasedThisCycle} purchased` : ''}</span>
        </div>
        <div class="billing-progress-track">
          <div class="billing-progress-fill" style="width:${pct}%"></div>
        </div>
        ${rev.overageSpentThisCycle > 0 ? `<p class="billing-overage-spent">$${rev.overageSpentThisCycle.toFixed(2)} spent on additional reveals this cycle</p>` : ''}
      `;
    }
    document.getElementById('billing-reveals').innerHTML = revealHtml;

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

    // Plan comparison cards
    await this._renderPlanCards(status.plan);

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
      <h4>Available Plans</h4>
      <div class="plan-cards-grid">
        ${plans.map(p => `
          <div class="plan-card ${p.key === currentPlan ? 'plan-current' : ''} ${p.key === 'pro' ? 'plan-recommended' : ''}">
            ${p.key === 'pro' ? '<div class="plan-recommended-badge">Most Popular</div>' : ''}
            <h4>${this.escapeHtml(p.name)}</h4>
            <div class="plan-price">${p.price > 0 ? `$${p.price}<span>/mo</span>` : 'Free'}</div>
            <ul class="plan-features">
              ${p.features.map(f => `<li>${this.escapeHtml(f)}</li>`).join('')}
            </ul>
            ${p.key === currentPlan
              ? '<button class="btn btn-outline btn-full" disabled>Current Plan</button>'
              : p.key === 'free'
                ? ''
                : `<button class="btn btn-primary btn-full" onclick="DirtLink.startCheckout('${p.key}')">
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
    this.showProfileModal();
    // Switch to billing tab
    setTimeout(() => {
      document.querySelectorAll('.profile-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.ptab === 'billing');
      });
      document.getElementById('form-profile').style.display = 'none';
      document.getElementById('notifications-tab').style.display = 'none';
      document.getElementById('billing-tab').style.display = 'flex';
      document.getElementById('form-password').style.display = 'none';
      this.loadBillingTab();
    }, 100);
  },

  async startCheckout(plan) {
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

  async buyReveal() {
    const btn = document.querySelector('.reveal-gate-buy');
    if (btn) { btn.disabled = true; btn.textContent = 'Processing...'; }

    const res = await fetch('/api/billing/buy-reveal', { method: 'POST' });
    if (res.ok) {
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else if (data.devMode) {
        // Dev mode — reveal granted immediately
        alert('Reveal purchased (dev mode). You can now use it.');
        // Close the gate and re-attempt the inquiry
        document.getElementById('inquiry-no-reveals').style.display = 'none';
        document.getElementById('inquiry-confirm').style.display = 'block';
        document.getElementById('reveal-counter').innerHTML = `<strong>${data.reveals.remaining}</strong> reveals remaining.`;
        // Also close standalone gate modal if open
        document.getElementById('modal-reveal-gate').style.display = 'none';
      }
    } else {
      const err = await res.json();
      alert(err.error || 'Failed to purchase reveal');
    }
    if (btn) { btn.disabled = false; btn.textContent = `Buy 1 Reveal`; }
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
document.addEventListener('DOMContentLoaded', () => DirtLink.init());
