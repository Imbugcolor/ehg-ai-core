-- ĐỔI TÊN ĐỊNH DANH SANG TIẾNG ANH.
--
-- Lược đồ ban đầu đặt tên tiếng Việt vì viết nhanh khi một mình dựng thử. Đây
-- là phần sẽ ghép vào hệ thống của team, mà tên bảng thì đi theo suốt vòng đời
-- dự án — đổi càng muộn càng đắt.
--
-- Quy ước: snake_case · tên bảng danh từ số ít · boolean is_* · mốc thời gian
-- _at · khoá ngoại <bảng>_id · số đếm _count · tỉ lệ _ratio · đơn vị trong tên
-- khi dễ nhầm (_usd, _ms).
--
-- Migration này CHỈ để chuyển cơ sở dữ liệu đã chạy sẵn. Các tệp migration phía
-- trước đã được viết lại bằng tên tiếng Anh, nên môi trường dựng mới sẽ có tên
-- đúng ngay từ đầu và migration này không làm gì cả.
--
-- Mọi lệnh đều kiểm tra tồn tại trước, chạy lại nhiều lần vẫn an toàn.

-- ── Bảng ────────────────────────────────────────────────────────────────────
do $$ begin if to_regclass('public.ai_cong_tac') is not null and to_regclass('public.ai_kill_switch') is null
  then execute 'alter table public.ai_cong_tac rename to ai_kill_switch'; end if; end $$;
do $$ begin if to_regclass('public.ai_giong_van') is not null and to_regclass('public.ai_tone') is null
  then execute 'alter table public.ai_giong_van rename to ai_tone'; end if; end $$;
do $$ begin if to_regclass('public.ai_han_muc') is not null and to_regclass('public.ai_budget') is null
  then execute 'alter table public.ai_han_muc rename to ai_budget'; end if; end $$;
do $$ begin if to_regclass('public.ai_mau_thu') is not null and to_regclass('public.ai_reply_template') is null
  then execute 'alter table public.ai_mau_thu rename to ai_reply_template'; end if; end $$;
do $$ begin if to_regclass('public.ai_nhap_da_sua') is not null and to_regclass('public.ai_draft_edit') is null
  then execute 'alter table public.ai_nhap_da_sua rename to ai_draft_edit'; end if; end $$;
do $$ begin if to_regclass('public.ai_so_ghi_nho') is not null and to_regclass('public.ai_thread_memory') is null
  then execute 'alter table public.ai_so_ghi_nho rename to ai_thread_memory'; end if; end $$;
do $$ begin if to_regclass('public.ai_thong_ke_sua') is not null and to_regclass('public.ai_edit_stats') is null
  then execute 'alter table public.ai_thong_ke_sua rename to ai_edit_stats'; end if; end $$;
do $$ begin if to_regclass('public.ai_tom_tat') is not null and to_regclass('public.ai_thread_summary') is null
  then execute 'alter table public.ai_tom_tat rename to ai_thread_summary'; end if; end $$;

-- ── Cột ─────────────────────────────────────────────────────────────────────
--
-- Duyệt theo bảng đối chiếu thay vì liệt kê từng cặp bảng-cột: cùng một tên cột
-- xuất hiện ở nhiều bảng (cap_nhat_luc, dang_dung, ghi_chu) và đều phải đổi
-- giống nhau. Liệt kê tay chừng đó cặp thì chắc chắn sót.
do $$
declare
  r record;
  bd jsonb := '{"pham_vi":"scope","tinh_nang":"feature","dang_tat":"is_disabled","ly_do":"reason","loai_khach":"guest_type","cau_mo":"opening_line","cau_ket":"closing_line","tu_nen_dung":"preferred_words","tu_tranh":"avoided_words","han_muc_ngay":"daily_limit_usd","han_muc_thang":"monthly_limit_usd","canh_bao_o":"warn_at_ratio","cau_hoi":"question","ket_qua":"outcome","y_dinh":"blocked_intent","so_ung_vien":"candidate_count","ban_nhap":"draft","ly_do_chan":"block_reason","lop_chan":"block_layer","model_chat":"chat_model","model_rerank":"rerank_model","model_embed":"embed_model","model_du_phong":"fallback_model","loi_loai":"error_type","loi_msg":"error_message","token_vao":"input_tokens","token_ra":"output_tokens","chi_phi":"cost_usd","tu_cache":"from_cache","nhan_y_dinh":"intent_label","cam_xuc":"sentiment","do_gap":"urgency","tinh_huong":"situation","ban_goc":"original_draft","ban_da_sua":"edited_draft","ty_le_sua":"edit_ratio","nguoi_sua":"edited_by","da_gui":"was_sent","khoa":"key","so_luot":"update_count","het_han_luc":"expires_at","so_ban":"draft_count","ty_le_sua_tb":"avg_edit_ratio","dung_duoc_ngay":"usable_count","ty_le_dung_duoc":"usable_ratio","hash_noi_dung":"content_hash","so_tin":"message_count","tom_tat":"summary","y_chinh":"key_points","viec_con_treo":"open_items","bang":"table_name","ban_ghi_id":"record_id","hanh_dong":"action","nguoi":"actor","truoc":"before_data","sau":"after_data","ma_booking":"booking_code","ten_kenh":"channel_name","ma_xac_nhan_kenh":"channel_confirmation_code","ten_khach":"guest_name","email_khach":"guest_email","email_la_alias":"guest_email_is_alias","sdt_khach":"guest_phone","quoc_tich":"nationality","trang_thai_sync":"sync_status","trang_thai":"status","email_goc_path":"source_email_path","do_tin_cay":"confidence","da_sua_tay":"manually_edited","thu_tu":"position","ngay_den":"arrival_date","ngay_di":"departure_date","loai_phong_coh":"coh_room_type","ma_gia_coh":"coh_rate_code","so_phong":"room_count","so_khach_lon":"adult_count","so_tre_em":"child_count","yeu_cau_dac_biet":"special_requests","ma_xac_nhan_pms":"pms_confirmation_code","loai_ma":"code_type","ma_coh":"coh_code","ma_pms":"pms_code","hieu_luc_tu":"effective_from","hieu_luc_den":"effective_to","night_audit_tu":"night_audit_start","night_audit_den":"night_audit_end","bao_tri_tu":"maintenance_start","bao_tri_den":"maintenance_end","gioi_han_goi_phut":"rate_limit_per_minute","mui_gio":"timezone","khoa_chong_trung":"idempotency_key","so_lan_thu":"attempt_count","thu_lai_luc":"retry_at","phan_hoi":"response","nguoi_duyet":"approved_by","duyet_luc":"approved_at","ngon_ngu":"lang","dang_dung":"is_active","cap_nhat_boi":"updated_by","cap_nhat_luc":"updated_at","tao_luc":"created_at","phien_ban":"version","noi_dung":"body","ghi_chu":"note","mo_ta":"description","nguon":"source","diem":"score","ten":"name","ma":"code","so":"facts","boi":"set_by","luc":"created_at"}'::jsonb;
