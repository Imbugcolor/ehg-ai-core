// Bảng điều khiển thử AI Core.
//
// Không dùng framework nào và không cần cài gói nào — chạy được ngay bằng
// `node server/app.mjs`. Đây là CÔNG CỤ THỬ, không phải sản phẩm: khi chốt
// framework giao diện thì bỏ thư mục này đi, phần lõi ở modules/ giữ nguyên.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { soanNhap, cfg } from '../modules/ai-core/index.mjs';
import { sql, q } from '../modules/ai-core/adapters.mjs';
import { tomTat } from '../modules/ai-core/summarize.mjs';
import { tat, bat, kiemTraTat, xoaNhoTam } from '../modules/ai-core/switch.mjs';
import { tinhTrangChiPhi, datHanMuc } from '../modules/ai-core/budget.mjs';
import { ghiNhanSua, thongKe } from '../modules/ai-core/feedback.mjs';

const THU_MUC = path.dirname(fileURLToPath(import.meta.url));
const CONG = Number(process.env.PORT || 5173);

const json = (res, data, code = 200) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
};

// Gom Buffer rồi mới giải mã MỘT lần theo utf8.
// Ghép kiểu `s += chunk` sẽ giải mã từng mảnh, và nếu ranh giới mảnh rơi vào
// giữa một ký tự nhiều byte thì chữ tiếng Việt hỏng — đo được: câu hỏi biến
// thành "gi� ph�ng", luật ý định không khớp và điểm tìm kiếm tụt còn 0.101.
const docBody = (req) =>
  new Promise((ok, loi) => {
    const manh = [];
    req.on('data', (c) => manh.push(c));
    req.on('error', loi);
    req.on('end', () => {
      try {
        const s = Buffer.concat(manh).toString('utf8');
        ok(s ? JSON.parse(s) : {});
      } catch (e) { loi(e); }
    });
  });

// Danh sách người dùng thử, nạp một lần lúc khởi động
let NGUOI_DUNG = [];
async function napNguoiDung() {
  NGUOI_DUNG = await sql(`
    select p.code, p.name, p.id::text as property_id, up.user_id::text as user_id
    from public.user_property up
    join public.property p on p.id = up.property_id
    order by p.code;`);
}

const timNguoi = (code) => NGUOI_DUNG.find((u) => u.code === code) || NGUOI_DUNG[0];

const API = {
  async 'GET /api/khoi-tao'() {
    const [chiPhi, tatAll, tk] = await Promise.all([
      tinhTrangChiPhi({ batBuocMoi: true }),
      sql(`select pham_vi, property_id::text as property_id, tinh_nang, ly_do
           from public.ai_cong_tac where dang_tat;`),
      thongKe().catch(() => null),
    ]);
    const kb = await sql(`
      select (select count(*) from public.kb_document) as tai_lieu,
             (select count(*) from public.kb_chunk)    as doan;`);
    return {
      nguoiDung: NGUOI_DUNG,
      cauHinh: {
        embedding: cfg.embedding.model,
        chieu: cfg.embedding.dim,
        rerank: cfg.rerank.model,
        chat: cfg.chat.model,
        kiemDuyet: cfg.chat.guardModel,
        nguong: cfg.rag.threshold,
      },
      chiPhi,
      dangTat: tatAll,
      khoTriThuc: kb[0],
      thongKeSua: tk?.tong ?? null,
    };
  },

  async 'POST /api/soan-nhap'(body) {
    const u = timNguoi(body.code);
    const r = await soanNhap(String(body.cauHoi || '').trim(), {
      userId: u.user_id,
      propertyId: u.property_id,
    });
    return { ...r, khachSan: u.name };
  },

  async 'POST /api/gui'(body) {
    // Ở đây CHƯA gửi email thật — đường gửi mail còn chờ chốt (câu hỏi T8 gửi
    // anh Tuấn). Hiện chỉ ghi nhận nhân viên đã duyệt và bấm gửi, kèm tỉ lệ sửa.
    const ty = await ghiNhanSua({
      logId: body.logId ?? null,
      banGoc: body.banGoc,
      banDaSua: body.banDaSua ?? body.banGoc,
      nhanYDinh: body.nhan ?? null,
      daGui: true,
    });
    await sql(`
      insert into public.audit_log (bang, ban_ghi_id, hanh_dong, ghi_chu)
      values ('ai_log', ${q(String(body.logId ?? '?'))}, 'gui_mail',
              ${q(`nhân viên duyệt và gửi, sửa ${(ty * 100).toFixed(1)}%`)});`);
    return { tyLeSua: ty, thongKe: (await thongKe()).tong };
  },

  async 'POST /api/ghi-nhan-sua'(body) {
    const ty = await ghiNhanSua({
      logId: body.logId ?? null,
      banGoc: body.banGoc,
      banDaSua: body.banDaSua,
      nhanYDinh: body.nhan ?? null,
      daGui: !!body.daGui,
    });
    return { tyLeSua: ty, thongKe: (await thongKe()).tong };
  },

  async 'POST /api/tom-tat'(body) {
    const u = timNguoi(body.code);
    const tin = String(body.hoiThoai || '')
      .split('\n')
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => {
        const i = d.indexOf(':');
        return i > 0
          ? { nguoi: d.slice(0, i).trim(), noi_dung: d.slice(i + 1).trim() }
          : { nguoi: 'Khách', noi_dung: d };
      });
    if (!tin.length) return { ketQua: 'THIEU_DU_LIEU' };
    return await tomTat(tin, {
      threadKey: body.threadKey || `ui-${Date.now()}`,
      propertyId: u.property_id,
    });
  },

  async 'POST /api/cong-tac'(body) {
    const u = body.code ? timNguoi(body.code) : null;
    const opt = {
      phamVi: body.phamVi,
      propertyId: body.phamVi === 'khach_san' ? u?.property_id : null,
      tinhNang: body.phamVi === 'tinh_nang' ? body.tinhNang : null,
    };
    if (body.hanhDong === 'tat') await tat({ ...opt, lyDo: body.lyDo || 'tắt từ bảng điều khiển' });
    else await bat(opt);
    xoaNhoTam();
    const conTat = await sql(`select pham_vi, property_id::text as property_id, tinh_nang, ly_do
                              from public.ai_cong_tac where dang_tat;`);
    return { dangTat: conTat };
  },

  async 'POST /api/han-muc'(body) {
    await datHanMuc({ ngay: body.ngay, thang: body.thang });
    return { chiPhi: await tinhTrangChiPhi({ batBuocMoi: true }) };
  },

  async 'GET /api/nhat-ky'() {
    const r = await sql(`
      select id, to_char(created_at at time zone 'Asia/Ho_Chi_Minh','HH24:MI:SS') as luc,
             left(cau_hoi, 70) as cau_hoi, ket_qua, y_dinh, nhan_y_dinh, cam_xuc, do_gap,
             diem, ms, tu_cache, loi_loai
      from public.ai_log order by id desc limit 25;`);
    return { dong: r };
  },
};

