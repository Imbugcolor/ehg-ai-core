// Kiểm hai đầu việc cuối của AI Core:
//   HM3.4 Tóm tắt hội thoại
//   HM3.6 Thư viện giọng văn

import { tomTat } from '../modules/ai-core/summarize.mjs';
import { layGiongVan, thanhChiDan, loaiKhachTheoNhan, xoaNhoTam } from '../modules/ai-core/tone.mjs';
import { soanNhap } from '../modules/ai-core/index.mjs';
import { sql, q } from '../modules/ai-core/adapters.mjs';

const users = Object.fromEntries(
  (
    await sql(`select p.code, up.user_id, p.id as pid from public.user_property up
               join public.property p on p.id = up.property_id;`)
  ).map((r) => [r.code, { uid: r.user_id, pid: r.pid }])
);

// ─────────────────────────────────────────────────────────────────────────────
console.log('══ HM3.4 · Tóm tắt hội thoại ══\n');

const HOI_THOAI = [
  { nguoi: 'Khách', luc: '09:12', noi_dung: 'Chào shop, mình đặt phòng ngày 20 tháng này qua Agoda, mã 8891234' },
  { nguoi: 'Nhân viên', luc: '09:20', noi_dung: 'Chào quý khách, chúng tôi đã nhận được đặt phòng ạ' },
  { nguoi: 'Khách', luc: '09:22', noi_dung: 'Mình muốn xin phòng tầng cao, tránh gần thang máy vì mình ngủ khó' },
  { nguoi: 'Nhân viên', luc: '09:30', noi_dung: 'Dạ chúng tôi đã ghi nhận, sẽ cố gắng sắp xếp' },
  { nguoi: 'Khách', luc: '14:05', noi_dung: 'Cho mình hỏi có xe đón sân bay không, chuyến mình hạ cánh 23h đêm' },
  { nguoi: 'Nhân viên', luc: '14:40', noi_dung: 'Dạ có ạ, để em kiểm tra lịch xe rồi báo lại quý khách' },
  { nguoi: 'Khách', luc: '18:20', noi_dung: 'Bạn ơi có kết quả xe chưa, mình cần chốt sớm để đặt vé' },
  { nguoi: 'Khách', luc: '21:15', noi_dung: 'Vẫn chưa thấy ai trả lời, mình hơi lo vì bay đêm' },
];

const t1 = await tomTat(HOI_THOAI, { threadKey: 'test-thread-1', propertyId: users.BIENXANH.pid });
console.log(`  Kết quả: ${t1.ketQua} · ${t1.ms} ms · cảm xúc: ${t1.camXuc}\n`);
console.log(`  Tóm tắt:\n    ${t1.tomTat?.replace(/\n/g, '\n    ')}\n`);
console.log('  Ý chính:');
(t1.yChinh || []).forEach((y) => console.log(`    • ${y}`));
console.log('\n  ⚠️  Việc còn treo — phần quan trọng nhất khi chuyển ca:');
(t1.viecConTreo || []).forEach((v) => console.log(`    ▸ ${v}`));

const t2 = await tomTat(HOI_THOAI, { threadKey: 'test-thread-1', propertyId: users.BIENXANH.pid });
console.log(`\n  Gọi lại cùng nội dung: ${t2.tuNhoLai ? '⚡ lấy lại bản cũ' : '🐢 tính lại'} · ${t2.ms} ms`);

const t3 = await tomTat([...HOI_THOAI, { nguoi: 'Nhân viên', luc: '21:40', noi_dung: 'Dạ xe đã sắp xếp xong, tài xế đón quý khách lúc 23h15 ạ' }],
  { threadKey: 'test-thread-1', propertyId: users.BIENXANH.pid });
console.log(`  Thêm một tin nhắn mới : ${t3.tuNhoLai ? '❌ vẫn lấy bản cũ' : '✅ tính lại đúng'} · còn treo: ${t3.viecConTreo?.length ?? '?'} việc`);

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n══ HM3.6 · Thư viện giọng văn ══\n');

for (const loai of ['chung', 'khieu_nai', 'doan_b2b']) {
  const g = await layGiongVan({ propertyId: users.BIENXANH.pid, loaiKhach: loai });
  console.log(`  ── ${loai} ──`);
  console.log(`     mở: "${g?.cauMo}"   kết: "${g?.cauKet}"`);
  console.log(`     tránh: ${(g?.tuTranh || []).join(', ')}`);
}

console.log('\n  Nhãn ý định → loại giọng:');
for (const n of ['KHIEU_NAI', 'DOAN_B2B', 'HOI_TIEN_ICH']) {
  console.log(`     ${n.padEnd(16)} → ${loaiKhachTheoNhan(n)}`);
}

// Nghiệp vụ sửa giọng văn, không cần lập trình viên
console.log('\n  ── Thử: nghiệp vụ đổi cách xưng hô cho riêng Biển Xanh ──');
await sql(`
  insert into public.ai_giong_van (property_id, loai_khach, ngon_ngu, mo_ta, cau_mo, cau_ket, tu_tranh)
  values ('${users.BIENXANH.pid}', 'chung', 'vi',
          'Thân thiện kiểu resort biển, vẫn lịch sự nhưng gần gũi hơn.',
          'Xin chào quý khách,', 'Hẹn gặp quý khách tại Biển Xanh,', ARRAY['bạn nhé','ok'])
  on conflict (property_id, loai_khach, ngon_ngu) do update
    set cau_mo = excluded.cau_mo, cau_ket = excluded.cau_ket, mo_ta = excluded.mo_ta;`);
xoaNhoTam();

const gBX = await layGiongVan({ propertyId: users.BIENXANH.pid, loaiKhach: 'chung' });
const gND = await layGiongVan({ propertyId: users.NUIDOI.pid, loaiKhach: 'chung' });
console.log(`     Biển Xanh → kết: "${gBX?.cauKet}"`);
console.log(`     Núi Đồi   → kết: "${gND?.cauKet}"`);
console.log(
  gBX?.cauKet !== gND?.cauKet
    ? '     ✅ Mỗi khách sạn một giọng, sửa trực tiếp trong cơ sở dữ liệu'
    : '     ❌ Không tách được theo khách sạn'
);

console.log('\n  ── Bản nháp thật có áp giọng mới chưa ──');
await sql('delete from public.rag_cache;');
const r = await soanNhap('khách sạn có hồ bơi không', {
  userId: users.BIENXANH.uid,
  propertyId: users.BIENXANH.pid,
  ghiLog: false,
});
console.log(`     ${r.ketQua} · nhãn: ${r.nhan?.nhan ?? '—'}`);
console.log(`     ${(r.banNhap || '').split('\n').filter(Boolean).slice(0, 2).join('\n     ')}`);
const cuoi = (r.banNhap || '').trim().split('\n').filter(Boolean).pop();
console.log(`     …kết thúc: "${cuoi}"`);
console.log(
  (r.banNhap || '').includes('Biển Xanh,') || (r.banNhap || '').includes('Xin chào')
    ? '     ✅ Giọng riêng của Biển Xanh đã vào bản nháp'
    : '     ⚠️  Chưa thấy giọng riêng — kiểm lại phần chèn vào prompt'
);
