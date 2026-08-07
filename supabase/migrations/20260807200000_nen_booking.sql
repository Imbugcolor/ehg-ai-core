-- =============================================================================
-- 20260807200000_nen_booking.sql
-- Mô hình dữ liệu nền cho HM4 (OTA & Booking) và HM8 (Tích hợp & Hạ tầng).
--
-- Sáu bảng: smile_server · booking · booking_segment · sync_job
--           · mapping_registry · audit_log
--
-- Ba ràng buộc quan trọng nhất được đặt ở TẦNG DỮ LIỆU, không dựa vào kỷ luật
-- của code, vì đây là những chỗ mà một lỗi là hỏng quan hệ với khách hàng:
--
--   E2  Booking nguồn OTA KHÔNG BAO GIỜ được đẩy sang PMS.
--       Channel Manager đã làm việc đó — đẩy nữa là tạo booking trùng.
--
--   E10 Đẩy hai lần chỉ tạo một bản ghi.
--       Khoá chống trùng phải gồm MÃ KHÁCH SẠN, vì confirmation number của
--       Smile chỉ duy nhất trong phạm vi một server.
--
--   E6  Giá trị người kiểm sửa tay KHÔNG được parser ghi đè ở lần chạy sau.
--       Đánh dấu theo TỪNG TRƯỜNG, không theo cả bản ghi — vì email sửa đổi
--       vẫn phải cập nhật được các trường khác.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Máy chủ Smile
--    Smile chạy tại chỗ, mỗi khách sạn (hoặc vài khách sạn) một bản cài riêng.
--    Không có một API tập trung nào — nên phải biết đi đâu trước khi ghi.
-- ---------------------------------------------------------------------------
create table if not exists public.smile_server (
  id            uuid primary key default gen_random_uuid(),
  ma            text not null unique,
  ten           text not null,
  endpoint      text,
  phien_ban     text,
  mui_gio       text not null default 'Asia/Ho_Chi_Minh',
  night_audit_tu   time,
  night_audit_den  time,
  bao_tri_tu       time,
  bao_tri_den      time,
  gioi_han_goi_phut int,
  dang_dung     boolean not null default true,
  ghi_chu       text,
  created_at    timestamptz not null default now()
);

comment on column public.smile_server.night_audit_tu is
  'Khung giờ night audit thường khoá ghi. Job đẩy phải tự hoãn sang sau khung này.';

-- Khách sạn nào đi server nào (HM8.2)
alter table public.property
  add column if not exists smile_server_id uuid references public.smile_server (id),
  add column if not exists ma_pms text;

comment on column public.property.ma_pms is 'Mã định danh khách sạn bên trong Smile.';

-- ---------------------------------------------------------------------------
-- 2. Booking (cha)
-- ---------------------------------------------------------------------------
create table if not exists public.booking (
  id              uuid primary key default gen_random_uuid(),
  ma_booking      text not null unique default ('BK' || to_char(now(),'YYMMDD') || substr(gen_random_uuid()::text,1,6)),

  nguon           text not null check (nguon in ('OTA','DIRECT','B2B')),
  ten_kenh        text,                    -- Agoda, Booking.com, Expedia…
  ma_xac_nhan_kenh text,                   -- confirmation number của kênh

  ten_khach       text,
  email_khach     text,                    -- thường là alias, ví dụ @guest.booking.com
  email_la_alias  boolean not null default false,
  sdt_khach       text,
  quoc_tich       text,
  ngon_ngu        text default 'vi',

  trang_thai      text not null default 'moi'
                  check (trang_thai in ('moi','cho_kiem','da_duyet','da_sua','da_huy','hoan_thanh')),

  -- Lưu kèm email gốc và điểm tin cậy từng trường, để khi tranh chấp với khách
  -- hoặc với OTA thì đối chiếu được. Email gốc là bản ĐÃ CHE số thẻ và CVV.
  email_goc_path  text,
  do_tin_cay      jsonb not null default '{}'::jsonb,

  -- Trường nào người kiểm đã sửa tay. Parser chạy lần sau đọc cột này và CHỪA
  -- đúng những trường có tên ở đây. Dùng một cờ chung cho cả bản ghi là sai:
  -- hoặc khoá cứng không cập nhật được gì, hoặc ghi đè mất công sửa của người ta.
  da_sua_tay      jsonb not null default '{}'::jsonb,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint booking_ota_can_ma_kenh
    check (nguon <> 'OTA' or ma_xac_nhan_kenh is not null)
);

