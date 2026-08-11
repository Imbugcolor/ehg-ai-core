// NHẬN DIỆN Ý ĐỊNH — chốt chặn đặt TRƯỚC cổng tin cậy.
//
// Vì sao cần lớp này: ba loại câu hỏi bị cấm theo hợp đồng với kênh OTA —
// hỏi giá, hỏi phòng trống, xin nâng hạng — luôn được reranker chấm điểm CAO,
// vì kho tri thức có nhiều tài liệu nói về tiền và về phòng. Đo được: câu
// "cho tôi nâng hạng miễn phí" đạt 0.386, cao hơn cả câu hỏi hợp lệ về wifi (0.269).
//
// Không thể phó thác việc chặn chúng cho một con số điểm nổi. Phải chặn bằng
// luật rõ ràng, và trả về câu mẫu hướng dẫn khách liên hệ bộ phận đặt phòng.

import { chat } from './adapters.mjs';
import { cfg } from './env.mjs';

export const Y_DINH_CAM = {
  HOI_GIA: {
    ten: 'hỏi giá phòng',
    mau: `Chào quý khách,

Về giá phòng cho ngày quý khách quan tâm, chúng tôi xin phép chuyển thông tin sang bộ phận đặt phòng để báo giá chính xác nhất, vì giá thay đổi theo thời điểm và hạng phòng còn trống.

Quý khách vui lòng cho biết ngày nhận phòng, ngày trả phòng và số khách để chúng tôi kiểm tra và phản hồi sớm nhất.

Trân trọng,`,
  },
  HOI_PHONG_TRONG: {
    ten: 'hỏi hoặc giữ phòng trống',
    mau: `Chào quý khách,

Tình trạng phòng trống thay đổi liên tục nên chúng tôi cần kiểm tra trực tiếp trên hệ thống trước khi xác nhận với quý khách.

Quý khách vui lòng cho biết ngày lưu trú, số phòng và loại phòng mong muốn, chúng tôi sẽ kiểm tra và phản hồi ngay.

Trân trọng,`,
  },
  XIN_UU_DAI: {
    ten: 'xin nâng hạng, giảm giá hoặc ưu đãi',
    mau: `Chào quý khách,

Cảm ơn quý khách đã quan tâm. Việc nâng hạng phòng và các ưu đãi tuỳ từng thời điểm và tình trạng phòng, nên chúng tôi không thể xác nhận trước qua kênh này.

Chúng tôi đã ghi nhận mong muốn của quý khách và sẽ chuyển tới bộ phận đặt phòng xem xét.

Trân trọng,`,
  },
  YEU_CAU_HANH_DONG: {
    ten: 'yêu cầu hệ thống tự thao tác',
    mau: null, // Không sinh nháp gửi khách — đây là yêu cầu nội bộ, phải người làm.
  },
  KENH_OTA: {
    ten: 'đề nghị huỷ kênh OTA hoặc thanh toán ngoài kênh',
    mau: `Chào quý khách,

Với đặt phòng đã thực hiện qua kênh trực tuyến, mọi thay đổi và thanh toán xin quý khách thực hiện trực tiếp trên chính kênh đó để đảm bảo quyền lợi của quý khách.

Nếu cần hỗ trợ thêm, quý khách vui lòng liên hệ bộ phận đặt phòng của chúng tôi.

Trân trọng,`,
  },
};

// Lớp 1 — luật cứng chạy trên CÂU HỎI, không chạy trên bản nháp. Rủi ro chặn
// nhầm thấp hơn nhiều so với quét bản nháp, vì câu hỏi ngắn và ý định rõ.
const LUAT = [
  // Hỏi giá phòng — KHÔNG bắt nhầm câu hỏi về phụ thu, phí dịch vụ hay chính
  // sách hoàn tiền, vì những thứ đó CÓ trong kho tri thức và trả lời được.
  // Đo được: luật lỏng kiểu /phòng.{0,16}bao nhiêu/ chặn nhầm câu
  // "phụ thu trả phòng muộn bao nhiêu" — một câu hoàn toàn hợp lệ.
  { y: 'HOI_GIA', re: /giá\s*(phòng|phong|room)/i },
  { y: 'HOI_GIA', re: /bảng\s*giá/i },
  { y: 'HOI_GIA', re: /(giá|chi phí)\s*(cho\s*)?(một|1|mỗi)\s*(đêm|ngày|người\/đêm)/i },
  { y: 'HOI_GIA', re: /phòng[^.?]{0,20}(bao nhiêu tiền|giá bao nhiêu|mấy tiền|giá thế nào)/i },
  { y: 'HOI_GIA', re: /(báo giá|quote|niêm yết giá)/i },

  // Phòng trống, giữ phòng, đặt hộ
  { y: 'HOI_PHONG_TRONG', re: /(còn|có)\s*phòng\s*(trống|nào|không)/i },
  { y: 'HOI_PHONG_TRONG', re: /(giữ|book|đặt)\s*(giúp|hộ|cho)\s*(tôi|mình|em)/i },
  { y: 'HOI_PHONG_TRONG', re: /(xác nhận|chắc chắn).{0,20}còn\s*phòng/i },

  // Nâng hạng, giảm giá, ưu đãi
  { y: 'XIN_UU_DAI', re: /(nâng hạng|nâng phòng|upgrade)/i },
  { y: 'XIN_UU_DAI', re: /(giảm giá|discount|bớt giá|giá tốt hơn|rẻ hơn)/i },
  { y: 'XIN_UU_DAI', re: /(miễn phí|free|tặng).{0,24}(phòng|suite|nâng)/i },
  { y: 'XIN_UU_DAI', re: /(khuyến mãi|ưu đãi).{0,16}(cho tôi|cho mình|riêng)/i },

  // Yêu cầu hệ thống tự làm thay người
  { y: 'YEU_CAU_HANH_DONG', re: /(gửi|gởi)\s*(luôn|giúp|hộ|ngay)/i },
  { y: 'YEU_CAU_HANH_DONG', re: /(tự|bạn)\s*(đặt|book|ghi|nhập|duyệt)/i },
  { y: 'YEU_CAU_HANH_DONG', re: /(ghi|nhập|cập nhật)\s*(thẳng\s*)?(vào\s*)?(hệ thống|pms|smile)/i },
  { y: 'YEU_CAU_HANH_DONG', re: /duyệt\s*luôn/i },

  // Chính sách kênh
  { y: 'KENH_OTA', re: /(huỷ|hủy).{0,30}(booking|agoda|expedia|traveloka|ota).{0,30}(đặt trực tiếp|đặt thẳng|rẻ hơn)/i },
  { y: 'KENH_OTA', re: /(chuyển khoản|thanh toán).{0,20}(thẳng|trực tiếp).{0,24}(khỏi|không qua|thay vì)/i },
  { y: 'KENH_OTA', re: /(giá trên|giá ở)\s*(booking|agoda|expedia)/i },
];

