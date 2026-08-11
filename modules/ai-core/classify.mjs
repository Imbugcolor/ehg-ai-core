// Phân loại ý định nghiệp vụ và cảm xúc (HM3.5).
//
// MỘT service duy nhất, dùng chung với HM4.7 bên luồng OTA — thiết kế ghi rõ
// "dùng chung service với M2.7, không trùng lặp mô hình".
//
// Khác với intent.mjs: file kia nhận diện Ý ĐỊNH BỊ CẤM để chặn, chạy trước RAG.
// File này gắn NHÃN NGHIỆP VỤ để định tuyến và thống kê, chạy song song.

import { chat } from './adapters.mjs';
import { cfg } from './env.mjs';

export const NHAN = {
  DAT_PHONG: 'Hỏi đặt phòng mới, tìm hiểu trước khi đặt',
  SUA_HUY: 'Sửa hoặc huỷ đặt phòng đã có',
  XAC_NHAN: 'Xác nhận lại đặt phòng, hỏi tình trạng đơn',
  HOI_TIEN_ICH: 'Hỏi tiện ích và dịch vụ: hồ bơi, bữa sáng, wifi, spa',
  HOI_CHINH_SACH: 'Hỏi chính sách: huỷ phòng, trẻ em, thú cưng, hút thuốc',
  HOI_DUONG_DI: 'Hỏi đường đi, đưa đón sân bay, phương tiện',
  YEU_CAU_DAC_BIET: 'Yêu cầu đặc biệt: giường phụ, tầng cao, trang trí, ăn kiêng',
  KHIEU_NAI: 'Phàn nàn, khiếu nại về phòng hoặc dịch vụ',
  THANH_TOAN: 'Thanh toán, hoá đơn, đặt cọc, hoàn tiền',
  DOAN_B2B: 'Khách đoàn, công ty, hội nghị, rooming list',
  KHEN_NGOI: 'Khen ngợi, cảm ơn, phản hồi tích cực',
  KHAC: 'Không thuộc các nhóm trên',
};

const HE_THONG = `Phân loại tin nhắn của khách khách sạn. Trả về DUY NHẤT một JSON:
{"nhan":"...", "cam_xuc":"tich_cuc|trung_tinh|tieu_cuc", "do_gap":"thap|trung|cao"}

NHÃN, chọn đúng một:
${Object.entries(NHAN).map(([k, v]) => `- ${k}: ${v}`).join('\n')}

CẢM XÚC: tich_cuc nếu khách hài lòng hoặc cảm ơn · tieu_cuc nếu khách bực bội,
thất vọng, doạ đánh giá xấu · trung_tinh với câu hỏi thông thường.

ĐỘ GẤP: cao nếu khách đang lưu trú và gặp sự cố, hoặc sắp đến trong 24 giờ,
hoặc đang bực · trung nếu có mốc thời gian cụ thể · thap với câu hỏi tìm hiểu.`;

/**
 * @returns {{nhan:string, camXuc:string, doGap:string} | null}
 */
export async function phanLoai(noiDung) {
  let raw;
  try {
    raw = await chat(
      [
        { role: 'system', content: HE_THONG },
        { role: 'user', content: noiDung },
      ],
      { model: cfg.chat.guardModel, maxTokens: 80, temperature: 0 }
    );
  } catch {
    return null; // phân loại hỏng không được làm hỏng luồng chính
  }

  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const v = JSON.parse(m[0]);
    const nhan = NHAN[v.nhan] ? v.nhan : 'KHAC';
    const camXuc = ['tich_cuc', 'trung_tinh', 'tieu_cuc'].includes(v.sentiment) ? v.sentiment : 'trung_tinh';
    const doGap = ['thap', 'trung', 'cao'].includes(v.urgency) ? v.urgency : 'thap';
    return { nhan, camXuc, doGap };
  } catch {
    return null;
  }
}

/** Cảm xúc tiêu cực hoặc độ gấp cao thì nâng mức ưu tiên trong hàng đợi (HM6). */
export function canUuTien(kq) {
  return !!kq && (kq.camXuc === 'tieu_cuc' || kq.doGap === 'cao' || kq.nhan === 'KHIEU_NAI');
}