begin
  for r in
    select c.table_name, c.column_name
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'public'
      and t.table_type = 'BASE TABLE'
      and bd ? c.column_name
  loop
    execute format('alter table public.%I rename column %I to %I',
                   r.table_name, r.column_name, bd ->> r.column_name);
  end loop;
end $$;

-- ── Hàm ─────────────────────────────────────────────────────────────────────
do $$ begin if exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='ai_bi_tat')
  then execute (select string_agg(format('alter function public.%s(%s) rename to ai_is_disabled', p.proname, pg_get_function_identity_arguments(p.oid)), '; ')
                from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                where n.nspname='public' and p.proname='ai_bi_tat'); end if; end $$;
do $$ begin if exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='ai_chi_phi')
  then execute (select string_agg(format('alter function public.%s(%s) rename to ai_cost_status', p.proname, pg_get_function_identity_arguments(p.oid)), '; ')
                from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                where n.nspname='public' and p.proname='ai_chi_phi'); end if; end $$;
do $$ begin if exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='ai_giong_van_ap_dung')
  then execute (select string_agg(format('alter function public.%s(%s) rename to ai_tone_resolve', p.proname, pg_get_function_identity_arguments(p.oid)), '; ')
                from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                where n.nspname='public' and p.proname='ai_giong_van_ap_dung'); end if; end $$;
do $$ begin if exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='ai_log_chi_ghi_them')
  then execute (select string_agg(format('alter function public.%s(%s) rename to ai_log_append_only', p.proname, pg_get_function_identity_arguments(p.oid)), '; ')
                from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                where n.nspname='public' and p.proname='ai_log_chi_ghi_them'); end if; end $$;
do $$ begin if exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='ai_mau_thu_ap_dung')
  then execute (select string_agg(format('alter function public.%s(%s) rename to ai_reply_template_resolve', p.proname, pg_get_function_identity_arguments(p.oid)), '; ')
                from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                where n.nspname='public' and p.proname='ai_mau_thu_ap_dung'); end if; end $$;
do $$ begin if exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='ai_so_ghi_nho_don')
  then execute (select string_agg(format('alter function public.%s(%s) rename to ai_thread_memory_prune', p.proname, pg_get_function_identity_arguments(p.oid)), '; ')
                from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                where n.nspname='public' and p.proname='ai_so_ghi_nho_don'); end if; end $$;
do $$ begin if exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='audit_chi_ghi_them')
  then execute (select string_agg(format('alter function public.%s(%s) rename to audit_append_only', p.proname, pg_get_function_identity_arguments(p.oid)), '; ')
                from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                where n.nspname='public' and p.proname='audit_chi_ghi_them'); end if; end $$;
do $$ begin if exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='audit_tu_dong')
  then execute (select string_agg(format('alter function public.%s(%s) rename to audit_trigger', p.proname, pg_get_function_identity_arguments(p.oid)), '; ')
                from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                where n.nspname='public' and p.proname='audit_tu_dong'); end if; end $$;
do $$ begin if exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='dich_ma')
  then execute (select string_agg(format('alter function public.%s(%s) rename to map_code', p.proname, pg_get_function_identity_arguments(p.oid)), '; ')
                from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                where n.nspname='public' and p.proname='dich_ma'); end if; end $$;
do $$ begin if exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='rag_cache_don')
  then execute (select string_agg(format('alter function public.%s(%s) rename to rag_cache_prune', p.proname, pg_get_function_identity_arguments(p.oid)), '; ')
                from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                where n.nspname='public' and p.proname='rag_cache_don'); end if; end $$;
do $$ begin if exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='segment_dong_bo_nguon')
  then execute (select string_agg(format('alter function public.%s(%s) rename to segment_sync_guard', p.proname, pg_get_function_identity_arguments(p.oid)), '; ')
                from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                where n.nspname='public' and p.proname='segment_dong_bo_nguon'); end if; end $$;
do $$ begin if exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='sync_job_can_duyet')
  then execute (select string_agg(format('alter function public.%s(%s) rename to sync_job_require_approval', p.proname, pg_get_function_identity_arguments(p.oid)), '; ')
                from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                where n.nspname='public' and p.proname='sync_job_can_duyet'); end if; end $$;