export function nhanDienLuat(cauHoi) {
  for (const l of LUAT) if (l.re.test(cauHoi)) return l.y;
  return null;
}

// Lớp 2 — chỉ chạy khi điểm rerank rơi vào VÙNG LẪN. Đo được: dải câu hợp lệ
// và dải câu phải chặn chồng lấn nhau, nên trong vùng đó một con số là không đủ.
// Ngoài vùng lẫn thì bỏ qua để đỡ một lượt gọi model.
const HE_THONG = `Phân loại ý định câu hỏi của khách khách sạn. Trả về DUY NHẤT JSON:
{"y_dinh": "HOI_GIA" | "HOI_PHONG_TRONG" | "XIN_UU_DAI" | "YEU_CAU_HANH_DONG" | "KENH_OTA" | "BINH_THUONG"}

- HOI_GIA: hỏi giá phòng, bảng giá, chi phí lưu trú
- HOI_PHONG_TRONG: hỏi còn phòng, xin giữ phòng, nhờ đặt phòng
- XIN_UU_DAI: xin nâng hạng, giảm giá, ưu đãi riêng
- YEU_CAU_HANH_DONG: yêu cầu chính TRỢ LÝ này tự thao tác — tự gửi thư đi, tự
  đặt phòng, tự ghi vào hệ thống PMS, tự duyệt
- KENH_OTA: rủ huỷ đặt phòng trên kênh OTA để đặt trực tiếp, hoặc thanh toán ngoài kênh
- BINH_THUONG: mọi câu hỏi khác về tiện ích, giờ giấc, chính sách, hướng dẫn

HOI_GIA chỉ tính khi khách hỏi GIÁ THUÊ PHÒNG MỘT ĐÊM là bao nhiêu tiền. Những
thứ sau là BINH_THUONG, không phải HOI_GIA:
- chính sách huỷ phòng, phụ thu, điều kiện hoàn tiền
- chính sách trẻ em: trẻ mấy tuổi được miễn phí, có tính thêm tiền không,
  giường phụ tính thế nào
- giá các DỊCH VỤ ngoài tiền phòng: xe đưa đón, spa, giặt là, bữa sáng thêm,
  gửi hành lý, đỗ xe
Đây đều là chính sách niêm yết, khách có quyền được biết và kho tri thức có sẵn.

Phân biệt cho kỹ: khách nhờ KHÁCH SẠN làm gì đó — sửa điều hoà, dọn phòng, mang
thêm khăn, gọi taxi, ghi nhận khiếu nại — là BINH_THUONG. Đó là nghiệp vụ hằng
ngày, nhân viên vẫn xử lý bình thường. Chỉ tính YEU_CAU_HANH_DONG khi khách bảo
chính trợ lý tự thực hiện một thao tác ra bên ngoài thay người.

Khách phàn nàn kèm câu "gọi mãi không ai lên", "nhắn mấy lần không ai trả lời"
vẫn là BINH_THUONG. Đó là lời than phiền về dịch vụ, không phải mệnh lệnh cho
trợ lý.`;

export async function nhanDienBangModel(cauHoi) {
  let raw = '';
  try {
    raw = await chat(
      [
        { role: 'system', content: HE_THONG },
        { role: 'user', content: cauHoi },
      ],
      { model: cfg.chat.guardModel, maxTokens: 60, temperature: 0 }
    );
  } catch {
    return null; // lỗi thì để cổng tin cậy quyết, không tự cho qua cũng không tự chặn
  }
  const m = raw.match(/"y_dinh"\s*:\s*"([A-Z_]+)"/);
  const y = m?.[1];
  return y && y !== 'BINH_THUONG' && Y_DINH_CAM[y] ? y : null;
}
