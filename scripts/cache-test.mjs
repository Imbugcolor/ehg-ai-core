// Đo hiệu quả cache và kiểm ba tính chất bắt buộc của khoá cache:
//   1. Hỏi lại cùng câu -> lấy từ cache, nhanh hơn hẳn
//   2. Cách viết khác nhau của cùng một câu -> chung một khoá
//   3. Người của khách sạn khác -> KHÔNG ăn được cache của nhau

import { soanNhap } from '../modules/ai-core/index.mjs';
import { sql } from '../modules/ai-core/adapters.mjs';
import { chuanHoa } from '../modules/ai-core/cache.mjs';

const users = Object.fromEntries(
  (
    await sql(`select p.code, up.user_id from public.user_property up
               join public.property p on p.id = up.property_id;`)
  ).map((r) => [r.code, r.user_id])
);

await sql('delete from public.rag_cache;');
console.log('Đã dọn cache cũ.\n');

const hoi = async (code, cauHoi) => {
  const r = await soanNhap(cauHoi, { userId: users[code], ghiLog: false });
  const nhan = r.tuCache ? '⚡ TỪ CACHE' : '🐢 tính mới ';
  console.log(`  ${nhan} ${String(r.ms).padStart(5)} ms  ${r.ketQua.padEnd(15)} [${code}] ${cauHoi}`);
  return r;
};

console.log('── 1. Cùng một câu, hỏi hai lần ──');
const a1 = await hoi('BIENXANH', 'bữa sáng phục vụ lúc mấy giờ');
const a2 = await hoi('BIENXANH', 'bữa sáng phục vụ lúc mấy giờ');
const nhanhHon = a1.ms > 0 ? (a1.ms / Math.max(a2.ms, 1)).toFixed(1) : '—';
console.log(`  → nhanh hơn ${nhanhHon} lần, và bỏ qua toàn bộ embedding, tìm kiếm, rerank, model chat\n`);

console.log('── 2. Viết khác nhau, cùng ý ──');
console.log(`  chuẩn hoá: "Bữa Sáng phục vụ lúc mấy giờ?" -> "${chuanHoa('Bữa Sáng phục vụ lúc mấy giờ?')}"`);
await hoi('BIENXANH', 'Bữa Sáng phục vụ lúc mấy giờ?');
await hoi('BIENXANH', 'bua sang phuc vu luc may gio');

console.log('\n── 3. Khách sạn khác KHÔNG được ăn cache ──');
const b = await hoi('NUIDOI', 'bữa sáng phục vụ lúc mấy giờ');
console.log(
  b.tuCache
    ? '  ❌ RÒ RỈ — người Núi Đồi ăn được cache của Biển Xanh'
    : '  ✅ Đúng — khoá cache có phạm vi khách sạn nên không dùng chung được'
);

console.log('\n── 4. Sửa tri thức thì cache tự hết hiệu lực ──');
const v1 = (await sql('select public.kb_version() as v;'))[0].v;
await sql(`update public.kb_document set updated_at = now()
           where title = 'Bữa sáng tại Biển Xanh';`);
const v2 = (await sql('select public.kb_version() as v;'))[0].v;
console.log(`  phiên bản tri thức: ${v1} -> ${v2}`);
const c = await hoi('BIENXANH', 'bữa sáng phục vụ lúc mấy giờ');
console.log(
  c.tuCache
    ? '  ❌ Vẫn ăn cache cũ dù tri thức đã đổi'
    : '  ✅ Đúng — tri thức đổi thì tính lại, không trả câu cũ'
);

const tk = await sql(`select count(*) as so, sum(hit_count) as luot_dung from public.rag_cache;`);
console.log(`\nCache hiện có ${tk[0].so} mục · ${tk[0].luot_dung || 0} lượt dùng lại`);
