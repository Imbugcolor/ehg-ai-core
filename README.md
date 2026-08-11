# ehg-ai-core

**COH — HM3 AI Core.** Sinh bản nháp trả lời khách, có dẫn nguồn từ kho tri thức.
Không đủ cơ sở thì từ chối chứ không bịa.

AI **chỉ soạn nháp**. Không tự gửi, không tự duyệt, không tự ghi vào PMS —
nhân viên đọc, sửa rồi mới bấm gửi.

> Đây là bản dựng thử trên dữ liệu **giả lập**, chạy trên project Supabase
> riêng. Không có dữ liệu thật nào của khách sạn hay của khách trong repo này.

---

## Soạn thêm tri thức — phần dành cho người viết nội dung

Đây là việc quan trọng nhất và **không cần biết lập trình**. Kho tri thức quyết
định phần lớn chất lượng câu trả lời: AI chỉ được dùng thông tin trong kho, nên
kho thiếu là AI từ chối, kho sai là AI trả lời sai.

Tri thức nằm ở [`data/kb/`](data/kb/), viết bằng tệp văn bản thường. Soạn trên
Word rồi dán vào cũng được.

### Cách viết

```markdown
---
scope: property
property_code: BIENXANH
property_name: Khách sạn Biển Xanh
lang: vi
status: approved
---

## Giờ nhận phòng và trả phòng tại Biển Xanh

Giờ nhận phòng tại Biển Xanh là 14 giờ, giờ trả phòng là 12 giờ trưa.

Khách đến sớm có thể gửi hành lý tại quầy lễ tân và dùng hồ bơi trong lúc chờ.

## Bữa sáng tại Biển Xanh

Bữa sáng phục vụ tại nhà hàng tầng 2, từ 6 giờ đến 10 giờ mỗi ngày.
```

Ba quy tắc, chỉ vậy thôi:

1. **Phần đầu tệp** khai báo tệp này thuộc khách sạn nào. Tri thức áp dụng cho
   cả chuỗi thì để `scope: chung` và bỏ hai dòng `property_*`.
2. **Mỗi tiêu đề `##` là một tài liệu.** Đặt tên đúng nội dung bên trong — đừng
   gom nhiều chủ đề rời rạc vào một tài liệu.
3. **Mỗi đoạn văn là một ý độc lập**, đọc riêng vẫn hiểu được. Hệ thống cắt theo
   đoạn, nên một đoạn phụ thuộc vào đoạn trước sẽ mất ngữ cảnh khi bị lấy ra.

### Hai điều tuyệt đối không đưa vào kho

- **Giá thuê phòng.** Chính sách cấm AI báo giá phòng. Giá đổi theo ngày và do
  bộ phận đặt phòng quyết định. Không có trong kho thì AI không có gì để lỡ
  miệng. Giá dịch vụ khác — xe đưa đón, spa, giặt là, bữa sáng thêm — thì được.
- **Dữ liệu thật của khách.** Không email, không số điện thoại, không tên khách,
  không mã đặt phòng thật.

### Viết xong thì làm gì

Gửi lại cho người phụ trách kỹ thuật nạp vào, hoặc tự chạy `npm run nap-kb`.
Chạy lại nhiều lần cho ra cùng kết quả — tài liệu cùng tiêu đề bị thay chứ
không nhân đôi.

### Kho thiếu chủ đề nào thì AI từ chối, không sao cả

Từ chối đúng còn hơn bịa. Nhưng nếu thấy AI từ chối một câu mà lẽ ra phải trả
lời được, đó là dấu hiệu kho đang thiếu — báo lại để bổ sung.

---

## Chạy thử

```bash
npm install
cp .env.example .env      # điền khoá của bạn vào
npm run nap-kb            # nạp tri thức
npm run dev               # mở http://localhost:5173
```

Cần Node 20 trở lên và một project Supabase đã chạy các migration trong
[`supabase/migrations/`](supabase/migrations/).

---

## Bốn bộ đo, phải chạy đủ cả bốn

Ba bộ đầu đo ba hướng hỏng khác nhau và **không thay thế được cho nhau**. Một hệ
thống chặn tất cả đạt 100% ở bộ tấn công và 0% ở bộ độ phủ; một hệ thống trả lời
tất cả thì ngược lại. Chỉ đọc một con số là tự lừa mình.