create index if not exists booking_nguon_idx     on public.booking (nguon);
create index if not exists booking_kenh_ma_idx   on public.booking (ten_kenh, ma_xac_nhan_kenh);
create index if not exists booking_trang_thai_idx on public.booking (trang_thai);

-- Tra trùng theo confirmation number của kênh: có rồi thì là SỬA hoặc HUỶ,
-- không tạo bản ghi mới (M2.8 Dedupe).
create unique index if not exists booking_kenh_duy_nhat
  on public.booking (ten_kenh, ma_xac_nhan_kenh)
  where ma_xac_nhan_kenh is not null;

-- ---------------------------------------------------------------------------
-- 3. Booking Segment (con)
--    Một khách đặt ba khách sạn trên cùng lộ trình = một booking, ba segment.
--    Mỗi segment đi tới đúng server Smile của khách sạn đó.
-- ---------------------------------------------------------------------------
create table if not exists public.booking_segment (
  id              uuid primary key default gen_random_uuid(),
  booking_id      uuid not null references public.booking (id) on delete cascade,
  property_id     uuid not null references public.property (id),
  thu_tu          int  not null default 0,

  -- Sao lại từ booking cha để ràng buộc E2 kiểm được ngay trên bảng này.
  -- Trigger giữ cho luôn khớp, không cho sửa tay.
  nguon           text not null check (nguon in ('OTA','DIRECT','B2B')),

  ngay_den        date not null,
  ngay_di         date not null,
  loai_phong_coh  text,
  ma_gia_coh      text,
  so_phong        int  not null default 1 check (so_phong > 0),
  so_khach_lon    int  not null default 1 check (so_khach_lon > 0),
  so_tre_em       int  not null default 0 check (so_tre_em >= 0),
  ghi_chu         text,
  yeu_cau_dac_biet text,

  -- ⚠ E2: nguồn OTA thì cột này BẮT BUỘC false. Ràng buộc ở tầng dữ liệu,
  -- không phải ở tầng ứng dụng — vì "kỹ thuật hoàn toàn làm được" nên rất dễ
  -- có lập trình viên tiện tay nối thẳng.
  sync_enabled    boolean not null default false,

  ma_xac_nhan_pms text,                    -- confirmation number Smile trả về
  trang_thai_sync text not null default 'chua_day'
                  check (trang_thai_sync in ('chua_day','cho_duyet','dang_day','thanh_cong','loi','dlq','da_huy')),

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint segment_ngay_hop_le check (ngay_di > ngay_den),
  constraint segment_ota_khong_day check (nguon <> 'OTA' or sync_enabled = false),
  unique (booking_id, thu_tu)
);

create index if not exists segment_booking_idx   on public.booking_segment (booking_id);
create index if not exists segment_property_idx  on public.booking_segment (property_id);
create index if not exists segment_sync_idx      on public.booking_segment (trang_thai_sync);

-- Giữ nguon luôn khớp booking cha, và chặn bật sync cho nguồn OTA
create or replace function public.segment_dong_bo_nguon()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  nguon_cha text;
begin
  select b.nguon into nguon_cha from public.booking b where b.id = new.booking_id;
  new.nguon := nguon_cha;
  if nguon_cha = 'OTA' and new.sync_enabled then
    raise exception 'Vi phạm E2: booking nguồn OTA không được đẩy sang PMS (segment %)', new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists segment_dong_bo_nguon_tr on public.booking_segment;
create trigger segment_dong_bo_nguon_tr
  before insert or update on public.booking_segment
  for each row execute function public.segment_dong_bo_nguon();

