-- =============================================================================
-- 20260807140000_kb_hybrid.sql
-- Bổ sung cho kho tri thức after_data khi chạy thử và phát hiện ba vấn đề:
--   1. Chỉ dùng vector thì xếp hạng sai — đoạn chứa từ khoá phụ lại lên trên
--   2. Điểm cosine thô không tách được đúng/sai, không dùng làm ngưỡng được
--   3. Câu hỏi ngoài phạm vi tri thức vẫn ra kết quả trông hợp lý
--
-- Cách xử lý: truy vấn lai (vector + full-text, hợp nhất bằng RRF), thêm
-- metadata để lọc cứng, và bảng cache.
--
-- Ghi chú tiếng Việt: Postgres KHÔNG có cấu hình full-text cho tiếng Việt
-- (đã kiểm chứng trên chính project này). Dùng cấu hình 'simple' cộng với
-- unaccent để bỏ dấu, và pg_trgm cho khớp gần đúng.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Extension
-- ---------------------------------------------------------------------------
create extension if not exists unaccent with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- unaccent() một tham số KHÔNG immutable nên không dùng được trong index.
-- Bản hai tham số thì immutable — bọc lại để dùng được.
create or replace function public.kb_normalize(txt text)
returns text
language sql
immutable
parallel safe
set search_path = public, extensions
as $$
  select lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(txt, '')))
$$;

comment on function public.kb_normalize is
  'Chuẩn hoá chữ Việt: bỏ dấu + chữ thường. Dùng cho cả tạo index lẫn lúc truy vấn.';

-- ---------------------------------------------------------------------------
-- 2. Thống nhất từ vựng trạng thái theo tài liệu thiết kế: PUBLISHED
-- ---------------------------------------------------------------------------
alter table public.kb_document drop constraint if exists kb_document_status_check;
alter table public.kb_document drop constraint if exists kb_document_approved_needs_approver;

update public.kb_document set status = 'published' where status = 'approved';

alter table public.kb_document
  add constraint kb_document_status_check
  check (status in ('draft', 'published', 'archived'));

alter table public.kb_document
  add constraint kb_document_published_needs_approver
  check (status <> 'published' or (approved_by is not null and approved_at is not null));

-- ---------------------------------------------------------------------------
-- 3. Metadata còn thiếu trên tài liệu
-- ---------------------------------------------------------------------------
alter table public.kb_document
  add column if not exists topic          text,
  add column if not exists owner_user_id  uuid references auth.users (id),
  add column if not exists effective_from date,
  add column if not exists effective_to   date,
  add column if not exists kb_version     int not null default 1,
  add column if not exists is_synthetic   boolean not null default false;

comment on column public.kb_document.topic is
  'Chủ đề để lọc cứng và để nhét vào chỉ mục tìm kiếm.';
comment on column public.kb_document.owner_user_id is
  'Người chịu trách nhiệm nội dung. Không có người sở hữu thì tri thức sẽ mục theo thời gian.';
comment on column public.kb_document.effective_from is
  'Chính sách theo mùa hoặc theo dịp lễ. NULL = luôn hiệu lực.';
comment on column public.kb_document.kb_version is
  'Tăng mỗi lần sửa nội dung. Là một phần khoá của rag_cache.';
comment on column public.kb_document.is_synthetic is
  'TRUE = tri thức giả lập dùng để thử. Xoá sạch dữ liệu giả bằng một lệnh nhờ cột này.';

create index if not exists kb_document_topic_idx     on public.kb_document (topic);
create index if not exists kb_document_effective_idx on public.kb_document (effective_from, effective_to);

-- ---------------------------------------------------------------------------
-- 4. Bổ sung trên đoạn tri thức
-- ---------------------------------------------------------------------------
alter table public.kb_chunk
  add column if not exists embedding_version text,
  add column if not exists metadata          jsonb not null default '{}'::jsonb,
  add column if not exists tsv               tsvector;

comment on column public.kb_chunk.embedding_version is
  'Đổi model là phải sinh lại vector. Cột này cho biết đoạn nào đã chuyển, đoạn nào chưa.';

-- tsv gộp cả tiêu đề tài liệu và chủ đề, không chỉ nội dung đoạn.
-- Lần chạy thử cho thấy thiếu ngữ cảnh tiêu đề là nguyên nhân xếp hạng sai.
create or replace function public.kb_chunk_refresh_tsv()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
declare
  doc_title text;
  doc_topic text;
begin
  select d.title, d.topic into doc_title, doc_topic
  from public.kb_document d where d.id = new.document_id;

  new.tsv := to_tsvector(
    'simple',
    public.kb_normalize(coalesce(doc_title, '') || ' ' || coalesce(doc_topic, '') || ' ' || new.content)
  );
  return new;
end;
$$;

drop trigger if exists kb_chunk_tsv on public.kb_chunk;
create trigger kb_chunk_tsv
  before insert or update of content, document_id on public.kb_chunk
  for each row execute function public.kb_chunk_refresh_tsv();

-- Tính lại cho dữ liệu đã có
update public.kb_chunk c
set tsv = to_tsvector(
  'simple',
  public.kb_normalize(coalesce(d.title, '') || ' ' || coalesce(d.topic, '') || ' ' || c.content)
)
from public.kb_document d
where d.id = c.document_id;

