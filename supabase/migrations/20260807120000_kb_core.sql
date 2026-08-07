-- =============================================================================
-- 20260807120000_kb_core.sql
-- Nền kho tri thức cho AI Core (HM3.1 Nạp kho tri thức, HM3.2 RAG)
--
-- Nguyên tắc bám theo tài liệu thiết kế:
--   • Kho tri thức nằm ngay trong Postgres bằng pgvector, không dựng vector DB riêng
--   • RAG chỉ truy xuất tài liệu ĐÃ DUYỆT
--   • Dữ liệu phân tách theo từng khách sạn, chặn ở TẦNG DỮ LIỆU bằng RLS
--     (nguyên tắc E7 — không chỉ ẩn trên giao diện)
--   • Vector ghi kèm tên model và số chiều: đổi model là nạp lại, không phải sửa schema
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Extension
-- ---------------------------------------------------------------------------
create extension if not exists vector with schema extensions;

-- ---------------------------------------------------------------------------
-- 2. Bảng khách sạn (TẠM)
--    Sẽ được thay bằng cây tổ chức thật của HM1 (Group > Brand > Region >
--    Property > Department). Giữ tối thiểu ở đây để dựng và kiểm chứng RLS.
-- ---------------------------------------------------------------------------
create table if not exists public.property (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null,
  timezone    text not null default 'Asia/Ho_Chi_Minh',
  created_at  timestamptz not null default now()
);

comment on table public.property is
  'TẠM — sẽ thay bằng cây tổ chức của HM1. Giữ để phân tách dữ liệu theo khách sạn.';

-- ---------------------------------------------------------------------------
-- 3. Người dùng thuộc khách sạn nào
--    Đây là cơ sở để RLS quyết định ai thấy gì.
-- ---------------------------------------------------------------------------
create table if not exists public.user_property (
  user_id     uuid not null references auth.users (id) on delete cascade,
  property_id uuid not null references public.property (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, property_id)
);

-- Hàm trả về danh sách khách sạn của người đang đăng nhập.
-- security definer để đọc được user_property mà không cần policy riêng cho bảng đó.
create or replace function public.user_property_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select property_id
  from public.user_property
  where user_id = (select auth.uid())
$$;

comment on function public.user_property_ids() is
  'Danh sách khách sạn mà người dùng hiện tại được phép truy cập. Dùng trong policy RLS.';

-- ---------------------------------------------------------------------------
-- 4. Tài liệu tri thức
--    property_id NULL = tài liệu dùng chung cho cả chuỗi.
-- ---------------------------------------------------------------------------
create table if not exists public.kb_document (
  id            uuid primary key default gen_random_uuid(),
  property_id   uuid references public.property (id) on delete cascade,
  title         text not null,
  source_type   text not null default 'manual'
                check (source_type in ('manual', 'file', 'url', 'sop')),
  source_uri    text,
  lang          text not null default 'vi',
  version       int  not null default 1,
  status        text not null default 'draft'
                check (status in ('draft', 'approved', 'archived')),
  content_hash  text,
  approved_by   uuid references auth.users (id),
  approved_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- Đã duyệt thì bắt buộc phải biết ai duyệt và duyệt lúc nào
  constraint kb_document_approved_needs_approver
    check (status <> 'approved' or (approved_by is not null and approved_at is not null))
);

create index if not exists kb_document_property_idx on public.kb_document (property_id);
create index if not exists kb_document_status_idx   on public.kb_document (status);

comment on column public.kb_document.property_id is
  'NULL = tài liệu dùng chung cho cả chuỗi. Có giá trị = chỉ thuộc khách sạn đó.';
comment on column public.kb_document.status is
  'Chỉ tài liệu approved mới được RAG truy xuất (yêu cầu M3.1).';

