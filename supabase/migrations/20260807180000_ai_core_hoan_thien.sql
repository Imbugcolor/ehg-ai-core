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
create table if not exists public.ai_cong_tac (
  id           uuid primary key default gen_random_uuid(),
  pham_vi      text not null check (pham_vi in ('toan_he', 'khach_san', 'tinh_nang')),
  property_id  uuid references public.property (id) on delete cascade,
  tinh_nang    text check (tinh_nang in ('rag', 'soan_nhap', 'tom_tat', 'phan_loai')),
  dang_tat     boolean not null default true,
  ly_do        text not null,
  boi          uuid references auth.users (id),
  luc          timestamptz not null default now(),

  -- Mức nào thì phải có đúng thông tin của mức đó
  constraint ai_cong_tac_hop_le check (
    (pham_vi = 'toan_he'   and property_id is null and tinh_nang is null) or
    (pham_vi = 'khach_san' and property_id is not null) or
    (pham_vi = 'tinh_nang' and tinh_nang is not null)
  )
);

comment on table public.ai_cong_tac is
  'Nút tắt khẩn cho AI. Có bản ghi dang_tat = true khớp phạm vi là AI ngừng, nhân viên tự viết.';

create index if not exists ai_cong_tac_tat_idx on public.ai_cong_tac (dang_tat) where dang_tat;

create or replace function public.ai_bi_tat(p_tinh_nang text, p_property_id uuid default null)
returns table (bi_tat boolean, ly_do text, pham_vi text)
language sql
stable
set search_path = public
as $$
  select true, s.ly_do, s.pham_vi
  from public.ai_cong_tac s
  where s.dang_tat
    and (
      s.pham_vi = 'toan_he'
      or (s.pham_vi = 'khach_san' and s.property_id = p_property_id)
      or (s.pham_vi = 'tinh_nang' and s.tinh_nang = p_tinh_nang)
    )
  order by case s.pham_vi when 'toan_he' then 1 when 'khach_san' then 2 else 3 end
  limit 1
$$;

-- ---------------------------------------------------------------------------
-- ② Chi phí và hạn mức
-- ---------------------------------------------------------------------------
alter table public.ai_log
  add column if not exists token_vao int,
  add column if not exists token_ra  int,
  add column if not exists chi_phi   numeric(12,8),
  add column if not exists tu_cache  boolean not null default false,
  add column if not exists model_du_phong text;

create table if not exists public.ai_han_muc (
  id             boolean primary key default true check (id),
  han_muc_ngay   numeric(10,2) not null default 5.00,
  han_muc_thang  numeric(10,2) not null default 100.00,
  canh_bao_o     numeric(3,2)  not null default 0.80,
  cap_nhat_luc   timestamptz not null default now()
);

insert into public.ai_han_muc (id) values (true) on conflict (id) do nothing;

comment on table public.ai_han_muc is
  'Hạn mức chi phí model. Một dòng duy nhất. canh_bao_o = 0.8 nghĩa là cảnh báo khi đạt 80%.';

create or replace function public.ai_chi_phi()
returns table (hom_nay numeric, thang_nay numeric, han_ngay numeric, han_thang numeric,
               ty_le_ngay numeric, ty_le_thang numeric, can_canh_bao boolean, vuot_han boolean)
language sql
stable
set search_path = public
as $$
  with c as (
    select
      coalesce(sum(chi_phi) filter (where created_at >= date_trunc('day', now())), 0)   as ngay,
      coalesce(sum(chi_phi) filter (where created_at >= date_trunc('month', now())), 0) as thang
    from public.ai_log
  ), h as (select * from public.ai_han_muc where id)
  select c.ngay, c.thang, h.han_muc_ngay, h.han_muc_thang,
         round(c.ngay / nullif(h.han_muc_ngay, 0), 4),
         round(c.thang / nullif(h.han_muc_thang, 0), 4),
         (c.ngay >= h.han_muc_ngay * h.canh_bao_o or c.thang >= h.han_muc_thang * h.canh_bao_o),
         (c.ngay >= h.han_muc_ngay or c.thang >= h.han_muc_thang)
  from c, h
$$;

-- ---------------------------------------------------------------------------
-- ③ Nhãn ý định nghiệp vụ và cảm xúc
--    Dùng chung với HM4.7 bên luồng OTA — một service, không nhân đôi mô hình.
-- ---------------------------------------------------------------------------
alter table public.ai_log
  add column if not exists nhan_y_dinh text,
  add column if not exists cam_xuc     text check (cam_xuc in ('tich_cuc','trung_tinh','tieu_cuc')),
  add column if not exists do_gap      text check (do_gap in ('thap','trung','cao'));

create index if not exists ai_log_nhan_idx    on public.ai_log (nhan_y_dinh);
create index if not exists ai_log_cam_xuc_idx on public.ai_log (cam_xuc) where cam_xuc = 'tieu_cuc';

-- ---------------------------------------------------------------------------
-- ④ Đo tỉ lệ nhân viên sửa bản nháp
--    Lưu cả bản gốc lẫn bản đã sửa để tính chênh lệch. Đây là chỉ số duy nhất
--    nói được AI có thực sự giúp việc hay không.
-- ---------------------------------------------------------------------------
create table if not exists public.ai_nhap_da_sua (
  id           bigserial primary key,
  log_id       bigint references public.ai_log (id),
  ban_goc      text not null,
  ban_da_sua   text not null,
  ty_le_sua    numeric(5,4) not null,   -- 0 = giữ nguyên, 1 = viết lại hoàn toàn
  nhan_y_dinh  text,
  nguoi_sua    uuid references auth.users (id),
  da_gui       boolean not null default false,
  luc          timestamptz not null default now()
);

create index if not exists ai_nhap_da_sua_nhan_idx   on public.ai_nhap_da_sua (nhan_y_dinh);
create index if not exists ai_nhap_da_sua_nguoi_idx  on public.ai_nhap_da_sua (nguoi_sua);

comment on column public.ai_nhap_da_sua.ty_le_sua is
  'Phần trăm nội dung nhân viên phải sửa. Tiêu chí nghiệm thu: trên 70% số bản nháp có tỉ lệ sửa thấp.';

create or replace view public.ai_thong_ke_sua as
  select
    coalesce(nhan_y_dinh, '(không nhãn)')                       as nhan_y_dinh,
    count(*)                                                    as so_ban,
    round(avg(ty_le_sua), 4)                                    as ty_le_sua_tb,
    count(*) filter (where ty_le_sua <= 0.30)                    as dung_duoc_ngay,
    round(count(*) filter (where ty_le_sua <= 0.30)::numeric
          / nullif(count(*), 0), 4)                              as ty_le_dung_duoc
  from public.ai_nhap_da_sua
  group by 1
  order by so_ban desc;

comment on view public.ai_thong_ke_sua is
  'Tiêu chí nghiệm thu M3: trên 70% bản nháp dùng được ngay hoặc chỉ sửa nhẹ (tỉ lệ sửa <= 30%).';

alter table public.ai_cong_tac    enable row level security;
alter table public.ai_han_muc     enable row level security;
alter table public.ai_nhap_da_sua enable row level security;
