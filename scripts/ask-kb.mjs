// Hỏi thử kho tri thức dưới danh tính của từng khách sạn.
// Kiểm ba thứ: tìm có trúng không, dữ liệu hai khách sạn có lẫn nhau không,
// và câu hỏi ngoài phạm vi tri thức thì hệ thống có im lặng không.

import fs from 'node:fs';

for (const line of fs.readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
  const i = line.indexOf('=');
  if (i > 0) process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
}

const REF = process.env.SUPABASE_PROJECT_REF;
const PAT = process.env.ACCESS_TOKEN;
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

let cost = 0;
async function embed(text) {
  const r = await fetch('https://openrouter.ai/api/v1/embeddings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${ORK}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, input: text, dimensions: DIM }),
  });
  const j = await r.json();
  cost += j.usage?.cost ?? 0;
  return j.data[0].embedding;
}

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const vec = (a) => `'[${a.map((x) => x.toFixed(7)).join(',')}]'::extensions.vector(${DIM})`;

const users = await sql(`
  select u.email, up.user_id, p.code
  from public.user_property up
  join auth.users u on u.id = up.user_id
  join public.property p on p.id = up.property_id
  order by p.code;`);

const CAU_HOI = [
  'mấy giờ được nhận phòng và trả phòng',
  'bữa sáng phục vụ lúc mấy giờ, người thêm bao nhiêu tiền',
  'khách sạn có hồ bơi không',
  'đỗ ô tô có mất phí không',
  'đi từ sân bay về khách sạn mất bao lâu và bao nhiêu tiền',
  'tôi mang chó theo được không',
  'huỷ phòng trước bao lâu thì được hoàn tiền',
  'giá phòng deluxe đêm nay bao nhiêu tiền',
];

const NGUONG = 0.35;

for (const u of users) {
  console.log(`\n${'='.repeat(74)}\nDanh tính: ${u.code}\n${'='.repeat(74)}`);
  for (const cauHoi of CAU_HOI) {
    const v = await embed(cauHoi);
    const rows = await sql(`
      begin;
      set local role authenticated;
      set local request.jwt.claims = '{"sub":"${u.user_id}","role":"authenticated"}';
      select title, left(content, 88) as content,
             round(coalesce(similarity,0)::numeric, 3) as sim,
             vector_rank as vr, fts_rank as fr,
             round(rrf_score::numeric, 5) as rrf
      from public.kb_search_hybrid(${vec(v)}, ${q(cauHoi)}, 'vi', 2, 30);
      commit;`);
    const res = (Array.isArray(rows) ? rows : []).filter((r) => r && r.title);

    console.log(`\n  ❓ ${cauHoi}`);
    if (!res.length) {
      console.log('     → không tìm thấy gì — hệ thống phải trả lời "không biết"');
      continue;
    }
    for (const r of res) {
      const lac =
        (u.code === 'BIENXANH' && r.title.includes('Núi Đồi')) ||
        (u.code === 'NUIDOI' && r.title.includes('Biển Xanh'));
      const nguon = `vec#${r.vr ?? '—'} fts#${r.fr ?? '—'}`;
      console.log(`     [rrf ${r.rrf} · cos ${r.sim} · ${nguon}] ${lac ? '❌ LẪN DỮ LIỆU · ' : ''}${r.title}`);
      console.log(`             ${r.content}…`);
    }
  }
}

console.log(`\nChi phí đợt hỏi này: ${cost.toFixed(8)} USD`);
