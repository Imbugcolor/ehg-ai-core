# Đổi model hoặc đổi bộ tri thức — phải làm gì

Bốn thứ có thể đổi độc lập nhau: **chat · kiểm duyệt · xếp hạng · embedding**, cộng
thêm **bộ tri thức**. Mức công việc chênh nhau rất xa, và thứ nguy hiểm nhất
không phải thứ nặng nhất — mà là thứ hỏng im lặng.

| Đổi cái gì | Nạp lại tri thức | Migration | Hiệu chuẩn lại | Hỏng kiểu gì nếu quên |
|---|---|---|---|---|
| Model chat | không | không | không | thấy ngay: nháp sai giọng, sai định dạng |
| Model kiểm duyệt | không | không | không | **im lặng**: chặn nhầm câu đúng |
| Model xếp hạng | không | không | **bắt buộc** | **im lặng**: chặn sạch hoặc mở toang |
| Model embedding | **toàn bộ** | nếu đổi số chiều | bắt buộc | thấy ngay: lỗi số chiều, hoặc điểm rác |
| Bộ tri thức | phần đã sửa | không | nên | bộ đo báo sai chỗ |

---

## 1. Đổi model chat — nhẹ nhất

```
CHAT_MODEL=...
CHAT_MODEL_FALLBACK=...,...
```

Kiểm hai thứ trước khi tin:

- **Model có suy luận nội bộ không.** Đo được: `gemini-2.5-flash` và `gpt-5-mini`
  tiêu hết `max_tokens` vào phần suy luận rồi trả về chuỗi rỗng. `adapters.mjs`
  đã gửi `reasoning: {enabled:false}` cho OpenRouter, nhưng nhà cung cấp khác
  có thể dùng tên tham số khác.
- **Model có tuân quy tắc 2 và 4 không** — tự nhận không đủ cơ sở, và bỏ qua
  chỉ dẫn cài trong câu hỏi khách. Không phải model nào cũng chịu.

Sau khi đổi:

```
node scripts/attack-test.mjs      # 30/30
node scripts/phu-song-test.mjs    # 17/17 và 5/5
```

Rồi tăng `PHIEN_BAN_LUAT` trong `modules/ai-core/cache.mjs` — nháp cũ trong cache
do model cũ viết, không còn đại diện cho model mới.

---

## 2. Đổi model kiểm duyệt — nhẹ tay nhưng dễ vỡ

```
GUARD_MODEL=...
```

**Bắt buộc** `node scripts/guardrail-test.mjs`, phải đạt **12/12 lọt · 8/8 chặn**.

Đây là chỗ dễ vỡ nhất trong cả hệ thống, vì các model chênh nhau rất xa về mức
độ "nhiệt tình" chặn. Đã hỏng hai lần trong lúc dựng: một lần chặn câu nói phụ
thu 30% giá phòng, một lần chặn cả bảng giá xe đưa đón sân bay. Cả hai đều là
câu đúng, và cả hai đều **không báo lỗi gì** — chỉ lặng lẽ trả `BI_CHAN`.

Nếu bộ đo tụt ở cột "phải lọt", sửa `DIEU_CAM` và phần **ĐƯỢC PHÉP** trong
`HE_THONG_KIEM` cho hẹp lại, đừng sửa bằng cách bỏ bớt câu đo.

---

## 3. Đổi model xếp hạng — nguy hiểm nhất

```
RERANK_MODEL=...
```

Thang điểm giữa các reranker **không so sánh được với nhau**. Đo được: cùng một
đoạn đúng, Cohere v3.5 cho 0,42 còn Jina v2 cho 0,15. Mang ngưỡng cũ sang model
mới là chặn sạch câu hợp lệ, hoặc mở toang cho câu không đủ cơ sở — mà không có
một dòng lỗi nào.

Bắt buộc theo đúng thứ tự:

```
node scripts/calibrate.mjs        # in ra ngưỡng đề nghị
```

Đặt vào `.env`: `RAG_THRESHOLD=<số vừa in>`

Rồi chỉnh **ba hằng số** trong `modules/ai-core/index.mjs` — chúng đều nằm trên
thang điểm của reranker nên đều trôi theo:

