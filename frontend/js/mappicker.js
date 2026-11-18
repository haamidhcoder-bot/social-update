// Map pin picker. Uses Google Maps when GOOGLE_MAPS_API_KEY is set on the
// server, otherwise falls back to OpenStreetMap (Leaflet) so it still works.
// mountMapPicker(host, {lat, lng}) -> { appendTo(fd), setPin(lat, lng) }
let _mapsReady;
function loadMapsLib() {
  if (_mapsReady) return _mapsReady;
  _mapsReady = (async () => {
    let key = '';
    try { key = (await API.get('/api/config')).maps_key || ''; } catch (e) {}
    const add = (tag, attrs) => new Promise((ok, bad) => {
      const el = document.createElement(tag);
      Object.assign(el, attrs, { onload: ok, onerror: bad });
      document.head.appendChild(el);
    });
    if (key) {
      window.__mapsInit = () => {};
      await add('script', { src: `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&callback=__mapsInit&loading=async`, async: true });
      for (let i = 0; i < 50 && !(window.google && google.maps && google.maps.Map); i++) await new Promise(r => setTimeout(r, 100));
      if (window.google && google.maps && google.maps.Map) return 'google';
    }
    await add('link', { rel: 'stylesheet', href: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css' });
    await add('script', { src: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js' });
    return 'osm';
  })();
  return _mapsReady;
}

function mountMapPicker(host, initial) {
  host.classList.add('map-picker');
  host.innerHTML = `
    <label>Exact location on map (optional)</label>
    <span class="hint">Search for your place, or click the map to drop a pin on your location. Drag the pin to adjust.</span>
    <div class="map-tools">
      <input type="text" class="map-search" placeholder="Search a place, e.g. Peelamedu bus stop" autocomplete="off">
      <button type="button" class="btn light map-find">Search</button>
      <button type="button" class="btn light map-here">Use my location</button>
      <button type="button" class="btn light map-clear" hidden>Remove pin</button>
    </div>
    <div class="map-canvas" aria-label="Map"></div>
    <small class="map-status">No pin set.</small>
    <input type="hidden" name="latitude"><input type="hidden" name="longitude">`;
  const $ = s => host.querySelector(s);
  const canvas = $('.map-canvas'), status = $('.map-status');
  const latIn = $('[name=latitude]'), lngIn = $('[name=longitude]');
  const clearBtn = $('.map-clear'), search = $('.map-search');
  const DEFAULT = { lat: 10.85, lng: 78.7 };          // Tamil Nadu
  let lib, map, marker, pin = null;

  function show(lat, lng, pan) {
    pin = (lat == null || isNaN(lat)) ? null : { lat: +(+lat).toFixed(6), lng: +(+lng).toFixed(6) };
    latIn.value = pin ? pin.lat : ''; lngIn.value = pin ? pin.lng : '';
    clearBtn.hidden = !pin;
    status.innerHTML = pin
      ? `Pin set: ${pin.lat}, ${pin.lng} · <a href="${mapsHref(pin.lat + ',' + pin.lng)}" target="_blank" rel="noopener">check in Google Maps</a>`
      : 'No pin set.';
    if (!map) return;
    if (lib === 'google') {
      if (marker) marker.setMap(null);
      marker = null;
      if (pin) {
        marker = new google.maps.Marker({ position: pin, map, draggable: true });
        marker.addListener('dragend', e => show(e.latLng.lat(), e.latLng.lng()));
        if (pan) { map.panTo(pin); map.setZoom(Math.max(map.getZoom(), 16)); }
      }
    } else {
      if (marker) { map.removeLayer(marker); marker = null; }
      if (pin) {
        marker = L.marker([pin.lat, pin.lng], { draggable: true }).addTo(map);
        marker.on('dragend', () => { const p = marker.getLatLng(); show(p.lat, p.lng); });
        if (pan) map.setView([pin.lat, pin.lng], Math.max(map.getZoom(), 16));
      }
    }
  }

  async function geocode(q) {
    if (lib === 'google') {
      return new Promise((ok, bad) => new google.maps.Geocoder().geocode(
        { address: q, region: 'IN' }, (r, s) => s === 'OK' ? ok(r[0].geometry.location.toJSON()) : bad(new Error('Place not found.'))));
    }
    const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=in&q=' + encodeURIComponent(q));
    const j = await r.json();
    if (!j.length) throw new Error('Place not found.');
    return { lat: +j[0].lat, lng: +j[0].lon };
  }
  async function doSearch() {
    const q = search.value.trim(); if (!q) return;
    try { const p = await geocode(q); show(p.lat, p.lng, true); }
    catch (e) { status.textContent = e.message || 'Search failed.'; }
  }
  $('.map-find').onclick = doSearch;
  search.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); doSearch(); } });
  clearBtn.onclick = () => show(null);
  $('.map-here').onclick = () => {
    if (!navigator.geolocation) { status.textContent = 'Location is not available in this browser.'; return; }
    navigator.geolocation.getCurrentPosition(
      p => show(p.coords.latitude, p.coords.longitude, true),
      () => { status.textContent = 'Could not get your location. Allow location access or click the map.'; });
  };

  const startMap = () => loadMapsLib().then(l => {
    lib = l;
    const start = initial && initial.lat != null ? { lat: +initial.lat, lng: +initial.lng } : null;
    const c = start || DEFAULT, z = start ? 16 : 7;
    if (lib === 'google') {
      map = new google.maps.Map(canvas, { center: c, zoom: z, streetViewControl: false, mapTypeControl: false });
      map.addListener('click', e => show(e.latLng.lat(), e.latLng.lng()));
    } else {
      map = L.map(canvas).setView([c.lat, c.lng], z);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(map);
      map.on('click', e => show(e.latlng.lat, e.latlng.lng));
    }
    if (pin) show(pin.lat, pin.lng, true); else show(null);
  }).catch(() => { canvas.outerHTML = '<p class="hint">The map could not be loaded. You can still register without a pin.</p>'; });

  // load the map library only when the field scrolls into view (keeps the page fast)
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(en => { if (en[0].isIntersecting) { io.disconnect(); startMap(); } }, { rootMargin: '200px' });
    io.observe(host);
  } else startMap();
  if (initial && initial.lat != null) show(+initial.lat, +initial.lng);
  return {
    appendTo(fd) { fd.set('latitude', latIn.value); fd.set('longitude', lngIn.value); },
    setPin(lat, lng) { show(lat == null || lat === '' ? null : +lat, lng == null ? null : +lng, true); },
  };
}
