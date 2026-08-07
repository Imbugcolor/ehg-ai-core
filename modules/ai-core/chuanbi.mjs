// Gom ba lượt truy vấn chuẩn bị thành MỘT.
//
// Trước đây mỗi lượt hỏi phải đi ba vòng tới cơ sở dữ liệu trước khi chạm được
// vào việc chính: kiểm nút tắt · lấy phạm vi và phiên bản tri thức · kiểm hạn
// mức. Mỗi vòng mất khoảng nửa giây, cộng lại là một giây rưỡi chết trước khi
// chữ đầu tiên kịp chảy ra.
//
// Gộp lại còn một vòng. Đây là chỗ tiết kiệm rẻ nhất trong cả đường ống.

import { sql } from './adapters.mjs';

export async function chuanBi(userId, propertyId = null) {
  const r = await sql(`
    select
      (select coalesce(json_agg(json_build_object(
                'pham_vi', s.pham_vi, 'property_id', s.property_id::text,
                'tinh_nang', s.tinh_nang, 'ly_do', s.ly_do)), '[]'::json)
       from public.ai_cong_tac s where s.dang_tat)              as cong_tac,
      public.kb_version()                                       as kb_version,
      coalesce((select string_agg(property_id::text, ',' order by property_id::text)
                from public.user_property where user_id = '${userId}'), 'khong-co') as scope_key,
      (select row_to_json(c) from public.ai_chi_phi() c)        as chi_phi;`);

  const x = r[0] || {};
  const congTac = x.cong_tac || [];
  const cp = x.chi_phi || {};

  const uuTien = { toan_he: 1, khach_san: 2, tinh_nang: 3 };
  const timTat = (tinhNang) => {
    const khop = congTac
      .filter(
        (s) =>
          s.pham_vi === 'toan_he' ||
          (s.pham_vi === 'khach_san' && propertyId && s.property_id === propertyId) ||
          (s.pham_vi === 'tinh_nang' && s.tinh_nang === tinhNang)
      )
      .sort((a, b) => uuTien[a.pham_vi] - uuTien[b.pham_vi])[0];
    return khop ? { lyDo: khop.ly_do, phamVi: khop.pham_vi } : null;
  };

  const vuotHan = !!cp.vuot_han;
  return {
    timTat,
    nguCanhCache: { kbVersion: Number(x.kb_version), scopeKey: x.scope_key },
    hanMuc: {
      vuot: vuotHan,
      lyDo: vuotHan
        ? `vượt hạn mức chi phí: ${Number(cp.hom_nay || 0).toFixed(4)} / ${Number(cp.han_ngay || 0).toFixed(2)} USD hôm nay`
        : null,
      canCanhBao: !!cp.can_canh_bao,
    },
  };
}
