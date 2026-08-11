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
--   E6  Giá trị người kiểm sửa tay KHÔNG được parser ghi đè ở lần chạy after_data.
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
  code            text not null unique,
  name           text not null,
  endpoint      text,
  version     text,
  timezone       text not null default 'Asia/Ho_Chi_Minh',
  night_audit_start   time,
  night_audit_end  time,
  maintenance_start       time,
  maintenance_end      time,
  rate_limit_per_minute int,
  is_active     boolean not null default true,
  note       text,
  created_at    timestamptz not null default now()
);

comment on column public.smile_server.night_audit_start is
  'Khung giờ night audit thường khoá ghi. Job đẩy phải tự hoãn sang sau khung này.';

-- Khách sạn nào đi server nào (HM8.2)
alter table public.property
  add column if not exists smile_server_id uuid references public.smile_server (id),
  add column if not exists pms_code text;

comment on column public.property.pms_code is 'Mã định danh khách sạn bên trong Smile.';

-- ---------------------------------------------------------------------------
-- 2. Booking (cha)
-- ---------------------------------------------------------------------------
create table if not exists public.booking (
  id              uuid primary key default gen_random_uuid(),
  booking_code      text not null unique default ('BK' || to_char(now(),'YYMMDD') || substr(gen_random_uuid()::text,1,6)),

  source           text not null check (source in ('OTA','DIRECT','B2B')),
  channel_name        text,                    -- Agoda, Booking.com, Expedia…
  channel_confirmation_code text,                   -- confirmation number của kênh

  guest_name       text,
  guest_email     text,                    -- thường là alias, ví dụ @guest.booking.com
  guest_email_is_alias  boolean not null default false,
  guest_phone       text,
  nationality       text,
  lang        text default 'vi',

  status      text not null default 'moi'
                  check (status in ('moi','cho_kiem','da_duyet','da_sua','da_huy','hoan_thanh')),

  -- Lưu kèm email gốc và điểm tin cậy từng trường, để khi tranh chấp với khách
  -- hoặc với OTA thì đối chiếu được. Email gốc là bản ĐÃ CHE số thẻ và CVV.
  source_email_path  text,
  confidence      jsonb not null default '{}'::jsonb,

  -- Trường nào người kiểm đã sửa tay. Parser chạy lần after_data đọc cột này và CHỪA
  -- đúng những trường có tên ở đây. Dùng một cờ chung cho cả bản ghi là sai:
  -- hoặc khoá cứng không cập nhật được gì, hoặc ghi đè mất công sửa của người ta.
  manually_edited      jsonb not null default '{}'::jsonb,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint booking_ota_can_ma_kenh
    check (source <> 'OTA' or channel_confirmation_code is not null)
);

create index if not exists booking_nguon_idx     on public.booking (source);
create index if not exists booking_kenh_ma_idx   on public.booking (channel_name, channel_confirmation_code);
create index if not exists booking_trang_thai_idx on public.booking (status);

-- Tra trùng theo confirmation number của kênh: có rồi thì là SỬA hoặc HUỶ,
-- không tạo bản ghi mới (M2.8 Dedupe).
create unique index if not exists booking_kenh_duy_nhat
  on public.booking (channel_name, channel_confirmation_code)
  where channel_confirmation_code is not null;

-- ---------------------------------------------------------------------------
-- 3. Booking Segment (con)
--    Một khách đặt ba khách sạn trên cùng lộ trình = một booking, ba segment.
--    Mỗi segment đi tới đúng server Smile của khách sạn đó.
-- ---------------------------------------------------------------------------
create table if not exists public.booking_segment (
  id              uuid primary key default gen_random_uuid(),
  booking_id      uuid not null references public.booking (id) on delete cascade,
  property_id     uuid not null references public.property (id),
  position          int  not null default 0,

  -- Sao lại từ booking cha để ràng buộc E2 kiểm được ngay trên bảng này.
  -- Trigger giữ cho luôn khớp, không cho sửa tay.
  source           text not null check (source in ('OTA','DIRECT','B2B')),

  arrival_date        date not null,
  departure_date         date not null,
  coh_room_type  text,
  coh_rate_code      text,
  room_count        int  not null default 1 check (room_count > 0),
  adult_count    int  not null default 1 check (adult_count > 0),
  child_count       int  not null default 0 check (child_count >= 0),
  note         text,
  special_requests text,

  -- ⚠ E2: nguồn OTA thì cột này BẮT BUỘC false. Ràng buộc ở tầng dữ liệu,
  -- không phải ở tầng ứng dụng — vì "kỹ thuật hoàn toàn làm được" nên rất dễ
  -- có lập trình viên tiện tay nối thẳng.
  sync_enabled    boolean not null default false,

  pms_confirmation_code text,                    -- confirmation number Smile trả về
  sync_status text not null default 'chua_day'
                  check (sync_status in ('chua_day','cho_duyet','dang_day','thanh_cong','loi','dlq','da_huy')),

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint segment_ngay_hop_le check (departure_date > arrival_date),
  constraint segment_ota_khong_day check (source <> 'OTA' or sync_enabled = false),
  unique (booking_id, position)
);

create index if not exists segment_booking_idx   on public.booking_segment (booking_id);
create index if not exists segment_property_idx  on public.booking_segment (property_id);
create index if not exists segment_sync_idx      on public.booking_segment (sync_status);

