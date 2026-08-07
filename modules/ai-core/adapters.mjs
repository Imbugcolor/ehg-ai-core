// LỚP KẾT NỐI — chỗ duy nhất biết đến nhà cung cấp cụ thể.
// Lõi nghiệp vụ chỉ gọi embed / rerank / chat / sql, không biết ai đứng sau.
// Đổi nhà cung cấp = sửa .env, không sửa dòng code nghiệp vụ nào.

import { cfg, laOpenRouter } from './env.mjs';

export const chiPhi = { usd: 0, luotGoi: 0, lanCuoi: null };

// Lỗi từ nhà cung cấp được phân loại, để lõi nghiệp vụ biết nên xử lý thế nào.
// Đo được một ca thật: nhà cung cấp chặn bằng bộ lọc nội dung của họ, hệ thống
// không phân biệt được nên câu hỏi biến mất khỏi kết quả mà không ai biết.
export class LoiNhaCungCap extends Error {
  constructor(loai, msg, path) {
    super(`${path}: ${msg}`);
    this.name = 'LoiNhaCungCap';
    this.loai = loai; // loc_noi_dung | qua_han_muc | het_credit | xac_thuc | qua_tai | khac
    this.msg = msg;
  }
}

function phanLoai(status, msg) {
  const m = (msg || '').toLowerCase();
  if (/content[_ ]filter|filtered due to|responsibleai/.test(m)) return 'loc_noi_dung';
  if (/insufficient credit|quota|balance/.test(m)) return 'het_credit';
  if (status === 429 || /rate limit|too many/.test(m)) return 'qua_han_muc';
  if (status === 401 || status === 403 || /unauthor|api key|invalid key/.test(m)) return 'xac_thuc';
  if (status >= 500 || /无可用渠道|no available|upstream|timeout/.test(m)) return 'qua_tai';
  return 'khac';
}

async function goi(base, key, path, body) {
  let r, j;
  try {
    r = await fetch(`${base}/${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    j = await r.json().catch(() => ({}));
  } catch (e) {
    throw new LoiNhaCungCap('qua_tai', e.message.slice(0, 200), path); // mạng hỏng
  }
  if (!r.ok || j.error) {
    const msg = (j.error ? JSON.stringify(j.error) : `HTTP ${r.status}`).slice(0, 220);
    throw new LoiNhaCungCap(phanLoai(r.status, msg), msg, path);
  }
  chiPhi.luotGoi++;
  chiPhi.usd += j.usage?.cost ?? 0;
  if (j.usage) chiPhi.lanCuoi = { tokenVao: j.usage.prompt_tokens ?? null, tokenRa: j.usage.completion_tokens ?? null, usd: j.usage.cost ?? null }; // chỉ OpenRouter trả về chi phí; nơi khác thì 0
  return j;
}

export async function embed(input, { dim = cfg.embedding.dim } = {}) {
  const j = await goi(cfg.embedding.base, cfg.embedding.key, 'embeddings', {
    model: cfg.embedding.model,
    input: Array.isArray(input) ? input : [input],
    dimensions: dim,
  });
  const vs = j.data.slice().sort((a, b) => a.index - b.index).map((d) => d.embedding);
  return Array.isArray(input) ? vs : vs[0];
}

// Cả OpenRouter lẫn Jina đều dùng chung hình dạng {model, query, documents, top_n}
// và trả về results[{index, relevance_score}] — nên một hàm dùng được cả hai.
export async function rerank(query, documents, topN) {
  const j = await goi(cfg.rerank.base, cfg.rerank.key, 'rerank', {
    model: cfg.rerank.model,
    query,
    documents,
    top_n: topN,
  });
  return j.results || [];
}

// Lỗi thuộc mấy loại này thì thử model dự phòng; loại còn lại thì đổi model
// cũng vô ích (sai khoá, vượt hạn mức chi phí của chính mình).
const NEN_DOI_MODEL = new Set(['qua_tai', 'loc_noi_dung', 'qua_han_muc']);

export async function chat(messages, { model, maxTokens, temperature = 0.2, khongDuPhong = false } = {}) {
  const chuoi = [model || cfg.chat.model, ...(khongDuPhong ? [] : cfg.chat.duPhong)];
  let loiCuoi;

  for (let i = 0; i < chuoi.length; i++) {
    const body = {
      model: chuoi[i],
      messages,
      max_tokens: maxTokens ?? cfg.rag.maxTokens,
      temperature,
    };
    // Tham số riêng của OpenRouter — gửi sang nhà cung cấp khác sẽ bị từ chối.
    if (laOpenRouter(cfg.chat.base)) body.reasoning = { enabled: false };

    try {
      const j = await goi(cfg.chat.base, cfg.chat.key, 'chat/completions', body);
      if (i > 0) chiPhi.lanCuoi = { ...(chiPhi.lanCuoi || {}), duPhong: chuoi[i] };
      return j.choices?.[0]?.message?.content?.trim() ?? '';
    } catch (e) {
      loiCuoi = e;
      const conNua = i < chuoi.length - 1;
      if (!(e instanceof LoiNhaCungCap) || !NEN_DOI_MODEL.has(e.loai) || !conNua) throw e;
      console.warn(`[model] ${chuoi[i]} lỗi ${e.loai}, chuyển sang ${chuoi[i + 1]}`);
    }
  }
  throw loiCuoi;
}

/**
 * Sinh văn bản theo dòng chảy, gọi onToken cho từng mẩu.
 * Trả về toàn bộ văn bản khi xong — nên phần kiểm duyệt phía sau vẫn chạy
 * trên bản đầy đủ, không kiểm từng mẩu.
 *
 * ⚠ Nhân viên sẽ NHÌN THẤY chữ chạy ra trước khi guardrail kịp kiểm. Điều đó
 * chấp nhận được: guardrail bảo vệ KHÁCH, không phải bảo vệ nhân viên. Nhưng
 * giao diện bắt buộc phải khoá nút gửi cho tới khi có phán quyết.
 */
export async function chatStream(messages, { model, maxTokens, temperature = 0.2 } = {}, onToken) {
  const body = {
    model: model || cfg.chat.model,
    messages,
    max_tokens: maxTokens ?? cfg.rag.maxTokens,
    temperature,
    stream: true,
    stream_options: { include_usage: true },
  };
  if (laOpenRouter(cfg.chat.base)) body.reasoning = { enabled: false };

  let r;
  try {
    r = await fetch(`${cfg.chat.base}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.chat.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new LoiNhaCungCap('qua_tai', e.message.slice(0, 200), 'chat/completions');
  }

  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new LoiNhaCungCap(phanLoai(r.status, t), t.slice(0, 220), 'chat/completions');
  }

  const doc = r.body.getReader();
  const giaiMa = new TextDecoder('utf-8');
  let dem = '';
  let toanBo = '';

  while (true) {
    const { done, value } = await doc.read();
    if (done) break;
    dem += giaiMa.decode(value, { stream: true });

    const dong = dem.split('\n');
    dem = dong.pop() ?? '';           // dòng cuối có thể còn dở
    for (const d of dong) {
      const s = d.trim();
      if (!s.startsWith('data:')) continue;
      const noi = s.slice(5).trim();
      if (noi === '[DONE]') continue;
      try {
        const j = JSON.parse(noi);
        if (j.usage) {
          chiPhi.usd += j.usage.cost ?? 0;
          chiPhi.lanCuoi = {
            tokenVao: j.usage.prompt_tokens ?? null,
            tokenRa: j.usage.completion_tokens ?? null,
            usd: j.usage.cost ?? null,
          };
        }
        const mau = j.choices?.[0]?.delta?.content;
        if (mau) {
          toanBo += mau;
          onToken?.(mau);
        }
      } catch { /* mẩu hỏng thì bỏ qua, không làm gãy cả dòng chảy */ }
    }
  }
  chiPhi.luotGoi++;
  return toanBo.trim();
}