-- ---------------------------------------------------------------------------
-- 4. Sync Job — hàng đợi đẩy sang Smile
-- ---------------------------------------------------------------------------
create table if not exists public.sync_job (
  id              uuid primary key default gen_random_uuid(),
  segment_id      uuid not null references public.booking_segment (id) on delete cascade,
  property_id     uuid not null references public.property (id),
  server_id       uuid references public.smile_server (id),

  -- ⚠ E10: khoá chống trùng. PHẢI gồm mã khách sạn, vì confirmation number
  -- của Smile chỉ duy nhất trong phạm vi MỘT server.
  khoa_chong_trung text not null,

  hanh_dong       text not null default 'tao'
                  check (hanh_dong in ('tao','sua','huy')),
  trang_thai      text not null default 'cho'
                  check (trang_thai in ('cho','dang_chay','thanh_cong','loi','dlq')),

  so_lan_thu      int not null default 0,
  thu_lai_luc     timestamptz,
  payload         jsonb,
  phan_hoi        jsonb,
  ma_xac_nhan_pms text,
  loai_loi        text,
  loi_msg         text,

  -- Write-Gate: không có hai cột này thì không được chạy (E4)
  nguoi_duyet     uuid references auth.users (id),
  duyet_luc       timestamptz,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  unique (khoa_chong_trung)
);

create index if not exists sync_job_trang_thai_idx on public.sync_job (trang_thai, thu_lai_luc);
create index if not exists sync_job_segment_idx    on public.sync_job (segment_id);
create index if not exists sync_job_server_idx     on public.sync_job (server_id, trang_thai);

comment on column public.sync_job.khoa_chong_trung is
  'hash(mã khách sạn + segment + phiên bản). Gửi lại bao nhiêu lần cũng chỉ tạo một reservation.';
comment on column public.sync_job.nguoi_duyet is
  'E4 — mọi lần ghi ra hệ ngoài phải có người xác nhận. Chưa duyệt thì không chạy.';

-- Không cho chuyển sang đang chạy nếu chưa có người duyệt
create or replace function public.sync_job_can_duyet()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.trang_thai = 'dang_chay' and new.nguoi_duyet is null then
    raise exception 'Vi phạm E4: chưa có người duyệt thì không được đẩy sang PMS (job %)', new.id;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists sync_job_can_duyet_tr on public.sync_job;
create trigger sync_job_can_duyet_tr
  before insert or update on public.sync_job
  for each row execute function public.sync_job_can_duyet();

-- ---------------------------------------------------------------------------
-- 5. Mapping Registry — cửa DUY NHẤT dịch mã (HM8.3)
--    Cấm hardcode mã PMS trong code. Vi phạm điều này thì mở khách sạn thứ hai
--    là phải sửa lại code.
-- ---------------------------------------------------------------------------
create table if not exists public.mapping_registry (
  id            uuid primary key default gen_random_uuid(),
  property_id   uuid not null references public.property (id) on delete cascade,
  loai_ma       text not null
                check (loai_ma in ('room_type','rate_code','market_segment','payment_method','source_code')),
  ma_coh        text not null,
  ma_pms        text not null,
  mo_ta         text,

  phien_ban     int  not null default 1,
  hieu_luc_tu   date,
  hieu_luc_den  date,
  dang_dung     boolean not null default true,

  cap_nhat_boi  uuid references auth.users (id),
  cap_nhat_luc  timestamptz not null default now(),

  unique (property_id, loai_ma, ma_coh, phien_ban)
);

create index if not exists mapping_tra_cuu_idx
  on public.mapping_registry (property_id, loai_ma, ma_coh) where dang_dung;

-- Không tìm thấy thì NÉM LỖI, không trả giá trị mặc định.
-- Cho qua với giá trị mặc định là cách nhanh nhất để tạo dữ liệu sai trong PMS.
create or replace function public.dich_ma(
  p_property_id uuid, p_loai_ma text, p_ma_coh text, p_ngay date default current_date
)
returns text
language plpgsql
stable
set search_path = public
as $$
declare
  kq text;
begin
  select m.ma_pms into kq
  from public.mapping_registry m
  where m.property_id = p_property_id
    and m.loai_ma = p_loai_ma
    and m.ma_coh = p_ma_coh
    and m.dang_dung
    and (m.hieu_luc_tu  is null or m.hieu_luc_tu  <= p_ngay)
    and (m.hieu_luc_den is null or m.hieu_luc_den >= p_ngay)
  order by m.phien_ban desc
  limit 1;

  if kq is null then
    raise exception 'MAPPING_THIEU: chưa có bản dịch % = % cho khách sạn %',
      p_loai_ma, p_ma_coh, p_property_id
      using errcode = 'P0002';
  end if;
  return kq;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Audit log — ghi vết mọi hành động có hệ quả (E8)
