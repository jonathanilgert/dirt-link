// DirtLink - Map Module (Leaflet)

let map;
const pinMarkers = L.layerGroup();

function initMap() {
  map = L.map('map', {
    center: [51.0447, -114.0719], // Default: Calgary, AB
    zoom: 11,
    zoomControl: true
  });

  // OpenStreetMap tiles (free, no API key needed)
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19
  }).addTo(map);

  pinMarkers.addTo(map);

  window.map = map;

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

// Create a custom colored marker
function createPinIcon(pinType, materialType, isTested) {
  const color = getPinColor(pinType, materialType);
  const shape = pinType === 'have' ? 'polygon(50% 0%, 0% 100%, 100% 100%)' : 'polygon(0% 0%, 100% 0%, 50% 100%)';
  const size = 28;

  return L.divIcon({
    className: 'custom-pin',
    html: `<div style="
      width: ${size}px;
      height: ${size}px;
      background: ${color};
      clip-path: ${shape};
      filter: drop-shadow(1px 2px 2px rgba(0,0,0,0.4));
      position: relative;
    ">
      ${isTested ? `<div style="
        position: absolute;
        top: ${pinType === 'have' ? '55%' : '20%'};
        left: 50%;
        transform: translate(-50%, -50%);
        color: white;
        font-size: 10px;
        font-weight: bold;
      ">&#10003;</div>` : ''}
    </div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, pinType === 'have' ? size : 0],
    popupAnchor: [0, pinType === 'have' ? -size : size]
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

  marker.bindPopup(`
    <div class="pin-popup">
      <div style="border-left: 3px solid ${color}; padding-left: 8px; margin-bottom: 6px;">
        <strong style="color: ${color}">${pin.pin_type === 'have' ? '&#9650; HAVE' : '&#9660; NEED'}</strong>
        <span style="margin-left: 6px;">${materialLabel}</span>
        ${pin.is_tested ? ' <span style="color:#2ecc71; font-size:11px;">&#10003; Tested</span>' : ''}
      </div>
      <strong>${DirtLink.escapeHtml(pin.title)}</strong><br>
      <small>${DirtLink.escapeHtml(pin.company_name)}</small><br>
      ${pin.quantity_estimate ? `<small>~${pin.quantity_estimate} ${pin.quantity_unit?.replace('_', ' ')}</small><br>` : ''}
      <a href="#" onclick="event.preventDefault(); DirtLink.showPinDetail('${pin.id}')" style="color: ${color}; font-weight: 600;">View Details &rarr;</a>
    </div>
  `, { maxWidth: 280 });

  pinMarkers.addLayer(marker);
};

// Init when DOM is ready
document.addEventListener('DOMContentLoaded', initMap);