// Sinh nháp theo dòng chảy. Dùng SSE vì nó đơn giản hơn websocket và đủ dùng
// cho luồng một chiều từ máy chủ ra.
async function soanNhapStream(req, res) {
  const body = await docBody(req);
  const u = timNguoi(body.code);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const banTin = (loai, data) => res.write(`event: ${loai}\ndata: ${JSON.stringify(data)}\n\n`);

  try {
    const r = await soanNhap(String(body.cauHoi || '').trim(), {
      userId: u.user_id,
      propertyId: u.property_id,
      onToken: (mau) => banTin('mau', { mau }),
      onGiaiDoan: (g) => banTin('giai_doan', g),
    });
    banTin('xong', { ...r, khachSan: u.name });
  } catch (e) {
    banTin('loi', { loi: e.message?.slice(0, 300) || 'lỗi không rõ' });
  }
  res.end();
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const khoa = `${req.method} ${url.pathname}`;

  if (khoa === 'POST /api/soan-nhap-stream') {
    try { return await soanNhapStream(req, res); }
    catch (e) { console.error('[stream]', e.message); return res.end(); }
  }

  if (API[khoa]) {
    try {
      const body = req.method === 'POST' ? await docBody(req) : null;
      return json(res, await API[khoa](body));
    } catch (e) {
      console.error('[api]', khoa, e.message);
      return json(res, { loi: e.message?.slice(0, 300) || 'lỗi không rõ' }, 500);
    }
  }

  // Tệp tĩnh
  const ten = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const tep = path.join(THU_MUC, 'public', ten);
  if (!tep.startsWith(path.join(THU_MUC, 'public')) || !fs.existsSync(tep)) {
    res.writeHead(404).end('không tìm thấy');
    return;
  }
  const kieu = ten.endsWith('.html') ? 'text/html; charset=utf-8'
    : ten.endsWith('.js') ? 'text/javascript; charset=utf-8'
    : ten.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/plain; charset=utf-8';
  res.writeHead(200, { 'Content-Type': kieu });
  fs.createReadStream(tep).pipe(res);
});

await napNguoiDung();
server.listen(CONG, () => {
  console.log(`\n  Bảng điều khiển AI Core: http://localhost:${CONG}\n`);
  console.log(`  Người dùng thử: ${NGUOI_DUNG.map((u) => `${u.code} (${u.name})`).join(' · ')}`);
  console.log(`  Model: ${cfg.chat.model} · ngưỡng tin cậy ${cfg.rag.threshold}\n`);
});
