-- =============================================================================
-- 20260807160000_ai_log.sql
-- Nhật ký AI (HM3.8) — ghi 100% lượt gọi, có che thông tin cá nhân.
--
-- Vì sao cần: nguyên tắc E9 "thất bại phải nhìn thấy được, không có lỗi im lặng".
-- Đo được một ca thật: nhà cung cấp model trả lỗi bộ lọc nội dung, hệ thống
-- không xử lý nên câu đó biến mất khỏi kết quả mà không ai biết.
--
-- Bảng chỉ ghi thêm, không cho sửa hoặc xoá — giống nhật ký ghi PMS bên HM8.
-- =============================================================================

create table if not exists public.ai_log (
  id            bigserial primary key,
  created_at    timestamptz not null default now(),

  user_id       uuid references auth.users (id),
  property_id   uuid references public.property (id),

  cau_hoi       text not null,          -- đã che thông tin cá nhân
  ket_qua       text not null
                check (ket_qua in ('TRA_LOI','KHONG_DU_CO_SO','CHAN_Y_DINH','BI_CHAN','LOI_NHA_CUNG_CAP')),
  y_dinh        text,
  diem          numeric(6,4),
  so_ung_vien   int,
  ban_nhap      text,                   -- đã che thông tin cá nhân
  ly_do_chan    text,
  lop_chan      int,

  model_chat    text,
  model_rerank  text,
  model_embed   text,

  ms            int,
  loi_loai      text,
  loi_msg       text
);

comment on table public.ai_log is
  'Nhật ký mọi lượt gọi AI. Chỉ ghi thêm. Dùng để đo tỉ lệ chặn, tỉ lệ lỗi nhà cung cấp và chất lượng bản nháp.';
comment on column public.ai_log.cau_hoi is 'Đã che email, số điện thoại, số thẻ trước khi ghi.';

create index if not exists ai_log_created_idx on public.ai_log (created_at desc);
create index if not exists ai_log_ketqua_idx  on public.ai_log (ket_qua);
create index if not exists ai_log_user_idx    on public.ai_log (user_id);

-- Chỉ ghi thêm: chặn sửa và xoá ở tầng dữ liệu, không dựa vào kỷ luật của code.
create or replace function public.ai_log_chi_ghi_them()
returns trigger
language plpgsql
as $$
begin
  raise exception 'ai_log chỉ được ghi thêm, không sửa hoặc xoá';
end;
$$;

drop trigger if exists ai_log_khong_sua on public.ai_log;
create trigger ai_log_khong_sua
  before update or delete on public.ai_log
  for each row execute function public.ai_log_chi_ghi_them();

-- RLS bật, KHÔNG có policy select cho authenticated: nhật ký chứa nội dung hội
-- thoại nên chỉ vai trò máy chủ mới đọc được. Sau này thêm policy riêng cho
-- vai trò quản trị khi có cây phân quyền của HM1.
alter table public.ai_log enable row level security;
