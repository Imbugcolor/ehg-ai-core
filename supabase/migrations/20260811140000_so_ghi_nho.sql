-- SỔ GHI NHỚ HỘI THOẠI.
--
-- Cửa sổ ngữ cảnh sáu tin nhắn có một chỗ hỏng nằm sẵn trong thiết kế: thứ khách
-- nói ở ĐẦU thư thường là thứ quan trọng nhất — mấy người, ngày nào, mã đặt
-- phòng, dị ứng gì — mà đó cũng đúng là thứ rơi ra khỏi cửa sổ trước tiên.
--
-- Đo được: câu "đoàn tôi lúc nãy nói ấy, có cần đặt cọc không?" khôi phục đầy đủ
-- thành "đoàn 8 người ngày 20" khi thông tin còn trong cửa sổ, và mất sạch số
-- người lẫn ngày khi nó bị đẩy ra ngoài. Không mờ dần — mất hẳn.
--
-- Sổ này tách những dữ kiện đó ra khỏi dòng thời gian. Đã ghi vào sổ thì còn
-- mãi, dù nói từ hai chục tin nhắn trước.

create table if not exists public.ai_thread_memory (
  thread_key   text primary key,
  property_id  uuid references public.property (id) on delete cascade,

  -- Các trường đã tách. Dùng jsonb chứ không phải cột rời vì tập trường này còn
  -- đổi khi có thư khách thật — lúc đó thêm trường không cần migration.
  facts           jsonb not null default '{}'::jsonb,

  update_count      int not null default 0,
  created_at      timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Sổ chứa dữ liệu cá nhân của khách: tên, mã đặt phòng, đôi khi cả tình trạng
  -- sức khoẻ qua yêu cầu ăn kiêng. Không giữ vô thời hạn.
  expires_at  timestamptz not null default now() + interval '90 days'
);

comment on table public.ai_thread_memory is
  'Dữ kiện bền của một hội thoại: mấy người, ngày nào, mã đặt phòng, yêu cầu '
  'đặc biệt. Tách khỏi cửa sổ ngữ cảnh trượt để không rơi mất khi thư dài.';

comment on column public.ai_thread_memory.expires_at is
  'Chứa dữ liệu cá nhân. Dọn định kỳ bằng ai_so_ghi_nho_don().';

create index if not exists ai_so_ghi_nho_property_idx on public.ai_thread_memory (property_id);
create index if not exists ai_so_ghi_nho_het_han_idx  on public.ai_thread_memory (expires_at);

alter table public.ai_thread_memory enable row level security;

-- Cùng luật phạm vi như mọi dữ liệu khác: người của khách sạn này không đọc
-- được hội thoại của khách sạn kia.
drop policy if exists ai_so_ghi_nho_scoped on public.ai_thread_memory;
create policy ai_so_ghi_nho_scoped
  on public.ai_thread_memory for select
  to authenticated
  using (property_id is null or property_id in (select public.user_property_ids()));

create or replace function public.ai_thread_memory_prune()
returns int
language sql
as $$
  with xoa as (
    delete from public.ai_thread_memory where expires_at < now() returning 1
  )
  select count(*)::int from xoa
$$;

comment on function public.ai_thread_memory_prune is
  'Xoá sổ đã hết hạn. Gọi định kỳ bằng pg_cron khi lên môi trường thật.';
