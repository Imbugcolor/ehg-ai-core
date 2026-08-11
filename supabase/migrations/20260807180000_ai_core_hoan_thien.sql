-- =============================================================================
-- 20260807180000_ai_core_hoan_thien.sql
-- Đóng nốt bốn phần còn thiếu của AI Core:
--   ① Nút tắt khẩn ba mức          (HM3.7 — ưu tiên 0, đang thiếu)
--   ② Đếm chi phí và hạn mức       (HM3.9)
--   ③ Nhãn ý định nghiệp vụ + cảm xúc (HM3.5)
--   ④ Đo tỉ lệ nhân viên sửa nháp  (HM3.8)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- ① Nút tắt khẩn
--    Ba mức: tắt toàn hệ · tắt theo khách sạn · tắt theo tính năng.
--    Đây là thứ dùng lúc đang có sự cố, nên phải đọc nhanh và không phụ thuộc
--    vào việc triển khai lại code.
-- ---------------------------------------------------------------------------
create table if not exists public.ai_kill_switch (
  id           uuid primary key default gen_random_uuid(),
  scope      text not null check (scope in ('toan_he', 'khach_san', 'tinh_nang')),
  property_id  uuid references public.property (id) on delete cascade,
  feature    text check (feature in ('rag', 'soan_nhap', 'tom_tat', 'phan_loai')),
  is_disabled     boolean not null default true,
  reason        text not null,
  set_by          uuid references auth.users (id),
  created_at          timestamptz not null default now(),

  -- Mức nào thì phải có đúng thông tin của mức đó
  constraint ai_cong_tac_hop_le check (
    (scope = 'toan_he'   and property_id is null and feature is null) or
    (scope = 'khach_san' and property_id is not null) or
    (scope = 'tinh_nang' and feature is not null)
  )
);

comment on table public.ai_kill_switch is
  'Nút tắt khẩn cho AI. Có bản ghi dang_tat = true khớp phạm vi là AI ngừng, nhân viên tự viết.';

create index if not exists ai_cong_tac_tat_idx on public.ai_kill_switch (is_disabled) where is_disabled;

create or replace function public.ai_is_disabled(p_tinh_nang text, p_property_id uuid default null)
returns table (bi_tat boolean, reason text, scope text)
language sql
stable
set search_path = public
as $$
  select true, s.reason, s.scope
  from public.ai_kill_switch s
  where s.is_disabled
    and (
      s.scope = 'toan_he'
      or (s.scope = 'khach_san' and s.property_id = p_property_id)
      or (s.scope = 'tinh_nang' and s.feature = p_tinh_nang)
    )
  order by case s.scope when 'toan_he' then 1 when 'khach_san' then 2 else 3 end
  limit 1
$$;

-- ---------------------------------------------------------------------------
-- ② Chi phí và hạn mức
-- ---------------------------------------------------------------------------
alter table public.ai_log
  add column if not exists input_tokens int,
  add column if not exists output_tokens  int,
  add column if not exists cost_usd   numeric(12,8),
  add column if not exists from_cache  boolean not null default false,
  add column if not exists fallback_model text;

create table if not exists public.ai_budget (
  id             boolean primary key default true check (id),
  daily_limit_usd   numeric(10,2) not null default 5.00,
  monthly_limit_usd  numeric(10,2) not null default 100.00,
  warn_at_ratio     numeric(3,2)  not null default 0.80,
  updated_at   timestamptz not null default now()
);

insert into public.ai_budget (id) values (true) on conflict (id) do nothing;

comment on table public.ai_budget is
  'Hạn mức chi phí model. Một dòng duy nhất. canh_bao_o = 0.8 nghĩa là cảnh báo khi đạt 80%.';

create or replace function public.ai_cost_status()
returns table (hom_nay numeric, thang_nay numeric, han_ngay numeric, han_thang numeric,
               ty_le_ngay numeric, ty_le_thang numeric, can_canh_bao boolean, vuot_han boolean)
language sql
stable
set search_path = public
as $$
  with c as (
    select
      coalesce(sum(cost_usd) filter (where created_at >= date_trunc('day', now())), 0)   as ngay,
      coalesce(sum(cost_usd) filter (where created_at >= date_trunc('month', now())), 0) as thang
    from public.ai_log
  ), h as (select * from public.ai_budget where id)
  select c.ngay, c.thang, h.daily_limit_usd, h.monthly_limit_usd,
         round(c.ngay / nullif(h.daily_limit_usd, 0), 4),
         round(c.thang / nullif(h.monthly_limit_usd, 0), 4),
         (c.ngay >= h.daily_limit_usd * h.warn_at_ratio or c.thang >= h.monthly_limit_usd * h.warn_at_ratio),
         (c.ngay >= h.daily_limit_usd or c.thang >= h.monthly_limit_usd)
  from c, h
$$;

-- ---------------------------------------------------------------------------
-- ③ Nhãn ý định nghiệp vụ và cảm xúc
--    Dùng chung với HM4.7 bên luồng OTA — một service, không nhân đôi mô hình.
-- ---------------------------------------------------------------------------
alter table public.ai_log
  add column if not exists intent_label text,
  add column if not exists sentiment     text check (sentiment in ('tich_cuc','trung_tinh','tieu_cuc')),
  add column if not exists urgency      text check (urgency in ('thap','trung','cao'));

create index if not exists ai_log_nhan_idx    on public.ai_log (intent_label);
create index if not exists ai_log_cam_xuc_idx on public.ai_log (sentiment) where sentiment = 'tieu_cuc';

-- ---------------------------------------------------------------------------
-- ④ Đo tỉ lệ nhân viên sửa bản nháp
--    Lưu cả bản gốc lẫn bản đã sửa để tính chênh lệch. Đây là chỉ số duy nhất
--    nói được AI có thực sự giúp việc hay không.
-- ---------------------------------------------------------------------------
create table if not exists public.ai_draft_edit (
  id           bigserial primary key,
  log_id       bigint references public.ai_log (id),
  original_draft      text not null,
  edited_draft   text not null,
  edit_ratio    numeric(5,4) not null,   -- 0 = giữ nguyên, 1 = viết lại hoàn toàn
  intent_label  text,
  edited_by    uuid references auth.users (id),
  was_sent       boolean not null default false,
  created_at          timestamptz not null default now()
);

create index if not exists ai_nhap_da_sua_nhan_idx   on public.ai_draft_edit (intent_label);
create index if not exists ai_nhap_da_sua_nguoi_idx  on public.ai_draft_edit (edited_by);

comment on column public.ai_draft_edit.edit_ratio is
  'Phần trăm nội dung nhân viên phải sửa. Tiêu chí nghiệm thu: trên 70% số bản nháp có tỉ lệ sửa thấp.';

create or replace view public.ai_edit_stats as
  select
    coalesce(intent_label, '(không nhãn)')                       as intent_label,
    count(*)                                                    as draft_count,
    round(avg(edit_ratio), 4)                                    as avg_edit_ratio,
    count(*) filter (where edit_ratio <= 0.30)                    as usable_count,
    round(count(*) filter (where edit_ratio <= 0.30)::numeric
          / nullif(count(*), 0), 4)                              as usable_ratio
  from public.ai_draft_edit
  group by 1
  order by draft_count desc;

comment on view public.ai_edit_stats is
  'Tiêu chí nghiệm thu M3: trên 70% bản nháp dùng được ngay hoặc chỉ sửa nhẹ (tỉ lệ sửa <= 30%).';

alter table public.ai_kill_switch    enable row level security;
alter table public.ai_budget     enable row level security;
alter table public.ai_draft_edit enable row level security;
