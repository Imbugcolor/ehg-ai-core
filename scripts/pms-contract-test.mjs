// Bộ test hợp đồng cho lớp kết nối PMS.
//
// Chạy trên bản giả lập bây giờ; khi có Smile thật thì chạy ĐÚNG bộ này trên
// bản thật. Bộ test là thứ định nghĩa "hiện thực đúng" nghĩa là gì.
//
// Bám theo tiêu chí nghiệm thu M9 của tài liệu thiết kế:
//   • Đẩy 100 segment: thành công lần đầu từ 98% trở lên
//   • Bấm hai lần, giả lập timeout rồi gọi lại: chỉ tạo MỘT reservation
//   • Ngắt một server: các khách sạn khác không bị ảnh hưởng

import { taoSmileGiaLap } from '../modules/pms-sync/smile-gia-lap.mjs';
import { nenThuLai, LOAI_LOI, kiemYeuCau } from '../modules/pms-sync/pms-client.mjs';

let dat = 0;
let truot = 0;
const kt = (ten, dung, chiTiet = '') => {
  if (dung) { dat++; console.log(`  ✅ ${ten}`); }
  else { truot++; console.log(`  ❌ ${ten}${chiTiet ? ' — ' + chiTiet : ''}`); }
};

const mauYeuCau = (i = 1, maPms = 'BIENXANH') => ({
  khoaChongTrung: `${maPms}|seg-${i}|v1`,
  maPms,
  tenKhach: `Khach Thu ${i}`,
  ngayDen: '2026-09-10',
  ngayDi: '2026-09-12',
  loaiPhong: 'DLX',
  maGia: 'BAR',
  soPhong: 1,
  soKhachLon: 2,
});