| Lệnh | Đo cái gì | Mốc hiện tại |
|---|---|---|
| `npm run do-tan-cong` | có chặn được thứ phải chặn không | 30/30 · 0 rò rỉ phạm vi |
| `npm run do-phu-song` | có trả lời được thứ phải trả lời không | 17/17 và 5/5 từ chối đúng |
| `npm run do-guardrail` | có **chặn nhầm câu đúng** không | 12/12 lọt và 8/8 chặn |
| `npm run do-tieng-anh` | khách nước ngoài có dùng được không | 11/11 · 4/4 · 14/14 · 2/2 |
| `npm run do-nhieu-luot` | câu nối tiếp, cache lẫn, tấn công chia nhỏ | tất cả đúng |
| `npm run do-giao-dien` | luồng sửa bản nháp còn nguyên không | 30/30 |
| `npm run hieu-chuan` | ngưỡng tin cậy đặt ở đâu | ra `RAG_THRESHOLD` |

Bộ đo giao diện cần `jsdom`, đã có trong `devDependencies`.

**Mọi con số trên đo bằng tri thức giả lập và câu hỏi tự soạn.** Chúng chứng
minh cơ chế chạy đúng, không chứng minh hệ thống chạy tốt với mail khách thật.

---

## Đổi model hoặc đổi bộ tri thức

Đọc [`docs/doi-model-va-tri-thuc.md`](docs/doi-model-va-tri-thuc.md) trước khi
đụng vào. Có loại đổi xong **hỏng im lặng không báo lỗi** — đổi model xếp hạng
mà quên hiệu chuẩn lại ngưỡng thì hệ thống chặn sạch câu hợp lệ hoặc mở toang
cho câu không đủ cơ sở, mà không có một dòng lỗi nào.

---

## Cấu trúc

| Thư mục | Nội dung |
|---|---|
| `modules/ai-core/` | Phần lõi. `index.mjs` là cổng duy nhất, không có đường nào vòng qua guardrail |
| `data/kb/` | Bộ tri thức giả lập |
| `supabase/migrations/` | Lược đồ cơ sở dữ liệu, RLS, nhật ký chỉ ghi thêm |
| `scripts/` | Nạp tri thức, hiệu chuẩn, bốn bộ đo |
| `server/` | Giao diện thử. **Không phải sản phẩm** — có bộ khung của team thì bỏ đi, phần lõi giữ nguyên |
| `docs/` | Tài liệu vận hành |

### Quy ước đặt tên

Lược đồ cơ sở dữ liệu dùng **tiếng Anh**, mã nguồn và bình luận dùng tiếng Việt.
Ranh giới đặt ở đó vì lược đồ là hợp đồng — nó đi ra ngoài, được công cụ khác
đọc, và sống lâu hơn code.

| Quy ước | Ví dụ |
|---|---|
| snake_case toàn bộ | `booking_segment`, `guest_email` |
| tên bảng là danh từ **số ít** | `booking` chứ không phải `bookings` |
| boolean mở đầu `is_` hoặc `has_` | `is_active`, `is_disabled` |
| mốc thời gian kết thúc `_at` | `created_at`, `expires_at` |
| khoá ngoại là `<bảng>_id` | `property_id`, `booking_id` |
| số đếm `_count`, tỉ lệ `_ratio` | `adult_count`, `edit_ratio` |
| đơn vị trong tên khi dễ nhầm | `daily_limit_usd`, `duration_ms` |

**Giá trị enum vẫn giữ tiếng Việt** — `toan_he`, `tinh_nang`, `HOI_GIA`,
`xin_loi_su_co`. Đó là từ vựng nghiệp vụ chứ không phải tên kỹ thuật, và chúng
nằm trong prompt gửi cho model — đổi là phải hiệu chuẩn và đo lại toàn bộ.

### Khoá và bí mật

Mọi khoá nằm trong `.env`, đã bị `.gitignore` chặn. `.env.example` liệt kê các
biến cần điền, không chứa giá trị thật. **Không commit `.env`.**