| Hằng số | Hiện tại | Ý nghĩa |
|---|---|---|
| `SAN_CUU` | 0,14 | sàn cứng của đường cứu vớt, dưới mức này không cứu |
| `BOI_CACH_BIET` | 1,1 | đoạn đầu phải hơn đoạn của tài liệu khác bao nhiêu lần |
| `VUNG_LAN` | ngưỡng + 0,15 | dải điểm phải hỏi thêm model về ý định |

Cách đặt lại nhanh: giữ nguyên **tỉ lệ** so với ngưỡng mới. Ngưỡng cũ 0,26 và
`SAN_CUU` 0,14 tức là 0,54 lần ngưỡng; `VUNG_LAN` rộng 0,58 lần ngưỡng. Đó là
điểm khởi đầu để đo, không phải kết luận.

Sau đó chạy lại `attack-test` **và** `phu-song-test`. Chỉ chạy một bộ là tự lừa
mình: khoá cứng mọi thứ thì `attack-test` đạt 100% mà hệ thống thành vô dụng.

Cuối cùng tăng `PHIEN_BAN_LUAT`.

Không cần nạp lại tri thức — reranker không đụng tới vector.

---

## 4. Đổi model embedding — nặng nhất, khó đảo ngược nhất

```
EMBEDDING_MODEL=...
EMBEDDING_DIM=...
```

### Nếu số chiều vẫn là 768

```
EMBEDDING_VERSION_OVERRIDE=v5-<tên-model> node scripts/ingest-kb.mjs
```

Phải nạp lại **toàn bộ**. Vector của hai model khác nhau không so sánh được với
nhau, nên tuyệt đối không để lẫn hai phiên bản trong cùng bảng. Kiểm bằng câu
cuối mà `ingest-kb.mjs` in ra: `so_phien_ban` phải bằng 1.

### Nếu số chiều khác 768 — phải viết migration

`vector(768)` viết cứng ở **bốn chỗ**, không đọc từ `.env`:

- `kb_chunk.embedding` — `supabase/migrations/20260807120000_kb_core.sql:109`
- chữ ký `kb_search` — cùng tệp, dòng 203
- chữ ký `kb_search_hybrid` — `20260807140000_kb_hybrid.sql:199`
- chữ ký `kb_search_hybrid` bản OR — `20260807150000_kb_tsquery_or.sql:35`

Migration phải: xoá index HNSW → `alter column ... type vector(N)` → tạo lại
index → `create or replace` cả ba hàm với chữ ký mới.

**Giới hạn của pgvector**, kiểm trước khi chọn model:

- index HNSW trên kiểu `vector`: tối đa **2000 chiều**
- trên kiểu `halfvec`: tối đa **4000 chiều**

Model 3072 chiều như `text-embedding-3-large` buộc phải dùng `halfvec`, hoặc
giảm chiều nếu nhà cung cấp hỗ trợ (`dimensions` của OpenAI, Matryoshka của
Jina). Giảm chiều rẻ hơn nhiều so với đổi kiểu cột.

### Sau khi nạp lại, dù chiều có đổi hay không

Hiệu chuẩn lại ngưỡng. Đổi embedding làm đổi **tập ứng viên** đưa vào reranker,
nên phân bố điểm đổi theo dù reranker giữ nguyên:

```
node scripts/calibrate.mjs
node scripts/attack-test.mjs
node scripts/phu-song-test.mjs
```

Cache tự hết hiệu lực: `kb_version()` lấy từ `max(updated_at)` của `kb_document`,
nạp lại là tự đổi.

---

## 5. Đổi bộ tri thức

```
node scripts/ingest-kb.mjs
```

Chạy lại nhiều lần cho ra cùng kết quả — tài liệu cùng tiêu đề bị xoá trước khi
nạp. Không cần ai nhớ tăng số phiên bản: `kb_version()` đọc từ `max(updated_at)`
nên cache tự hết hiệu lực.

**Nhưng `PHIEN_BAN_LUAT` không tự đổi.** Nó chỉ dành cho đổi luật (ngưỡng, điều
cấm, prompt). Đừng tăng nó khi chỉ sửa tri thức — sẽ xoá cache một cách vô ích.

