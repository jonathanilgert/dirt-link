// DirtLink - Map Module (Leaflet)

let map;
const pinMarkers = L.layerGroup();

function initMap() {
  map = L.map('map', {
    center: [51.0447, -114.0719], // Default: Calgary, AB
    zoom: 11,
    zoomControl: false
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19
  }).addTo(map);

  // Zoom control — bottom-right keeps the top clear for the instruction bar
  L.control.zoom({ position: 'bottomright' }).addTo(map);

  pinMarkers.addTo(map);

  window.map = map;

  // Green + river layers — single Overpass query to avoid rate limiting
  const greenLayer = L.layerGroup().addTo(map);
  const riverLayer = L.layerGroup().addTo(map);
  let naturalFetchTimer = null;

  async function updateNaturalLayers() {
    if (map.getZoom() < 9) {
      greenLayer.clearLayers();
      riverLayer.clearLayers();
      return;
    }
    const b = map.getBounds();
    const bbox = `${b.getSouth().toFixed(4)},${b.getWest().toFixed(4)},${b.getNorth().toFixed(4)},${b.getEast().toFixed(4)}`;
    const query = `[out:json][timeout:25];(
      way["leisure"~"^(park|garden|nature_reserve)$"](${bbox});
      way["landuse"~"^(forest|grass|meadow|recreation_ground|village_green)$"](${bbox});
      way["natural"~"^(wood|grassland|heath)$"](${bbox});
      way["waterway"~"^(river|canal)$"](${bbox});
      way["waterway"="stream"](${bbox});
    );out geom;`;
    try {
      const res = await fetch(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`);
      if (!res.ok) return;
      const data = await res.json();
      greenLayer.clearLayers();
      riverLayer.clearLayers();
      data.elements.forEach(el => {
        if (!el.geometry) return;
        const latlngs = el.geometry.map(p => [p.lat, p.lon]);
        const ww = el.tags?.waterway;
        if (ww) {
          L.polyline(latlngs, {
            color: '#89C4E1',
            weight: (ww === 'river' || ww === 'canal') ? 3 : 1.5,
            opacity: 0.75,
            lineCap: 'round',
            lineJoin: 'round'
          }).addTo(riverLayer);
        } else {
          L.polygon(latlngs, {
            color: '#7BD295',
            fillColor: '#7BD295',
            weight: 0,
            fillOpacity: 0.45
          }).addTo(greenLayer);
        }
      });
    } catch (e) { /* silently ignore */ }
  }

  map.on('moveend', () => {
    clearTimeout(naturalFetchTimer);
    naturalFetchTimer = setTimeout(updateNaturalLayers, 600);
  });

  updateNaturalLayers();

  // Show location prompt on first visit, or use saved location
  const savedLocation = localStorage.getItem('dirtlink_location');
  if (savedLocation) {
    const loc = JSON.parse(savedLocation);
    map.setView([loc.lat, loc.lng], loc.zoom || 12);
  } else {
    document.getElementById('modal-location').style.display = 'flex';
  }

  // Bind location form
  document.getElementById('form-location').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('location-input').value.trim();
    if (!input) return;
    await geocodeAndCenter(input);
  });

  document.getElementById('btn-skip-location').addEventListener('click', () => {
    document.getElementById('modal-location').style.display = 'none';
    // Try browser geolocation
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude, zoom: 12 };
          map.setView([loc.lat, loc.lng], loc.zoom);
          localStorage.setItem('dirtlink_location', JSON.stringify(loc));
        },
        () => { /* keep default */ },
        { timeout: 5000 }
      );
    }
  });
}

// Geocode a postal/zip code using OpenStreetMap Nominatim (free, no API key)
async function geocodeAndCenter(query) {
  const btn = document.querySelector('#form-location button[type="submit"]');
  btn.textContent = 'Finding location...';
  btn.disabled = true;

  try {
    const res = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`);
    const results = await res.json();

    if (results.length > 0) {
      const loc = {
        lat: parseFloat(results[0].lat),
        lng: parseFloat(results[0].lon),
        zoom: 12
      };
      map.setView([loc.lat, loc.lng], loc.zoom);
      localStorage.setItem('dirtlink_location', JSON.stringify(loc));
      document.getElementById('modal-location').style.display = 'none';
    } else {
      alert('Could not find that location. Please try a different zip/postal code or city name.');
    }
  } catch (err) {
    alert('Error looking up location. Please try again.');
  }

  btn.textContent = 'Go to My Area';
  btn.disabled = false;
}

// Create a custom colored marker — polished SVG triangles
function createPinIcon(pinType, materialType, isTested, isNow) {
  const color = getPinColor(pinType, materialType);
  const isHave = pinType === 'have';
  const size = 38;

  // Up triangle = HAVE, down triangle = NEED
  const points = isHave ? '19,4 35,34 3,34' : '19,34 35,4 3,4';
  const checkY  = isHave ? '26' : '14';

  const baseFilter = 'drop-shadow(0 2px 5px rgba(0,0,0,0.35)) drop-shadow(0 1px 2px rgba(0,0,0,0.18))';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="filter:${baseFilter};display:block;">
    <polygon points="${points}" fill="${color}" stroke="white" stroke-width="2.5" stroke-linejoin="round">${isNow ? `<animate attributeName="opacity" values="1;0.55;1" dur="1.8s" repeatCount="indefinite"/>` : ''}</polygon>
    ${isTested ? `<text x="19" y="${checkY}" text-anchor="middle" dominant-baseline="middle" font-size="13" fill="white" font-weight="700" font-family="Inter,sans-serif">✓</text>` : ''}
  </svg>`;

  return L.divIcon({
    className: 'custom-pin' + (isNow ? ' pin-now' : ''),
    html: svg,
    iconSize:    [size, size],
    iconAnchor:  [size / 2, isHave ? size : 0],
    popupAnchor: [0, isHave ? -size : size]
  });
}

// Create icon for opaque (unclaimed) permit pins — semi-transparent upright triangle
function createPermitPinIcon() {
  const size = 38;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="filter:drop-shadow(0 2px 4px rgba(0,0,0,0.2));display:block;">
    <polygon points="19,4 35,34 3,34" fill="rgba(120,120,120,0.45)" stroke="rgba(80,80,80,0.6)" stroke-width="2" stroke-linejoin="round"/>
    <text x="19" y="26" text-anchor="middle" dominant-baseline="middle" font-size="11" fill="rgba(60,60,60,0.7)" font-weight="700" font-family="Inter,sans-serif">?</text>
  </svg>`;
  return L.divIcon({
    className: 'custom-pin permit-pin',
    html: `<div title="Development Permit">${svg}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size],
    popupAnchor: [0, -size]
  });
}

// Site type config — colors, labels, and tooltip text
const SITE_TYPE_CONFIG = {
  landfill:           { color: '#7C3AED', label: 'LF', tooltip: 'Landfill' },
  transfer_station:   { color: '#0891B2', label: 'TS', tooltip: 'Transfer Station' },
  processing_site:    { color: '#B45309', label: 'PS', tooltip: 'Processing Site' },
  supplier:           { color: '#059669', label: 'SP', tooltip: 'Earth Material Supplier' },
  recycler:           { color: '#0284C7', label: 'RC', tooltip: 'Metal Recycler' },
  composting:         { color: '#65A30D', label: 'CM', tooltip: 'Composting Facility' },
  concrete_plant:     { color: '#64748B', label: 'CP', tooltip: 'Concrete Plant' },
  demolition:         { color: '#DC2626', label: 'DM', tooltip: 'Demolition Services' },
};

function getSiteConfig(siteType) {
  return SITE_TYPE_CONFIG[siteType] || { color: '#6B7280', label: (siteType || '??').substring(0, 2).toUpperCase(), tooltip: (siteType || 'Site').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) };
}

// Create icon for permanent site pins — square with distinct color + tooltip
function createPermanentPinIcon(siteType) {
  const size = 34;
  const cfg = getSiteConfig(siteType);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="filter:drop-shadow(0 2px 4px rgba(0,0,0,0.3));display:block;">
    <rect x="2" y="2" width="30" height="30" rx="5" fill="${cfg.color}" stroke="white" stroke-width="2.5"/>
    <text x="17" y="19" text-anchor="middle" dominant-baseline="middle" font-size="10" fill="white" font-weight="700" font-family="Inter,sans-serif">${cfg.label}</text>
  </svg>`;
  return L.divIcon({
    className: 'custom-pin permanent-pin',
    html: `<div title="${cfg.tooltip}">${svg}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size],
    popupAnchor: [0, -size]
  });
}

// Render all pins on the map (includes standard, permit, and permanent)
window.renderPins = function(pins) {
  pinMarkers.clearLayers();
  pins.forEach(pin => addPinToMap(pin));
  // Also render permit and permanent pins
  if (window._permitPins) window._permitPins.forEach(p => addPermitPinToMap(p));
  if (window._permanentPins) window._permanentPins.forEach(p => addPermanentPinToMap(p));
};

// Add permit pin to map — click opens the claim/inquire modal
window.addPermitPinToMap = function(pin) {
  if (pin.status === 'claimed') return;
  const icon = createPermitPinIcon();
  const marker = L.marker([pin.latitude, pin.longitude], { icon });
  marker.on('click', () => {
    DirtLink.openPermitModal(pin);
  });
  pinMarkers.addLayer(marker);
};

// Add permanent site pin to map — click opens detail modal
window.addPermanentPinToMap = function(pin) {
  const icon = createPermanentPinIcon(pin.site_type);
  const marker = L.marker([pin.latitude, pin.longitude], { icon });
  const cfg = getSiteConfig(pin.site_type);

  // Compact popup with "View Details" link
  marker.bindPopup(`
    <div class="pin-popup">
      <div class="pp-header" style="background:${cfg.color}">
        <span class="pp-type">&#9632; ${cfg.tooltip}</span>
      </div>
      <div class="pp-body">
        <div class="pp-title">${DirtLink.escapeHtml(pin.site_name)}</div>
        <div class="pp-company">${DirtLink.escapeHtml(pin.address)}</div>
        ${pin.accepted_materials ? `<div class="pp-qty" style="margin-top:4px">${DirtLink.escapeHtml(pin.accepted_materials)}</div>` : ''}
        ${pin.claimed_company ? `<div style="margin-top:4px;font-size:11px;color:var(--success);font-weight:600;">Claimed by ${DirtLink.escapeHtml(pin.claimed_company)}</div>` : ''}
        <a class="pp-action" href="#" onclick="event.preventDefault(); DirtLink.showPermanentPinDetail('${pin.id}')" style="color:${cfg.color}">View Details &#8594;</a>
      </div>
    </div>
  `, { maxWidth: 280, className: 'dl-popup' });
  pinMarkers.addLayer(marker);
};

// Add a single pin to the map
window.addPinToMap = function(pin) {
  const isNow = pin.timeline_date === 'now';
  const icon = createPinIcon(pin.pin_type, pin.material_type, pin.is_tested, isNow);
  const marker = L.marker([pin.latitude, pin.longitude], { icon });

  const color = getPinColor(pin.pin_type, pin.material_type);
  const materialLabel = MATERIALS[pin.material_type]?.label || pin.material_type;
  const isHave = pin.pin_type === 'have';
  const qty = pin.quantity_estimate
    ? `~${pin.quantity_estimate} ${(pin.quantity_unit || '').replace('_', ' ')}`
    : null;

  // Timeline display in popup
  let timelinePopup = '';
  if (isNow) {
    timelinePopup = '<div class="pp-now"><span class="pp-now-dot"></span>Active Now</div>';
  } else if (pin.timeline_date) {
    const d = new Date(pin.timeline_date + 'T00:00');
    const today = new Date(); today.setHours(0,0,0,0);
    const isPast = d < today;
    timelinePopup = `<div class="pp-timeline ${isPast ? 'pp-stale' : ''}">${isPast ? '⚠ ' : ''}${isHave ? 'Remove by' : 'Need by'}: ${d.toLocaleDateString()}</div>`;
  }

  marker.bindPopup(`
    <div class="pin-popup">
      <div class="pp-header" style="background:${color}">
        <span class="pp-type">${isHave ? '&#9650; HAVE' : '&#9660; NEED'}</span>
        <span class="pp-material">${materialLabel}</span>
        ${pin.is_tested ? '<span class="pp-tested">&#10003; Tested</span>' : ''}
      </div>
      <div class="pp-body">
        <div class="pp-title">${DirtLink.escapeHtml(pin.title)}</div>
        <div class="pp-company">${DirtLink.escapeHtml(pin.company_name)}</div>
        ${qty ? `<div class="pp-qty">${qty}</div>` : ''}
        ${timelinePopup}
        <a class="pp-action" href="#" onclick="event.preventDefault(); DirtLink.showPinDetail('${pin.id}')" style="color:${color}">View Details &#8594;</a>
      </div>
    </div>
  `, { maxWidth: 260, className: 'dl-popup' });

  pinMarkers.addLayer(marker);
};

// Expose site config for use in app.js
window.getSiteConfig = getSiteConfig;
window.SITE_TYPE_CONFIG = SITE_TYPE_CONFIG;

// Init when DOM is ready
document.addEventListener('DOMContentLoaded', initMap);
