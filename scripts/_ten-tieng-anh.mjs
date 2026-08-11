// BẢN ĐỒ ĐỔI TÊN SANG TIẾNG ANH — nguồn duy nhất.
//
// Lược đồ ban đầu đặt tên tiếng Việt vì viết nhanh và dễ đọc khi một mình dựng
// thử. Nhưng đây là phần sẽ ghép vào hệ thống của team, và tên bảng thì đi theo
// suốt vòng đời dự án — đổi càng muộn càng đắt.
//
// Quy ước áp dụng:
//   • snake_case toàn bộ
//   • tên bảng là danh từ SỐ ÍT: booking, property, ai_tone
//   • boolean mở đầu bằng is_ hoặc has_
//   • mốc thời gian kết thúc bằng _at
//   • khoá ngoại là <bảng>_id
//   • số đếm kết thúc bằng _count, tỉ lệ kết thúc bằng _ratio
//   • đơn vị nằm trong tên khi dễ nhầm: _usd, _ms
//
// Thứ tự thay QUAN TRỌNG: chuỗi dài thay trước chuỗi ngắn, nếu không thì
// "ma_pms" nuốt mất "ma_xac_nhan_pms". Script đổi tên tự sắp xếp theo độ dài.

export const BANG = {
  ai_cong_tac: 'ai_kill_switch',
  ai_giong_van: 'ai_tone',
  ai_han_muc: 'ai_budget',
  ai_mau_thu: 'ai_reply_template',
  ai_nhap_da_sua: 'ai_draft_edit',
  ai_so_ghi_nho: 'ai_thread_memory',
  ai_thong_ke_sua: 'ai_edit_stats',
  ai_tom_tat: 'ai_thread_summary',
};

export const HAM = {
  ai_bi_tat: 'ai_is_disabled',
  ai_chi_phi: 'ai_cost_status',
  ai_giong_van_ap_dung: 'ai_tone_resolve',
  ai_log_chi_ghi_them: 'ai_log_append_only',
  ai_mau_thu_ap_dung: 'ai_reply_template_resolve',
  ai_so_ghi_nho_don: 'ai_thread_memory_prune',
  audit_chi_ghi_them: 'audit_append_only',
  audit_tu_dong: 'audit_trigger',
  dich_ma: 'map_code',
  rag_cache_don: 'rag_cache_prune',
  segment_dong_bo_nguon: 'segment_sync_guard',
  sync_job_can_duyet: 'sync_job_require_approval',
};

