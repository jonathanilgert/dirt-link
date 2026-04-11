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

  // Urgent glow for "now" pins
  const glowFilter = isNow
    ? 'filter:drop-shadow(0 0 6px rgba(239,68,68,0.7)) drop-shadow(0 0 12px rgba(239,68,68,0.4)) drop-shadow(0 2px 5px rgba(0,0,0,0.35));display:block;'
    : 'filter:drop-shadow(0 2px 5px rgba(0,0,0,0.35)) drop-shadow(0 1px 2px rgba(0,0,0,0.18));display:block;';

  // "Now" badge — small pulsing dot at the top
  const nowBadge = isNow
    ? `<circle cx="30" cy="8" r="5" fill="#ef4444" stroke="white" stroke-width="1.5"><animate attributeName="r" values="4;6;4" dur="1.5s" repeatCount="indefinite"/><animate attributeName="opacity" values="1;0.7;1" dur="1.5s" repeatCount="indefinite"/></circle>`
    : '';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="${glowFilter}">
    <polygon points="${points}" fill="${color}" stroke="white" stroke-width="2.5" stroke-linejoin="round"/>
    ${isTested ? `<text x="19" y="${checkY}" text-anchor="middle" dominant-baseline="middle" font-size="13" fill="white" font-weight="700" font-family="Inter,sans-serif">✓</text>` : ''}
    ${nowBadge}
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
    html: svg,
    iconSize: [size, size],
    iconAnchor: [size / 2, size],
    popupAnchor: [0, -size]
  });
}

// Create icon for permanent site pins — square with distinct color
function createPermanentPinIcon(siteType) {
  const size = 34;
  const color = siteType === 'landfill' ? '#6B4C9A' : siteType === 'transfer_station' ? '#2C7A7B' : '#8B5E3C';
  const label = siteType === 'landfill' ? 'LF' : siteType === 'transfer_station' ? 'TS' : 'PS';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="filter:drop-shadow(0 2px 4px rgba(0,0,0,0.3));display:block;">
    <rect x="2" y="2" width="30" height="30" rx="5" fill="${color}" stroke="white" stroke-width="2.5"/>
    <text x="17" y="19" text-anchor="middle" dominant-baseline="middle" font-size="10" fill="white" font-weight="700" font-family="Inter,sans-serif">${label}</text>
  </svg>`;
  return L.divIcon({
    className: 'custom-pin permanent-pin',
    html: svg,
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

// Add permanent site pin to map
window.addPermanentPinToMap = function(pin) {
  const icon = createPermanentPinIcon(pin.site_type);
  const marker = L.marker([pin.latitude, pin.longitude], { icon });
  const typeLabel = (pin.site_type || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  marker.bindPopup(`
    <div class="pin-popup">
      <div class="pp-header" style="background:${pin.site_type === 'landfill' ? '#6B4C9A' : pin.site_type === 'transfer_station' ? '#2C7A7B' : '#8B5E3C'}">
        <span class="pp-type">&#9632; ${typeLabel}</span>
      </div>
      <div class="pp-body">
        <div class="pp-title">${DirtLink.escapeHtml(pin.site_name)}</div>
        <div class="pp-company">${DirtLink.escapeHtml(pin.address)}</div>
        ${pin.hours_of_operation ? `<div class="pp-qty">Hours: ${DirtLink.escapeHtml(pin.hours_of_operation)}</div>` : ''}
        ${pin.accepted_materials ? `<div class="pp-qty">Accepts: ${DirtLink.escapeHtml(pin.accepted_materials)}</div>` : ''}
        ${pin.rates_fees ? `<div class="pp-qty">Rates: ${DirtLink.escapeHtml(pin.rates_fees)}</div>` : ''}
        ${pin.contact_phone ? `<div class="pp-qty">Phone: ${DirtLink.escapeHtml(pin.contact_phone)}</div>` : ''}
        ${pin.website_url ? `<div class="pp-qty"><a href="${DirtLink.escapeHtml(pin.website_url)}" target="_blank" rel="noopener">Website</a></div>` : ''}
        ${pin.notes ? `<div class="pp-qty">${DirtLink.escapeHtml(pin.notes)}</div>` : ''}
        <div style="margin-top:6px;font-size:11px;color:#888;">Permanent site</div>
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

// Init when DOM is ready
document.addEventListener('DOMContentLoaded', initMap);
