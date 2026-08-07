// Đếm chi phí và hạn mức (HM3.9).
//
// Hai việc: biết đang tiêu bao nhiêu, và dừng lại trước khi cháy ví.
// Kiểm hạn mức TRƯỚC khi gọi model, không phải sau — sau thì đã tiêu rồi.

import { sql } from './adapters.mjs';

const NHO_TAM_MS = Number(process.env.AI_BUDGET_TTL_MS || 30_000);
let nhoTam = { luc: 0, data: null };

export async function tinhTrangChiPhi({ batBuocMoi = false } = {}) {
  if (!batBuocMoi && nhoTam.data && Date.now() - nhoTam.luc < NHO_TAM_MS) return nhoTam.data;
  const r = await sql('select * from public.ai_chi_phi();');
  const x = r[0] || {};
  const data = {
    homNay: Number(x.hom_nay || 0),
    thangNay: Number(x.thang_nay || 0),
    hanNgay: Number(x.han_ngay || 0),
    hanThang: Number(x.han_thang || 0),
    tyLeNgay: Number(x.ty_le_ngay || 0),
    tyLeThang: Number(x.ty_le_thang || 0),
    canCanhBao: !!x.can_canh_bao,
    vuotHan: !!x.vuot_han,
  };
  nhoTam = { luc: Date.now(), data };
  return data;
}

/** Gọi trước mỗi lượt dùng model. Vượt hạn thì trả lý do để dừng. */
export async function kiemHanMuc() {
  const t = await tinhTrangChiPhi();
  if (t.vuotHan) {
    const ai = t.homNay >= t.hanNgay ? 'ngày' : 'tháng';
    return {
      vuot: true,
      lyDo: `vượt hạn mức chi phí ${ai}: ${(ai === 'ngày' ? t.homNay : t.thangNay).toFixed(4)} / ${(ai === 'ngày' ? t.hanNgay : t.hanThang).toFixed(2)} USD`,
    };
  }
  if (t.canCanhBao) {
    console.warn(
      `[chi phí] đã dùng ${(t.tyLeNgay * 100).toFixed(0)}% hạn mức ngày, ` +
        `${(t.tyLeThang * 100).toFixed(0)}% hạn mức tháng`
    );
  }
  return { vuot: false };
}

export async function datHanMuc({ ngay, thang, canhBaoO }) {
  const set = [];
  if (ngay != null) set.push(`han_muc_ngay = ${Number(ngay)}`);
  if (thang != null) set.push(`han_muc_thang = ${Number(thang)}`);
  if (canhBaoO != null) set.push(`canh_bao_o = ${Number(canhBaoO)}`);
  if (!set.length) return;
  await sql(`update public.ai_han_muc set ${set.join(', ')}, cap_nhat_luc = now() where id;`);
  nhoTam = { luc: 0, data: null };
}
