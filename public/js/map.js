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
function createPinIcon(pinType, materialType, isTested) {
  const color = getPinColor(pinType, materialType);
  const isHave = pinType === 'have';
  const size = 38;

  // Up triangle = HAVE, down triangle = NEED
  const points = isHave ? '19,4 35,34 3,34' : '19,34 35,4 3,4';
  const checkY  = isHave ? '26' : '14';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="filter:drop-shadow(0 2px 5px rgba(0,0,0,0.35)) drop-shadow(0 1px 2px rgba(0,0,0,0.18));display:block;">
    <polygon points="${points}" fill="${color}" stroke="white" stroke-width="2.5" stroke-linejoin="round"/>
    ${isTested ? `<text x="19" y="${checkY}" text-anchor="middle" dominant-baseline="middle" font-size="13" fill="white" font-weight="700" font-family="Inter,sans-serif">✓</text>` : ''}
  </svg>`;

  return L.divIcon({
    className: 'custom-pin',
    html: svg,
    iconSize:    [size, size],
    iconAnchor:  [size / 2, isHave ? size : 0],
    popupAnchor: [0, isHave ? -size : size]
  });
}

// Render all pins on the map
window.renderPins = function(pins) {
  pinMarkers.clearLayers();
  pins.forEach(pin => addPinToMap(pin));
};

// Add a single pin to the map
window.addPinToMap = function(pin) {
  const icon = createPinIcon(pin.pin_type, pin.material_type, pin.is_tested);
  const marker = L.marker([pin.latitude, pin.longitude], { icon });

  const color = getPinColor(pin.pin_type, pin.material_type);
  const materialLabel = MATERIALS[pin.material_type]?.label || pin.material_type;
  const isHave = pin.pin_type === 'have';
  const qty = pin.quantity_estimate
    ? `~${pin.quantity_estimate} ${(pin.quantity_unit || '').replace('_', ' ')}`
    : null;

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
        <a class="pp-action" href="#" onclick="event.preventDefault(); DirtLink.showPinDetail('${pin.id}')" style="color:${color}">View Details &#8594;</a>
      </div>
    </div>
  `, { maxWidth: 260, className: 'dl-popup' });

  pinMarkers.addLayer(marker);
};

// Init when DOM is ready
document.addEventListener('DOMContentLoaded', initMap);