### Phải cập nhật bộ đo, nếu không bộ đo sẽ nói dối

Đây là chỗ đã sai một lần, nên viết rõ:

**`scripts/phu-song-test.mjs`** — mọi câu trong `CAU_HOI` phải được **đối chiếu
với kho thật** trước khi đưa vào. Lần đầu soạn bộ này có ba câu đoán bừa — bữa
tối, quãng đường từ Hà Nội, đồ thất lạc — mà kho không hề có nội dung nào. Bộ đo
báo "từ chối oan" trong khi hệ thống làm đúng. Câu nào kho không có phải nằm ở
`NGOAI_KHO`. Kiểm nhanh:

```sql
select distinct d.title from public.kb_chunk c
join public.kb_document d on d.id = c.document_id
where c.content ilike '%<từ khoá>%';
```

**`scripts/attack-test.mjs`** — danh sách `DE_CU` tự đối chiếu với kho rồi, chuỗi
nào có ở cả hai bên hoặc nằm trong tri thức dùng chung sẽ tự bị loại. Nhưng nó
đang viết cứng cho **đúng hai khách sạn**: dòng `const kia = code === 'BIENXANH'
? 'NUIDOI' : 'BIENXANH'`. Thêm khách sạn thứ ba là phải sửa chỗ này thành so với
tất cả các khách sạn khác.

**`scripts/calibrate.mjs`** — hai nhóm câu hỏi phải phản ánh kho mới, nếu không
ngưỡng hiệu chuẩn ra sẽ lệch.

### Thêm khách sạn mới

Thêm bản ghi `property` và `user_property`. RLS đã xử lý phạm vi sẵn, không cần
sửa chính sách. Nhưng nhớ sửa `attack-test.mjs` như trên, và thêm câu hỏi của
khách sạn mới vào `phu-song-test.mjs` — nếu không thì không có gì chứng minh
khách sạn mới không đọc được dữ liệu của khách sạn cũ.

---

## Thứ tự an toàn khi đổi nhiều thứ cùng lúc

Đổi từng thứ một, đo xong mới đổi tiếp. Nếu buộc phải đổi cả embedding lẫn
rerank:

1. Đổi embedding, nạp lại, kiểm `so_phien_ban = 1`
2. Đổi rerank
3. `calibrate.mjs` **một lần** ở cấu hình cuối
4. Chỉnh `SAN_CUU`, `BOI_CACH_BIET`
5. Chạy cả bốn bộ đo
6. Tăng `PHIEN_BAN_LUAT`

Đảo thứ tự 3 và 1 là hiệu chuẩn trên tập ứng viên cũ, ra ngưỡng sai.

---

## Bốn bộ đo, và tại sao phải chạy đủ cả bốn

| Bộ đo | Trả lời câu hỏi gì | Mốc hiện tại |
|---|---|---|
| `attack-test.mjs` | có chặn được thứ phải chặn không | 30/30, 0 rò rỉ |
| `phu-song-test.mjs` | có trả lời được thứ phải trả lời không | 17/17 và 5/5 |
| `guardrail-test.mjs` | có chặn nhầm câu đúng không | 12/12 và 8/8 |
| `calibrate.mjs` | ngưỡng đặt ở đâu | ra `RAG_THRESHOLD` |

Ba bộ đầu đo ba hướng hỏng khác nhau và **không thay thế được cho nhau**. Một hệ
thống chặn tất cả đạt 100% ở bộ 1 và 0% ở bộ 2. Một hệ thống trả lời tất cả thì
ngược lại. Chỉ đọc một con số là tự lừa mình.

---

## Điều cần biết về các con số hiện tại

Mọi mốc trên đo trên **bộ tri thức giả lập** (32 tài liệu, 2 khách sạn) và **câu
hỏi tự soạn**, chưa có mail khách thật. `BOI_CACH_BIET = 1,1` chỉnh trên 48 mẫu.
Khi có dữ liệu thật phải đo lại toàn bộ, và nhiều khả năng các hằng số sẽ đổi.
