// Shared helpers used by every page.
const API = {
  async request(method, url, body) {
    const opts = { method, headers: {}, credentials: 'same-origin' };
    if (body instanceof FormData) {            // file uploads: browser sets the boundary
      opts.body = body;
    } else if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    let res;
    try { res = await fetch(url, opts); }
    catch (e) { throw new Error('Cannot reach the server right now. Is the Flask backend running?'); }
    let data = {};
    try { data = await res.json(); } catch (e) { /* empty body */ }
    if (!res.ok) {
      const err = new Error(data.error || 'Something went wrong. Please try again.');
      err.status = res.status;
      throw err;
    }
    return data;
  },
  get:  (url)       => API.request('GET', url),
  post: (url, body) => API.request('POST', url, body || {}),
  postForm: (url, fd) => API.request('POST', url, fd),
  del:  (url)       => API.request('DELETE', url),
};

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function toast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.style.display = 'block';
  clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(() => (t.style.display = 'none'), 3000);
}

const DISTRICTS = ['Ariyalur','Chengalpattu','Chennai','Coimbatore','Cuddalore','Dharmapuri','Dindigul','Erode','Kallakurichi','Kancheepuram','Karur','Krishnagiri','Madurai','Mayiladuthurai','Nagapattinam','Namakkal','Nilgiris','Perambalur','Pudukkottai','Ramanathapuram','Ranipet','Salem','Sivagangai','Tenkasi','Thanjavur','Theni','Thoothukudi','Tiruchirappalli','Tirunelveli','Tirupathur','Tiruppur','Tiruvallur','Tiruvannamalai','Tiruvarur','Vellore','Viluppuram','Virudhunagar'];

// role slug -> display info (slug values match the backend / MySQL enum)
const ROLES = [
  { key: 'farmer', name: 'Farmer',
    desc: 'List fresh produce, set quantities and connect directly with buyers.',
    label: 'Farm / farmer name',
    help: 'Crops grown, harvest dates, typical quantities and prices.' },
  { key: 'hotel_manager', name: 'Hotel Manager',
    desc: 'Source ingredients and share safe surplus meals with people in need.',
    label: 'Hotel / restaurant name',
    help: 'Ingredients needed, daily meal volume, surplus availability, pickup timings.' },
  { key: 'processing_manager', name: 'Food Processing Industry Manager',
    desc: 'Find raw materials and connect with farmers and bulk suppliers.',
    label: 'Factory / company name',
    help: 'Raw materials required, processing capacity, grades and packed products.' },
  { key: 'orphanage_incharge', name: 'Orphanage Incharge',
    desc: 'Share food requirements and receive suitable donations.',
    label: 'Orphanage name',
    help: 'Number of residents, weekly food requirements, dietary needs, delivery timings.' },
  { key: 'college_incharge', name: 'College Food Incharge',
    desc: 'Manage mess requirements and share surplus food responsibly.',
    label: 'College / institution name',
    help: 'Mess name, student count, food requirements and surplus meal information.' },
  { key: 'ngo_incharge', name: 'NGO Incharge',
    desc: 'Coordinate donors, recipient communities and food collection.',
    label: 'NGO / foundation name',
    help: 'Communities served, meal capacity, collection area and vehicle availability.' },
  { key: 'other', name: 'Others',
    desc: 'Volunteers, donors, transporters, shops or anyone else who wants to help or take part.',
    label: 'Your name / organisation',
    help: 'Tell us who you are (volunteer, donor, transporter, shop…) and how you would like to help or what you need.' },
];
const roleBySlug = key => ROLES.find(r => r.key === key);

const LISTING_TYPES = {
  produce:           { label: 'Produce for sale',    cls: '' },
  ingredient_need:   { label: 'Ingredients needed',  cls: 'orange' },
  raw_material_need: { label: 'Raw material needed', cls: 'orange' },
  surplus_food:      { label: 'Surplus food',        cls: '' },
  food_request:      { label: 'Food request',        cls: 'orange' },
  transport_offer:   { label: 'Transport available', cls: '' },
  help_request:      { label: 'Delivery / volunteer needed', cls: 'orange' },
};

// ---------- food safety window (surplus food) ----------
// h = hours the food stays safe after it was cooked / picked, g = 0 surplus, 1 before-waste
const FOOD_TYPES = [
  { n: 'Cooked meals - rice varieties',   h: 4,  g: 0 },
  { n: 'Tiffin & breads (idli, dosa, chapati)',      h: 6,  g: 0 },
  { n: 'Dairy, egg & milk-sweet dishes, curd rice',  h: 2,  g: 0 },
  { n: 'Cut fruit & salads',                         h: 2,  g: 0 },
  { n: 'Bakery & fried snacks',                      h: 12, g: 1 },
  { n: 'Milk, curd & paneer (kept chilled)',         h: 24, g: 1 },
  { n: 'Whole fruits & vegetables',                  h: 48, g: 1 },
];
const FOOD_GROUPS = ['Surplus food', 'Before-waste food'];

