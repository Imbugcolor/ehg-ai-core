// Bộ nhớ đệm câu trả lời.
//
// Khoá gồm năm phần: câu hỏi đã chuẩn hoá · phạm vi khách sạn · ngôn ngữ ·
// phiên bản kho tri thức · phiên bản luật. Thiếu phần nào cũng sai:
//   • thiếu phạm vi     -> người của khách sạn này ăn cache của khách sạn kia
//   • thiếu phiên bản kho -> sửa tri thức mà vẫn trả câu trả lời cũ
//   • thiếu phiên bản luật -> sửa cổng tin cậy, ngưỡng hay guardrail mà câu đã
//     hỏi vẫn trả kết quả cũ. Đo được: nới cổng tin cậy cho câu hỏi thú cưng
//     xong chạy lại vẫn ra KHONG_DU_CO_SO trong 780 ms, vì cache đã giữ kết
//     quả từ chối từ lần trước. Kết quả TỪ CHỐI cũng được cache, nên lỗi này
//     im lặng và rất dễ tưởng là luật mới không ăn.

import { createHash } from 'node:crypto';
import { sql, q } from './adapters.mjs';

// Chuẩn hoá để "Mấy giờ nhận phòng?" và "may gio nhan phong" chung một khoá
export function chuanHoa(s) {
  return String(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// TĂNG SỐ NÀY mỗi khi đổi ngưỡng tin cậy, luật cứu vớt, danh sách điều cấm hay
// prompt soạn nháp. Đây là cách duy nhất để cache cũ không che mất luật mới.
export const PHIEN_BAN_LUAT = 14;

export function taoKhoa({ cauHoi, scopeKey, lang, kbVersion, vanTaySo = '' }) {
  // vanTaySo là vân tay của sổ ghi nhớ hội thoại. Sổ ảnh hưởng tới bản nháp,
  // nên hai hội thoại có sổ khác nhau KHÔNG được dùng chung câu trả lời — cùng
  // một bẫy với việc mở ngữ cảnh nhiều lượt, chỉ khác chỗ phát sinh.
  //
  // Hội thoại chưa có sổ thì vân tay rỗng và khoá y như cũ, nên câu hỏi lẻ —
  // phần lớn lưu lượng — vẫn dùng chung cache bình thường.
  return createHash('sha256')
    .update(`${chuanHoa(cauHoi)}|${scopeKey}|${lang}|${kbVersion}|l${PHIEN_BAN_LUAT}|s${vanTaySo}`)
    .digest('hex');
}

/** Lấy phạm vi khách sạn của người dùng và phiên bản kho tri thức trong một lượt truy vấn. */
export async function layNguCanhCache(userId) {
  const r = await sql(`
    select
      public.kb_version() as kb_version,
      coalesce(
        (select string_agg(property_id::text, ',' order by property_id::text)
         from public.user_property where user_id = '${userId}'),
        'khong-co'
      ) as scope_key;`);
  return { kbVersion: Number(r[0].kb_version), scopeKey: r[0].scope_key };
}

export async function tim(khoa) {
  const r = await sql(`
    select outcome, answer, citations, score
    from public.rag_cache where cache_key = ${q(khoa)} limit 1;`);
  if (!r.length || !r[0].outcome) return null;
  // Cập nhật lượt dùng, không chờ kết quả để khỏi làm chậm câu trả lời
  sql(`update public.rag_cache
       set hit_count = hit_count + 1, last_used_at = now()
       where cache_key = ${q(khoa)};`).catch(() => {});
  return {
    ketQua: r[0].outcome,
    banNhap: r[0].answer ?? undefined,
    nguon: r[0].citations ?? [],
    diem: Number(r[0].score ?? 0),
  };
}

export async function luu(khoa, { cauHoi, scopeKey, lang, kbVersion, propertyId, ketQua, banNhap, diem, nguon }) {
  const cites = JSON.stringify(
    // Giữ cả mã tài liệu và số phiên bản. Thiếu phiên bản thì trích dẫn chỉ nói
    // được "lấy từ tài liệu nào", không nói được "lấy từ bản nào" — mà kho tri
    // thức thì liên tục đổi.
    (nguon || []).map((n) => ({
      chunk_id: n.chunk_id,
      kb_id: n.document_id ?? n.kb_id ?? null,
      version: n.version ?? null,
      title: n.title,
    }))
  );
  const ids = (nguon || []).map((n) => `'${n.chunk_id}'`).join(',');
  try {
    await sql(`
      insert into public.rag_cache
        (cache_key, question, property_id, lang, kb_version, scope_key, chunk_ids, answer, citations, outcome, score)
      values (${q(khoa)}, ${q(cauHoi)}, ${propertyId ? `'${propertyId}'` : 'null'}, ${q(lang)},
              ${kbVersion}, ${q(scopeKey)}, ARRAY[${ids}]::uuid[], ${banNhap ? q(banNhap) : 'null'},
              ${q(cites)}::jsonb, ${q(ketQua)}, ${Number(diem) || 0})
      on conflict (cache_key) do update
        set answer = excluded.answer,
            citations = excluded.citations,
            outcome = excluded.outcome,
            score = excluded.score,
            last_used_at = now();`);
  } catch (e) {
    console.error('[rag_cache] không lưu được:', e.message.slice(0, 140));
  }
}
