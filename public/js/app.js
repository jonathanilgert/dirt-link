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
      haveItem.innerHTML = `<span class="legend-dot" style="background:${cat.haveColor}"></span>${cat.label}`;
      haveContainer.appendChild(haveItem);

      const needItem = document.createElement('div');
      needItem.className = 'legend-item';
      needItem.dataset.cat = key;
      needItem.innerHTML = `<span class="legend-dot" style="background:${cat.needColor}"></span>${cat.label}`;
      needContainer.appendChild(needItem);
    });

    document.querySelectorAll('.legend-item').forEach(item => {
      item.addEventListener('click', () => {
        const cat = item.dataset.cat;
        const select = document.getElementById('filter-material');
        const isActive = item.classList.contains('active');

        // Clear all active states
        document.querySelectorAll('.legend-item').forEach(i => i.classList.remove('active'));

        if (isActive) {
          // Toggle off — reset filter
          select.value = '';
        } else {
          // Activate this category — highlight both have + need rows
          document.querySelectorAll(`.legend-item[data-cat="${cat}"]`).forEach(i => i.classList.add('active'));
          select.value = 'cat:' + cat;
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
        document.getElementById('form-password').style.display = tab.dataset.ptab === 'password' ? 'flex' : 'none';
        document.getElementById('profile-error').textContent = '';
        document.getElementById('profile-success').textContent = '';
        document.getElementById('password-error').textContent = '';
        document.getElementById('password-success').textContent = '';
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

    // Permit modal buttons
    document.getElementById('btn-permit-claim').addEventListener('click', () => this.startClaim());
    document.getElementById('btn-permit-inquire').addEventListener('click', () => this.startInquiry());
    document.getElementById('btn-confirm-inquiry').addEventListener('click', () => this.submitInquiry());
    document.getElementById('form-claim').addEventListener('submit', e => this.submitClaim(e));

    // Timeline "Now" button
    document.getElementById('btn-timeline-now').addEventListener('click', () => {
      document.getElementById('claim-timeline').value = '';
      const formData = document.getElementById('form-claim');
      // Set a hidden indicator
      document.getElementById('claim-timeline').dataset.now = 'true';
      document.getElementById('timeline-hint').style.display = 'block';
      document.getElementById('timeline-hint').textContent = 'Timeline set to: Immediate / Active';
      // Set the actual value that gets submitted
      document.getElementById('claim-timeline').value = 'now';
    });
    document.getElementById('claim-timeline').addEventListener('change', (e) => {
      if (e.target.value && e.target.value !== 'now') {
        document.getElementById('timeline-hint').style.display = 'block';
        document.getElementById('timeline-hint').textContent = `Timeline: ${new Date(e.target.value).toLocaleDateString()}`;
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
    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.applyFilters();
      });
    });
    document.getElementById('filter-material').addEventListener('change', () => {
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
    document.getElementById('form-password').style.display = 'none';
    document.getElementById('profile-error').textContent = '';
    document.getElementById('profile-success').textContent = '';
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
      // Reload all pins to reflect changes
      await this.loadPins();
      this.loadMyPins();
    } else {
      const err = await res.json();
      alert(err.error || 'Failed to save pin');
    }
  },

  applyFilters() {
    const typeBtn = document.querySelector('.filter-btn.active');
    const pinType = typeBtn ? typeBtn.dataset.filterType : 'all';
    const materialFilter = document.getElementById('filter-material').value;
    const testedOnly = document.getElementById('filter-tested').checked;
    const myCompanyOnly = document.getElementById('filter-my-company').checked;

    const filtered = this.pins.filter(p => {
      if (pinType !== 'all' && p.pin_type !== pinType) return false;
      if (materialFilter) {
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
    container.innerHTML = pins.map(p => `
      <div class="pin-card ${p.pin_type}">
        <div class="pin-card-header">
          <span class="pin-type-badge" style="background:${getPinColor(p.pin_type, p.material_type)}">
            ${p.pin_type === 'have' ? '&#9650; HAVE' : '&#9660; NEED'}
          </span>
          <span class="pin-material">${MATERIALS[p.material_type]?.label || p.material_type}</span>
          ${p.is_tested ? '<span class="tested-badge">Tested</span>' : ''}
          <span class="pin-status ${p.is_active ? 'active' : 'inactive'}">${p.is_active ? 'Active' : 'Closed'}</span>
        </div>
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
          ` : `
            <button class="btn btn-sm btn-outline" onclick="DirtLink.reactivatePin('${p.id}')">Reactivate</button>
          `}
          <button class="btn btn-sm btn-danger" onclick="DirtLink.deletePin('${p.id}')">Delete</button>
        </div>
      </div>
    `).join('');
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

    document.getElementById('pin-detail-content').innerHTML = `
      <div class="pin-detail">
        <div class="pin-detail-header" style="border-left: 4px solid ${color}">
          <span class="pin-type-badge" style="background:${color}">
            ${pin.pin_type === 'have' ? '&#9650; HAVE' : '&#9660; NEED'}
          </span>
          <span class="pin-material-lg">${MATERIALS[pin.material_type]?.label || pin.material_type}</span>
          ${pin.is_tested ? '<span class="tested-badge">Tested</span>' : ''}
        </div>
        <h2>${this.escapeHtml(pin.title)}</h2>
        <p class="pin-company">${this.escapeHtml(pin.company_name)} &mdash; ${this.escapeHtml(pin.contact_name)}</p>
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
          counter.innerHTML = '<span class="reveals-unlimited">Unlimited connections (Pro)</span>';
        } else if (reveals.remaining > 0) {
          counter.innerHTML = `This will use <strong>1</strong> of your <strong>${reveals.remaining}</strong> remaining reveals this month.`;
        } else {
          // No reveals left
          document.getElementById('inquiry-confirm').style.display = 'none';
          document.getElementById('inquiry-no-reveals').style.display = 'block';
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

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
};

// Initialize on load
document.addEventListener('DOMContentLoaded', () => DirtLink.init());
