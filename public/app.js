// Frontend Aplikasi Staff — tanpa framework. Semua teks pengguna dirender via textContent (aman dari XSS).
const $app = document.getElementById('app');
const state = { user: null, balance: null, users: [], view: 'dasbor', filters: { type: '', status: '', user_id: '', from: '', to: '', q: '' }, sumYear: new Date().getFullYear(), sumMonth: 0 };

const TYPE_LABEL = { pelanggaran: 'Pelanggaran', sakit: 'Izin Sakit', izin_keluar: 'Izin Keluar Jam Kerja', cuti: 'Cuti', lainnya: 'Lainnya' };
const STATUS_LABEL = { pending: 'Menunggu', approved: 'Disetujui', rejected: 'Ditolak', cancelled: 'Dibatalkan', recorded: 'Tercatat' };
const SANCTION_LABEL = { '': '-', teguran_lisan: 'Teguran Lisan', sp1: 'SP 1', sp2: 'SP 2', sp3: 'SP 3', lainnya: 'Lainnya' };
const LEAVE_LABEL = { tahunan: 'Tahunan', besar: 'Besar', melahirkan: 'Melahirkan', menikah: 'Menikah', duka: 'Duka', tanpa_gaji: 'Tanpa Gaji', lainnya: 'Lainnya' };
const ROLE_LABEL = { admin: 'Admin', manager: 'Manager', staff: 'Staff' };
const MONTHS = ['Setahun penuh', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

const canManage = () => state.user && (state.user.role === 'admin' || state.user.role === 'manager');

// ---------- helpers ----------
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}
async function api(method, url, body) {
  const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  if (res.status === 401 && state.user) { state.user = null; render(); throw new Error('Sesi berakhir, silakan login lagi'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Terjadi kesalahan');
  return data;
}
function toast(msg) { const t = h('div', { class: 'toast' }, msg); document.body.append(t); setTimeout(() => t.remove(), 2500); }
const fmtDate = (d) => (d ? new Date(d + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const pill = (cls, text) => h('span', { class: 'pill ' + cls }, text);
function field(label, input) { return h('div', { class: 'field' }, h('label', {}, label), input); }
function sel(options, value, attrs) {
  return h('select', attrs, options.map(([v, l]) => h('option', { value: v, selected: String(v) === String(value) }, l)));
}
function dayspan(a, b) { return Math.round((Date.parse(b) - Date.parse(a)) / 86400000) + 1; }

// ---------- login ----------
function renderLogin() {
  const err = h('div', { class: 'err' });
  const u = h('input', { autocomplete: 'username', required: true, autofocus: true });
  const p = h('input', { type: 'password', autocomplete: 'current-password', required: true });
  const form = h('form', { class: 'card', onsubmit: async (e) => {
    e.preventDefault(); err.textContent = '';
    try { await api('POST', '/api/login', { username: u.value, password: p.value }); await boot(); }
    catch (ex) { err.textContent = ex.message; }
  } }, h('h1', {}, 'Aplikasi Staff'), h('p', { class: 'muted' }, 'Pelanggaran, izin, dan cuti staff'),
    field('Username', u), field('Password', p), err, h('button', { class: 'btn', type: 'submit' }, 'Masuk'));
  $app.replaceChildren(h('div', { class: 'login' }, form));
}

// ---------- layout ----------
function renderShell(content) {
  const tabs = [['dasbor', '🏠', 'Dasbor'], ['catatan', '📋', 'Catatan']];
  if (canManage()) tabs.push(['persetujuan', '✅', 'Setuju']);
  if (state.user.role === 'admin') tabs.push(['staff', '👥', 'Staff']);
  tabs.push(['akun', '👤', 'Akun']);
  $app.replaceChildren(
    h('header', { class: 'top' }, h('div', { class: 'top-in' }, h('span', { class: 'brand' }, 'Aplikasi Staff'), h('span', { class: 'who' }, state.user.name))),
    h('main', {}, content),
    h('nav', { class: 'tabbar' }, tabs.map(([k, ic, l]) => h('button', { class: state.view === k ? 'active' : '', onclick: () => { state.view = k; window.scrollTo(0, 0); render(); } }, h('span', { class: 'ic' }, ic), h('span', {}, l)))));
}

// ---------- dasbor ----------
async function viewDasbor() {
  const box = h('div', {});
  renderShell(box);
  const s = await api('GET', `/api/summary?year=${state.sumYear}&month=${state.sumMonth}`);
  const n = (type, status) => s.counts.filter((c) => c.type === type && (!status || c.status === status)).reduce((a, c) => a + c.n, 0);
  const yearIn = h('input', { type: 'number', value: state.sumYear, min: 2000, max: 2100 });
  const monthSel = sel(MONTHS.map((m, i) => [i, m]), state.sumMonth);
  const apply = () => { state.sumYear = Number(yearIn.value) || state.sumYear; state.sumMonth = Number(monthSel.value); render(); };
  box.append(
    h('div', { class: 'card row' }, field('Tahun', yearIn), field('Bulan', monthSel), h('div', { class: 'field' }, h('button', { class: 'btn', onclick: apply }, 'Tampilkan'))),
    h('div', { class: 'grid' },
      stat(n('pelanggaran'), 'Pelanggaran'), stat(n('sakit', 'approved'), 'Izin sakit (disetujui)'), stat(n('izin_keluar', 'approved'), 'Izin keluar (disetujui)'),
      stat(n('cuti', 'approved'), 'Cuti (disetujui)'), stat(s.pending, canManage() ? 'Menunggu keputusan Anda' : 'Pengajuan Anda menunggu')));
  if (!canManage() && state.balance) {
    const b = state.balance;
    box.append(h('div', { class: 'card' }, h('h2', {}, `Jatah cuti tahunan ${b.year}`), h('p', {}, `Kuota ${b.quota} · terpakai ${b.used} · menunggu ${b.pending} · `, h('b', {}, `sisa ${b.remaining} hari`))));
  }
  if (s.outNow.length) {
    box.append(h('div', { class: 'card' }, h('h2', {}, 'Tidak masuk / izin hari ini'),
      s.outNow.map((r) => h('div', { class: 'line' }, h('div', {}, h('b', {}, r.name), h('div', { class: 'muted small' }, TYPE_LABEL[r.type] + (r.type === 'cuti' ? ` (${LEAVE_LABEL[r.category] || r.category})` : ''))),
        h('div', { class: 'muted small right' }, r.type === 'izin_keluar' ? `${r.time_out}${r.time_in ? '–' + r.time_in : ''}` : `s/d ${fmtDate(r.end_date)}`)))));
  }
  box.append(h('h2', { class: 'sect' }, canManage() ? 'Rekap per staff' : 'Rekap saya'),
    s.perStaff.map((r) => h('div', { class: 'card item' }, h('div', { class: 'item-head' }, h('b', {}, r.name), h('span', { class: 'muted small' }, r.department)),
      h('div', { class: 'mini' }, mini(r.violations, 'Pelanggaran'), mini(r.points, 'Poin'), mini(r.sick_days, 'Hr sakit'), mini(r.out_count, 'Izin keluar'), mini(r.leave_days, 'Hr cuti'), mini(r.other_count, 'Lainnya')))));
}
const mini = (n, l) => h('div', {}, h('div', { class: 'n' }, n), h('div', { class: 'l' }, l));
const stat = (n, l) => h('div', { class: 'stat' }, h('div', { class: 'n' }, n), h('div', { class: 'l' }, l));

// ---------- daftar catatan ----------
function detailText(r) {
  switch (r.type) {
    case 'pelanggaran': return `${r.category} · sanksi: ${SANCTION_LABEL[r.sanction] || '-'} · ${r.points} poin`;
    case 'sakit': return `${r.days} hari${r.has_doctor_note ? ' · ada surat dokter' : ' · tanpa surat dokter'}`;
    case 'izin_keluar': return `${r.time_out}${r.time_in ? ' – ' + r.time_in : ''}`;
    case 'cuti': return `${LEAVE_LABEL[r.category] || r.category} · ${r.days} hari`;
    default: return `${r.category} · ${r.days} hari`;
  }
}
function recordTable(rows, { withActions }) {
  if (!rows.length) return h('p', { class: 'muted' }, 'Belum ada data.');
  return h('div', {}, rows.map((r) => h('div', { class: 'card item' },
    h('div', { class: 'item-head' }, pill('t-' + r.type, TYPE_LABEL[r.type]), pill(r.status, STATUS_LABEL[r.status])),
    h('div', { class: 'item-title' }, r.user_name),
    h('div', { class: 'muted small' }, fmtDate(r.start_date) + (r.end_date !== r.start_date ? ' – ' + fmtDate(r.end_date) : '') + ' · ' + detailText(r)),
    h('p', { class: 'desc' }, r.description),
    r.decision_note ? h('div', { class: 'muted small' }, `Catatan keputusan: ${r.decision_note}`) : null,
    h('div', { class: 'muted small' }, `Dicatat ${r.created_by_name}${r.decided_by_name ? ' · diputuskan ' + r.decided_by_name : ''}`),
    withActions ? recordActions(r) : null)));
}
function recordActions(r) {
  const a = [];
  const mine = r.created_by === state.user.id;
  if (canManage() && r.status === 'pending' && r.user_id !== state.user.id) {
    a.push(h('button', { class: 'btn ok sm', onclick: () => decide(r, 'approved') }, 'Setujui'), h('button', { class: 'btn danger sm', onclick: () => decide(r, 'rejected') }, 'Tolak'));
  }
  if (r.status === 'pending' && (mine || state.user.role === 'admin')) a.push(h('button', { class: 'btn ghost sm', onclick: () => cancelRec(r) }, 'Batalkan'));
  const editable = canManage() ? (state.user.role === 'admin' || r.type === 'pelanggaran' || r.status === 'pending') : (r.status === 'pending' && mine);
  if (editable && r.status !== 'cancelled') a.push(h('button', { class: 'btn ghost sm', onclick: () => openRecordForm(r) }, 'Ubah'));
  if (state.user.role === 'admin') a.push(h('button', { class: 'btn danger sm', onclick: () => delRec(r) }, 'Hapus'));
  return h('div', { class: 'actions' }, a);
}
async function decide(r, status) {
  let note = '';
  if (status === 'rejected') { note = prompt('Alasan penolakan (wajib):'); if (!note) return; }
  else if (!confirm(`Setujui ${TYPE_LABEL[r.type]} milik ${r.user_name}?`)) return;
  try { await api('POST', `/api/records/${r.id}/decide`, { status, note }); toast('Keputusan disimpan'); await refreshMe(); render(); } catch (e) { alert(e.message); }
}
async function cancelRec(r) { if (!confirm('Batalkan pengajuan ini?')) return; try { await api('POST', `/api/records/${r.id}/cancel`, {}); await refreshMe(); render(); } catch (e) { alert(e.message); } }
async function delRec(r) { if (!confirm('Hapus catatan ini secara permanen?')) return; try { await api('DELETE', `/api/records/${r.id}`); await refreshMe(); render(); } catch (e) { alert(e.message); } }

async function viewCatatan() {
  const f = state.filters;
  const box = h('div', {});
  renderShell(box);
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v));
  const rows = await api('GET', '/api/records?' + qs);
  const set = (k) => (e) => { f[k] = e.target.value; };
  const types = [['', 'Semua jenis'], ...Object.entries(TYPE_LABEL)];
  const statuses = [['', 'Semua status'], ...Object.entries(STATUS_LABEL)];
  const filters = h('details', { class: 'card' }, h('summary', {}, 'Filter & unduh'), h('div', { class: 'row' },
    field('Jenis', sel(types, f.type, { onchange: set('type') })), field('Status', sel(statuses, f.status, { onchange: set('status') })),
    canManage() ? field('Staff', sel([['', 'Semua staff'], ...state.users.map((u) => [u.id, u.name])], f.user_id, { onchange: set('user_id') })) : null,
    field('Dari', h('input', { type: 'date', value: f.from, onchange: set('from') })), field('Sampai', h('input', { type: 'date', value: f.to, onchange: set('to') })),
    field('Cari', h('input', { value: f.q, placeholder: 'nama / keterangan', onchange: set('q') }))),
    h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => render() }, 'Terapkan'), h('a', { class: 'btn ghost', href: '/api/export.csv?' + qs, download: '' }, 'Unduh CSV')));
  if (Object.values(f).some(Boolean)) filters.open = true;
  box.append(h('button', { class: 'btn block', onclick: () => openRecordForm() }, canManage() ? '+ Catat baru' : '+ Ajukan izin / cuti'), filters, recordTable(rows, { withActions: true }));
}

