// Đo tỉ lệ nhân viên phải sửa bản nháp (HM3.8).
//
// Đây là chỉ số DUY NHẤT nói được AI có thực sự giúp việc hay không.
// Tiêu chí nghiệm thu M3: trên 70% bản nháp dùng được ngay hoặc chỉ sửa nhẹ.
//
// Cơ chế dựng sẵn ở đây, dữ liệu thật chỉ có khi nhân viên dùng thật.

import { sql, q } from './adapters.mjs';
import { che } from './log.mjs';

/**
 * Khoảng cách Levenshtein chuẩn hoá theo độ dài — 0 là giữ nguyên, 1 là viết lại hẳn.
 * Tính trên TỪ chứ không trên ký tự: sửa một dấu câu không nên bị tính như sửa nội dung.
 */
export function tyLeSua(banGoc, banDaSua) {
  const a = String(banGoc || '').trim().split(/\s+/).filter(Boolean);
  const b = String(banDaSua || '').trim().split(/\s+/).filter(Boolean);
  if (!a.length && !b.length) return 0;
  if (!a.length || !b.length) return 1;

  // Levenshtein trên mảng từ, chỉ giữ hai hàng để đỡ tốn bộ nhớ
  let truoc = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const hienTai = [i];
    for (let j = 1; j <= b.length; j++) {
      hienTai[j] = Math.min(
        truoc[j] + 1,
        hienTai[j - 1] + 1,
        truoc[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    truoc = hienTai;
  }
  return Math.min(1, truoc[b.length] / Math.max(a.length, b.length));
}

/** Gọi khi nhân viên bấm gửi hoặc lưu bản đã sửa. */
export async function ghiNhanSua({ logId = null, banGoc, banDaSua, nhanYDinh = null, nguoiSua = null, daGui = false }) {
  const ty = tyLeSua(banGoc, banDaSua);
  await sql(`
    insert into public.ai_nhap_da_sua
      (log_id, ban_goc, ban_da_sua, ty_le_sua, nhan_y_dinh, nguoi_sua, da_gui)
    values (${logId ?? 'null'}, ${q(che(banGoc))}, ${q(che(banDaSua))}, ${ty.toFixed(4)},
            ${nhanYDinh ? q(nhanYDinh) : 'null'},
            ${nguoiSua ? `'${nguoiSua}'` : 'null'}, ${daGui});`);
  return ty;
}

/** Thống kê phục vụ nghiệm thu. */
export async function thongKe() {
  const theoNhan = await sql('select * from public.ai_thong_ke_sua;');
  const tong = await sql(`
    select count(*) as so_ban,
           round(avg(ty_le_sua), 4) as ty_le_sua_tb,
           count(*) filter (where ty_le_sua <= 0.30) as dung_duoc_ngay,
           round(count(*) filter (where ty_le_sua <= 0.30)::numeric / nullif(count(*),0), 4) as ty_le_dung_duoc
    from public.ai_nhap_da_sua;`);
  return { theoNhan, tong: tong[0] };
}
