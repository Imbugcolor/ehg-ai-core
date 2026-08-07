// Che thông tin cá nhân rồi ghi nhật ký.
//
// Che TRƯỚC KHI ghi bất kỳ đâu — cùng nguyên tắc với M2.9 bên luồng OTA.
// Nhật ký sẽ được đọc lại để đo chất lượng, nên không được chứa dữ liệu khách.

import { sql, q } from './adapters.mjs';
import { cfg } from './env.mjs';

const MAU_CHE = [
  // Số thẻ: 13–19 chữ số, cho phép cách hoặc gạch
  [/\b(?:\d[ -]?){13,19}\b/g, '[SỐ THẺ]'],
  // Email
  [/\b[\w.+-]+@[\w-]+\.[\w.]+\b/g, '[EMAIL]'],
  // Điện thoại Việt Nam
  [/\b(?:\+?84|0)(?:[ .-]?\d){8,10}\b/g, '[SĐT]'],
  // Căn cước, hộ chiếu
  [/\b\d{9,12}\b/g, '[GIẤY TỜ]'],
];

export function che(text) {
  if (!text) return text;
  let s = String(text);
  for (const [re, thay] of MAU_CHE) s = s.replace(re, thay);
  return s;
}

export async function ghiNhatKy(ban) {
  const v = (x) => (x === undefined || x === null || x === '' ? 'null' : q(String(x)));
  const n = (x) => (x === undefined || x === null || Number.isNaN(x) ? 'null' : Number(x));
  try {
    const r = await sql(`
      insert into public.ai_log
        (user_id, cau_hoi, ket_qua, y_dinh, diem, so_ung_vien, ban_nhap,
         ly_do_chan, lop_chan, model_chat, model_rerank, model_embed, ms, loi_loai, loi_msg,
         nhan_y_dinh, cam_xuc, do_gap, token_vao, token_ra, chi_phi, tu_cache, model_du_phong)
      values (
        ${ban.userId ? `'${ban.userId}'` : 'null'},
        ${q(che(ban.cauHoi))},
        ${q(ban.ketQua)},
        ${v(ban.yDinh)},
        ${n(ban.diem)},
        ${n(ban.soUngVien)},
        ${ban.banNhap ? q(che(ban.banNhap)) : 'null'},
        ${v(ban.lyDoChan)},
        ${n(ban.lopChan)},
        ${q(cfg.chat.model)},
        ${q(cfg.rerank.model)},
        ${q(cfg.embedding.model)},
        ${n(ban.ms)},
        ${v(ban.loiLoai)},
        ${ban.loiMsg ? q(String(ban.loiMsg).slice(0, 400)) : 'null'},
        ${v(ban.nhan?.nhan)}, ${v(ban.nhan?.camXuc)}, ${v(ban.nhan?.doGap)},
        ${n(ban.tokens?.tokenVao)}, ${n(ban.tokens?.tokenRa)}, ${n(ban.tokens?.usd)},
        ${ban.tuCache ? 'true' : 'false'}, ${v(ban.tokens?.duPhong)}
      ) returning id;`);
    return r?.[0]?.id ?? null;
  } catch (e) {
    // Ghi nhật ký hỏng thì KHÔNG được làm hỏng luồng chính, nhưng phải kêu lên.
    console.error('[ai_log] không ghi được nhật ký:', e.message.slice(0, 160));
    return null;
  }
}