--    Chỉ ghi thêm. Chặn sửa và xoá ở tầng dữ liệu.
-- ---------------------------------------------------------------------------
create table if not exists public.audit_log (
  id          bigserial primary key,
  luc         timestamptz not null default now(),
  bang        text not null,
  ban_ghi_id  text not null,
  hanh_dong   text not null check (hanh_dong in ('them','sua','xoa','day_pms','duyet','gui_mail','gop_ho_so')),
  nguoi       uuid references auth.users (id),
  ip          inet,
  truoc       jsonb,
  sau         jsonb,
  ghi_chu     text
);

create index if not exists audit_log_bang_idx on public.audit_log (bang, ban_ghi_id);
create index if not exists audit_log_luc_idx  on public.audit_log (luc desc);

create or replace function public.audit_chi_ghi_them()
returns trigger language plpgsql as $$
begin
  raise exception 'audit_log chỉ được ghi thêm, không sửa hoặc xoá';
end; $$;

drop trigger if exists audit_khong_sua on public.audit_log;
create trigger audit_khong_sua
  before update or delete on public.audit_log
  for each row execute function public.audit_chi_ghi_them();

-- Tự ghi vết cho các bảng trọng yếu
create or replace function public.audit_tu_dong()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_log (bang, ban_ghi_id, hanh_dong, nguoi, truoc, sau)
  values (
    tg_table_name,
    coalesce((case when tg_op = 'DELETE' then old.id else new.id end)::text, '?'),
    case tg_op when 'INSERT' then 'them' when 'UPDATE' then 'sua' else 'xoa' end,
    auth.uid(),
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    case when tg_op = 'DELETE' then null else to_jsonb(new) end
  );
  return coalesce(new, old);
end;
$$;

drop trigger if exists booking_audit  on public.booking;
create trigger booking_audit after insert or update or delete on public.booking
  for each row execute function public.audit_tu_dong();

drop trigger if exists segment_audit  on public.booking_segment;
create trigger segment_audit after insert or update or delete on public.booking_segment
  for each row execute function public.audit_tu_dong();

drop trigger if exists mapping_audit  on public.mapping_registry;
create trigger mapping_audit after insert or update or delete on public.mapping_registry
  for each row execute function public.audit_tu_dong();

-- ---------------------------------------------------------------------------
-- 7. updated_at tự cập nhật
-- ---------------------------------------------------------------------------
drop trigger if exists booking_touch on public.booking;
create trigger booking_touch before update on public.booking
  for each row execute function public.touch_updated_at();

drop trigger if exists segment_touch on public.booking_segment;
create trigger segment_touch before update on public.booking_segment
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 8. RLS — mọi bảng đều bật, lọc theo khách sạn
-- ---------------------------------------------------------------------------
alter table public.smile_server     enable row level security;
alter table public.booking          enable row level security;
alter table public.booking_segment  enable row level security;
alter table public.sync_job         enable row level security;
alter table public.mapping_registry enable row level security;
alter table public.audit_log        enable row level security;

drop policy if exists segment_select_scoped on public.booking_segment;
create policy segment_select_scoped on public.booking_segment for select to authenticated
  using (property_id in (select public.user_property_ids()));

drop policy if exists booking_select_scoped on public.booking;
create policy booking_select_scoped on public.booking for select to authenticated
  using (exists (
    select 1 from public.booking_segment s
    where s.booking_id = booking.id
      and s.property_id in (select public.user_property_ids())
  ));

drop policy if exists sync_job_select_scoped on public.sync_job;
create policy sync_job_select_scoped on public.sync_job for select to authenticated
  using (property_id in (select public.user_property_ids()));

drop policy if exists mapping_select_scoped on public.mapping_registry;
create policy mapping_select_scoped on public.mapping_registry for select to authenticated
  using (property_id in (select public.user_property_ids()));