// The backend has no column for these, so they ride at the start of the description: [[ft:0|ct:1731830000000]]
const SAFE_TAG = /^\s*\[\[ft:(\d+)\|ct:(\d+)\]\]\s*/;
function packSafe(ft, ct, text) { return `[[ft:${ft}|ct:${ct}]] ${text || ''}`.trim(); }
function unpackSafe(desc) {
  const m = SAFE_TAG.exec(desc || '');
  return m ? { ft: +m[1], ct: +m[2], text: desc.slice(m[0].length) } : { ft: null, ct: null, text: desc || '' };
}

function clock12(ms) {
  const d = new Date(ms), n = new Date();
  let h = d.getHours(); const m = d.getMinutes(), a = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  const t = h + ':' + String(m).padStart(2, '0') + ' ' + a;
  return d.toDateString() === n.toDateString() ? t
    : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) + ', ' + t;
}
function timeLeft(ms) {
  const m = Math.max(0, Math.floor(ms / 6e4)), d = Math.floor(m / 1440), h = Math.floor(m % 1440 / 60), n = m % 60;
  return d ? d + 'd ' + h + 'h' : h ? h + 'h ' + n + 'm' : n + 'm';
}
const hoursLabel = h => h >= 48 ? Math.round(h / 24) + ' days' : h + ' h';
function nowLocalInput() {
  return new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 16);
}
function foodSafety(ft, ct) {
  const t = FOOD_TYPES[ft];
  if (ft == null || !ct || !t) return null;
  const tot = t.h * 36e5;
  return { t, tot, end: ct + tot, rem: ct + tot - Date.now() };
}
const isExpired = l => { const x = foodSafety(l.ft, l.ct); return !!x && x.rem <= 0; };

// Green / yellow / orange / red status line + progress bar + food type, like the "Safe for 2h 29m more" card
function safeBlock(ft, ct) {
  const x = foodSafety(ft, ct);
  if (!x) return '';
  const f = x.rem / x.tot, ex = x.rem <= 0;
  const cls = ex ? 'bad' : f < .25 ? 'hurry' : f < .5 ? 'soon' : 'ok';
  const msg = ex ? 'Past safe time. Do not serve'
    : (f < .25 ? 'Hurry · ' : f < .5 ? 'Serve soon · ' : '') + 'Safe for ' + timeLeft(x.rem) + ' more';
  const w = Math.max(0, Math.min(100, f * 100));
  return `<div class="safe ${cls}" data-ft="${ft}" data-ct="${ct}">
    <div class="safe-line">${msg} <span>· ${ex ? 'ended' : 'until'} ${clock12(x.end)}</span></div>
    <div class="safe-bar"><i style="width:${w}%"></i></div>
    <div class="safe-meta">${FOOD_GROUPS[x.t.g]} · ${esc(x.t.n)} · safe window ${hoursLabel(x.t.h)}</div></div>`;
}
// Keep the countdowns live; onExpire fires once when something runs out of safe time
function startSafeTicker(onExpire) {
  setInterval(() => {
    let expired = false;
    document.querySelectorAll('.safe[data-ft]').forEach(el => {
      const ft = +el.dataset.ft, ct = +el.dataset.ct, x = foodSafety(ft, ct);
      if (x && x.rem <= 0 && !el.classList.contains('bad')) expired = true;
      el.outerHTML = safeBlock(ft, ct);
    });
    if (expired && onExpire) onExpire();
  }, 30000);
}

// ---------- tap to call / tap to open in maps ----------
// Disables the form's submit button while `fn` runs (stops double posts and
// shows the person that something is happening).
async function withBusy(form, label, fn) {
  const btn = form.querySelector('[type=submit]');
  const old = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = label; }
  try { return await fn(); }
  finally { if (btn) { btn.disabled = false; btn.textContent = old; } }
}

// Phone photos are often 2 MB+; shrink them in the browser so uploads are fast.
async function shrinkImage(file, maxSide = 1600, quality = 0.82) {
  if (!file || !/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 300 * 1024) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', quality));
    return blob && blob.size < file.size ? new File([blob], 'photo.jpg', { type: 'image/jpeg' }) : file;
  } catch (e) { return file; }
}

const telHref = p => 'tel:' + String(p ?? '').replace(/[^\d+]/g, '');
const mapsHref = q => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);
function phoneChip(phone) {
  return phone ? `<a class="chip" href="${telHref(phone)}" title="Call ${esc(phone)}">Call ${esc(phone)}</a>` : '';
}
function placeChip(label, query, lat, lng) {
  if (!label) return '';
  const q = (lat != null && lat !== '' && lng != null && lng !== '') ? `${+lat},${+lng}` : (query || label);
  return `<a class="chip" href="${mapsHref(q)}" target="_blank" rel="noopener" title="Open in Google Maps">Open map</a>`;
}

