// GUARDRAIL — hai lớp, và là cổng BẮT BUỘC.
//
// Không xuất ra hàm nào cho phép sinh văn bản mà bỏ qua guardrail. Lý do:
// nếu để nó thành một hàm gọi ở cuối, sớm muộn sẽ có đường code nào đó quên gọi.
//
// Lớp 1 — luật cứng: chỉ bắt những thứ KHÔNG THỂ xuất hiện hợp lệ.
//   Bài học đo được: luật thô kiểu /còn phòng/ chặn nhầm câu
//   "nhận phòng sớm nếu còn phòng trống" — một câu hoàn toàn đúng.
//   Guardrail chặn nhầm câu đúng còn tệ hơn không có guardrail.
//
// Lớp 2 — model kiểm: xử lý phủ định, thứ luật cứng không phân biệt được.
//   "không thể hứa nâng hạng miễn phí" và "sẽ nâng hạng miễn phí cho quý khách"
//   chỉ khác một chữ mà hậu quả ngược hẳn.

import { chat } from './adapters.mjs';
import { cfg } from './env.mjs';

export const DIEU_CAM = [
  'Báo GIÁ THUÊ PHÒNG MỖI ĐÊM bằng số tiền, ví dụ "phòng Deluxe 2 triệu một đêm". ' +
    'CHỈ giá thuê phòng mỗi đêm mới bị cấm, vì giá đó thay đổi theo ngày và do ' +
    'bộ phận đặt phòng quyết định',
  'Khẳng định chắc chắn còn phòng trống cho một ngày cụ thể',
  'Hứa nâng hạng phòng miễn phí hoặc hứa ưu đãi không có trong tri thức',
  'Mời khách huỷ đặt phòng trên kênh OTA để đặt trực tiếp',
  'Chào giá thấp hơn giá trên kênh OTA',
  'Đề nghị thanh toán ngoài kênh chính thức của khách sạn',
  'Tiết lộ thông tin của khách sạn khác ngoài phạm vi người dùng được phép',
  'Tự nhận đã gửi thư cho khách hoặc đã thực hiện thao tác thay nhân viên',
];

const LUAT_CUNG = [
  {
    re: /giá\s*phòng[^.]{0,40}?\b\d[\d.,]*\s*(nghìn|triệu|vnd|đồng|k)\b/i,
    ly: 'nêu giá phòng bằng số tiền cụ thể',
  },
  {
    re: /(chúng tôi|khách sạn)\s*(xin\s*)?(cam kết|đảm bảo)\s*(sẽ\s*)?(còn|có)\s*phòng/i,
    ly: 'cam kết còn phòng',
  },
  {
    re: /(huỷ|hủy)\s*(đặt phòng\s*)?(trên|qua|ở)\s*(ota|booking|agoda|expedia)[^.]{0,40}(đặt trực tiếp|đặt thẳng)/i,
    ly: 'mời khách huỷ OTA để đặt trực tiếp',
  },
  {
    re: /(tôi|em|mình)\s*(đã|vừa)\s*(gửi|gởi)\s*(thư|email|mail)\s*(cho|tới|đến)\s*(khách|quý khách)/i,
    ly: 'tự nhận đã gửi thư cho khách',
  },
];

const HE_THONG_KIEM = `Bạn kiểm duyệt bản nháp thư khách sạn trước khi nhân viên nhìn thấy.
Trả về DUY NHẤT một JSON: {"vi_pham": true|false, "ly_do": "..."}

Đánh dấu vi_pham = true CHỈ KHI bản nháp thực sự làm một trong các việc sau:
${DIEU_CAM.map((d, i) => `${i + 1}. ${d}`).join('\n')}

Trước khi kết luận vi phạm, hãy đối chiếu danh sách ĐƯỢC PHÉP dưới đây. Nếu bản
nháp rơi vào một trong các mục này thì vi_pham = false, kể cả khi nó có nhắc tới
tiền bạc hay phòng ốc:
- Nêu giá của DỊCH VỤ ngoài tiền phòng: xe đưa đón, spa, giặt là, bữa ăn, thuê
  xe máy, tour. Đây là bảng giá niêm yết, khách có quyền được biết.
- Nêu tỉ lệ phụ thu, phí nhận phòng sớm, phí trả phòng muộn, mức phạt huỷ,
  tiền đặt cọc — miễn là lấy từ chính sách khách sạn.
- Mô tả điều kiện, thủ tục, giờ giấc, tiện nghi, chính sách trẻ em, thú cưng.
- TỪ CHỐI, nói KHÔNG THỂ, hoặc hướng dẫn khách liên hệ bộ phận đặt phòng về
  những điều bị cấm. Từ chối đúng cách là hành vi mong muốn.

Chỉ đánh dấu vi phạm khi bản nháp thực sự làm điều bị cấm, không phải khi nó
chỉ nhắc tới chủ đề gần giống. Chặn nhầm một bản nháp đúng gây hại nhiều hơn.`;

export async function kiemDuyet(banNhap) {
  for (const g of LUAT_CUNG) {
    if (g.re.test(banNhap)) return { viPham: true, lyDo: g.ly, lop: 1 };
  }

  let raw = '';
  try {
    raw = await chat(
      [
        { role: 'system', content: HE_THONG_KIEM },
        { role: 'user', content: banNhap },
      ],
      { model: cfg.chat.guardModel, maxTokens: 200, temperature: 0 }
    );
  } catch {
    // Model kiểm lỗi thì KHÔNG cho qua im lặng — báo để người xem.
    return { viPham: true, lyDo: 'không kiểm duyệt được, cần người xem', lop: 2 };
  }

  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return { viPham: false, lop: 2 };
  try {
    const v = JSON.parse(m[0]);
    return v.vi_pham
      ? { viPham: true, lyDo: v.ly_do || 'model kiểm duyệt từ chối', lop: 2 }
      : { viPham: false, lop: 2 };
  } catch {
    return { viPham: false, lop: 2 };
  }
}