async function viewPersetujuan() {
  const box = h('div', {});
  renderShell(box);
  const rows = (await api('GET', '/api/records?status=pending')).filter((r) => r.user_id !== state.user.id);
  box.append(h('h2', { class: 'sect' }, `Menunggu keputusan (${rows.length})`), recordTable(rows, { withActions: true }));
}

// ---------- form catatan ----------
function openRecordForm(existing) {
  const manage = canManage();
  const isEdit = !!existing;
  const err = h('div', { class: 'err' });
  const types = manage ? Object.keys(TYPE_LABEL) : ['sakit', 'izin_keluar', 'cuti', 'lainnya'];
  const type = sel(types.map((t) => [t, TYPE_LABEL[t]]), existing?.type || types[0], { disabled: isEdit });
  const staffSel = manage ? sel(state.users.map((u) => [u.id, u.name]), existing?.user_id || state.user.id) : null;
  const start = h('input', { type: 'date', value: existing?.start_date || todayStr(), required: true });
  const end = h('input', { type: 'date', value: existing?.end_date || todayStr() });
  const desc = h('textarea', { required: true, maxlength: 2000 }, existing?.description || '');
  const dyn = h('div', {});
  const startLabel = h('label', {}, 'Tanggal');
  const auto = h('input', { type: 'checkbox' });
  let el = {};

  function buildDynamic() {
    const t = type.value; el = {}; dyn.replaceChildren();
    startLabel.textContent = t === 'izin_keluar' || t === 'pelanggaran' ? 'Tanggal' : 'Tanggal mulai';
    const endField = field(t === 'sakit' || t === 'cuti' || t === 'lainnya' ? 'Tanggal selesai' : '', end);
    if (t === 'pelanggaran') {
      el.category = sel([['ringan', 'Ringan (1 poin)'], ['sedang', 'Sedang (3 poin)'], ['berat', 'Berat (5 poin)']], existing?.category || 'ringan');
      el.sanction = sel(Object.entries(SANCTION_LABEL).map(([v, l]) => [v, v ? l : 'Tanpa sanksi']), existing?.sanction || '');
      el.points = h('input', { type: 'number', min: 0, max: 100, value: existing?.points ?? '', placeholder: 'otomatis sesuai tingkat' });
      dyn.append(field('Tingkat pelanggaran', el.category), field('Sanksi', el.sanction), field('Poin (opsional)', el.points));
    } else if (t === 'sakit') {
      el.doc = h('input', { type: 'checkbox', checked: !!existing?.has_doctor_note });
      dyn.append(endField, h('div', { class: 'field check' }, el.doc, h('label', {}, 'Ada surat keterangan dokter')));
    } else if (t === 'izin_keluar') {
      el.out = h('input', { type: 'time', value: existing?.time_out || '', required: true });
      el.in = h('input', { type: 'time', value: existing?.time_in || '' });
      dyn.append(h('div', { class: 'row' }, field('Jam keluar', el.out), field('Perkiraan kembali', el.in)));
    } else if (t === 'cuti') {
      el.category = sel(Object.entries(LEAVE_LABEL), existing?.category || 'tahunan');
      el.days = h('input', { type: 'number', min: 1, value: existing?.days || '' });
      const hint = h('div', { class: 'muted small' });
      const upd = () => {
        const span = dayspan(start.value, end.value);
        if (span > 0 && !el.days.dataset.touched) el.days.value = span;
        hint.textContent = state.balance && el.category.value === 'tahunan' && !manage ? `Sisa jatah cuti tahunan: ${state.balance.remaining} hari` : 'Isi manual bila ada hari libur/non-kerja di rentang ini.';
      };
      el.days.addEventListener('input', () => { el.days.dataset.touched = '1'; });
      start.addEventListener('change', upd); end.addEventListener('change', upd); el.category.addEventListener('change', upd);
      dyn.append(field('Jenis cuti', el.category), endField, field('Jumlah hari cuti', el.days), hint); upd();
    } else {
      el.category = h('input', { value: existing?.category || '', placeholder: 'mis. Izin menikah, dinas luar, ...', maxlength: 40, required: true });
      dyn.append(field('Jenis / kategori', el.category), endField);
    }
    if (manage && !isEdit && t !== 'pelanggaran') dyn.append(h('div', { class: 'field check' }, auto, h('label', {}, 'Langsung setujui (dicatat atas nama staff)')));
  }
  type.addEventListener('change', buildDynamic); buildDynamic();

  const close = () => back.remove();
  const form = h('form', { onsubmit: async (e) => {
    e.preventDefault(); err.textContent = '';
    const t = type.value;
    const body = { type: t, start_date: start.value, end_date: t === 'izin_keluar' || t === 'pelanggaran' ? start.value : end.value || start.value, description: desc.value };
    if (manage) body.user_id = Number(staffSel.value);
    if (t === 'pelanggaran') Object.assign(body, { category: el.category.value, sanction: el.sanction.value, points: el.points.value });
    if (t === 'sakit') body.has_doctor_note = el.doc.checked;
    if (t === 'izin_keluar') Object.assign(body, { time_out: el.out.value, time_in: el.in.value });
    if (t === 'cuti') Object.assign(body, { category: el.category.value, days: el.days.value });
    if (t === 'lainnya') body.category = el.category.value;
    if (auto.checked) body.auto_approve = true;
    try {
      await api(isEdit ? 'PUT' : 'POST', isEdit ? `/api/records/${existing.id}` : '/api/records', body);
      close(); toast(isEdit ? 'Perubahan disimpan' : (t === 'pelanggaran' ? 'Pelanggaran dicatat' : manage && auto.checked ? 'Tercatat & disetujui' : 'Berhasil disimpan')); await refreshMe(); render();
    } catch (ex) { err.textContent = ex.message; }
  } },
    h('h2', {}, isEdit ? 'Ubah catatan' : manage ? 'Catat baru' : 'Ajukan izin / cuti'),
    field('Jenis', type), manage ? field('Staff', staffSel) : null,
    h('div', { class: 'field' }, startLabel, start), dyn,
    field('Keterangan / alasan', desc), err,
    h('div', { class: 'row' }, h('button', { class: 'btn', type: 'submit' }, 'Simpan'), h('button', { class: 'btn ghost', type: 'button', onclick: close }, 'Batal')));
  const back = h('div', { class: 'modal-back', onmousedown: (e) => { if (e.target === back) close(); } }, h('div', { class: 'modal' }, form));
  document.body.append(back);
}

