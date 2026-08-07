// Kiểm bốn phần vừa bổ sung cho AI Core:
//   ① Nút tắt khẩn ba mức
//   ② Hạn mức chi phí + model dự phòng
//   ③ Nhãn ý định nghiệp vụ + cảm xúc
//   ④ Đo tỉ lệ nhân viên sửa bản nháp

import { soanNhap } from '../modules/ai-core/index.mjs';
import { sql } from '../modules/ai-core/adapters.mjs';
import { tat, bat, xoaNhoTam } from '../modules/ai-core/switch.mjs';
import { tinhTrangChiPhi, datHanMuc } from '../modules/ai-core/budget.mjs';
import { phanLoai, canUuTien } from '../modules/ai-core/classify.mjs';
import { ghiNhanSua, tyLeSua, thongKe } from '../modules/ai-core/feedback.mjs';

const users = Object.fromEntries(
  (
    await sql(`select p.code, up.user_id, p.id as pid from public.user_property up
               join public.property p on p.id = up.property_id;`)
  ).map((r) => [r.code, { uid: r.user_id, pid: r.pid }])
);

const hoi = async (code, cauHoi) => {
  const u = users[code];
  const r = await soanNhap(cauHoi, { userId: u.uid, propertyId: u.pid, ghiLog: false });
  return r;
};

// ─────────────────────────────────────────────────────────────────────────────
console.log('══ ① Nút tắt khẩn ══\n');
await sql('delete from public.ai_cong_tac;');
await sql('delete from public.rag_cache;');
xoaNhoTam();

let r = await hoi('BIENXANH', 'khách sạn có hồ bơi không');
console.log(`  bình thường            → ${r.ketQua}`);

await tat({ phamVi: 'tinh_nang', tinhNang: 'soan_nhap', lyDo: 'thử tắt theo tính năng' });
r = await hoi('BIENXANH', 'khách sạn có hồ bơi không');
console.log(`  tắt theo tính năng     → ${r.ketQua}  · ${r.lyDoChan ?? ''}`);
await bat({ phamVi: 'tinh_nang', tinhNang: 'soan_nhap' });

await tat({ phamVi: 'khach_san', propertyId: users.BIENXANH.pid, lyDo: 'thử tắt riêng Biển Xanh' });
const rA = await hoi('BIENXANH', 'khách sạn có hồ bơi không');
const rB = await hoi('NUIDOI', 'khách sạn có hồ bơi không');
console.log(`  tắt riêng Biển Xanh    → Biển Xanh: ${rA.ketQua} · Núi Đồi: ${rB.ketQua}`);
console.log(
  rA.ketQua === 'AI_DANG_TAT' && rB.ketQua !== 'AI_DANG_TAT'
    ? '  ✅ Tắt đúng một khách sạn, khách sạn kia vẫn chạy'
    : '  ❌ Sai phạm vi'
);
await bat({ phamVi: 'khach_san', propertyId: users.BIENXANH.pid });

await tat({ phamVi: 'toan_he', lyDo: 'thử tắt toàn hệ' });
const rC = await hoi('NUIDOI', 'khách sạn có hồ bơi không');
console.log(`  tắt toàn hệ            → ${rC.ketQua}`);
await bat({ phamVi: 'toan_he' });
xoaNhoTam();

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n══ ② Hạn mức chi phí ══\n');
let t = await tinhTrangChiPhi({ batBuocMoi: true });
console.log(`  hôm nay ${t.homNay.toFixed(6)} / ${t.hanNgay} USD  (${(t.tyLeNgay * 100).toFixed(1)}%)`);
console.log(`  tháng   ${t.thangNay.toFixed(6)} / ${t.hanThang} USD  (${(t.tyLeThang * 100).toFixed(1)}%)`);

await datHanMuc({ ngay: 0.000001 });
r = await hoi('NUIDOI', 'bữa sáng phục vụ lúc mấy giờ');
console.log(`  hạ hạn mức xuống sát 0 → ${r.ketQua} · ${r.lyDoChan ?? ''}`);
console.log(
  r.ketQua === 'VUOT_HAN_MUC'
    ? '  ✅ Dừng TRƯỚC khi gọi model, không tiêu thêm'
    : '  ⚠️  Chưa chặn được (có thể chưa ghi chi phí nào vào nhật ký)'
);
await datHanMuc({ ngay: 5 });

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n══ ③ Nhãn ý định và cảm xúc ══\n');
const MAU = [
  'phòng tôi điều hoà không mát, gọi mãi không ai lên sửa, tôi rất bực',
  'cho tôi hỏi khách sạn có đưa đón sân bay không',
  'tôi muốn đổi ngày nhận phòng từ 15 sang 17',
  'cảm ơn các bạn, kỳ nghỉ vừa rồi rất tuyệt',
  'công ty tôi cần 30 phòng cho hội nghị tháng sau',
];
for (const m of MAU) {
  const k = await phanLoai(m);
  const uu = canUuTien(k) ? '  🔺 nâng ưu tiên' : '';
  console.log(`  ${(k?.nhan ?? '?').padEnd(18)} ${(k?.camXuc ?? '?').padEnd(11)} gấp:${(k?.doGap ?? '?').padEnd(6)}${uu}`);
  console.log(`    "${m.slice(0, 62)}"`);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n══ ④ Đo tỉ lệ sửa bản nháp ══\n');
await sql('delete from public.ai_nhap_da_sua;');

const CAP = [
  ['Chào quý khách, hồ bơi mở từ 6 giờ đến 21 giờ. Trân trọng,',
   'Chào quý khách, hồ bơi mở từ 6 giờ đến 21 giờ. Trân trọng,', 'HOI_TIEN_ICH'],
  ['Chào quý khách, bữa sáng phục vụ từ 6 giờ đến 10 giờ tại nhà hàng. Trân trọng,',
   'Chào quý khách, bữa sáng phục vụ từ 6 giờ đến 10 giờ tại nhà hàng Sóng Biển. Trân trọng,', 'HOI_TIEN_ICH'],
  ['Chào quý khách, chính sách huỷ phòng tuỳ loại giá đã đặt. Trân trọng,',
   'Kính chào quý khách, về việc huỷ phòng thì tuỳ vào loại giá quý khách đã chọn lúc đặt. Với giá linh hoạt được hoàn tiền toàn bộ. Mong quý khách thông cảm. Trân trọng,', 'HOI_CHINH_SACH'],
];
for (const [goc, sua, nhan] of CAP) {
  const ty = await ghiNhanSua({ banGoc: goc, banDaSua: sua, nhanYDinh: nhan, daGui: true });
  const danh = ty <= 0.3 ? '✅ dùng được ngay' : '✏️  sửa nhiều';
  console.log(`  tỉ lệ sửa ${(ty * 100).toFixed(1).padStart(5)}%  ${danh}  (${nhan})`);
}

const tk = await thongKe();
console.log(`\n  Tổng: ${tk.tong.so_ban} bản · trung bình sửa ${(tk.tong.ty_le_sua_tb * 100).toFixed(1)}%`);
console.log(`  Dùng được ngay: ${tk.tong.dung_duoc_ngay}/${tk.tong.so_ban} = ${(tk.tong.ty_le_dung_duoc * 100).toFixed(1)}%  (tiêu chí nghiệm thu: >70%)`);
