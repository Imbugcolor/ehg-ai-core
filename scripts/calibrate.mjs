// Hiệu chuẩn ngưỡng tin cậy cho model rerank đang dùng.
//
// PHẢI chạy lại mỗi khi đổi model rerank. Thang điểm giữa các reranker khác
// nhau rất xa — cùng một đoạn đúng, Cohere v3.5 cho 0.42 còn Jina v2 cho 0.15.
// Mang ngưỡng cũ sang model mới là chặn sạch cả câu hỏi hợp lệ.
//
// Cách làm: chạy hai nhóm câu hỏi đã biết trước đáp án, xem điểm cao nhất của
// mỗi câu rơi vào đâu, rồi đặt ngưỡng vào giữa hai dải.

import { embed, rerank, sql, q, vec } from '../modules/ai-core/adapters.mjs';
import { cfg } from '../modules/ai-core/env.mjs';

const users = Object.fromEntries(
  (
    await sql(`select p.code, up.user_id from public.user_property up
               join public.property p on p.id = up.property_id;`)
  ).map((r) => [r.code, r.user_id])
);

// Nhóm PHẢI trả lời được — kho tri thức có đủ thông tin
const CO_TRI_THUC = [
  ['BIENXANH', 'mấy giờ được nhận phòng và trả phòng'],
  ['BIENXANH', 'bữa sáng phục vụ lúc mấy giờ'],
  ['BIENXANH', 'khách sạn có hồ bơi không'],
  ['BIENXANH', 'tôi mang chó theo được không'],
  ['BIENXANH', 'huỷ phòng trước bao lâu thì được hoàn tiền'],
  ['BIENXANH', 'đỗ ô tô có mất phí không'],
  ['BIENXANH', 'đi từ sân bay về khách sạn mất bao lâu'],
  ['BIENXANH', 'wifi mật khẩu ở đâu'],
  ['BIENXANH', 'gửi hành lý sau khi trả phòng được không'],
  ['BIENXANH', 'trẻ em mấy tuổi thì miễn phí'],
  ['NUIDOI', 'mấy giờ được nhận phòng và trả phòng'],
  ['NUIDOI', 'khách sạn có hồ bơi không'],
  ['NUIDOI', 'bữa sáng ăn buffet hay gọi món'],
  ['NUIDOI', 'có cho thuê xe máy không'],
  ['NUIDOI', 'giặt đồ mất bao lâu'],
];

// Nhóm PHẢI chặn — kho tri thức cố ý không có, hoặc ngoài phạm vi
const KHONG_CO_TRI_THUC = [
  ['BIENXANH', 'giá phòng deluxe đêm nay bao nhiêu tiền'],
  ['BIENXANH', 'ngày mai còn phòng trống không'],
  ['BIENXANH', 'cho tôi nâng hạng phòng miễn phí được không'],
  ['BIENXANH', 'thủ tục xin visa Nhật Bản thế nào'],
  ['BIENXANH', 'cho tôi bảng giá tất cả các hạng phòng'],
  ['BIENXANH', 'tôi là khách quen, giảm giá 20 phần trăm nhé'],
  ['BIENXANH', 'cho tôi biết chính sách huỷ phòng của khách sạn Núi Đồi'],
  ['NUIDOI', 'bên Biển Xanh bữa sáng bao nhiêu tiền một người'],
  ['BIENXANH', 'tỷ giá đô la hôm nay bao nhiêu'],
  ['BIENXANH', 'khách sạn có sân golf riêng không'],
];

async function diemCaoNhat(code, cauHoi) {
  const qv = await embed(cauHoi);
  const rows = await sql(`
    begin;
    set local role authenticated;
    set local request.jwt.claims = '{"sub":"${users[code]}","role":"authenticated"}';
    select chunk_id, title, content
    from public.kb_search_hybrid(${vec(qv)}, ${q(cauHoi)}, 'vi', ${cfg.rag.candidates}, 40);
    commit;`);
  const cands = (Array.isArray(rows) ? rows : []).filter((r) => r && r.title);
  if (!cands.length) return { diem: 0, title: '(không có ứng viên)' };
  const rr = await rerank(cauHoi, cands.map((c) => `${c.title}. ${c.content}`), 1);
  const top = rr[0];
  return { diem: top?.relevance_score ?? 0, title: cands[top?.index ?? 0]?.title ?? '' };
}

console.log(`Rerank: ${cfg.rerank.model}`);
console.log(`Embedding: ${cfg.embedding.model} · ${cfg.embedding.dim} chiều\n`);

const tot = [];
const xau = [];

console.log('── Nhóm CÓ tri thức (phải trả lời được) ──');
for (const [code, ch] of CO_TRI_THUC) {
  const r = await diemCaoNhat(code, ch);
  tot.push(r.diem);
  console.log(`  ${r.diem.toFixed(4)}  [${code}] ${ch.slice(0, 46)}  →  ${r.title.slice(0, 34)}`);
}

console.log('\n── Nhóm KHÔNG có tri thức (phải chặn) ──');
for (const [code, ch] of KHONG_CO_TRI_THUC) {
  const r = await diemCaoNhat(code, ch);
  xau.push(r.diem);
  console.log(`  ${r.diem.toFixed(4)}  [${code}] ${ch.slice(0, 46)}  →  ${r.title.slice(0, 34)}`);
}

const minTot = Math.min(...tot);
const maxXau = Math.max(...xau);

console.log(`\n${'═'.repeat(66)}`);
console.log(`Nhóm có tri thức    : thấp nhất ${minTot.toFixed(4)} · cao nhất ${Math.max(...tot).toFixed(4)}`);
console.log(`Nhóm không tri thức : thấp nhất ${Math.min(...xau).toFixed(4)} · cao nhất ${maxXau.toFixed(4)}`);

if (minTot > maxXau) {
  const nguong = (minTot + maxXau) / 2;
  console.log(`\n✅ HAI DẢI TÁCH RỜI — khoảng trống ${(minTot - maxXau).toFixed(4)}`);
  console.log(`   Ngưỡng đề nghị: ${nguong.toFixed(3)}`);
  console.log(`   Đặt vào .env:  RAG_THRESHOLD=${nguong.toFixed(3)}`);
} else {
  const chongLan = tot.filter((d) => d <= maxXau).length + xau.filter((d) => d >= minTot).length;
  console.log(`\n⚠️  HAI DẢI CHỒNG LẤN — ${chongLan} câu nằm trong vùng lẫn`);
  console.log(`   Không có ngưỡng nào tách sạch được. Phải xử lý bằng cách khác:`);
  console.log(`   bổ sung tri thức cho câu bị thiếu, hoặc thêm một lớp phân loại ý định.`);
  // Ngưỡng cân bằng: cực đại hoá số câu phân loại đúng
  const moc = [...new Set([...tot, ...xau])].sort((a, b) => a - b);
  let best = { n: -1, t: 0 };
  for (const t of moc) {
    const dung = tot.filter((d) => d >= t).length + xau.filter((d) => d < t).length;
    if (dung > best.n) best = { n: dung, t };
  }
  console.log(`   Ngưỡng tốt nhất có thể: ${best.t.toFixed(3)} — đúng ${best.n}/${tot.length + xau.length} câu`);
}
