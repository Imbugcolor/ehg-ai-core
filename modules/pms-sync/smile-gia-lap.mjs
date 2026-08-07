// BẢN GIẢ LẬP SMILE PMS.
//
// Dùng để viết và kiểm thử toàn bộ Sync Service, Write-Gate và cơ chế chống
// trùng TRƯỚC KHI có API thật. Kế hoạch cấm thử trực tiếp trên PMS production,
// và vendor có thể không có môi trường thử — nên cái này là bắt buộc chứ không
// phải tiện thì làm.
//
// Bản giả lập cố ý mô phỏng những chỗ KHÓ, không phải chỉ đường êm:
//   • Mỗi khách sạn một kho riêng — confirmation number chỉ duy nhất trong
//     phạm vi một server, đúng như Smile thật
//   • Có khung giờ night audit khoá ghi
//   • Có tỉ lệ lỗi tạm thời và độ trễ giả lập
//   • Có chế độ KHÔNG nhận idempotency key, để thử kịch bản xấu nhất

import { LOAI_LOI, kiemYeuCau } from './pms-client.mjs';

let demSo = 0;

/**
 * @param {Object} opt
 * @param {boolean} [opt.hoTroIdempotency=true]  false = mô phỏng Smile KHÔNG chống trùng
 * @param {number}  [opt.tyLeLoi=0]              0..1 — tỉ lệ lỗi tạm thời
 * @param {number}  [opt.doTre=0]                mili giây
 * @param {[number,number]} [opt.nightAudit]     [giờ bắt đầu, giờ kết thúc]
 * @param {() => number}    [opt.gioHienTai]     để test khỏi phải chờ tới đêm
 */
export function taoSmileGiaLap(opt = {}) {
  const {
    hoTroIdempotency = true,
    tyLeLoi = 0,
    doTre = 0,
    nightAudit = null,
    gioHienTai = () => new Date().getHours(),
    ngauNhien = Math.random,
  } = opt;

  // Mỗi khách sạn một kho riêng, đúng như Smile chạy tại chỗ
  const kho = new Map(); // maPms -> { theoMaXacNhan: Map, theoKhoa: Map }
  const nhatKyGoi = [];

  const layKho = (maPms) => {
    if (!kho.has(maPms)) kho.set(maPms, { theoMaXacNhan: new Map(), theoKhoa: new Map() });
    return kho.get(maPms);
  };

  const cho = () => (doTre ? new Promise((r) => setTimeout(r, doTre)) : Promise.resolve());

  const kiemMoiTruong = () => {
    if (nightAudit) {
      const h = gioHienTai();
      const [tu, den] = nightAudit;
      const trong = tu < den ? h >= tu && h < den : h >= tu || h < den;
      if (trong) {
        return { ketQua: 'loi', loaiLoi: LOAI_LOI.NIGHT_AUDIT, loiMsg: `đang night audit (${tu}h–${den}h)` };
      }
    }
    if (tyLeLoi > 0 && ngauNhien() < tyLeLoi) {
      return { ketQua: 'loi', loaiLoi: LOAI_LOI.PMS_BAN, loiMsg: 'PMS bận, thử lại sau' };
    }
    return null;
  };

  return {
    async taoBooking(yc) {
      await cho();
      nhatKyGoi.push({ ham: 'taoBooking', khoa: yc.khoaChongTrung, luc: Date.now() });

      const kt = kiemYeuCau(yc);
      if (!kt.hopLe) {
        return {
          ketQua: 'loi',
          loaiLoi: LOAI_LOI.THIEU_TRUONG,
          loiMsg: kt.loi || `thiếu trường: ${kt.thieu.join(', ')}`,
        };
      }

      const moiTruong = kiemMoiTruong();
      if (moiTruong) return moiTruong;

      const k = layKho(yc.maPms);

      // Smile thật có thể KHÔNG nhận idempotency key. Bật chế độ đó để thử
      // kịch bản xấu nhất: gọi lại là tạo bản ghi thứ hai.
      if (hoTroIdempotency && k.theoKhoa.has(yc.khoaChongTrung)) {
        const maCu = k.theoKhoa.get(yc.khoaChongTrung);
        return { ketQua: 'da_ton_tai', maXacNhan: maCu };
      }

      // Confirmation number chỉ duy nhất trong phạm vi MỘT khách sạn —
      // hai khách sạn khác nhau có thể trùng số.
      const maXacNhan = `${yc.maPms}-${String(++demSo).padStart(6, '0')}`;
      const ban = {
        maXacNhan,
        maPms: yc.maPms,
        tenKhach: yc.tenKhach,
        ngayDen: yc.ngayDen,
        ngayDi: yc.ngayDi,
        loaiPhong: yc.loaiPhong,
        maGia: yc.maGia ?? null,
        soPhong: yc.soPhong,
        soKhachLon: yc.soKhachLon,
        soTreEm: yc.soTreEm ?? 0,
        ghiChu: yc.ghiChu ?? null,
        trangThai: 'confirmed',
        taoLuc: new Date().toISOString(),
      };
      k.theoMaXacNhan.set(maXacNhan, ban);
      if (hoTroIdempotency) k.theoKhoa.set(yc.khoaChongTrung, maXacNhan);

      return { ketQua: 'thanh_cong', maXacNhan, phanHoiGoc: ban };
    },

    async suaBooking(maXacNhan, yc) {
      await cho();
      const moiTruong = kiemMoiTruong();
      if (moiTruong) return moiTruong;

      for (const k of kho.values()) {
        const ban = k.theoMaXacNhan.get(maXacNhan);
        if (ban) {
          Object.assign(ban, yc, { suaLuc: new Date().toISOString() });
          return { ketQua: 'thanh_cong', maXacNhan, phanHoiGoc: ban };
        }
      }
      return { ketQua: 'loi', loaiLoi: LOAI_LOI.KHAC, loiMsg: 'không tìm thấy booking' };
    },

    async huyBooking(maXacNhan, lyDo) {
      await cho();
      const moiTruong = kiemMoiTruong();
      if (moiTruong) return moiTruong;

      for (const k of kho.values()) {
        const ban = k.theoMaXacNhan.get(maXacNhan);
        if (ban) {
          ban.trangThai = 'cancelled';
          ban.lyDoHuy = lyDo ?? null;
          ban.huyLuc = new Date().toISOString();
          return { ketQua: 'thanh_cong', maXacNhan, phanHoiGoc: ban };
        }
      }
      return { ketQua: 'loi', loaiLoi: LOAI_LOI.KHAC, loiMsg: 'không tìm thấy booking' };
    },

    async docBooking(maXacNhan) {
      await cho();
      for (const k of kho.values()) {
        const ban = k.theoMaXacNhan.get(maXacNhan);
        if (ban) return { ...ban };
      }
      return null;
    },

    async docKhachDen(ngay) {
      await cho();
      const ra = [];
      for (const k of kho.values()) {
        for (const b of k.theoMaXacNhan.values()) {
          if (b.ngayDen === ngay && b.trangThai === 'confirmed') ra.push({ ...b });
        }
      }
      return ra;
    },

    async kiemTra() {
      await cho();
      const m = kiemMoiTruong();
      if (m) return { song: false, msg: m.loiMsg };
      return { song: true, phienBan: 'gia-lap-1.0' };
    },

    // --- dành cho kiểm thử -------------------------------------------------
    _kho: kho,
    _nhatKyGoi: nhatKyGoi,
    _demBanGhi: (maPms) => (kho.get(maPms)?.theoMaXacNhan.size ?? 0),
    _reset: () => {
      kho.clear();
      nhatKyGoi.length = 0;
    },
  };
}
