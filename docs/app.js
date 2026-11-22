// Catatan Staff — pencatatan & rekap pribadi. Semua data tersimpan di perangkat (localStorage). Tanpa server, tanpa login.
(() => {
'use strict';

const TYPES = {
  pelanggaran: { label: 'Pelanggaran', icon: '⚠️' },
  sakit: { label: 'Izin Sakit', icon: '🤒' },
  izin_keluar: { label: 'Izin Keluar', icon: '🚶' },
  cuti: { label: 'Cuti', icon: '🏖️' },
  lainnya: { label: 'Lainnya', icon: '📝' },
};
const SEVERITY = { ringan: 1, sedang: 3, berat: 5 };
const SANCTION = { '': 'Tanpa sanksi', teguran_lisan: 'Teguran Lisan', sp1: 'SP 1', sp2: 'SP 2', sp3: 'SP 3', lainnya: 'Sanksi lain' };
const LEAVE = { tahunan: 'Tahunan', besar: 'Besar', melahirkan: 'Melahirkan', menikah: 'Menikah', duka: 'Duka', tanpa_gaji: 'Tanpa Gaji', lainnya: 'Lainnya' };
const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const KEY = 'catatan-staff-v1';

// ---------- penyimpanan ----------
let data = { staff: [], records: [], nextId: 1 };
let storageOk = true;
function load() {
  try { const raw = localStorage.getItem(KEY); if (raw) data = normalize(JSON.parse(raw)); } catch { storageOk = false; }
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { storageOk = false; toast('Gagal menyimpan! Penyimpanan browser penuh/diblokir'); } }
function normalize(d) {
  const out = { staff: Array.isArray(d.staff) ? d.staff : [], records: Array.isArray(d.records) ? d.records : [], nextId: Number(d.nextId) || 1 };
  const maxId = Math.max(0, ...out.staff.map((s) => s.id), ...out.records.map((r) => r.id));
  out.nextId = Math.max(out.nextId, maxId + 1);
  return out;
}

// ---------- state & util ----------
const now = new Date();
const ui = { tab: 'beranda', year: now.getFullYear(), month: now.getMonth(), rekapMode: 'bulan', filterType: '', filterStaff: '', q: '', lastStaff: '' };
const $app = document.getElementById('app');
const pad = (n) => String(n).padStart(2, '0');
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const fmtDate = (s) => new Date(s + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000) + 1;
const staffById = (id) => data.staff.find((s) => s.id === id);
const staffName = (id) => staffById(id)?.name || '(staff dihapus)';
const periodPrefix = (mode = ui.rekapMode) => (mode === 'tahun' ? String(ui.year) : `${ui.year}-${pad(ui.month + 1)}`);
const inPeriod = (r, prefix) => r.start.startsWith(prefix);
const sortRecords = (a, b) => (a.start < b.start ? 1 : a.start > b.start ? -1 : b.id - a.id);

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
  for (const kid of kids.flat(Infinity)) if (kid !== null && kid !== undefined && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}
function toast(msg) { const t = h('div', { class: 'toast' }, msg); document.body.append(t); setTimeout(() => t.remove(), 2200); }
const field = (label, input) => h('div', { class: 'field' }, h('label', {}, label), input);
const select = (opts, value, attrs) => h('select', attrs, opts.map(([v, l]) => h('option', { value: v, selected: String(v) === String(value) }, l)));
const tag = (type) => h('span', { class: 'tag t-' + type }, TYPES[type].label);

function detail(r) {
  switch (r.type) {
    case 'pelanggaran': return `${r.category} · ${SANCTION[r.sanction] || 'Tanpa sanksi'} · ${r.points} poin`;
    case 'sakit': return `${r.days} hari · ${r.doctorNote ? 'ada surat dokter' : 'tanpa surat dokter'}`;
    case 'izin_keluar': return `${r.timeOut}${r.timeIn ? ' – ' + r.timeIn : ''}`;
    case 'cuti': return `${LEAVE[r.category] || r.category} · ${r.days} hari`;
    default: return `${r.category}${r.days > 1 ? ' · ' + r.days + ' hari' : ''}`;
  }
}
function dateText(r) { return fmtDate(r.start) + (r.end && r.end !== r.start ? ' → ' + fmtDate(r.end) : ''); }

function recordCard(r) {
  return h('button', { class: 'card item', onclick: () => openRecordSheet(r) },
    h('div', { class: 'top' }, h('span', { class: 'who' }, staffName(r.staffId)), tag(r.type)),
    h('div', { class: 'muted small' }, dateText(r) + ' · ' + detail(r)),
    r.desc ? h('div', { class: 'desc' }, r.desc) : null);
}

function summarize(prefix) {
  const rows = data.staff.filter((s) => s.active !== false).map((s) => ({ staff: s, v: 0, pts: 0, sick: 0, out: 0, leave: 0, annual: 0, other: 0 }));
  const byId = new Map(rows.map((x) => [x.staff.id, x]));
  const totals = { pelanggaran: 0, sakit: 0, izin_keluar: 0, cuti: 0, lainnya: 0 };
  for (const r of data.records) {
    if (!inPeriod(r, prefix)) continue;
    totals[r.type] += 1;
    const x = byId.get(r.staffId); if (!x) continue;
    if (r.type === 'pelanggaran') { x.v++; x.pts += r.points; }
    else if (r.type === 'sakit') x.sick += r.days;
    else if (r.type === 'izin_keluar') x.out++;
    else if (r.type === 'cuti') x.leave += r.days;
    else x.other++;
  }
  return { rows, totals };
}
function annualLeaveUsed(staffId, year) {
  return data.records.filter((r) => r.staffId === staffId && r.type === 'cuti' && r.category === 'tahunan' && r.start.startsWith(String(year))).reduce((a, r) => a + r.days, 0);
}

// ---------- layout ----------
function shell(content) {
  const tabs = [['beranda', '🏠', 'Beranda'], ['riwayat', '📋', 'Riwayat'], ['add', '+', 'Catat'], ['rekap', '📊', 'Rekap'], ['pengaturan', '⚙️', 'Pengaturan']];
  $app.replaceChildren(
    h('div', { class: 'page' }, content),
    h('nav', { class: 'tabbar' }, tabs.map(([k, ic, l]) => h('button', { class: (k === 'add' ? 'add ' : '') + (ui.tab === k ? 'on' : ''), 'aria-label': l, onclick: () => { if (k === 'add') return openRecordSheet(); ui.tab = k; window.scrollTo(0, 0); render(); } },
      h('span', { class: 'ic' }, ic), h('span', {}, l)))));
}
function monthNav(withYearOnly) {
  const step = (d) => { if (withYearOnly) ui.year += d; else { ui.month += d; if (ui.month < 0) { ui.month = 11; ui.year--; } if (ui.month > 11) { ui.month = 0; ui.year++; } } render(); };
  return h('div', { class: 'monthnav' }, h('button', { class: 'iconbtn', 'aria-label': 'Sebelumnya', onclick: () => step(-1) }, '‹'),
    h('b', {}, withYearOnly ? String(ui.year) : `${MONTHS[ui.month]} ${ui.year}`), h('button', { class: 'iconbtn', 'aria-label': 'Berikutnya', onclick: () => step(1) }, '›'));
}

// ---------- beranda ----------
function viewBeranda() {
  const prefix = `${ui.year}-${pad(ui.month + 1)}`;
  const { totals } = summarize(prefix);
  const recent = data.records.filter((r) => inPeriod(r, prefix)).sort(sortRecords).slice(0, 8);
  const body = [h('div', { class: 'head' }, h('h1', {}, 'Catatan Staff'), monthNav(false))];
  if (!data.staff.length) {
    body.push(h('div', { class: 'card empty' }, h('p', {}, 'Mulai dengan menambahkan staff dulu.'), h('button', { class: 'btn', onclick: () => { ui.tab = 'pengaturan'; render(); openStaffSheet(); } }, '+ Tambah staff')));
  } else {
    body.push(h('div', { class: 'grid' }, Object.entries(TYPES).map(([k, t]) => h('div', { class: 'stat t-' + k }, h('div', { class: 'n' }, totals[k]), h('div', { class: 'l' }, `${t.icon} ${t.label}`)))));
    body.push(h('div', { class: 'sect' }, 'Catatan terbaru bulan ini'));
    body.push(recent.length ? recent.map(recordCard) : h('div', { class: 'card empty' }, 'Belum ada catatan bulan ini. Tekan tombol + untuk mencatat.'));
  }
  if (!storageOk) body.push(h('div', { class: 'card small' }, '⚠️ Penyimpanan browser tidak tersedia (mode privat?). Data tidak akan tersimpan.'));
  shell(body);
}

// ---------- riwayat ----------
function viewRiwayat() {
  const body = [h('div', { class: 'head' }, h('h1', {}, 'Riwayat'))];
  const q = h('input', { type: 'search', placeholder: 'Cari nama / keterangan…', value: ui.q, oninput: (e) => { ui.q = e.target.value; renderList(); } });
  body.push(q);
  body.push(h('div', { class: 'chips' }, [['', 'Semua'], ...Object.entries(TYPES).map(([k, t]) => [k, t.label])].map(([k, l]) => h('button', { class: 'chip' + (ui.filterType === k ? ' on' : ''), onclick: () => { ui.filterType = k; render(); } }, l))));
  body.push(h('div', { class: 'field' }, select([['', 'Semua staff'], ...data.staff.map((s) => [s.id, s.name])], ui.filterStaff, { onchange: (e) => { ui.filterStaff = e.target.value; renderList(); } })));
  const list = h('div', {});
  body.push(list);
  function renderList() {
    const s = ui.q.trim().toLowerCase();
    const rows = data.records.filter((r) => (!ui.filterType || r.type === ui.filterType) && (!ui.filterStaff || r.staffId === Number(ui.filterStaff))
      && (!s || staffName(r.staffId).toLowerCase().includes(s) || (r.desc || '').toLowerCase().includes(s) || (r.category || '').toLowerCase().includes(s))).sort(sortRecords);
    list.replaceChildren(...(rows.length ? rows.slice(0, 300).map(recordCard) : [h('div', { class: 'card empty' }, 'Tidak ada catatan.')]));
  }
  shell(body); renderList();
}

// ---------- rekap ----------
function viewRekap() {
  const prefix = periodPrefix();
  const { rows, totals } = summarize(prefix);
  const body = [h('div', { class: 'head' }, h('h1', {}, 'Rekap'), monthNav(ui.rekapMode === 'tahun'))];
  body.push(h('div', { class: 'seg' }, [['bulan', 'Per bulan'], ['tahun', 'Per tahun']].map(([k, l]) => h('button', { class: ui.rekapMode === k ? 'on' : '', onclick: () => { ui.rekapMode = k; render(); } }, l))));
  const total = Object.values(totals).reduce((a, b) => a + b, 0);
  body.push(h('div', { class: 'card small muted' }, `${total} catatan pada periode ini · dihitung berdasarkan tanggal mulai`));
  if (!rows.length) body.push(h('div', { class: 'card empty' }, 'Belum ada staff.'));
  rows.sort((a, b) => b.pts - a.pts || a.staff.name.localeCompare(b.staff.name)).forEach((x) => {
    const left = x.staff.quota ? x.staff.quota - annualLeaveUsed(x.staff.id, ui.year) : null;
    body.push(h('button', { class: 'card item', onclick: () => openStaffDetail(x.staff, prefix) },
      h('div', { class: 'row' }, h('b', {}, x.staff.name), h('span', { class: 'muted small' }, [x.staff.position, left !== null ? `sisa cuti ${left} hr (${ui.year})` : ''].filter(Boolean).join(' · '))),
      h('div', { class: 'mini' }, mini(x.v, 'Pelanggaran'), mini(x.pts, 'Poin'), mini(x.sick, 'Hari sakit'), mini(x.out, 'Izin keluar'), mini(x.leave, 'Hari cuti'), mini(x.other, 'Lainnya'))));
  });
  body.push(h('button', { class: 'btn ghost', onclick: () => exportCsv(prefix) }, '⬇️ Unduh rekap periode ini (CSV)'));
  shell(body);
}
const mini = (n, l) => h('div', {}, h('div', { class: 'n' }, n), h('div', { class: 'l' }, l));

function sheet(children) {
  const back = h('div', { class: 'backdrop', onclick: (e) => { if (e.target === back) back.remove(); } }, h('div', { class: 'sheet' }, children));
  back.close = () => back.remove();
  document.body.append(back);
  return back;
}
function openStaffDetail(s, prefix) {
  const rows = data.records.filter((r) => r.staffId === s.id && inPeriod(r, prefix)).sort(sortRecords);
  const back = sheet([h('h2', {}, s.name), h('div', { class: 'muted small' }, prefix.length === 4 ? `Tahun ${prefix}` : `${MONTHS[Number(prefix.slice(5)) - 1]} ${prefix.slice(0, 4)}`),
    h('div', { class: 'sect' }, `${rows.length} catatan`),
    rows.length ? rows.map((r) => h('button', { class: 'card item', onclick: () => { back.close(); openRecordSheet(r); } }, h('div', { class: 'top' }, h('span', { class: 'muted small' }, dateText(r)), tag(r.type)), h('div', { class: 'small' }, detail(r)), r.desc ? h('div', { class: 'desc' }, r.desc) : null)) : h('div', { class: 'empty' }, 'Tidak ada catatan.'),
    h('button', { class: 'btn ghost', onclick: () => back.close() }, 'Tutup')]);
}

// ---------- form catatan ----------
function openRecordSheet(existing) {
  if (!data.staff.some((s) => s.active !== false)) { toast('Tambah staff dulu di Pengaturan'); ui.tab = 'pengaturan'; render(); return; }
  const isEdit = !!existing;
  const activeStaff = data.staff.filter((s) => s.active !== false || (existing && s.id === existing.staffId));
  const err = h('div', { class: 'err' });
  const type = select(Object.entries(TYPES).map(([k, t]) => [k, `${t.icon} ${t.label}`]), existing?.type || 'sakit');
  const staff = select(activeStaff.map((s) => [s.id, s.name]), existing?.staffId || ui.lastStaff || activeStaff[0].id);
  const start = h('input', { type: 'date', value: existing?.start || todayStr(), required: true });
  const end = h('input', { type: 'date', value: existing?.end || existing?.start || todayStr() });
  const desc = h('textarea', { placeholder: 'Keterangan / alasan (opsional)', maxlength: 2000 }, existing?.desc || '');
  const startLabel = h('label', {}, 'Tanggal');
  const dyn = h('div', {});
  let el = {};
  const endField = h('div', { class: 'field' }, h('label', {}, 'Tanggal selesai'), end);

  function build() {
    const t = type.value; el = {}; dyn.replaceChildren();
    startLabel.textContent = t === 'izin_keluar' || t === 'pelanggaran' ? 'Tanggal' : 'Tanggal mulai';
    if (t === 'pelanggaran') {
      el.cat = select([['ringan', 'Ringan (1 poin)'], ['sedang', 'Sedang (3 poin)'], ['berat', 'Berat (5 poin)']], existing?.category || 'ringan');
      el.sanction = select(Object.entries(SANCTION), existing?.sanction || '');
      el.points = h('input', { type: 'number', inputmode: 'numeric', min: 0, max: 100, value: existing?.points ?? '', placeholder: 'Otomatis sesuai tingkat' });
      dyn.append(field('Tingkat pelanggaran', el.cat), field('Sanksi', el.sanction), field('Poin (opsional, ubah bila perlu)', el.points));
    } else if (t === 'sakit') {
      el.doc = h('input', { type: 'checkbox', checked: !!existing?.doctorNote });
      dyn.append(endField, h('div', { class: 'check' }, el.doc, h('label', {}, 'Ada surat keterangan dokter')));
    } else if (t === 'izin_keluar') {
      el.out = h('input', { type: 'time', value: existing?.timeOut || '' }); el.in = h('input', { type: 'time', value: existing?.timeIn || '' });
      dyn.append(h('div', { class: 'two' }, field('Jam keluar', el.out), field('Perkiraan kembali', el.in)));
    } else if (t === 'cuti') {
      el.cat = select(Object.entries(LEAVE), existing?.category || 'tahunan');
      el.days = h('input', { type: 'number', inputmode: 'numeric', min: 1, value: existing?.days || '' });
      const sync = () => { const n = daysBetween(start.value, end.value); if (n > 0 && !el.days.dataset.touched) el.days.value = n; };
      el.days.addEventListener('input', () => { el.days.dataset.touched = '1'; });
      start.onchange = end.onchange = sync; if (!existing) sync();
      dyn.append(field('Jenis cuti', el.cat), endField, field('Jumlah hari cuti (ubah bila ada hari libur)', el.days));
    } else {
      el.cat = h('input', { value: existing?.category || '', placeholder: 'mis. Dinas luar, izin menikah…', maxlength: 40 });
      dyn.append(field('Jenis / kategori', el.cat), endField);
    }
  }
  type.addEventListener('change', build);
  if (isEdit) type.disabled = true;
  build();

  const back = sheet([h('h2', {}, isEdit ? 'Ubah catatan' : 'Catat baru'),
    h('form', { onsubmit: (e) => {
      e.preventDefault(); err.textContent = '';
      const t = type.value;
      const r = { id: existing?.id, type: t, staffId: Number(staff.value), start: start.value, end: t === 'izin_keluar' || t === 'pelanggaran' ? start.value : (end.value || start.value), desc: desc.value.trim(), createdAt: existing?.createdAt || new Date().toISOString() };
      if (!r.start) return (err.textContent = 'Tanggal wajib diisi');
      if (r.end < r.start) return (err.textContent = 'Tanggal selesai tidak boleh sebelum tanggal mulai');
      if (t === 'pelanggaran') {
        r.category = el.cat.value; r.sanction = el.sanction.value;
        const p = el.points.value === '' ? SEVERITY[r.category] : Number(el.points.value);
        if (!Number.isInteger(p) || p < 0) return (err.textContent = 'Poin tidak valid');
        r.points = p; r.days = 0;
      } else if (t === 'sakit') { r.days = daysBetween(r.start, r.end); r.doctorNote = el.doc.checked; }
      else if (t === 'izin_keluar') {
        if (!el.out.value) return (err.textContent = 'Jam keluar wajib diisi');
        if (el.in.value && el.in.value <= el.out.value) return (err.textContent = 'Jam kembali harus setelah jam keluar');
        r.timeOut = el.out.value; r.timeIn = el.in.value; r.days = 0;
      } else if (t === 'cuti') {
        const span = daysBetween(r.start, r.end), d = Number(el.days.value);
        if (!Number.isInteger(d) || d < 1 || d > span) return (err.textContent = `Jumlah hari cuti harus 1–${span}`);
        r.category = el.cat.value; r.days = d;
      } else {
        r.category = el.cat.value.trim(); if (!r.category) return (err.textContent = 'Jenis/kategori wajib diisi');
        r.days = daysBetween(r.start, r.end);
      }
      if (isEdit) data.records[data.records.findIndex((x) => x.id === existing.id)] = r;
      else { r.id = data.nextId++; data.records.push(r); }
      ui.lastStaff = r.staffId; save(); back.close(); toast(isEdit ? 'Perubahan disimpan' : 'Tercatat ✓'); render();
    } },
      field('Jenis', type), field('Staff', staff), h('div', { class: 'field' }, startLabel, start), dyn, h('div', { class: 'field' }, h('label', {}, 'Keterangan'), desc), err,
      h('button', { class: 'btn', type: 'submit' }, 'Simpan'),
      isEdit ? h('button', { class: 'btn danger', type: 'button', onclick: () => { if (confirm('Hapus catatan ini?')) { data.records = data.records.filter((x) => x.id !== existing.id); save(); back.close(); toast('Dihapus'); render(); } } }, 'Hapus') : null,
      h('button', { class: 'btn ghost', type: 'button', onclick: () => back.close() }, 'Batal'))]);
}

// ---------- pengaturan ----------
function viewPengaturan() {
  const body = [h('div', { class: 'head' }, h('h1', {}, 'Pengaturan'))];
  body.push(h('div', { class: 'sect' }, 'Staff'));
  body.push(h('button', { class: 'btn', onclick: () => openStaffSheet() }, '+ Tambah staff'));
  data.staff.forEach((s) => body.push(h('button', { class: 'card item', onclick: () => openStaffSheet(s) },
    h('div', { class: 'row' }, h('b', {}, s.name), s.active === false ? h('span', { class: 'tag' }, 'Arsip') : null),
    h('div', { class: 'muted small' }, [s.position, s.quota ? `kuota cuti ${s.quota} hr/thn` : ''].filter(Boolean).join(' · ') || 'Ketuk untuk ubah'))));
  body.push(h('div', { class: 'sect' }, 'Cadangan data'));
  body.push(h('div', { class: 'card small' }, 'Data hanya ada di browser/HP ini. ', h('b', {}, 'Unduh cadangan secara berkala'), ' — data bisa hilang bila browser dibersihkan, atau Safari tidak dibuka lama (pasang ke Layar Utama untuk mengurangi risiko).'));
  body.push(h('button', { class: 'btn', onclick: exportJson }, '⬇️ Unduh cadangan (JSON)'));
  const file = h('input', { type: 'file', accept: 'application/json,.json', hidden: true, onchange: importJson });
  body.push(file, h('button', { class: 'btn ghost', onclick: () => file.click() }, '⬆️ Pulihkan dari cadangan'));
  body.push(h('button', { class: 'btn ghost', onclick: () => exportCsv('') }, '⬇️ Unduh semua catatan (CSV / Excel)'));
  body.push(h('div', { class: 'sect' }, 'Data'));
  body.push(h('div', { class: 'card small muted' }, `${data.staff.length} staff · ${data.records.length} catatan`));
  body.push(h('button', { class: 'btn danger', onclick: () => { if (confirm('Hapus SEMUA data? Tidak bisa dibatalkan.') && confirm('Yakin? Pastikan sudah unduh cadangan.')) { data = { staff: [], records: [], nextId: 1 }; save(); render(); } } }, 'Hapus semua data'));
  shell(body);
}
function openStaffSheet(s) {
  const isEdit = !!s;
  const name = h('input', { value: s?.name || '', placeholder: 'Nama staff', required: true, maxlength: 100 });
  const pos = h('input', { value: s?.position || '', placeholder: 'Jabatan / bagian (opsional)', maxlength: 80 });
  const quota = h('input', { type: 'number', inputmode: 'numeric', min: 0, max: 365, value: s?.quota ?? 12 });
  const err = h('div', { class: 'err' });
  const used = isEdit ? data.records.filter((r) => r.staffId === s.id).length : 0;
  const back = sheet([h('h2', {}, isEdit ? 'Ubah staff' : 'Tambah staff'),
    h('form', { onsubmit: (e) => {
      e.preventDefault();
      const n = name.value.trim(); if (!n) return (err.textContent = 'Nama wajib diisi');
      const q = Number(quota.value); if (!Number.isInteger(q) || q < 0) return (err.textContent = 'Kuota tidak valid');
      if (isEdit) Object.assign(s, { name: n, position: pos.value.trim(), quota: q });
      else data.staff.push({ id: data.nextId++, name: n, position: pos.value.trim(), quota: q, active: true });
      save(); back.close(); render();
    } }, field('Nama', name), field('Jabatan', pos), field('Kuota cuti tahunan (hari, 0 = tidak dihitung)', quota), err,
      h('button', { class: 'btn', type: 'submit' }, 'Simpan'),
      isEdit ? h('button', { class: 'btn ghost', type: 'button', onclick: () => { s.active = s.active === false; save(); back.close(); render(); } }, s.active === false ? 'Aktifkan kembali' : 'Arsipkan (sembunyikan dari rekap & form)') : null,
      isEdit && !used ? h('button', { class: 'btn danger', type: 'button', onclick: () => { if (confirm('Hapus staff ini?')) { data.staff = data.staff.filter((x) => x.id !== s.id); save(); back.close(); render(); } } }, 'Hapus') : null,
      isEdit && used ? h('div', { class: 'muted small' }, `Punya ${used} catatan — tidak bisa dihapus, gunakan Arsipkan.`) : null,
      h('button', { class: 'btn ghost', type: 'button', onclick: () => back.close() }, 'Batal'))]);
}

// ---------- ekspor / impor ----------
function download(name, text, mime) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = h('a', { href: url, download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
}
function exportJson() { download(`cadangan-catatan-staff-${todayStr()}.json`, JSON.stringify({ app: 'catatan-staff', version: 1, exportedAt: new Date().toISOString(), ...data }, null, 2), 'application/json'); toast('Cadangan diunduh'); }
function importJson(e) {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  const rd = new FileReader();
  rd.onload = () => {
    try {
      const d = JSON.parse(rd.result);
      if (!Array.isArray(d.staff) || !Array.isArray(d.records)) throw new Error('format');
      if (!confirm(`Pulihkan ${d.staff.length} staff & ${d.records.length} catatan? Data saat ini akan DIGANTI.`)) return;
      data = normalize(d); save(); toast('Data dipulihkan'); render();
    } catch { alert('File cadangan tidak valid.'); }
  };
  rd.readAsText(f);
}
function exportCsv(prefix) {
  const cell = (v) => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return `"${s.replace(/"/g, '""')}"`; };
  const head = ['Tanggal Mulai', 'Tanggal Selesai', 'Staff', 'Jenis', 'Kategori', 'Jam Keluar', 'Jam Kembali', 'Hari', 'Sanksi', 'Poin', 'Surat Dokter', 'Keterangan'];
  const rows = data.records.filter((r) => !prefix || inPeriod(r, prefix)).sort((a, b) => (a.start < b.start ? -1 : 1));
  const lines = [head.map(cell).join(',')].concat(rows.map((r) => [r.start, r.end, staffName(r.staffId), TYPES[r.type].label, r.type === 'cuti' ? LEAVE[r.category] : r.category || '', r.timeOut || '', r.timeIn || '', r.days || '', SANCTION[r.sanction] || '', r.points || '', r.doctorNote ? 'ya' : '', r.desc].map(cell).join(',')));
  download(`rekap-staff-${prefix || 'semua'}.csv`, '﻿' + lines.join('\r\n'), 'text/csv;charset=utf-8'); toast('CSV diunduh');
}

// ---------- render ----------
function render() { ({ beranda: viewBeranda, riwayat: viewRiwayat, rekap: viewRekap, pengaturan: viewPengaturan })[ui.tab](); }
load(); render();
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
