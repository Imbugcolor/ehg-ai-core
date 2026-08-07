-- =============================================================================
-- 20260807170000_rag_cache_dung.sql
-- Đưa rag_cache vào dùng thật.
--
-- Câu hỏi trong ngành khách sạn lặp lại rất nhiều — giờ nhận phòng, bữa sáng,
-- đưa đón sân bay, chính sách trẻ em. Đo được: một lượt trả lời mất 4–9 giây và
-- tốn một lượt gọi model chat, trong khi câu hỏi thì gần như y hệt nhau.
--
-- Khoá cache gồm bốn phần, thiếu phần nào cũng sai:
--   • câu hỏi đã chuẩn hoá  — để "mấy giờ nhận phòng" và "Mấy giờ nhận phòng?" chung một khoá
--   • phạm vi khách sạn     — người của Biển Xanh không được ăn cache của Núi Đồi
--   • ngôn ngữ
--   • phiên bản kho tri thức — sửa tri thức là toàn bộ cache tự hết hiệu lực
-- =============================================================================

alter table public.rag_cache
  add column if not exists ket_qua   text,
  add column if not exists diem      numeric(6,4),
  add column if not exists scope_key text;

alter table public.rag_cache drop constraint if exists rag_cache_ket_qua_check;
alter table public.rag_cache
  add constraint rag_cache_ket_qua_check
  check (ket_qua is null or ket_qua in ('TRA_LOI', 'KHONG_DU_CO_SO'));

comment on column public.rag_cache.scope_key is
  'Danh sách khách sạn người dùng được phép xem, đã sắp xếp. Nằm trong khoá cache.';
comment on column public.rag_cache.kb_version is
  'Dấu thời gian sửa tri thức gần nhất. Đổi tri thức là mọi khoá cũ tự vô hiệu.';

create index if not exists rag_cache_last_used_idx on public.rag_cache (last_used_at);

-- Phiên bản kho tri thức: lấy từ lần sửa tài liệu gần nhất, không cần bảng đếm
-- riêng và không cần ai nhớ tăng số. Nạp lại tri thức là tự đổi.
create or replace function public.kb_version()
returns bigint
language sql
stable
set search_path = public
as $$
  select coalesce(extract(epoch from max(updated_at))::bigint, 0)
  from public.kb_document
$$;

comment on function public.kb_version is
  'Phiên bản kho tri thức. Dùng làm một phần khoá cache để tri thức đổi thì cache tự hết hiệu lực.';

-- Dọn cache cũ. Gọi định kỳ bằng pg_cron khi lên môi trường thật.
create or replace function public.rag_cache_don(giu_ngay int default 30)
returns int
language sql
as $$
  with xoa as (
    delete from public.rag_cache
    where last_used_at < now() - (giu_ngay || ' days')::interval
       or kb_version <> public.kb_version()
    returning 1
  )
  select count(*)::int from xoa
$$;