-- ---------------------------------------------------------------------------
-- 5. Đoạn tri thức đã cắt + vector
--    property_id lặp lại từ kb_document để RLS và lọc chạy nhanh, không phải join.
--    768 chiều: index HNSW của pgvector chỉ chạy tới 2000 chiều, và 768 là đủ
--    cho kho tri thức cỡ vài nghìn đoạn. Giá token không đổi theo số chiều.
-- ---------------------------------------------------------------------------
create table if not exists public.kb_chunk (
  id              uuid primary key default gen_random_uuid(),
  document_id     uuid not null references public.kb_document (id) on delete cascade,
  property_id     uuid references public.property (id) on delete cascade,
  chunk_index     int  not null,
  content         text not null,
  token_count     int,
  embedding       extensions.vector(768),
  embedding_model text,
  embedding_dim   int,
  created_at      timestamptz not null default now(),

  unique (document_id, chunk_index),

  -- Có vector thì bắt buộc phải biết vector đó sinh từ model nào.
  -- Nhờ cột này mà đổi model chỉ cần nạp lại đúng phần cần nạp.
  constraint kb_chunk_embedding_needs_model
    check (embedding is null or (embedding_model is not null and embedding_dim is not null))
);

create index if not exists kb_chunk_document_idx on public.kb_chunk (document_id);
create index if not exists kb_chunk_property_idx on public.kb_chunk (property_id);

-- Index tìm theo độ gần (cosine). Tạo trên bảng rỗng là bình thường.
create index if not exists kb_chunk_embedding_idx
  on public.kb_chunk
  using hnsw (embedding extensions.vector_cosine_ops);

-- ---------------------------------------------------------------------------
-- 6. Tự cập nhật updated_at
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists kb_document_touch on public.kb_document;
create trigger kb_document_touch
  before update on public.kb_document
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 7. RLS — chặn ở tầng dữ liệu
--    service_role tự động bỏ qua RLS, nên phần nạp tri thức chạy bằng
--    service_role vẫn ghi được mà không cần policy insert.
-- ---------------------------------------------------------------------------
alter table public.property      enable row level security;
alter table public.user_property enable row level security;
alter table public.kb_document   enable row level security;
alter table public.kb_chunk      enable row level security;

-- Chỉ thấy khách sạn mình thuộc về
drop policy if exists property_select_scoped on public.property;
create policy property_select_scoped
  on public.property for select
  to authenticated
  using (id in (select public.user_property_ids()));

-- Chỉ thấy dòng phân quyền của chính mình
drop policy if exists user_property_select_own on public.user_property;
create policy user_property_select_own
  on public.user_property for select
  to authenticated
  using (user_id = (select auth.uid()));

-- Tài liệu: phải ĐÃ DUYỆT, và thuộc khách sạn mình hoặc dùng chung
drop policy if exists kb_document_select_scoped on public.kb_document;
create policy kb_document_select_scoped
  on public.kb_document for select
  to authenticated
  using (
    status = 'approved'
    and (property_id is null or property_id in (select public.user_property_ids()))
  );

-- Đoạn tri thức: cùng luật, và tài liệu cha cũng phải qua được RLS ở trên
drop policy if exists kb_chunk_select_scoped on public.kb_chunk;
create policy kb_chunk_select_scoped
  on public.kb_chunk for select
  to authenticated
  using (
    (property_id is null or property_id in (select public.user_property_ids()))
    and exists (
      select 1 from public.kb_document d
      where d.id = kb_chunk.document_id
        and d.status = 'approved'
    )
  );

-- ---------------------------------------------------------------------------
-- 8. Hàm tìm theo độ gần
--    Để mặc định security invoker => RLS của người gọi vẫn được áp dụng.
--    Người của khách sạn A gọi hàm này KHÔNG lấy ra được đoạn của khách sạn B.
-- ---------------------------------------------------------------------------
create or replace function public.kb_search(
  query_embedding extensions.vector(768),
  p_property_id   uuid    default null,
  match_count     int     default 5,
  min_similarity  float   default 0.0
)
returns table (
  chunk_id    uuid,
  document_id uuid,
  title       text,
  content     text,
  similarity  float
)
language sql
stable
set search_path = public, extensions
as $$
  select
    c.id,
    c.document_id,
    d.title,
    c.content,
    1 - (c.embedding <=> query_embedding) as similarity
  from public.kb_chunk c
  join public.kb_document d on d.id = c.document_id
  where c.embedding is not null
    and (p_property_id is null or c.property_id is not distinct from p_property_id
         or c.property_id is null)
    and 1 - (c.embedding <=> query_embedding) >= min_similarity
  order by c.embedding <=> query_embedding
  limit match_count
$$;

comment on function public.kb_search is
  'Tìm đoạn tri thức gần nhất. Chạy dưới quyền người gọi nên RLS vẫn chặn theo khách sạn.';