create index if not exists kb_chunk_tsv_idx     on public.kb_chunk using gin (tsv);
create index if not exists kb_chunk_content_trgm on public.kb_chunk
  using gin (public.kb_normalize(content) extensions.gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- 5. Policy RLS cập nhật theo từ vựng mới + hiệu lực theo thời gian
-- ---------------------------------------------------------------------------
drop policy if exists kb_document_select_scoped on public.kb_document;
create policy kb_document_select_scoped
  on public.kb_document for select
  to authenticated
  using (
    status = 'published'
    and (property_id is null or property_id in (select public.user_property_ids()))
    and (effective_from is null or effective_from <= current_date)
    and (effective_to   is null or effective_to   >= current_date)
  );

drop policy if exists kb_chunk_select_scoped on public.kb_chunk;
create policy kb_chunk_select_scoped
  on public.kb_chunk for select
  to authenticated
  using (
    (property_id is null or property_id in (select public.user_property_ids()))
    and exists (
      select 1 from public.kb_document d
      where d.id = kb_chunk.document_id
        and d.status = 'published'
        and (d.effective_from is null or d.effective_from <= current_date)
        and (d.effective_to   is null or d.effective_to   >= current_date)
    )
  );

-- ---------------------------------------------------------------------------
-- 6. Bộ nhớ đệm câu trả lời
--    Câu hỏi trong ngành khách sạn lặp lại rất nhiều: giờ nhận phòng, chính
--    sách trẻ em, có đưa đón sân bay không. Cache cắt được phần lớn chi phí.
-- ---------------------------------------------------------------------------
create table if not exists public.rag_cache (
  cache_key    text primary key,
  question     text not null,
  property_id  uuid references public.property (id) on delete cascade,
  lang         text not null default 'vi',
  kb_version   int  not null,
  chunk_ids    uuid[] not null,
  answer       text,
  citations    jsonb not null default '[]'::jsonb,
  hit_count    int  not null default 0,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz not null default now()
);

comment on table public.rag_cache is
  'Khoá = hash(câu hỏi chuẩn hoá + phạm vi + ngôn ngữ + kb_version). Đổi tri thức là cache tự hết hiệu lực.';

create index if not exists rag_cache_property_idx on public.rag_cache (property_id);

alter table public.rag_cache enable row level security;

drop policy if exists rag_cache_select_scoped on public.rag_cache;
create policy rag_cache_select_scoped
  on public.rag_cache for select
  to authenticated
  using (property_id is null or property_id in (select public.user_property_ids()));

-- ---------------------------------------------------------------------------
-- 7. Truy vấn lai — vector + full-text, hợp nhất bằng RRF
--
--    Lọc cứng phạm vi TRƯỚC rồi mới tính khoảng cách. HNSW kết hợp bộ lọc
--    chọn lọc cao dễ bị giảm recall, nên thu hẹp tập ứng viên từ đầu.
--
--    Để mặc định security invoker => RLS của người gọi vẫn áp dụng.
-- ---------------------------------------------------------------------------
create or replace function public.kb_search_hybrid(
  query_embedding extensions.vector(768),
  query_text      text,
  p_lang          text default 'vi',
  match_count     int  default 5,
  candidate_count int  default 30,
  rrf_k           int  default 60
)
returns table (
  chunk_id    uuid,
  document_id uuid,
  title       text,
  content     text,
  similarity  float,
  vector_rank int,
  fts_rank    int,
  rrf_score   float
)
language sql
stable
set search_path = public, extensions
as $$
  with pool as (
    -- Lọc cứng trước: RLS đã chặn theo khách sạn, ở đây thêm ngôn ngữ
    select c.id, c.document_id, c.content, c.embedding, c.tsv, d.title
    from public.kb_chunk c
    join public.kb_document d on d.id = c.document_id
    where c.embedding is not null
      and (p_lang is null or d.lang = p_lang)
  ),
  by_vector as (
    select id, row_number() over (order by embedding <=> query_embedding) as rnk,
           1 - (embedding <=> query_embedding) as sim
    from pool
    order by embedding <=> query_embedding
    limit candidate_count
  ),
  by_fts as (
    select id, row_number() over (
             order by ts_rank_cd(tsv, plainto_tsquery('simple', public.kb_normalize(query_text))) desc
           ) as rnk
    from pool
    where tsv @@ plainto_tsquery('simple', public.kb_normalize(query_text))
    limit candidate_count
  ),
  fused as (
    select
      coalesce(v.id, f.id) as id,
      v.rnk  as v_rank,
      f.rnk  as f_rank,
      v.sim  as sim,
      coalesce(1.0 / (rrf_k + v.rnk), 0) + coalesce(1.0 / (rrf_k + f.rnk), 0) as score
    from by_vector v
    full outer join by_fts f on f.id = v.id
  )
  select
    p.id, p.document_id, p.title, p.content,
    fu.sim, fu.v_rank::int, fu.f_rank::int, fu.score::float
  from fused fu
  join pool p on p.id = fu.id
  order by fu.score desc
  limit match_count
$$;

comment on function public.kb_search_hybrid is
  'Tìm lai: vector cho ngữ nghĩa, full-text cho từ khoá và số liệu, hợp nhất bằng Reciprocal Rank Fusion.';