// ---------- staff (admin) ----------
async function viewStaff() {
  const box = h('div', {});
  renderShell(box);
  const users = await api('GET', '/api/users?all=1');
  box.append(h('button', { class: 'btn block', onclick: () => openUserForm() }, '+ Tambah staff'),
    users.map((u) => h('div', { class: 'card item' }, h('div', { class: 'item-head' }, h('b', {}, u.name), pill(u.active ? 'approved' : 'rejected', u.active ? 'Aktif' : 'Nonaktif')),
      h('div', { class: 'muted small' }, `${u.username} · ${ROLE_LABEL[u.role]}${u.nik ? ' · NIK ' + u.nik : ''}`),
      h('div', { class: 'muted small' }, [u.position, u.department].filter(Boolean).join(' / ') || '-', ` · kuota cuti ${u.annual_quota}`),
      h('div', { class: 'actions' }, h('button', { class: 'btn ghost sm', onclick: () => openUserForm(u) }, 'Ubah')))));
}
function openUserForm(u) {
  const err = h('div', { class: 'err' });
  const f = {
    name: h('input', { value: u?.name || '', required: true }), username: h('input', { value: u?.username || '', required: !u, disabled: !!u }),
    password: h('input', { type: 'password', autocomplete: 'new-password', required: !u, placeholder: u ? 'kosongkan bila tidak diubah' : 'minimal 8 karakter' }),
    nik: h('input', { value: u?.nik || '' }), position: h('input', { value: u?.position || '' }), department: h('input', { value: u?.department || '' }),
    role: sel(Object.entries(ROLE_LABEL), u?.role || 'staff'), quota: h('input', { type: 'number', min: 0, max: 365, value: u?.annual_quota ?? 12 }),
    active: h('input', { type: 'checkbox', checked: u ? !!u.active : true }),
  };
  const close = () => back.remove();
  const form = h('form', { onsubmit: async (e) => {
    e.preventDefault(); err.textContent = '';
    const body = { name: f.name.value, nik: f.nik.value, position: f.position.value, department: f.department.value, role: f.role.value, annual_quota: Number(f.quota.value), active: f.active.checked };
    if (f.password.value) body.password = f.password.value;
    if (!u) body.username = f.username.value;
    try { await api(u ? 'PUT' : 'POST', u ? `/api/users/${u.id}` : '/api/users', body); close(); await refreshMe(); render(); } catch (ex) { err.textContent = ex.message; }
  } }, h('h2', {}, u ? 'Ubah staff' : 'Tambah staff'),
    field('Nama lengkap', f.name), field('Username', f.username), field('Password', f.password), field('NIK / ID karyawan', f.nik),
    field('Jabatan', f.position), field('Departemen', f.department), field('Role', f.role), field('Kuota cuti tahunan (hari)', f.quota),
    h('div', { class: 'field check' }, f.active, h('label', {}, 'Akun aktif')), err,
    h('div', { class: 'row' }, h('button', { class: 'btn', type: 'submit' }, 'Simpan'), h('button', { class: 'btn ghost', type: 'button', onclick: close }, 'Batal')));
  const back = h('div', { class: 'modal-back', onmousedown: (e) => { if (e.target === back) close(); } }, h('div', { class: 'modal' }, form));
  document.body.append(back);
}