// Cột. Gom theo bảng cho dễ soát, nhưng khi thay thì trộn chung — tên cột
// trùng nhau giữa các bảng đều được đổi giống nhau, đó là điều mong muốn.
export const COT = {
  // ai_kill_switch
  pham_vi: 'scope',
  tinh_nang: 'feature',
  dang_tat: 'is_disabled',
  ly_do: 'reason',

  // ai_tone
  loai_khach: 'guest_type',
  cau_mo: 'opening_line',
  cau_ket: 'closing_line',
  tu_nen_dung: 'preferred_words',
  tu_tranh: 'avoided_words',

  // ai_budget
  han_muc_ngay: 'daily_limit_usd',
  han_muc_thang: 'monthly_limit_usd',
  canh_bao_o: 'warn_at_ratio',

  // ai_log
  cau_hoi: 'question',
  ket_qua: 'outcome',
  y_dinh: 'blocked_intent',
  so_ung_vien: 'candidate_count',
  ban_nhap: 'draft',
  ly_do_chan: 'block_reason',
  lop_chan: 'block_layer',
  model_chat: 'chat_model',
  model_rerank: 'rerank_model',
  model_embed: 'embed_model',
  model_du_phong: 'fallback_model',
  loi_loai: 'error_type',
  loi_msg: 'error_message',
  token_vao: 'input_tokens',
  token_ra: 'output_tokens',
  chi_phi: 'cost_usd',
  tu_cache: 'from_cache',
  nhan_y_dinh: 'intent_label',
  cam_xuc: 'sentiment',
  do_gap: 'urgency',

  // ai_reply_template
  tinh_huong: 'situation',

  // ai_draft_edit
  ban_goc: 'original_draft',
  ban_da_sua: 'edited_draft',
  ty_le_sua: 'edit_ratio',
  nguoi_sua: 'edited_by',
  da_gui: 'was_sent',

  // ai_prompt
  khoa: 'key',

  // ai_thread_memory
  so_luot: 'update_count',
  het_han_luc: 'expires_at',

  // ai_edit_stats
  so_ban: 'draft_count',
  ty_le_sua_tb: 'avg_edit_ratio',
  dung_duoc_ngay: 'usable_count',
  ty_le_dung_duoc: 'usable_ratio',

  // ai_thread_summary
  hash_noi_dung: 'content_hash',
  so_tin: 'message_count',
  tom_tat: 'summary',
  y_chinh: 'key_points',
  viec_con_treo: 'open_items',

  // audit_log
  bang: 'table_name',
  ban_ghi_id: 'record_id',
  hanh_dong: 'action',
  nguoi: 'actor',
  truoc: 'before_data',
  sau: 'after_data',

  // booking
  ma_booking: 'booking_code',
  ten_kenh: 'channel_name',
  ma_xac_nhan_kenh: 'channel_confirmation_code',
  ten_khach: 'guest_name',
  email_khach: 'guest_email',
  email_la_alias: 'guest_email_is_alias',
  sdt_khach: 'guest_phone',
  quoc_tich: 'nationality',
  trang_thai_sync: 'sync_status',
  trang_thai: 'status',
  email_goc_path: 'source_email_path',
  do_tin_cay: 'confidence',
  da_sua_tay: 'manually_edited',

  // booking_segment
  thu_tu: 'position',
  ngay_den: 'arrival_date',
  ngay_di: 'departure_date',
  loai_phong_coh: 'coh_room_type',
  ma_gia_coh: 'coh_rate_code',
  so_phong: 'room_count',
  so_khach_lon: 'adult_count',
  so_tre_em: 'child_count',
  yeu_cau_dac_biet: 'special_requests',
  ma_xac_nhan_pms: 'pms_confirmation_code',

  // mapping_registry
  loai_ma: 'code_type',
  ma_coh: 'coh_code',
  ma_pms: 'pms_code',
  hieu_luc_tu: 'effective_from',
  hieu_luc_den: 'effective_to',

  // smile_server
  night_audit_tu: 'night_audit_start',
  night_audit_den: 'night_audit_end',
  bao_tri_tu: 'maintenance_start',
  bao_tri_den: 'maintenance_end',
  gioi_han_goi_phut: 'rate_limit_per_minute',
  mui_gio: 'timezone',

  // sync_job
  khoa_chong_trung: 'idempotency_key',
  so_lan_thu: 'attempt_count',
  thu_lai_luc: 'retry_at',
  phan_hoi: 'response',
  nguoi_duyet: 'approved_by',
  duyet_luc: 'approved_at',

  // dùng chung nhiều bảng
  ngon_ngu: 'lang',
  dang_dung: 'is_active',
  cap_nhat_boi: 'updated_by',
  cap_nhat_luc: 'updated_at',
  tao_luc: 'created_at',
  phien_ban: 'version',
  noi_dung: 'body',
  ghi_chu: 'note',
  mo_ta: 'description',
  nguon: 'source',
  diem: 'score',
  ten: 'name',
  ma: 'code',
  so: 'facts',
  boi: 'set_by',
  luc: 'at',
};

export const TAT_CA = { ...BANG, ...HAM, ...COT };

/** Sắp xếp dài trước ngắn để chuỗi ngắn không nuốt mất chuỗi dài. */
export const THEO_DO_DAI = Object.entries(TAT_CA).sort((a, b) => b[0].length - a[0].length);

// Những tên NGẮN và trùng với từ vựng JS trong code. Thay tự động là hỏng:
// `so` là biến đếm, `ten` là nhãn hiển thị, `diem` là điểm tin cậy trong đối
// tượng kết quả — không phải cột cơ sở dữ liệu.
//
// Tệp SQL thì thay được vì ở đó chúng chắc chắn là tên cột. Tệp .mjs và .html
// phải soát từng chỗ.
export const NGUY_HIEM_TRONG_JS = new Set([
  'ma', 'so', 'ten', 'luc', 'boi', 'diem', 'nguon', 'khoa',
  'bang', 'nguoi', 'truoc', 'sau', 'phan_hoi', 'nguon',
]);

/** Chỉ những tên chắc chắn là định danh cơ sở dữ liệu, thay được trong JS. */
export const AN_TOAN_TRONG_JS = THEO_DO_DAI.filter(([k]) => !NGUY_HIEM_TRONG_JS.has(k));
