// Landing page logic: role picker, register, login, directory.
const roleGrid = document.getElementById('roleGrid');
const roleSelect = document.getElementById('role');
const districtSelect = document.getElementById('district');

roleGrid.innerHTML = ROLES.map(r =>
  `<button class="role" type="button" data-role="${r.key}" onclick="chooseRole('${r.key}')">
     <h3>${r.name}</h3><p>${r.desc}</p></button>`).join('');
roleSelect.innerHTML = ROLES.map(r => `<option value="${r.key}">${r.name}</option>`).join('');
districtSelect.innerHTML = '<option value="">Choose district</option>' +
  DISTRICTS.map(d => `<option>${d}</option>`).join('');
document.getElementById('filterRole').innerHTML +=
  ROLES.map(r => `<option value="${r.key}">${r.name}</option>`).join('');
document.getElementById('filterDistrict').innerHTML +=
  DISTRICTS.map(d => `<option>${d}</option>`).join('');

function chooseRole(key, scroll = true) {
  roleSelect.value = key;
  const r = roleBySlug(key);
  document.querySelectorAll('.role').forEach(x => x.classList.toggle('selected', x.dataset.role === key));
  document.getElementById('asideTitle').textContent = 'Joining as: ' + r.name;
  document.getElementById('asideText').textContent =
    r.desc + ' Add your contact and location details so other members can find you.';
  document.getElementById('orgLabel').textContent = r.label + ' *';
  document.getElementById('details').placeholder = r.help;
  if (scroll) document.getElementById('register').scrollIntoView({ behavior: 'smooth' });
}
roleSelect.addEventListener('change', () => chooseRole(roleSelect.value));

function goRegister() {
  document.getElementById('register').scrollIntoView({ behavior: 'smooth' });
  setTimeout(() => roleSelect.focus(), 450);
}
function openLogin() {
  document.getElementById('loginModal').classList.add('show');
  setTimeout(() => document.getElementById('loginEmail').focus(), 50);
}
function closeLogin() { document.getElementById('loginModal').classList.remove('show'); }
document.getElementById('loginModal').addEventListener('click', e => {
  if (e.target.id === 'loginModal') closeLogin();
});

// ---- auth state in the header ----
async function refreshAuthNav() {
  try {
    const { user, page } = await API.get('/api/me');
    document.getElementById('loginNav').style.display = 'none';
    document.getElementById('joinNav').style.display = 'none';
    const dash = document.getElementById('dashNav');
    dash.href = page; dash.style.display = 'inline-block';
    document.getElementById('logoutNav').style.display = 'inline-block';
    document.getElementById('logoutNav').textContent = 'Log out · ' + user.contact_name.split(' ')[0];
  } catch (e) { /* not logged in */ }
}
async function logout() {
  await API.post('/api/logout');
  location.href = '/';
}

// ---- register ----
document.getElementById('registerForm').addEventListener('submit', async e => {
  e.preventDefault();
  const err = document.getElementById('registerError');
  err.textContent = '';
  const fd = new FormData(e.target);          // includes the optional picture
  const body = Object.fromEntries(fd);
  try {
    const res = await API.postForm('/api/register', fd);
    location.href = res.redirect;          // straight to the role page
  } catch (ex) {
    err.textContent = ex.message;
    if (ex.status === 409) {
      document.getElementById('loginEmail').value = body.email;
      openLogin();
    }
  }
});

// ---- login ----
document.getElementById('loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const err = document.getElementById('loginError');
  err.textContent = '';
  try {
    const res = await API.post('/api/login', {
      email: document.getElementById('loginEmail').value,
      password: document.getElementById('loginPassword').value,
    });
    location.href = res.redirect;          // straight to the role page
  } catch (ex) { err.textContent = ex.message; }
});

// ---- directory ----
async function renderDirectory() {
  const params = new URLSearchParams({
    q: document.getElementById('search').value,
    role: document.getElementById('filterRole').value,
    district: document.getElementById('filterDistrict').value,
  });
  const box = document.getElementById('directoryList');
  try {
    const { members } = await API.get('/api/members?' + params);
    box.innerHTML = members.length ? members.map(m => {
      const r = roleBySlug(m.role);
      const contact = m.phone
        ? `<br>${esc(m.contact_name)}<br><a href="mailto:${esc(m.email)}">${esc(m.email)}</a>
           <span class="chips">${phoneChip(m.phone)}${placeChip(m.org_name + ', ' + m.area, [m.org_name, m.area, m.district, 'Tamil Nadu'].join(', '))}</span>`
        : `<br>Log in to see contact details<span class="chips">${placeChip(m.area + ', ' + m.district, [m.area, m.district, 'Tamil Nadu'].join(', '))}</span>`;
      return `<article class="person"><div class="person-top">
        <div class="person-icon">${m.photo_url ? pictureTag(m.photo_url, 'person-photo', m.org_name) : ''}<span>${esc((m.org_name || '?').trim().charAt(0).toUpperCase())}</span></div>
        <div><h3>${esc(m.org_name)}</h3><small>${esc(r.name)}</small></div></div>
        <p>${contact.replace(/^<br>/, "")}</p>
        ${m.details ? '<p>' + esc(m.details) + '</p>' : ''}
        <span class="tag">${esc(m.district)}</span></article>`;
    }).join('') : '<div class="empty">Nobody here yet. You could be the first.</div>';
  } catch (ex) {
    box.innerHTML = `<div class="empty">${esc(ex.message)}</div>`;
  }
}
let dirTimer;
document.getElementById('search').addEventListener('input', () => {
  clearTimeout(dirTimer); dirTimer = setTimeout(renderDirectory, 250);
});
document.getElementById('filterRole').addEventListener('change', renderDirectory);
document.getElementById('filterDistrict').addEventListener('change', renderDirectory);

const regPicture = mountPicture(document.getElementById('regPicture'), 'Farm / organisation picture (optional)');
chooseRole('farmer', false);
refreshAuthNav();
renderDirectory();
