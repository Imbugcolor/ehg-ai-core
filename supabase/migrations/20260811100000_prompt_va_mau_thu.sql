-- PROMPT RA CẤU HÌNH (HM3.9) và THƯ MẪU THEO TÌNH HUỐNG (HM3.6).
--
-- Tiêu chí nghiệm thu ghi "model/prompt có thể thay đổi bằng cấu hình". Model
-- thì đã đổi được qua biến môi trường, nhưng prompt vẫn viết cứng trong code —
-- sửa một câu hướng dẫn phải triển khai lại cả hệ thống.
--
-- Hai bảng dưới đây theo đúng lối đã làm với giọng văn: nội dung nằm ở cơ sở dữ
-- liệu, code chỉ đọc. Khác một điểm quan trọng — prompt KHÔNG phải nội dung
-- nghiệp vụ tự sửa thoải mái như giọng văn. Sửa sai một dòng trong prompt factsạn
-- nháp là hỏng cả hệ thống, nên bảng prompt giữ lịch sử và có bản mặc định
-- trong code làm lưới đỡ khi bảng trống hoặc lỗi.

-- ══════════════════════════════════════════════════════════════════════════
-- 1. PROMPT
-- ══════════════════════════════════════════════════════════════════════════

create table if not exists public.ai_prompt (
  id           uuid primary key default gen_random_uuid(),
  key         text not null
               check (key in ('soan_nhap', 'kiem_duyet', 'tom_tat', 'phan_loai', 'viet_lai_cau_hoi')),
  lang     text not null default 'vi',
  body     text not null,
  note      text,

  -- Mỗi khoá chỉ có ĐÚNG MỘT bản đang dùng. Các bản cũ giữ lại để đối chiếu khi
  -- chất lượng bản nháp tụt after_data một lần sửa prompt.
  is_active    boolean not null default false,
  version    int not null default 1,

  updated_by uuid references auth.users (id),
  updated_at timestamptz not null default now(),
  created_at      timestamptz not null default now()
);

comment on table public.ai_prompt is
  'Prompt của từng khâu. Đổi được bằng cấu hình, không cần triển khai lại code. '
  'Code có bản mặc định làm lưới đỡ khi bảng trống.';

-- Ràng buộc "một bản đang dùng cho mỗi khoá và ngôn ngữ" ở tầng dữ liệu.
-- Để ở tầng ứng dụng thì sớm muộn cũng có hai bản cùng bật, và lúc đó hệ thống
-- chạy bằng prompt nào là chuyện may rủi.
create unique index if not exists ai_prompt_mot_ban_dang_dung
  on public.ai_prompt (key, lang) where is_active;

create index if not exists ai_prompt_khoa_idx on public.ai_prompt (key, lang);

alter table public.ai_prompt enable row level security;

-- Prompt là cấu hình vận hành, không phải dữ liệu khách sạn — không phân phạm
-- vi theo khách sạn. Nhưng cũng không để người dùng thường đọc: nó lộ toàn bộ
-- luật chặn, biết luật thì viết câu lách dễ hơn nhiều.
drop policy if exists ai_prompt_khong_cho_doc on public.ai_prompt;
create policy ai_prompt_khong_cho_doc
  on public.ai_prompt for select
  to authenticated
  using (false);

-- ══════════════════════════════════════════════════════════════════════════
-- 2. THƯ MẪU THEO TÌNH HUỐNG
-- ══════════════════════════════════════════════════════════════════════════
--
-- Khác giọng văn ở chỗ: giọng văn nói "viết thế nào", thư mẫu nói "viết cái gì".
-- Có tình huống mà câu trả lời gần như cố định — xin lỗi sự cố, xác nhận đã
-- ghi nhận yêu cầu, hướng dẫn liên hệ bộ phận đặt phòng. Những câu đó để model
-- tự nghĩ mỗi lần một kiểu thì vừa tốn tiền vừa không đều.

create table if not exists public.ai_reply_template (
  id           uuid primary key default gen_random_uuid(),
  property_id  uuid references public.property (id) on delete cascade,  -- NULL = cả chuỗi
  situation   text not null
               check (situation in (
                 'xin_loi_su_co',        -- khách phàn nàn về sự cố trong phòng
                 'ghi_nhan_yeu_cau',     -- đã nhận yêu cầu, sẽ phản hồi
                 'chuyen_dat_phong',     -- chuyển câu hỏi giá/phòng trống sang bộ phận đặt phòng
                 'cam_on_khen_ngoi',     -- khách khen
                 'huong_dan_duong_di',   -- chỉ đường tới khách sạn
                 'xac_nhan_thong_tin',   -- xác nhận lại thông tin đặt phòng khách cung cấp
                 'ngoai_pham_vi'         -- kho không có, mời khách liên hệ trực tiếp
               )),
  lang     text not null default 'vi',

  name          text not null,
  body     text not null,
  note      text,

  is_active    boolean not null default true,
  updated_by uuid references auth.users (id),
  updated_at timestamptz not null default now(),

  unique (property_id, situation, lang)
);

comment on table public.ai_reply_template is
  'Thư mẫu theo tình huống. Nghiệp vụ sửa trực tiếp. Model dùng làm khung, '
  'không chép nguyên — vẫn phải bám ngữ cảnh và tri thức lấy được.';

