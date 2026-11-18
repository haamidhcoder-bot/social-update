// My Account page (all roles): edit details, picture and password.
(async function () {
  let me;
  try { me = await API.get('/api/me'); }
  catch (e) { location.href = '/'; return; }          // not logged in

  const role = roleBySlug(me.user.role);
  document.getElementById('brandLink').href = me.page;
  document.getElementById('backLink').href = me.page;
  document.getElementById('userName').textContent = me.user.org_name;
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await API.post('/api/logout');
    location.href = '/';
  });

  document.getElementById('app').innerHTML = `
    <section class="panel">
      <form id="accountForm" class="form-grid" autocomplete="off">
        <div class="field"><label for="aorg">${esc(role.label)} *</label><input id="aorg" required maxlength="150"></div>
        <div class="field"><label for="acontact">Contact person *</label><input id="acontact" required maxlength="100"></div>
        <div class="field"><label for="aphone">Mobile number *</label><input id="aphone" required inputmode="tel" pattern="[0-9+() \\-]{8,16}"></div>
        <div class="field"><label for="aemail">Email address *</label><input id="aemail" type="email" required maxlength="150"></div>
        <div class="field"><label for="adistrict">District *</label><select id="adistrict" required>${DISTRICTS.map(d => `<option>${d}</option>`).join('')}</select></div>
        <div class="field"><label for="aarea">Area / town *</label><input id="aarea" required maxlength="100"></div>
        <div class="field full" id="profileMap"></div>
        <div class="field full"><label for="adetails">What do you offer or need?</label><textarea id="adetails" rows="3" placeholder="${esc(role.help)}"></textarea></div>
        <div class="field"><label for="acapacity">Capacity / quantity</label><input id="acapacity" maxlength="100"></div>
        <div class="field"><label for="awebsite">Website / social link</label><input id="awebsite" type="url" maxlength="255" placeholder="https://"></div>
        <div class="field full" id="profilePicture"></div>
        <div class="field full"><label>Change password (leave blank to keep the current one)</label></div>
        <div class="field"><input id="acurpw" type="password" autocomplete="current-password" placeholder="Current password"></div>
        <div class="field"><input id="anewpw" type="password" minlength="8" autocomplete="new-password" placeholder="New password (min 8 characters)"></div>
        <p class="form-error" id="accountError" style="grid-column:1/-1"></p>
        <div class="form-actions"><button class="btn" type="submit">Save changes</button><a class="btn light" href="${esc(me.page)}">Cancel</a></div>
      </form>
    </section>`;

  const profilePic = mountPicture(document.getElementById('profilePicture'),
    'Farm / organisation picture (optional)', me.user.photo_url);

  const profileMap = mountMapPicker(document.getElementById('profileMap'));

  function fillAccount(a) {
    const set = (id, v) => { document.getElementById(id).value = v ?? ''; };
    set('aorg', a.org_name); set('acontact', a.contact_name); set('aphone', a.phone);
    set('aemail', a.email); set('adistrict', a.district); set('aarea', a.area);
    set('adetails', a.details);
    set('acapacity', a.capacity); set('awebsite', a.website);
    set('acurpw', ''); set('anewpw', '');
    profileMap.setPin(a.latitude, a.longitude);
    profilePic.setCurrent(a.photo_url);
    document.getElementById('userName').textContent = a.org_name;
  }
  try { fillAccount((await API.get('/api/account')).account); }
  catch (ex) { document.getElementById('accountError').textContent = ex.message; }

  document.getElementById('accountForm').addEventListener('submit', async e => {
    e.preventDefault();
    const err = document.getElementById('accountError');
    err.textContent = '';
    const v = id => document.getElementById(id).value;
    try {
      const form = e.target;
      const fd = new FormData();
      fd.append('org', v('aorg')); fd.append('contact', v('acontact'));
      fd.append('phone', v('aphone')); fd.append('email', v('aemail'));
      fd.append('district', v('adistrict')); fd.append('area', v('aarea'));
      fd.append('details', v('adetails'));
      fd.append('capacity', v('acapacity')); fd.append('website', v('awebsite'));
      if (v('anewpw')) { fd.append('current_password', v('acurpw')); fd.append('new_password', v('anewpw')); }
      profileMap.appendTo(fd);
      const res = await withBusy(form, 'Saving…', async () => {
        await profilePic.appendTo(fd);
        return API.postForm('/api/account', fd);
      });
      fillAccount(res.account);
      toast('Account details saved.');
    } catch (ex) { err.textContent = ex.message; }
  });
})();
