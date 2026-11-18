// Shared dashboard logic. Each role page only sets <body data-role="...">;
// what the user can post / browse comes from the backend (/api/me).
(async function () {
  const pageRole = document.body.dataset.role;
  const app = document.getElementById('app');
  let me;

  try {
    me = await API.get('/api/me');
  } catch (e) {
    location.href = '/';                       // not logged in
    return;
  }
  if (me.user.role !== pageRole) {             // wrong role page
    location.href = me.page;
    return;
  }

  const { user, permissions } = me;
  document.getElementById('userName').textContent = user.org_name;
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await API.post('/api/logout');
    location.href = '/';
  });

  const typeOptions = permissions.post.map(t =>
    `<option value="${t}">${LISTING_TYPES[t].label}</option>`).join('');
  const browseOptions = permissions.browse.map(t =>
    `<option value="${t}">${LISTING_TYPES[t].label}</option>`).join('');

  app.innerHTML = `
    <div class="dash-grid">
      <section class="panel">
        <h2>Post an update</h2>
        <form id="listingForm" class="form-grid">
          <div class="field full"><label for="ltype">Type</label><select id="ltype">${typeOptions}</select></div>
          <div class="field full"><label for="ltitle">Title *</label><input id="ltitle" required maxlength="150" placeholder="Eg. Fresh tomatoes / 50 meals tonight"></div>
          <div class="field"><label for="lqty" id="lqtyLabel">Quantity</label><input id="lqty" type="number" min="0" step="any" placeholder="100"></div>
          <div class="field"><label for="lunit" id="lunitLabel">Unit</label><input id="lunit" maxlength="20" list="unitList" placeholder="kg / meals / litres"><datalist id="unitList"></datalist></div>
          <div class="field"><label for="lprice" id="lpriceLabel">Price (₹, optional)</label><input id="lprice" type="number" min="0" step="any" placeholder="0 for free"></div>
          <div class="field full" id="foodFields" style="display:none">
            <label for="lfood">What kind of food? (decides how long it stays safe)</label>
            <select id="lfood">${FOOD_TYPES.map((f, i) => `<option value="${i}">${f.n} · safe ${hoursLabel(f.h)}</option>`).join('')}</select>
            <label for="lcooked" style="margin-top:8px">Cooked / picked at</label>
            <input id="lcooked" type="datetime-local">
            <span class="hint">Receivers will see a live "safe for … more" countdown. Expired food is hidden automatically.</span>
          </div>
          <div class="field full" id="transportFields" style="display:none">
            <label for="lvehicle">Your vehicle</label>
            <select id="lvehicle">${VEHICLES.map(v => `<option>${v}</option>`).join('')}</select>
            <label for="lfrom" style="margin-top:8px">When are you free? From *</label>
            <input id="lfrom" type="datetime-local">
            <label for="luntil" style="margin-top:8px">Free until *</label>
            <input id="luntil" type="datetime-local">
            <span class="hint">Hotels, farmers and NGOs will see this window. Offers disappear automatically when it ends.</span>
          </div>
          <div class="field full" id="listingPicture"></div>
          <div class="field full"><label for="ldesc">Details</label><textarea id="ldesc" rows="3" placeholder="Pickup time, quality, delivery options…"></textarea></div>
          <p class="form-error" id="listingError" style="grid-column:1/-1"></p>
          <div class="form-actions"><button class="btn" type="submit">Post update</button></div>
        </form>
      </section>
      <section class="panel">
        <h2>My posts</h2>
        <div class="my-list" id="myListings"></div>
      </section>
    </div>

    <section class="section">
      <div class="section-head"><div>
        <span class="kicker">From other members</span>
        <h2>Browse listings</h2>
        <p>Call or email them directly. No middleman.</p></div></div>
      <div class="directory-tools">
        <input id="bq" placeholder="Search listings…">
        <select id="btype"><option value="">All types</option>${browseOptions}</select>
        <select id="bdistrict"><option value="">All districts</option>${DISTRICTS.map(d => `<option>${d}</option>`).join('')}</select>
      </div>
      <div class="directory" id="browseList"></div>
    </section>`;

  // picture picker for the listing form
  const PIC_LABELS = {
    produce: 'Picture of your crop / produce (optional)',
    surplus_food: 'Photo of the food (optional)',
    ingredient_need: 'Picture (optional) - e.g. the quality or variety you need',
    raw_material_need: 'Picture (optional) - e.g. the grade or sample you need',
    food_request: 'Picture (optional) - e.g. your kitchen or the people you serve',
    transport_offer: 'Photo of your vehicle (optional)',
  };
  const listingPic = mountPicture(document.getElementById('listingPicture'), PIC_LABELS[permissions.post[0]]);

  // pull the hidden safe-window tag back out of the description
  const parseListing = l => { const u = unpackSafe(l.description); return { ...l, ft: u.ft, ct: u.ct, description: u.text }; };
  const fmtQty = l => [l.quantity != null ? Number(l.quantity) : null, l.unit].filter(Boolean).join(' ');
  const fmtPrice = l => l.price == null ? '' : (Number(l.price) === 0 ? 'Free' : '₹' + Number(l.price));

  async function loadMine() {
    const box = document.getElementById('myListings');
    try {
      const { listings: raw } = await API.get('/api/my-listings');
      const listings = raw.map(parseListing);
      box.innerHTML = listings.length ? listings.map(l => `
        <div class="my-item">
          ${pictureTag(l.image_url, 'my-thumb', l.title)}
          <div class="my-main"><b>${esc(l.title)}</b>
          <small>${LISTING_TYPES[l.type].label}${fmtQty(l) ? ' · ' + esc(fmtQty(l)) : ''}${fmtPrice(l) ? ' · ' + fmtPrice(l) : ''}</small>
          ${l.type === 'surplus_food' ? safeBlock(l.ft, l.ct) : ''}
          ${l.type === 'transport_offer' ? transportBlock(l) : ''}</div>
          <button class="btn small danger" data-del="${l.id}">Delete</button>
        </div>`).join('') : '<div class="empty">Nothing posted yet.</div>';
    } catch (e) { box.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  }

  async function loadBrowse() {
    const box = document.getElementById('browseList');
    const params = new URLSearchParams({
      q: document.getElementById('bq').value,
      types: document.getElementById('btype').value,
      district: document.getElementById('bdistrict').value,
    });
    try {
      const { listings: raw } = await API.get('/api/listings?' + params);
      // food that is past its safe time is not offered any more
      const listings = raw.map(parseListing).filter(l => !(l.type === 'surplus_food' && isExpired(l)));
      box.innerHTML = listings.length ? listings.map(l => {
        const t = LISTING_TYPES[l.type];
        return `<article class="listing">
          ${pictureTag(l.image_url, 'listing-img', l.title)}
          <span class="tag ${t.cls}">${t.label}</span>
          <h3>${esc(l.title)}</h3>
          <div class="meta">${[fmtQty(l), fmtPrice(l)].filter(Boolean).map(esc).join(' · ')}
            ${l.description ? '<br>' + esc(l.description) : ''}</div>
          ${l.type === 'surplus_food' ? safeBlock(l.ft, l.ct) : ''}
          ${l.type === 'transport_offer' ? transportBlock(l) : ''}
          <div class="contact"><b>${esc(l.org_name)}</b> · ${esc(l.contact_name)}<br><a href="mailto:${esc(l.email)}">${esc(l.email)}</a>
            <div class="chips">${phoneChip(l.phone)}${placeChip(l.org_name + ', ' + l.area, [l.org_name, l.area, l.district, 'Tamil Nadu'].join(', '))}</div></div>
        </article>`;
      }).join('') : '<div class="empty">Nothing matches right now. Try again later or widen your search.</div>';
    } catch (e) { box.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  }

  document.getElementById('listingForm').addEventListener('submit', async e => {
    e.preventDefault();
    const err = document.getElementById('listingError');
    err.textContent = '';
    try {
      const type = document.getElementById('ltype').value;
      let description = document.getElementById('ldesc').value;
      if (type === 'surplus_food') {
        const ft = +document.getElementById('lfood').value;
        const ct = Math.min(new Date(document.getElementById('lcooked').value).getTime() || Date.now(), Date.now());
        if (ct + FOOD_TYPES[ft].h * 36e5 <= Date.now()) { err.textContent = 'This food is already past its safe time, so it cannot be shared.'; return; }
        description = packSafe(ft, ct, description);
      }
      if (type === 'transport_offer') {
        const f = document.getElementById('lfrom').value, u = document.getElementById('luntil').value;
        if (!f || !u) { err.textContent = 'Please tell us when you are free (from and until).'; return; }
        if (new Date(u) <= new Date(f)) { err.textContent = '"Free until" must be after "free from".'; return; }
        if (new Date(u) <= new Date()) { err.textContent = '"Free until" is already in the past.'; return; }
      }
      const fd = new FormData();
      fd.append('type', type);
      fd.append('title', document.getElementById('ltitle').value);
      fd.append('quantity', document.getElementById('lqty').value);
      fd.append('unit', document.getElementById('lunit').value);
      fd.append('price', document.getElementById('lprice').value);
      fd.append('description', description);
      if (type === 'transport_offer') {
        fd.append('vehicle', document.getElementById('lvehicle').value);
        fd.append('available_from', document.getElementById('lfrom').value);
        fd.append('available_until', document.getElementById('luntil').value);
      }
      await withBusy(e.target, 'Posting…', async () => {
        await listingPic.appendTo(fd);
        await API.postForm('/api/listings', fd);
      });
      e.target.reset();
      syncFood();
      toast('Posted.');
      loadMine();
    } catch (ex) { err.textContent = ex.message; }
  });

  document.getElementById('myListings').addEventListener('click', async e => {
    const id = e.target.dataset.del;
    if (!id || !confirm('Delete this post?')) return;
    try { await API.del('/api/listings/' + id); loadMine(); toast('Deleted.'); }
    catch (ex) { toast(ex.message); }
  });

  let t;
  document.getElementById('bq').addEventListener('input', () => { clearTimeout(t); t = setTimeout(loadBrowse, 250); });
  document.getElementById('btype').addEventListener('change', loadBrowse);
  document.getElementById('bdistrict').addEventListener('change', loadBrowse);

  // show the food-condition fields only for surplus food
  function syncFood() {
    const on = document.getElementById('ltype').value === 'surplus_food';
    document.getElementById('foodFields').style.display = on ? 'grid' : 'none';
    const c = document.getElementById('lcooked');
    c.max = nowLocalInput();
    if (!c.value) c.value = nowLocalInput();
    syncTransport();
    listingPic.setLabel(PIC_LABELS[document.getElementById('ltype').value]);
  }
  // transport offers: when free + how much can be carried
  function syncTransport() {
    const on = document.getElementById('ltype').value === 'transport_offer';
    document.getElementById('transportFields').style.display = on ? 'grid' : 'none';
    document.getElementById('lqtyLabel').textContent = on ? 'How much can you carry? *' : 'Quantity';
    document.getElementById('lunitLabel').textContent = on ? 'Unit *' : 'Unit';
    document.getElementById('lpriceLabel').textContent = on ? 'Charge (₹, optional)' : 'Price (₹, optional)';
    document.getElementById('lqty').required = on;
    document.getElementById('lunit').required = on;
    document.getElementById('unitList').innerHTML = on ? TRANSPORT_UNITS.map(u => `<option value="${u}">`).join('') : '';
    const f = document.getElementById('lfrom'), u = document.getElementById('luntil');
    f.min = u.min = nowLocalInput();
    if (on && !f.value) f.value = nowLocalInput();
  }
  document.getElementById('ltype').addEventListener('change', syncFood);
  syncFood();

  loadMine();
  loadBrowse();
  startSafeTicker(() => { loadBrowse(); loadMine(); });
})();
