// CHUẨN BỊ TRUY VẤN — biến câu khách gõ thành câu dùng để đi tìm.
//
// Câu khách gõ và câu dùng để tra kho là hai thứ khác nhau. Hiện có một việc
// cần làm ở đây, và sắp có việc thứ hai:
//
//   1. Câu hỏi không phải tiếng Việt  ->  dịch sang tiếng Việt trước khi tìm
//   2. (sắp tới) Câu hỏi nối tiếp     ->  viết lại thành câu độc lập
//
// Cả hai đều là cùng một ý: kho tri thức viết bằng tiếng Việt và mỗi đoạn đứng
// độc lập, nên câu đi tìm phải ở dạng gần với kho nhất có thể.
//
// ── Vì sao dịch chứ không tìm thẳng ────────────────────────────────────────
//
// Model embedding và xếp hạng đều đa ngôn ngữ, nên câu tiếng Anh VẪN tra được
// tài liệu tiếng Việt. Nhưng đo trên 23 câu thì tìm thẳng kém hơn rõ:
//
//                        tách đúng     sàn của nhóm đúng
//   tìm thẳng tiếng Anh   18/23         0,070
//   dịch rồi mới tìm      20/23         0,198
//
// Con số đáng lo không phải tỉ lệ mà là cái sàn. Tìm thẳng thì câu hỏi hợp lệ
// "what is the wifi password?" chỉ được 0,070 — lẫn hẳn vào vùng nhiễu của
// những câu kho không có. Không ngưỡng nào tách được ở mức đó.
//
// Đổi lại là một lượt gọi model rẻ nằm trên đường găng. Chấp nhận được: đó là
// model nhỏ, ít token, và chỉ chạy khi khách không nói tiếng Việt.

import { chat } from './adapters.mjs';
import { cfg } from './env.mjs';

const NGON_NGU_KHO = 'vi';

const HE_THONG_DICH = `Dịch câu hỏi của khách khách sạn sang tiếng Việt tự nhiên.

Chỉ trả về đúng câu đã dịch. Không thêm lời dẫn, không giải thích, không dịch
kèm bản gốc.

Giữ nguyên tên riêng, số hiệu đặt phòng, ngày giờ và số liệu. Nếu câu đã là
tiếng Việt thì trả lại y nguyên.`;

/**
 * Trả về câu dùng để đi tìm trong kho.
 *
 * Không bao giờ ném lỗi ra ngoài: dịch hỏng thì dùng lại câu gốc. Tìm bằng câu
 * gốc cho điểm thấp hơn nhưng vẫn ra kết quả — còn hơn là cả lượt hỏi thất bại
 * vì một bước phụ trợ.
 */
export async function chuanBiTruyVan(cauHoi, lang = 'vi') {
  if (!lang || lang === NGON_NGU_KHO) return { truyVan: cauHoi, daDich: false };

  try {
    const dich = (
      await chat(
        [
          { role: 'system', content: HE_THONG_DICH },
          { role: 'user', content: cauHoi },
        ],
        { model: cfg.chat.guardModel, maxTokens: 200, temperature: 0 }
      )
    ).trim();

    // Bản dịch rỗng hoặc dài bất thường là dấu hiệu model trả về lời giải thích
    // thay vì câu dịch. Lúc đó dùng câu gốc an toàn hơn.
    if (!dich || dich.length > cauHoi.length * 3 + 60) {
      return { truyVan: cauHoi, daDich: false };
    }
    return { truyVan: dich, daDich: true };
  } catch {
    return { truyVan: cauHoi, daDich: false };
  }
}
