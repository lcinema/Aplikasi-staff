import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, createApp, seedAdmin } from '../server.js';

let server, base;
before(async () => {
  process.env.ADMIN_PASSWORD = 'adminpass123';
  const db = openDb(':memory:');
  seedAdmin(db);
  server = createApp(db);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

async function call(method, url, body, cookie) {
  const res = await fetch(base + url, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
}
const login = async (u, p) => (await call('POST', '/api/login', { username: u, password: p })).cookie;

test('alur lengkap: staff, izin, cuti, pelanggaran, hak akses', async () => {
  const admin = await login('admin', 'adminpass123');
  assert.ok(admin.startsWith('sid='));
  assert.equal((await call('GET', '/api/me')).status, 401);
  assert.equal((await call('POST', '/api/login', { username: 'admin', password: 'salah' })).status, 401);

  const mk = (username, role) => call('POST', '/api/users', { username, password: 'password123', name: username.toUpperCase(), role, annual_quota: 5 }, admin);
  const mgr = (await mk('budi', 'manager')).data, ani = (await mk('ani', 'staff')).data, joko = (await mk('joko', 'staff')).data;
  const mgrC = await login('budi', 'password123'), aniC = await login('ani', 'password123'), jokoC = await login('joko', 'password123');

  // staff tidak boleh mencatat pelanggaran / kelola staff
  assert.equal((await call('POST', '/api/records', { type: 'pelanggaran', user_id: joko.id, start_date: '2026-11-01', category: 'ringan', description: 'x' }, aniC)).status, 403);
  assert.equal((await call('GET', '/api/users?all=1', null, aniC)).data.length, 1);
  assert.equal((await call('POST', '/api/users', { username: 'zzz', password: 'password123', name: 'z', role: 'staff' }, aniC)).status, 403);

  // izin sakit & izin keluar -> pending -> disetujui manager
  const sakit = await call('POST', '/api/records', { type: 'sakit', start_date: '2026-11-02', end_date: '2026-11-04', description: 'Demam', has_doctor_note: true }, aniC);
  assert.equal(sakit.status, 201); assert.equal(sakit.data.days, 3); assert.equal(sakit.data.status, 'pending');
  const keluar = await call('POST', '/api/records', { type: 'izin_keluar', start_date: '2026-11-05', time_out: '13:00', time_in: '12:00', description: 'Bank' }, aniC);
  assert.equal(keluar.status, 400); // jam kembali sebelum jam keluar
  assert.equal((await call('POST', `/api/records/${sakit.data.id}/decide`, { status: 'approved' }, aniC)).status, 403); // staff tak bisa setujui
  assert.equal((await call('POST', `/api/records/${sakit.data.id}/decide`, { status: 'rejected' }, mgrC)).status, 400); // tolak wajib alasan
  assert.equal((await call('POST', `/api/records/${sakit.data.id}/decide`, { status: 'approved' }, mgrC)).data.status, 'approved');
  assert.equal((await call('POST', `/api/records/${sakit.data.id}/decide`, { status: 'approved' }, mgrC)).status, 400); // sudah diputuskan

  // kuota cuti tahunan (5 hari)
  const c1 = await call('POST', '/api/records', { type: 'cuti', category: 'tahunan', start_date: '2026-12-01', end_date: '2026-12-03', description: 'Liburan' }, aniC);
  assert.equal(c1.status, 201);
  assert.equal((await call('POST', '/api/records', { type: 'cuti', category: 'tahunan', start_date: '2026-12-10', end_date: '2026-12-12', description: 'Lagi' }, aniC)).status, 400); // 3+3 > 5
  assert.equal((await call('POST', '/api/records', { type: 'cuti', category: 'duka', start_date: '2026-12-10', end_date: '2026-12-12', description: 'Duka' }, aniC)).status, 201); // bukan tahunan, tak kena kuota
  await call('POST', `/api/records/${c1.data.id}/decide`, { status: 'approved' }, mgrC);
  const bal = (await call('GET', `/api/balance/${ani.id}?year=2026`, null, aniC)).data;
  assert.deepEqual([bal.used, bal.remaining], [3, 2]);
  assert.equal((await call('GET', `/api/balance/${joko.id}`, null, aniC)).status, 403);

  // pelanggaran oleh manager, poin otomatis
  const v = await call('POST', '/api/records', { type: 'pelanggaran', user_id: joko.id, start_date: '2026-11-10', category: 'berat', sanction: 'sp1', description: 'Terlambat berulang' }, mgrC);
  assert.equal(v.status, 201); assert.equal(v.data.points, 5); assert.equal(v.data.status, 'recorded');
  // staff hanya melihat catatannya sendiri
  assert.equal((await call('GET', '/api/records', null, aniC)).data.every((r) => r.user_id === ani.id), true);
  assert.equal((await call('GET', '/api/records?type=pelanggaran', null, jokoC)).data.length, 1);
  assert.equal((await call('GET', '/api/records?type=pelanggaran', null, aniC)).data.length, 0);
  // manager tak bisa menyetujui pengajuan sendiri
  const own = await call('POST', '/api/records', { type: 'lainnya', category: 'Dinas luar', start_date: '2026-11-11', description: 'Meeting' }, mgrC);
  assert.equal((await call('POST', `/api/records/${own.data.id}/decide`, { status: 'approved' }, mgrC)).status, 403);
  assert.equal((await call('POST', `/api/records/${own.data.id}/decide`, { status: 'approved' }, admin)).status, 200);
  // hanya admin yang boleh hapus
  assert.equal((await call('DELETE', `/api/records/${v.data.id}`, null, mgrC)).status, 403);

  // ringkasan & CSV
  const s = (await call('GET', '/api/summary?year=2026&month=11', null, mgrC)).data;
  assert.equal(s.perStaff.find((r) => r.name === 'JOKO').points, 5);
  const csv = await call('POST', '/api/records', { type: 'lainnya', category: '=HYPERLINK("x")', start_date: '2026-11-12', description: '+cmd' }, aniC);
  const out = await call('GET', '/api/export.csv', null, mgrC);
  assert.match(out.data, /"'=HYPERLINK/); assert.match(out.data, /"'\+cmd"/);
  assert.equal(csv.status, 201);

  // nonaktifkan staff mencabut sesi
  await call('PUT', `/api/users/${joko.id}`, { active: false }, admin);
  assert.equal((await call('GET', '/api/me', null, jokoC)).status, 401);
});

test('file statis dan penahan path traversal', async () => {
  assert.equal((await fetch(base + '/')).status, 200);
  assert.equal((await fetch(base + '/app.js')).status, 200);
  assert.equal((await fetch(base + '/..%2fserver.js')).status, 404);
});