-- Giữ source luôn khớp booking cha, và chặn bật sync cho nguồn OTA
create or replace function public.segment_sync_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  nguon_cha text;
begin
  select b.source into nguon_cha from public.booking b where b.id = new.booking_id;
  new.source := nguon_cha;
  if nguon_cha = 'OTA' and new.sync_enabled then
    raise exception 'Vi phạm E2: booking nguồn OTA không được đẩy sang PMS (segment %)', new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists segment_dong_bo_nguon_tr on public.booking_segment;
create trigger segment_dong_bo_nguon_tr
  before insert or update on public.booking_segment
  for each row execute function public.segment_sync_guard();

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
  idempotency_key text not null,

  action       text not null default 'tao'
                  check (action in ('tao','sua','huy')),
  status      text not null default 'cho'
                  check (status in ('cho','dang_chay','thanh_cong','loi','dlq')),

  attempt_count      int not null default 0,
  retry_at     timestamptz,
  payload         jsonb,
  response        jsonb,
  pms_confirmation_code text,
  loai_loi        text,
  error_message         text,

  -- Write-Gate: không có hai cột này thì không được chạy (E4)
  approved_by     uuid references auth.users (id),
  approved_at       timestamptz,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  unique (idempotency_key)
);

create index if not exists sync_job_trang_thai_idx on public.sync_job (status, retry_at);
create index if not exists sync_job_segment_idx    on public.sync_job (segment_id);
create index if not exists sync_job_server_idx     on public.sync_job (server_id, status);

comment on column public.sync_job.idempotency_key is
  'hash(mã khách sạn + segment + phiên bản). Gửi lại bao nhiêu lần cũng chỉ tạo một reservation.';
comment on column public.sync_job.approved_by is
  'E4 — mọi lần ghi ra hệ ngoài phải có người xác nhận. Chưa duyệt thì không chạy.';

-- Không cho chuyển sang đang chạy nếu chưa có người duyệt
create or replace function public.sync_job_require_approval()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'dang_chay' and new.approved_by is null then
    raise exception 'Vi phạm E4: chưa có người duyệt thì không được đẩy sang PMS (job %)', new.id;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists sync_job_can_duyet_tr on public.sync_job;
create trigger sync_job_can_duyet_tr
  before insert or update on public.sync_job
  for each row execute function public.sync_job_require_approval();

-- ---------------------------------------------------------------------------
-- 5. Mapping Registry — cửa DUY NHẤT dịch mã (HM8.3)
--    Cấm hardcode mã PMS trong code. Vi phạm điều này thì mở khách sạn thứ hai
--    là phải sửa lại code.
-- ---------------------------------------------------------------------------
create table if not exists public.mapping_registry (
  id            uuid primary key default gen_random_uuid(),
  property_id   uuid not null references public.property (id) on delete cascade,
  code_type       text not null
                check (code_type in ('room_type','rate_code','market_segment','payment_method','source_code')),
  coh_code        text not null,
  pms_code        text not null,
  description         text,

  version     int  not null default 1,
  effective_from   date,
  effective_to  date,
  is_active     boolean not null default true,

  updated_by  uuid references auth.users (id),
  updated_at  timestamptz not null default now(),

  unique (property_id, code_type, coh_code, version)
);

create index if not exists mapping_tra_cuu_idx
  on public.mapping_registry (property_id, code_type, coh_code) where is_active;

-- Không tìm thấy thì NÉM LỖI, không trả giá trị mặc định.
-- Cho qua với giá trị mặc định là cách nhanh nhất để tạo dữ liệu sai trong PMS.
create or replace function public.map_code(
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
  select m.pms_code into kq
  from public.mapping_registry m
  where m.property_id = p_property_id
    and m.code_type = p_loai_ma
    and m.coh_code = p_ma_coh
    and m.is_active
    and (m.effective_from  is null or m.effective_from  <= p_ngay)
    and (m.effective_to is null or m.effective_to >= p_ngay)
  order by m.version desc
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
  created_at         timestamptz not null default now(),
  table_name        text not null,
  record_id  text not null,
  action   text not null check (action in ('them','sua','xoa','day_pms','duyet','gui_mail','gop_ho_so')),
  actor       uuid references auth.users (id),
  ip          inet,
  before_data       jsonb,
  after_data         jsonb,
  note     text
);

create index if not exists audit_log_bang_idx on public.audit_log (table_name, record_id);
create index if not exists audit_log_created_at_idx  on public.audit_log (created_at desc);

create or replace function public.audit_append_only()
returns trigger language plpgsql as $$
begin
  raise exception 'audit_log chỉ được ghi thêm, không sửa hoặc xoá';
end; $$;

drop trigger if exists audit_khong_sua on public.audit_log;
create trigger audit_khong_sua
  before update or delete on public.audit_log
  for each row execute function public.audit_append_only();

-- Tự ghi vết cho các bảng trọng yếu
create or replace function public.audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_log (table_name, record_id, action, actor, before_data, after_data)
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
  for each row execute function public.audit_trigger();

drop trigger if exists segment_audit  on public.booking_segment;
create trigger segment_audit after insert or update or delete on public.booking_segment
  for each row execute function public.audit_trigger();

drop trigger if exists mapping_audit  on public.mapping_registry;
create trigger mapping_audit after insert or update or delete on public.mapping_registry
  for each row execute function public.audit_trigger();

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
