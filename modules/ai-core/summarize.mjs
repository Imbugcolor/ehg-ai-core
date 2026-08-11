// Tóm tắt hội thoại dài (HM3.4).
//
// Dùng lúc chuyển ca hoặc khi cấp trên vào xem một hội thoại đã dài. Phần giá
// trị nhất không phải bản tóm tắt mà là DANH SÁCH VIỆC CÒN TREO — người nhận ca
// cần biết khách đang chờ gì, chứ không cần đọc lại toàn bộ.
//
// Có nhớ lại: khoá theo băm nội dung nên thêm tin nhắn mới là tự tính lại.

import { createHash } from 'node:crypto';
import { chat, sql, q } from './adapters.mjs';
import { cfg } from './env.mjs';
import { kiemTraTat } from './switch.mjs';
import { kiemHanMuc } from './budget.mjs';
import { che } from './log.mjs';

const HE_THONG = `Tóm tắt hội thoại giữa khách và khách sạn, phục vụ người nhận ca đọc trong 20 giây.

Trả về DUY NHẤT một JSON:
{
  "tom_tat": "3-4 câu, nêu khách là ai, đang cần gì, đã xử lý tới đâu",
  "y_chinh": ["ý khách đã nêu, mỗi ý một dòng ngắn"],
  "viec_con_treo": ["việc khách đang chờ mà chưa xong, mỗi việc một dòng"],
  "cam_xuc": "tich_cuc|trung_tinh|tieu_cuc"
}

QUY TẮC:
- Chỉ dùng thông tin có trong hội thoại, không suy diễn thêm.
- open_items là phần quan trọng nhất. Không có việc nào treo thì để mảng rỗng.
- Không nêu lại giá, không tự kết luận thay khách sạn.`;

const bam = (s) => createHash('sha256').update(s).digest('hex').slice(0, 32);

/**
 * @param {{nguoi:string, luc?:string, body:string}[]} tinNhan
 * @returns {{tomTat:string, yChinh:string[], viecConTreo:string[], camXuc:string,
 *            tuNhoLai?:boolean, ketQua?:string, lyDo?:string, ms:number}}
 */
export async function tomTat(tinNhan, { threadKey, propertyId = null } = {}) {
  const t0 = Date.now();
  const ket = (o) => ({ ms: Date.now() - t0, ...o });

  const tat = await kiemTraTat('tom_tat', propertyId);
  if (tat) return ket({ ketQua: 'AI_DANG_TAT', lyDo: tat.lyDo });

  const vanBan = tinNhan
    .map((t) => `${t.nguoi}${t.luc ? ` (${t.luc})` : ''}: ${t.body}`)
    .join('\n');
  const hash = bam(vanBan);

  // Đã tóm tắt đúng nội dung này rồi thì dùng lại
  const cu = await sql(`
    select summary, key_points, open_items, sentiment
    from public.ai_thread_summary
    where thread_key = ${q(threadKey)} and content_hash = ${q(hash)}
    limit 1;`);
  if (cu.length) {
    return ket({
      ketQua: 'OK',
      tuNhoLai: true,
      tomTat: cu[0].summary,
      yChinh: cu[0].key_points || [],
      viecConTreo: cu[0].open_items || [],
      camXuc: cu[0].sentiment,
    });
  }

  const hm = await kiemHanMuc();
  if (hm.vuot) return ket({ ketQua: 'VUOT_HAN_MUC', lyDo: hm.lyDo });

  const raw = await chat(
    [
      { role: 'system', content: HE_THONG },
      { role: 'user', content: vanBan },
    ],
    { maxTokens: 700, temperature: 0.1 }
  );

  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return ket({ ketQua: 'KHONG_TOM_TAT_DUOC', lyDo: 'model không trả JSON' });

  let v;
  try {
    v = JSON.parse(m[0]);
  } catch {
    return ket({ ketQua: 'KHONG_TOM_TAT_DUOC', lyDo: 'JSON hỏng' });
  }

  const kq = {
    tomTat: String(v.summary || '').trim(),
    yChinh: Array.isArray(v.key_points) ? v.key_points : [],
    viecConTreo: Array.isArray(v.open_items) ? v.open_items : [],
    camXuc: ['tich_cuc', 'trung_tinh', 'tieu_cuc'].includes(v.sentiment) ? v.sentiment : 'trung_tinh',
  };

  await sql(`
    insert into public.ai_thread_summary
      (thread_key, content_hash, property_id, message_count, summary, key_points, open_items, sentiment, model, ms)
    values (${q(threadKey)}, ${q(hash)}, ${propertyId ? `'${propertyId}'` : 'null'},
            ${tinNhan.length}, ${q(che(kq.tomTat))},
            ${q(JSON.stringify(kq.yChinh.map(che)))}::jsonb,
            ${q(JSON.stringify(kq.viecConTreo.map(che)))}::jsonb,
            ${q(kq.camXuc)}, ${q(cfg.chat.model)}, ${Date.now() - t0})
    on conflict (thread_key, content_hash) do nothing;`).catch(() => {});

  return ket({ ketQua: 'OK', ...kq });
}