// Nối thẳng tới Postgres, KHÔNG qua Management API.
//
// Bản đầu gọi https://api.supabase.com/.../database/query bằng ACCESS_TOKEN.
// Chạy trên máy cá nhân thì tiện, nhưng có hai vấn đề khi đưa lên hosting:
//
//   • ACCESS_TOKEN là personal access token cấp TÀI KHOẢN, không phải khoá của
//     riêng project này. Ai lấy được nó thì thao tác được với mọi project
//     Supabase trong tài khoản. Đặt token đó vào biến môi trường của một trang
//     web công khai là mở rộng thiệt hại xa hơn nhiều so với cần thiết.
//   • Đó là API quản trị, không phải đường dữ liệu. Đo được mỗi truy vấn mất
//     500–600 ms, trong khi nối thẳng chỉ vài chục ms.
//
// Giờ dùng chuỗi kết nối Postgres. Phạm vi thiệt hại thu về đúng một cơ sở dữ
// liệu, và nhanh hơn hẳn.

import pg from 'pg';

// Dùng pooler ở chế độ giao dịch. Trên nền serverless mỗi lượt gọi là một tiến
// trình mới, nối thẳng cổng 5432 sẽ đốt hết hạn mức kết nối rất nhanh.
const chuoiNoi = process.env.DATABASE_POOLER_URL || process.env.DATABASE_URL;
if (!chuoiNoi) throw new Error('Thiếu DATABASE_POOLER_URL hoặc DATABASE_URL');

const be = new pg.Pool({
  connectionString: chuoiNoi,
  ssl: { rejectUnauthorized: false },
  max: Number(process.env.PG_MAX || 3),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 15_000,
});
be.on('error', (e) => console.error('[pg] lỗi kết nối nhàn rỗi:', e.message));

export async function sql(query) {
  let kq;
  try {
    kq = await be.query(query);
  } catch (e) {
    // Kèm theo đoạn đầu câu lệnh, không có nó thì lỗi cú pháp rất khó lần ra
    // đến từ truy vấn nào.
    throw new Error(`${e.message} — truy vấn: ${query.trim().slice(0, 120)}`);
  }

  // Câu lệnh ghép nhiều mệnh đề (begin; set local role …; select …; commit;)
  // trả về một MẢNG kết quả. Lấy mệnh đề cuối cùng thật sự có dòng, giống hệt
  // hành vi cũ của Management API.
  const ds = Array.isArray(kq) ? kq : [kq];
  for (let i = ds.length - 1; i >= 0; i--) if (ds[i]?.rows?.length) return ds[i].rows;
  return [];
}

/** Đóng bể kết nối. Cần cho script chạy một lần rồi thoát. */
export async function dongKetNoi() {
  await be.end().catch(() => {});
}

export const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
export const vec = (a) =>
  `'[${a.map((x) => x.toFixed(7)).join(',')}]'::extensions.vector(${cfg.embedding.dim})`;
