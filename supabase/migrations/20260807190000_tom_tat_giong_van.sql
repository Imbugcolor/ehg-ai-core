-- =============================================================================
-- 20260807190000_tom_tat_giong_van.sql
-- Hai đầu việc cuối của AI Core:
--   HM3.4 Tóm tắt hội thoại  — dùng khi chuyển ca hoặc khi cấp trên vào xem
--   HM3.6 Thư viện giọng văn — nghiệp vụ tự sửa được, không cần lập trình viên
-- =============================================================================

-- ---------------------------------------------------------------------------
-- HM3.4 — Tóm tắt hội thoại
--
-- Lưu lại để không gọi model lặp. Khoá theo nội dung: có tin nhắn mới thì
-- băm đổi, bản tóm tắt cũ tự hết hiệu lực — cùng cách làm với rag_cache.
-- ---------------------------------------------------------------------------
create table if not exists public.ai_tom_tat (
  id           uuid primary key default gen_random_uuid(),
  thread_key   text not null,
  hash_noi_dung text not null,
  property_id  uuid references public.property (id) on delete cascade,

  so_tin       int not null,
  tom_tat      text not null,
  y_chinh      jsonb not null default '[]'::jsonb,   -- các ý khách đã nêu
  viec_con_treo jsonb not null default '[]'::jsonb,  -- việc chưa xử lý xong
  cam_xuc      text,

  model        text,
  ms           int,
  created_at   timestamptz not null default now(),

  unique (thread_key, hash_noi_dung)
);

comment on table public.ai_tom_tat is
  'Tóm tắt hội thoại dài. Khoá gồm băm nội dung nên có tin mới là tự tính lại.';
comment on column public.ai_tom_tat.viec_con_treo is
  'Việc khách đang chờ mà chưa xử lý xong. Đây là phần quan trọng nhất khi chuyển ca.';

create index if not exists ai_tom_tat_thread_idx on public.ai_tom_tat (thread_key, created_at desc);

alter table public.ai_tom_tat enable row level security;

drop policy if exists ai_tom_tat_select_scoped on public.ai_tom_tat;
create policy ai_tom_tat_select_scoped
  on public.ai_tom_tat for select
  to authenticated
  using (property_id is null or property_id in (select public.user_property_ids()));

-- ---------------------------------------------------------------------------
-- HM3.6 — Thư viện giọng văn
--
-- Để trong bảng chứ không viết cứng trong prompt, vì yêu cầu là nghiệp vụ tự
-- sửa được. Sửa giọng văn là việc của Marketing, không phải việc phải chờ
-- lập trình viên triển khai lại.
-- ---------------------------------------------------------------------------
create table if not exists public.ai_giong_van (
  id           uuid primary key default gen_random_uuid(),
  property_id  uuid references public.property (id) on delete cascade,  -- NULL = cả chuỗi
  loai_khach   text not null default 'chung'
               check (loai_khach in ('chung', 'vip', 'doan_b2b', 'khach_quen', 'khieu_nai')),
  ngon_ngu     text not null default 'vi',

  mo_ta        text not null,          -- hướng dẫn giọng văn, đưa thẳng vào prompt
  cau_mo       text,
  cau_ket      text,
  tu_nen_dung  text[] not null default '{}',
  tu_tranh     text[] not null default '{}',

  dang_dung    boolean not null default true,
  cap_nhat_boi uuid references auth.users (id),
  cap_nhat_luc timestamptz not null default now(),

  unique (property_id, loai_khach, ngon_ngu)
);

comment on table public.ai_giong_van is
  'Giọng văn theo khách sạn và loại khách. Nghiệp vụ sửa trực tiếp, không cần triển khai lại.';

-- Chọn bản phù hợp nhất: riêng khách sạn + đúng loại khách > riêng khách sạn
-- + chung > cả chuỗi + đúng loại khách > cả chuỗi + chung.
create or replace function public.ai_giong_van_ap_dung(
  p_property_id uuid default null,
  p_loai_khach  text default 'chung',
  p_ngon_ngu    text default 'vi'
)
returns table (mo_ta text, cau_mo text, cau_ket text, tu_nen_dung text[], tu_tranh text[])
language sql
stable
set search_path = public
as $$
  select g.mo_ta, g.cau_mo, g.cau_ket, g.tu_nen_dung, g.tu_tranh
  from public.ai_giong_van g
  where g.dang_dung
    and g.ngon_ngu = p_ngon_ngu
    and (g.property_id is null or g.property_id = p_property_id)
    and (g.loai_khach = p_loai_khach or g.loai_khach = 'chung')
  order by
    (g.property_id is not null) desc,
    (g.loai_khach = p_loai_khach) desc
  limit 1
$$;

alter table public.ai_giong_van enable row level security;

drop policy if exists ai_giong_van_select_scoped on public.ai_giong_van;
create policy ai_giong_van_select_scoped
  on public.ai_giong_van for select
  to authenticated
  using (property_id is null or property_id in (select public.user_property_ids()));

-- Giọng mặc định cho cả chuỗi. Đây là dữ liệu khởi tạo, Marketing sẽ sửa lại.
insert into public.ai_giong_van (property_id, loai_khach, ngon_ngu, mo_ta, cau_mo, cau_ket, tu_nen_dung, tu_tranh)
values
  (null, 'chung', 'vi',
   'Lịch sự, ngắn gọn, đi thẳng vào việc. Xưng "chúng tôi", gọi khách là "quý khách". Không dùng câu sáo rỗng, không hứa những điều ngoài thẩm quyền.',
   'Chào quý khách,', 'Trân trọng,',
   ARRAY['quý khách', 'chúng tôi', 'vui lòng'],
   ARRAY['bạn nhé', 'ok', 'chắc chắn 100%', 'cam kết']),

  (null, 'khieu_nai', 'vi',
   'Nhận lỗi trước, không biện minh, không đổ cho bộ phận khác. Nêu rõ việc sẽ làm và mốc thời gian. Tuyệt đối không hứa bồi thường — việc đó do quản lý quyết.',
   'Chào quý khách, chúng tôi rất tiếc về việc này.', 'Chúng tôi mong quý khách thông cảm và sẽ theo sát đến khi xử lý xong.',
   ARRAY['chúng tôi rất tiếc', 'ghi nhận', 'xử lý ngay'],
   ARRAY['do bộ phận khác', 'không phải lỗi của chúng tôi', 'bồi thường', 'hoàn tiền']),

  (null, 'doan_b2b', 'vi',
   'Trang trọng hơn khách lẻ, dùng ngôn ngữ công việc. Nêu rõ điều kiện và mốc thời gian. Luôn chuyển sang bộ phận kinh doanh khi chạm tới giá và số lượng.',
   'Kính gửi Quý công ty,', 'Trân trọng,',
   ARRAY['Quý công ty', 'kính gửi', 'theo yêu cầu'],
   ARRAY['bạn', 'nhé', 'giảm giá'])
on conflict (property_id, loai_khach, ngon_ngu) do nothing;