// ---------- picture picker (upload a file or paste a link, with preview) ----------
const MAX_IMAGE_MB = 2;
let pictureCount = 0;
// Fills `host` with the picture field. Inputs are named picture / picture_url /
// remove_picture, so a <form> containing it can be sent with new FormData(form).
// Returns { appendTo(fd), reset(), setLabel(text), setCurrent(url) }.
function mountPicture(host, label, current) {
  const id = 'pic' + (++pictureCount);
  host.classList.add('picture-field');
  host.innerHTML = `
    <label id="${id}Label">${esc(label || 'Picture (optional)')}</label>
    <div class="pic-preview" id="${id}Prev" hidden><img alt="Picture preview"></div>
    <input type="file" id="${id}File" name="picture" accept="image/jpeg,image/png,image/gif,image/webp">
    <span class="hint">JPG, PNG, GIF or WebP, up to ${MAX_IMAGE_MB} MB. Only use pictures you have the right to publish.</span>
    <label for="${id}Url">…or a picture link</label>
    <input type="text" id="${id}Url" name="picture_url" maxlength="255" placeholder="https://… or /static/img/…" autocomplete="off">
    <label class="check" id="${id}RemoveWrap" hidden><input type="checkbox" id="${id}Remove" name="remove_picture" value="1"> Remove current picture</label>`;
  const $ = s => host.querySelector('#' + id + s);
  const prev = $('Prev'), img = prev.querySelector('img');
  const file = $('File'), url = $('Url'), rem = $('Remove'), remWrap = $('RemoveWrap');
  let objectUrl = null, currentUrl = current || null;

  function show(src) {
    if (objectUrl && src !== objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
    prev.hidden = !src; remWrap.hidden = !src;
    if (src) img.src = src;
  }
  function refresh() {
    if (rem.checked) { prev.classList.add('removed'); return; }
    prev.classList.remove('removed');
    const f = file.files[0];
    if (f) { objectUrl = URL.createObjectURL(f); show(objectUrl); }
    else if (url.value.trim()) show(url.value.trim());
    else show(currentUrl);
  }
  img.addEventListener('error', () => { prev.hidden = true; remWrap.hidden = !currentUrl; });
  file.addEventListener('change', () => {
    const f = file.files[0];
    if (f && f.size > 15 * 1024 * 1024) {
      file.value = ''; toast('Picture is too large. Maximum size is ' + MAX_IMAGE_MB + ' MB.');
    } else if (f) { url.value = ''; rem.checked = false; }
    refresh();
  });
  url.addEventListener('input', () => { if (url.value) { file.value = ''; rem.checked = false; } refresh(); });
  rem.addEventListener('change', () => {
    if (rem.checked) { file.value = ''; url.value = ''; }
    refresh();
  });
  // the whole form was reset after posting
  host.closest('form')?.addEventListener('reset', () => setTimeout(() => { currentUrl = null; refresh(); }));
  refresh();

  return {
    async appendTo(fd) {
      if (file.files[0]) fd.append('picture', await shrinkImage(file.files[0]));
      if (url.value.trim()) fd.append('picture_url', url.value.trim());
      if (rem.checked) fd.append('remove_picture', '1');
    },
    reset() { file.value = ''; url.value = ''; rem.checked = false; currentUrl = null; refresh(); },
    setLabel(t) { $('Label').textContent = t; },
    setCurrent(u) { currentUrl = u || null; file.value = ''; url.value = ''; rem.checked = false; refresh(); },
  };
}

// <img> for a stored picture (empty string when there is none)
const pictureTag = (src, cls, alt) => src
  ? `<img class="${cls}" src="${esc(src)}" alt="${esc(alt || '')}" loading="lazy" onerror="this.remove()">` : '';

// ---------- transport offers (Others: when free + how much can be carried) ----------
const VEHICLES = ['Bike / scooter', 'Auto', 'Car', 'Van', 'Mini truck / tempo', 'Lorry / truck', 'Refrigerated vehicle', 'Other'];
const TRANSPORT_UNITS = ['kg', 'tonnes', 'meals', 'boxes', 'litres'];
const localTime = s => { const t = new Date(s); return isNaN(t) ? null : t.getTime(); };
// "Free: 18 Nov, 9:00 am → 18 Nov, 5:00 pm" + vehicle + "Free now" badge
const HELP_KIND_LABELS = { delivery_person: 'Delivery person', volunteer: 'Volunteer', both: 'Delivery person or volunteer' };
function helpBlock(l) {
  const a = localTime(l.available_from), b = localTime(l.available_until);
  if (a == null || b == null) return '';
  return `<div class="transport live">
    <div class="transport-line">${esc(HELP_KIND_LABELS[l.help_kind] || 'Help')} needed <span>· until ${clock12(b)}</span></div>
    <div class="transport-meta">${clock12(a)} to ${clock12(b)}</div></div>`;
}
function transportBlock(l) {
  const a = localTime(l.available_from), b = localTime(l.available_until);
  if (a == null || b == null) return '';
  const now = Date.now(), live = now >= a && now <= b;
  return `<div class="transport ${live ? 'live' : ''}">
    <div class="transport-line">${live ? 'Free now' : 'Free later'} <span>· until ${clock12(b)}</span></div>
    <div class="transport-meta">${clock12(a)} to ${clock12(b)}${l.vehicle ? '<br>' + esc(l.vehicle) : ''}</div></div>`;
}
