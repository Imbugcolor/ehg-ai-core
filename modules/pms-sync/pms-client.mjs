// HỢP ĐỒNG KẾT NỐI PMS — lõi nghiệp vụ chỉ biết interface này, không biết
// bên dưới là Smile thật, là bản giả lập, hay là một PMS khác.
//
// Vì sao viết interface trước khi có API thật:
//   • Sync Service, Write-Gate và cơ chế chống trùng viết và test xong TRƯỚC
//   • Có API Smile thật thì chỉ thêm một bản hiện thực, không sửa phần lõi
//   • Chưa rõ Smile là REST, SOAP hay nhập file — cả ba đều nhét vừa hợp đồng này
//
// Yêu cầu tối thiểu lấy theo Mục K.4 của tài liệu thiết kế.

/**
 * @typedef {Object} YeuCauTaoBooking
 * @property {string}  khoaChongTrung  Khoá idempotency = hash(khách sạn + segment + phiên bản)
 * @property {string}  maPms           Mã khách sạn bên trong Smile
 * @property {string}  tenKhach
 * @property {string=} quocTich
 * @property {string}  ngayDen         YYYY-MM-DD
 * @property {string}  ngayDi          YYYY-MM-DD
 * @property {string}  loaiPhong       ĐÃ dịch sang mã của Smile
 * @property {string=} maGia           ĐÃ dịch sang mã của Smile
 * @property {string=} marketSegment   ĐÃ dịch sang mã của Smile
 * @property {number}  soPhong
 * @property {number}  soKhachLon
 * @property {number=} soTreEm
 * @property {string=} ghiChu
 */

/**
 * @typedef {Object} KetQuaGhi
 * @property {'thanh_cong'|'da_ton_tai'|'loi'} ketQua
 * @property {string=} maXacNhan   Confirmation number do PMS trả về
 * @property {string=} loaiLoi     mapping_thieu | thieu_truong | pms_ban | dang_night_audit | mat_ket_noi | khac
 * @property {string=} loiMsg
 * @property {object=} phanHoiGoc
 */

/**
 * Hợp đồng mà mọi bản hiện thực PMS phải đáp ứng.
 * @typedef {Object} PmsClient
 * @property {(yc: YeuCauTaoBooking) => Promise<KetQuaGhi>}          taoBooking
 * @property {(maXacNhan: string, yc: Partial<YeuCauTaoBooking>) => Promise<KetQuaGhi>} suaBooking
 * @property {(maXacNhan: string, lyDo?: string) => Promise<KetQuaGhi>} huyBooking
 * @property {(maXacNhan: string) => Promise<object|null>}            docBooking
 * @property {(ngay: string) => Promise<object[]>}                    docKhachDen
 * @property {() => Promise<{song: boolean, phienBan?: string, msg?: string}>} kiemTra
 */

export const LOAI_LOI = {
  MAPPING_THIEU: 'mapping_thieu',
  THIEU_TRUONG: 'thieu_truong',
  PMS_BAN: 'pms_ban',
  NIGHT_AUDIT: 'dang_night_audit',
  MAT_KET_NOI: 'mat_ket_noi',
  KHAC: 'khac',
};

// Lỗi nào thì thử lại được, lỗi nào thì thử lại cũng vô ích.
// Phân biệt sai chỗ này là hoặc mất booking, hoặc quay vòng vô ích tới DLQ.
export const LOI_TAM_THOI = new Set([
  LOAI_LOI.PMS_BAN,
  LOAI_LOI.NIGHT_AUDIT,
  LOAI_LOI.MAT_KET_NOI,
]);

export const nenThuLai = (loaiLoi) => LOI_TAM_THOI.has(loaiLoi);

export const TRUONG_BAT_BUOC = [
  'khoaChongTrung',
  'maPms',
  'tenKhach',
  'ngayDen',
  'ngayDi',
  'loaiPhong',
  'soPhong',
  'soKhachLon',
];

/** Kiểm trước khi gọi PMS — thà chặn còn hơn tạo dữ liệu sai (E6). */
export function kiemYeuCau(yc) {
  const thieu = TRUONG_BAT_BUOC.filter((t) => yc[t] === undefined || yc[t] === null || yc[t] === '');
  if (thieu.length) return { hopLe: false, thieu };
  if (new Date(yc.ngayDi) <= new Date(yc.ngayDen)) {
    return { hopLe: false, thieu: [], loi: 'ngày đi phải sau ngày đến' };
  }
  return { hopLe: true };
}