-- Chọn bản riêng của khách sạn trước, không có thì lấy bản cả chuỗi.
create or replace function public.ai_reply_template_resolve(
  p_property_id uuid default null,
  p_tinh_huong  text default null,
  p_ngon_ngu    text default 'vi'
)
returns table (name text, body text)
language sql
stable
set search_path = public
as $$
  select m.name, m.body
  from public.ai_reply_template m
  where m.is_active
    and m.lang = p_ngon_ngu
    and m.situation = p_tinh_huong
    and (m.property_id is null or m.property_id = p_property_id)
  order by (m.property_id is not null) desc
  limit 1
$$;

alter table public.ai_reply_template enable row level security;

drop policy if exists ai_mau_thu_select_scoped on public.ai_reply_template;
create policy ai_mau_thu_select_scoped
  on public.ai_reply_template for select
  to authenticated
  using (property_id is null or property_id in (select public.user_property_ids()));

-- Bộ mẫu khởi tạo cho cả chuỗi. Nghiệp vụ sẽ sửa lại theo thực tế từng nơi.
-- Cố ý viết dạng KHUNG có chỗ trống, không phải câu hoàn chỉnh: model điền phần
-- cụ thể từ tri thức lấy được. Mẫu hoàn chỉnh quá thì bản nháp nào cũng giống
-- nhau và khách nhận ra ngay là thư máy.
insert into public.ai_reply_template (property_id, situation, lang, name, body, note)
values
  (null, 'xin_loi_su_co', 'vi', 'Xin lỗi khi khách gặp sự cố',
   E'Mở đầu bằng lời xin lỗi cụ thể về đúng sự cố khách nêu, không xin lỗi chung chung.\n'
   'Nói rõ khách sạn sẽ làm gì tiếp theo và trong bao lâu, chỉ nêu những gì có trong tri thức.\n'
   'Không hứa bồi thường, giảm giá hay nâng hạng phòng.\n'
   'Kết bằng lời mời khách báo lại nếu chưa được xử lý.',
   'Không hứa bồi thường — thẩm quyền đó thuộc quản lý khách sạn'),

  (null, 'ghi_nhan_yeu_cau', 'vi', 'Đã ghi nhận yêu cầu',
   E'Nhắc lại yêu cầu của khách bằng lời của mình để khách biết đã hiểu đúng.\n'
   'Nói rõ bộ phận nào sẽ xử lý và khi nào khách nhận được phản hồi.\n'
   'Không xác nhận là yêu cầu đã được chấp thuận — mới chỉ là đã ghi nhận.',
   'Phân biệt rõ "đã nhận" và "đã đồng ý"'),

  (null, 'chuyen_dat_phong', 'vi', 'Chuyển câu hỏi giá hoặc phòng trống',
   E'Cảm ơn khách đã quan tâm.\n'
   'Nói rõ giá và tình trạng phòng do bộ phận đặt phòng phụ trách, sẽ liên hệ lại với khách.\n'
   'TUYỆT ĐỐI không nêu bất kỳ mức giá phòng nào, không phỏng đoán còn hay hết phòng.\n'
   'Có thể nêu những thông tin khác khách hỏi kèm mà tri thức có sẵn.',
   'Dùng cho mọi câu hỏi giá và phòng trống'),

  (null, 'cam_on_khen_ngoi', 'vi', 'Cảm ơn khách khen',
   E'Cảm ơn ngắn gọn, nhắc lại đúng điều khách khen chứ không cảm ơn chung chung.\n'
   'Nếu khách khen một nhân viên cụ thể thì nói sẽ chuyển lời tới người đó.\n'
   'Không kèm mời chào đặt phòng lần sau — đang cảm ơn thì chỉ cảm ơn.',
   'Ngắn. Thư cảm ơn dài đọc như thư quảng cáo'),

  (null, 'huong_dan_duong_di', 'vi', 'Hướng dẫn đường đến khách sạn',
   E'Nêu đường đi theo đúng thông tin trong tri thức: khoảng cách, thời gian, phương tiện.\n'
   'Nếu khách cho biết điểm xuất phát thì trả lời đúng từ điểm đó, không liệt kê mọi hướng.\n'
   'Không tự ước lượng quãng đường hay giá cước nếu tri thức không có.',
   NULL),

  (null, 'xac_nhan_thong_tin', 'vi', 'Xác nhận lại thông tin khách cung cấp',
   E'Nhắc lại thông tin khách vừa cung cấp để khách kiểm tra.\n'
   'Nêu rõ những gì còn thiếu, nếu có.\n'
   'Không khẳng định đặt phòng đã được xác nhận — việc xác nhận do nhân viên thực hiện.',
   'AI không tự xác nhận đặt phòng'),

  (null, 'ngoai_pham_vi', 'vi', 'Kho tri thức không có thông tin',
   E'Nói thẳng là chưa có thông tin để trả lời chính xác, không vòng vo.\n'
   'Mời khách liên hệ lễ tân hoặc bộ phận phụ trách để được hỗ trợ.\n'
   'TUYỆT ĐỐI không suy đoán hay đưa thông tin không có trong tri thức.',
   'Thà nói không biết còn hơn đoán')
on conflict (property_id, situation, lang) do nothing;
