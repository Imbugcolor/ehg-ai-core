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
                'pham_vi', s.scope, 'property_id', s.property_id::text,
                'tinh_nang', s.feature, 'ly_do', s.reason)), '[]'::json)
       from public.ai_kill_switch s where s.is_disabled)              as cong_tac,
      public.kb_version()                                       as kb_version,
      (select p.name from public.property p
        where p.id = ${propertyId ? `'${propertyId}'` : 'null'}) as ten_khach_san,
      coalesce((select string_agg(property_id::text, ',' order by property_id::text)
                from public.user_property where user_id = '${userId}'), 'khong-co') as scope_key,
      (select row_to_json(c) from public.ai_cost_status() c)        as cost_usd;`);

  const x = r[0] || {};
  const congTac = x.cong_tac || [];
  const cp = x.cost_usd || {};

  const uuTien = { toan_he: 1, khach_san: 2, feature: 3 };
  const timTat = (tinhNang) => {
    const khop = congTac
      .filter(
        (s) =>
          s.scope === 'toan_he' ||
          (s.scope === 'khach_san' && propertyId && s.property_id === propertyId) ||
          (s.scope === 'tinh_nang' && s.feature === tinhNang)
      )
      .sort((a, b) => uuTien[a.scope] - uuTien[b.scope])[0];
    return khop ? { lyDo: khop.reason, phamVi: khop.scope } : null;
  };

  const vuotHan = !!cp.vuot_han;
  return {
    timTat,
    // Tên khách sạn đang phục vụ. Đưa vào prompt để model biết nó nói thay ai —
    // thiếu chỗ này thì khách hỏi về khách sạn khác trong chuỗi, model lấy
    // chính sách toàn chuỗi rồi gán tên nơi khác vào: "Nui Doi Hotel applies
    // three room rate types…" trong khi nó không phụ trách Núi Đồi.
    tenKhachSan: x.ten_khach_san || null,
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
