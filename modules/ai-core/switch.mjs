// Nút tắt khẩn (HM3.7).
//
// Dùng khi AI đang trả lời sai và cần dừng NGAY, không kịp triển khai lại code.
// Ba mức: toàn hệ · theo khách sạn · theo tính năng.
//
// Trạng thái được nhớ tạm vài giây để không phải hỏi cơ sở dữ liệu mỗi lượt,
// nhưng phải đủ ngắn để bật tắt có hiệu lực gần như tức thì.

import { sql, q } from './adapters.mjs';

const NHO_TAM_MS = Number(process.env.AI_SWITCH_TTL_MS || 10_000);
let nhoTam = { luc: 0, data: [] };

async function docTrangThai() {
  if (Date.now() - nhoTam.luc < NHO_TAM_MS) return nhoTam.data;
  const r = await sql(`
    select scope, property_id::text as property_id, feature, reason
    from public.ai_kill_switch where is_disabled;`);
  nhoTam = { luc: Date.now(), data: Array.isArray(r) ? r : [] };
  return nhoTam.data;
}

/** @returns {null | {lyDo:string, phamVi:string}} */
export async function kiemTraTat(tinhNang, propertyId = null) {
  const ds = await docTrangThai();
  if (!ds.length) return null;

  const uuTien = { toan_he: 1, khach_san: 2, feature: 3 };
  const khop = ds
    .filter(
      (s) =>
        s.scope === 'toan_he' ||
        (s.scope === 'khach_san' && propertyId && s.property_id === propertyId) ||
        (s.scope === 'tinh_nang' && s.feature === tinhNang)
    )
    .sort((a, b) => uuTien[a.scope] - uuTien[b.scope])[0];

  return khop ? { lyDo: khop.reason, phamVi: khop.scope } : null;
}

export function xoaNhoTam() {
  nhoTam = { luc: 0, data: [] };
}

// --- Bật tắt bằng lệnh, để lúc có sự cố không phải mở giao diện ------------
export async function tat({ phamVi, propertyId = null, tinhNang = null, lyDo, boi = null }) {
  await sql(`
    insert into public.ai_kill_switch (scope, property_id, feature, is_disabled, reason, set_by)
    values (${q(phamVi)}, ${propertyId ? `'${propertyId}'` : 'null'},
            ${tinhNang ? q(tinhNang) : 'null'}, true, ${q(lyDo)},
            ${boi ? `'${boi}'` : 'null'});`);
  xoaNhoTam();
}

export async function bat({ phamVi, propertyId = null, tinhNang = null }) {
  await sql(`
    update public.ai_kill_switch set is_disabled = false
    where is_disabled
      and scope = ${q(phamVi)}
      and property_id is not distinct from ${propertyId ? `'${propertyId}'` : 'null'}
      and feature is not distinct from ${tinhNang ? q(tinhNang) : 'null'};`);
  xoaNhoTam();
}
