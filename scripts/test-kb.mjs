// Chạy thử đầu–cuối kho tri thức: nạp -> sinh embedding -> tìm theo độ gần
// -> kiểm chứng RLS chặn dữ liệu giữa hai khách sạn.
// Dùng dữ liệu giả lập, không có thông tin thật của khách sạn nào.

import fs from 'node:fs';

for (const line of fs.readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
  const i = line.indexOf('=');
  if (i > 0) process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
}

const REF = process.env.SUPABASE_PROJECT_REF;
const PAT = process.env.ACCESS_TOKEN;
const URL_ = process.env.SUPABASE_URL;
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ORK = process.env.OPEN_ROUTER_API_KEY || process.env.OPENROUTER_API_KEY;

const MODEL = 'openai/text-embedding-3-small';
const DIM = 768;

async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(j).slice(0, 300));
  return j;
}

async function embed(inputs) {
  const r = await fetch('https://openrouter.ai/api/v1/embeddings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${ORK}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, input: inputs, dimensions: DIM }),
  });
  const j = await r.json();
  if (!j.data) throw new Error(JSON.stringify(j).slice(0, 300));
  return { vectors: j.data.map((d) => d.embedding), cost: j.usage?.cost ?? 0 };
}

async function createUser(email) {
  const r = await fetch(`${URL_}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SRK}`, apikey: SRK, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Test-' + Math.abs(hash(email)), email_confirm: true }),
  });
  const j = await r.json();
  if (!j.id) throw new Error(JSON.stringify(j).slice(0, 300));
  return j.id;
}

function hash(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return h; }
const vec = (a) => `'[${a.join(',')}]'::extensions.vector(${DIM})`;
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

// --- dữ liệu giả lập: cùng chủ đề, hai khách sạn trả lời khác nhau -----------
const DOCS = [
  {
    prop: 'BIENXANH', propName: 'Khách sạn Biển Xanh',
    title: 'Chính sách huỷ phòng - Biển Xanh',
    chunks: [
      'Khách huỷ phòng trước 48 giờ so với ngày nhận phòng được hoàn tiền 100 phần trăm, không mất phí.',
      'Huỷ trong vòng 48 giờ trước ngày đến sẽ bị tính phí một đêm đầu tiên.',
      'Giờ nhận phòng tại Biển Xanh là 14 giờ, giờ trả phòng là 12 giờ trưa.',
    ],
  },
  {
    prop: 'NUIDOI', propName: 'Khách sạn Núi Đồi',
    title: 'Chính sách huỷ phòng - Núi Đồi',
    chunks: [
      'Khách huỷ phòng trước 7 ngày so với ngày nhận phòng được hoàn tiền 100 phần trăm.',
      'Huỷ trong vòng 7 ngày trước ngày đến sẽ bị tính phí toàn bộ giá trị đặt phòng.',
      'Giờ nhận phòng tại Núi Đồi là 15 giờ, giờ trả phòng là 11 giờ sáng.',
    ],
  },
];

const t0 = Date.now();
let totalCost = 0;

console.log('== 1. Dọn dữ liệu thử cũ ==');
await sql(`delete from public.kb_document where title like 'Chính sách huỷ phòng - %';
           delete from public.property where code in ('BIENXANH','NUIDOI');`);

console.log('== 2. Tạo 2 người dùng thử ==');
const uidA = await createUser('test-bienxanh@example.com').catch(async () => {
  const r = await sql(`select id from auth.users where email='test-bienxanh@example.com'`);
  return r[0].id;
});
const uidB = await createUser('test-nuidoi@example.com').catch(async () => {
  const r = await sql(`select id from auth.users where email='test-nuidoi@example.com'`);
  return r[0].id;
});
console.log('   user Biển Xanh:', uidA.slice(0, 8) + '…');
console.log('   user Núi Đồi  :', uidB.slice(0, 8) + '…');

console.log('== 3. Nạp tri thức + sinh embedding ==');
const propIds = {};
for (const d of DOCS) {
  const p = await sql(
    `insert into public.property (code, name) values (${q(d.prop)}, ${q(d.propName)})
     on conflict (code) do update set name = excluded.name returning id;`
  );
  const pid = p[0].id;
  propIds[d.prop] = pid;

  const uid = d.prop === 'BIENXANH' ? uidA : uidB;
  const doc = await sql(
    `insert into public.kb_document (property_id, title, status, approved_by, approved_at)
     values ('${pid}', ${q(d.title)}, 'approved', '${uid}', now()) returning id;`
  );
  const did = doc[0].id;

  const { vectors, cost } = await embed(d.chunks);
  totalCost += cost;

  const values = d.chunks
    .map((c, i) => `('${did}','${pid}',${i},${q(c)},${vec(vectors[i])},${q(MODEL)},${DIM})`)
    .join(',');
  await sql(
    `insert into public.kb_chunk (document_id, property_id, chunk_index, content, embedding, embedding_model, embedding_dim)
     values ${values};`
  );
  console.log(`   ${d.propName}: ${d.chunks.length} đoạn`);
}

// --- Hỏi cùng một câu, dưới hai danh tính khác nhau -------------------------
await sql(`insert into public.user_property (user_id, property_id) values
   ('${uidA}','${propIds.BIENXANH}'), ('${uidB}','${propIds.NUIDOI}')
   on conflict do nothing;`);

console.log('== 4. Truy vấn: "huỷ phòng trước bao lâu thì được hoàn tiền" ==');
const tq = Date.now();
const { vectors: [qv], cost: qc } = await embed(['huỷ phòng trước bao lâu thì được hoàn tiền']);
totalCost += qc;
const embedMs = Date.now() - tq;

async function asUser(uid, label) {
  const t = Date.now();
  const rows = await sql(`
    begin;
    set local role authenticated;
    set local request.jwt.claims = '{"sub":"${uid}","role":"authenticated"}';
    select title, left(content, 60) as content, round((similarity)::numeric, 4) as sim
    from public.kb_search(${vec(qv)}, null, 3, 0);
    commit;`);
  const ms = Date.now() - t;
  const res = Array.isArray(rows) ? rows.filter((r) => r && r.title) : [];
  console.log(`\n   --- ${label} (${ms} ms) ---`);
  if (!res.length) console.log('      (không thấy gì)');
  for (const r of res) console.log(`      [${r.sim}] ${r.title} :: ${r.content}…`);
  return res;
}

const rA = await asUser(uidA, 'Đăng nhập bằng user của Biển Xanh');
const rB = await asUser(uidB, 'Đăng nhập bằng user của Núi Đồi');

console.log('\n== 5. Kết luận ==');
const leakA = rA.some((r) => r.title.includes('Núi Đồi'));
const leakB = rB.some((r) => r.title.includes('Biển Xanh'));
console.log('   RLS chặn chéo dữ liệu:', !leakA && !leakB ? '✅ ĐẠT' : '❌ RÒ RỈ');
console.log('   Model            :', MODEL, '/', DIM, 'chiều');
console.log('   Thời gian embed  :', embedMs, 'ms cho 1 câu hỏi');
console.log('   Chi phí lần chạy :', totalCost.toFixed(8), 'USD');
console.log('   Tổng thời gian   :', ((Date.now() - t0) / 1000).toFixed(1), 'giây');
