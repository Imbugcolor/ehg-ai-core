-- =============================================================================
-- 20260807150000_kb_tsquery_or.sql
-- Sửa phần full-text của truy vấn lai.
--
-- Vấn đề đo được: plainto_tsquery nối các từ bằng AND. Câu hỏi tiếng Việt bị
-- cấu hình 'simple' tách thành nhiều âm tiết ("mấy giờ được nhận phòng và trả
-- phòng" -> 8 token), đòi khớp đủ cả 8 thì gần như không đoạn nào qua được.
-- Kết quả: nhánh full-text im lặng ở 15/16 lượt hỏi, RRF mất một chân.
--
-- Cách sửa: nối bằng OR, để ts_rank_cd tự thưởng điểm cho đoạn khớp nhiều từ.
-- =============================================================================

create or replace function public.kb_tsquery_or(txt text)
returns tsquery
language sql
stable
parallel safe
set search_path = public, extensions
as $$
  select nullif(
    array_to_string(
      tsvector_to_array(to_tsvector('simple', public.kb_normalize(txt))),
      ' | '
    ),
    ''
  )::tsquery
$$;

comment on function public.kb_tsquery_or is
  'Biến câu hỏi thành tsquery nối bằng OR. Trả NULL nếu câu rỗng, để nhánh full-text tự bỏ qua.';

drop function if exists public.kb_search_hybrid(extensions.vector, text, text, int, int, int);

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
  fts_score   float,
  rrf_score   float
)
language sql
stable
set search_path = public, extensions
as $$
  with tsq as (
    select public.kb_tsquery_or(query_text) as q
  ),
  pool as (
    select c.id, c.document_id, c.content, c.embedding, c.tsv, d.title
    from public.kb_chunk c
    join public.kb_document d on d.id = c.document_id
    where c.embedding is not null
      and (p_lang is null or d.lang = p_lang)
  ),
  by_vector as (
    select id,
           row_number() over (order by embedding <=> query_embedding) as rnk,
           1 - (embedding <=> query_embedding) as sim
    from pool
    order by embedding <=> query_embedding
    limit candidate_count
  ),
  by_fts as (
    select p.id,
           ts_rank_cd(p.tsv, t.q) as score,
           row_number() over (order by ts_rank_cd(p.tsv, t.q) desc) as rnk
    from pool p, tsq t
    where t.q is not null and p.tsv @@ t.q
    order by ts_rank_cd(p.tsv, t.q) desc
    limit candidate_count
  ),
  fused as (
    select
      coalesce(v.id, f.id) as id,
      v.rnk   as v_rank,
      f.rnk   as f_rank,
      v.sim   as sim,
      f.score as f_score,
      coalesce(1.0 / (rrf_k + v.rnk), 0) + coalesce(1.0 / (rrf_k + f.rnk), 0) as score
    from by_vector v
    full outer join by_fts f on f.id = v.id
  )
  select
    p.id, p.document_id, p.title, p.content,
    fu.sim, fu.v_rank::int, fu.f_rank::int, fu.f_score::float, fu.score::float
  from fused fu
  join pool p on p.id = fu.id
  order by fu.score desc
  limit match_count
$$;