// ---------- akun ----------
function viewAkun() {
  const err = h('div', { class: 'err' });
  const cur = h('input', { type: 'password', autocomplete: 'current-password', required: true });
  const pw = h('input', { type: 'password', autocomplete: 'new-password', required: true, minlength: 8 });
  renderShell(h('div', { class: 'card' }, h('h2', {}, 'Akun saya'),
    h('p', { class: 'muted' }, `${state.user.name} · ${state.user.username} · ${ROLE_LABEL[state.user.role]}`),
    h('form', { onsubmit: async (e) => {
      e.preventDefault(); err.textContent = '';
      try { await api('POST', '/api/me/password', { current: cur.value, password: pw.value }); cur.value = pw.value = ''; toast('Password diganti'); } catch (ex) { err.textContent = ex.message; }
    } }, h('h3', {}, 'Ganti password'), field('Password lama', cur), field('Password baru (min. 8 karakter)', pw), err, h('button', { class: 'btn', type: 'submit' }, 'Simpan'))));
}

// ---------- boot ----------
async function refreshMe() {
  const me = await api('GET', '/api/me');
  state.user = me.user; state.balance = me.balance;
  state.users = await api('GET', '/api/users');
}
async function render() {
  if (!state.user) return renderLogin();
  try {
    const views = { dasbor: viewDasbor, catatan: viewCatatan, persetujuan: viewPersetujuan, staff: viewStaff, akun: viewAkun };
    if (!views[state.view] || (state.view === 'staff' && state.user.role !== 'admin') || (state.view === 'persetujuan' && !canManage())) state.view = 'dasbor';
    await views[state.view]();
  } catch (e) { if (state.user) alert(e.message); }
}
async function boot() { try { await refreshMe(); } catch { state.user = null; } render(); }
boot();