// ─────────────────────────────────────────────────────────────────────────────
console.log('══ 1. Kiểm đầu vào trước khi gọi PMS ══');
{
  const thieu = kiemYeuCau({ ...mauYeuCau(), tenKhach: '' });
  kt('thiếu trường bắt buộc thì chặn ngay', !thieu.hopLe && thieu.thieu.includes('tenKhach'));

  const sai = kiemYeuCau({ ...mauYeuCau(), ngayDi: '2026-09-09' });
  kt('ngày đi trước ngày đến thì chặn', !sai.hopLe);

  kt('yêu cầu hợp lệ thì cho qua', kiemYeuCau(mauYeuCau()).hopLe);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n══ 2. Chống ghi trùng ══');
{
  const pms = taoSmileGiaLap();
  const a = await pms.taoBooking(mauYeuCau(1));
  const b = await pms.taoBooking(mauYeuCau(1));
  const c = await pms.taoBooking(mauYeuCau(1));
  kt('gọi ba lần cùng khoá → chỉ một bản ghi', pms._demBanGhi('BIENXANH') === 1,
     `đang có ${pms._demBanGhi('BIENXANH')}`);
  kt('lần sau trả về đúng confirmation number cũ', a.maXacNhan === b.maXacNhan && b.maXacNhan === c.maXacNhan);
  kt('lần sau báo rõ là đã tồn tại', b.ketQua === 'da_ton_tai');
}

console.log('\n══ 3. Kịch bản xấu nhất: Smile KHÔNG nhận idempotency key ══');
{
  const pms = taoSmileGiaLap({ hoTroIdempotency: false });
  await pms.taoBooking(mauYeuCau(1));
  await pms.taoBooking(mauYeuCau(1));
  kt('không có idempotency → gọi lại TẠO TRÙNG', pms._demBanGhi('BIENXANH') === 2,
     'bản giả lập phải tái hiện được ca xấu này');
  console.log('     ⚠️  Nếu Smile thật rơi vào ca này thì COH phải tự giữ bảng khoá');
  console.log('        và tuyệt đối không thử lại mù khi timeout.');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n══ 4. Confirmation number chỉ duy nhất trong MỘT khách sạn ══');
{
  const pms = taoSmileGiaLap();
  const a = await pms.taoBooking(mauYeuCau(1, 'BIENXANH'));
  const b = await pms.taoBooking(mauYeuCau(1, 'NUIDOI'));
  kt('cùng segment, khác khách sạn → hai bản ghi riêng',
     a.maXacNhan !== b.maXacNhan && pms._demBanGhi('BIENXANH') === 1 && pms._demBanGhi('NUIDOI') === 1);
  console.log('     → khoá chống trùng BẮT BUỘC gồm mã khách sạn');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n══ 5. Một server hỏng không kéo theo khách sạn khác ══');
{
  // Server của Biển Xanh đang night audit, Núi Đồi thì không
  const bienXanh = taoSmileGiaLap({ nightAudit: [2, 4], gioHienTai: () => 3 });
  const nuiDoi = taoSmileGiaLap({ nightAudit: [2, 4], gioHienTai: () => 10 });

  const a = await bienXanh.taoBooking(mauYeuCau(1, 'BIENXANH'));
  const b = await nuiDoi.taoBooking(mauYeuCau(1, 'NUIDOI'));

  kt('server đang night audit → báo lỗi đúng loại', a.ketQua === 'loi' && a.loaiLoi === LOAI_LOI.NIGHT_AUDIT);
  kt('server còn lại vẫn ghi được', b.ketQua === 'thanh_cong');
  kt('lỗi night audit là lỗi TẠM THỜI, phải thử lại', nenThuLai(a.loaiLoi));
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n══ 6. Phân biệt lỗi tạm thời và lỗi vĩnh viễn ══');
{
  kt('PMS bận → thử lại', nenThuLai(LOAI_LOI.PMS_BAN));
  kt('mất kết nối → thử lại', nenThuLai(LOAI_LOI.MAT_KET_NOI));
  kt('thiếu trường → KHÔNG thử lại, vào DLQ ngay', !nenThuLai(LOAI_LOI.THIEU_TRUONG));
  kt('thiếu bản dịch mã → KHÔNG thử lại', !nenThuLai(LOAI_LOI.MAPPING_THIEU));
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n══ 7. Đẩy 100 segment — tiêu chí ≥98% thành công lần đầu ══');
{
  const pms = taoSmileGiaLap({ tyLeLoi: 0.01, ngauNhien: (() => { let i = 0; return () => (i++ % 100) / 100; })() });
  let ok = 0;
  for (let i = 1; i <= 100; i++) {
    const r = await pms.taoBooking(mauYeuCau(i));
    if (r.ketQua === 'thanh_cong') ok++;
  }
  kt(`thành công lần đầu ${ok}/100 (yêu cầu ≥98)`, ok >= 98, `được ${ok}`);
  kt('không tạo bản ghi thừa', pms._demBanGhi('BIENXANH') === ok);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n══ 8. Sửa và huỷ sau khi đã đẩy ══');
{
  const pms = taoSmileGiaLap();
  const a = await pms.taoBooking(mauYeuCau(1));
  const s = await pms.suaBooking(a.maXacNhan, { ngayDi: '2026-09-14' });
  const doc = await pms.docBooking(a.maXacNhan);
  kt('sửa được tại chỗ, giữ nguyên confirmation number',
     s.ketQua === 'thanh_cong' && doc.ngayDi === '2026-09-14' && doc.maXacNhan === a.maXacNhan);

  const h = await pms.huyBooking(a.maXacNhan, 'khách đổi lịch');
  const doc2 = await pms.docBooking(a.maXacNhan);
  kt('huỷ đúng, không xoá bản ghi (còn vết để đối soát)',
     h.ketQua === 'thanh_cong' && doc2.trangThai === 'cancelled' && doc2.lyDoHuy === 'khách đổi lịch');

  const kh = await pms.huyBooking('KHONG-CO-THAT');
  kt('huỷ mã không tồn tại → báo lỗi, không im lặng', kh.ketQua === 'loi');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n══ 9. Đọc danh sách khách đến — phục vụ đối soát ══');
{
  const pms = taoSmileGiaLap();
  await pms.taoBooking({ ...mauYeuCau(1), ngayDen: '2026-09-10' });
  await pms.taoBooking({ ...mauYeuCau(2), ngayDen: '2026-09-10' });
  await pms.taoBooking({ ...mauYeuCau(3), ngayDen: '2026-09-11' });
  const ds = await pms.docKhachDen('2026-09-10');
  kt('đọc đúng số khách đến trong ngày', ds.length === 2, `được ${ds.length}`);

  const a = await pms.taoBooking(mauYeuCau(4));
  await pms.huyBooking(a.maXacNhan);
  const ds2 = await pms.docKhachDen('2026-09-10');
  kt('booking đã huỷ không nằm trong danh sách khách đến', ds2.length === 2);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(62)}`);
console.log(`Đạt ${dat} · Trượt ${truot}`);
if (truot === 0) {
  console.log('\n✅ Bộ test hợp đồng đã sẵn sàng.');
  console.log('   Khi có Smile thật: viết một bản hiện thực nữa rồi chạy ĐÚNG bộ này.');
  console.log('   Bộ test không đổi — nó chính là định nghĩa của "làm đúng".');
}
process.exit(truot === 0 ? 0 : 1);
