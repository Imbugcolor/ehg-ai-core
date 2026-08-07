// Đường ống RAG đầy đủ:
//   câu hỏi -> embedding -> truy vấn lai -> RERANK -> CỔNG TIN CẬY -> model chat -> guardrail
//
// Điểm quan trọng nhất: nếu độ tin cậy dưới ngưỡng thì DỪNG, KHÔNG gọi model chat.
// Model chat mà nhận ngữ cảnh rác sẽ viết ra một bản nháp trôi chảy và sai —
// dạng lỗi nguy hiểm nhất vì nhân viên bận sẽ tin nó.

import fs from 'node:fs';

for (const line of fs.readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
  const i = line.indexOf('=');
  if (i > 0) process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
}

const REF = process.env.SUPABASE_PROJECT_REF;
const PAT = process.env.ACCESS_TOKEN;
const ORK = process.env.OPEN_ROUTER_API_KEY;

const EMBED_MODEL = 'openai/text-embedding-3-small';
const RERANK_MODEL = 'cohere/rerank-v3.5';
const CHAT_MODEL = process.env.CHAT_MODEL || 'google/gemini-2.5-flash';
const DIM = 768;

const CANDIDATES = 20;   // lấy về từ truy vấn lai
const KEEP = 4;          // giữ lại sau rerank
const NGUONG = Number(process.env.RAG_THRESHOLD || 0.50); // cổng tin cậy
const DEBUG = process.argv.includes('--debug');

let cost = 0;

async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(j).slice(0, 300));
  return j;
}

async function or_(path, body) {
  const r = await fetch(`https://openrouter.ai/api/v1/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ORK}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  cost += j.usage?.cost ?? 0;
  return j;
}

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const vec = (a) => `'[${a.map((x) => x.toFixed(7)).join(',')}]'::extensions.vector(${DIM})`;

// --- Guardrail hai lớp -------------------------------------------------------
// Lớp 1 chỉ bắt những thứ KHÔNG THỂ xuất hiện hợp lệ. Bài học từ lần chạy trước:
// luật thô kiểu /còn phòng/ chặn nhầm câu "nhận phòng sớm nếu còn phòng trống" —
// một câu hoàn toàn đúng. Guardrail chặn nhầm câu đúng còn tệ hơn không có.
const LUAT_CUNG = [
  { re: /giá\s*phòng[^.]{0,40}?\b\d[\d.,]*\s*(nghìn|triệu|vnd|đồng|k)\b/i, ly: 'nêu giá phòng bằng số tiền cụ thể' },
  { re: /(chúng tôi|khách sạn)\s*(xin\s*)?(cam kết|đảm bảo)\s*(sẽ\s*)?(còn|có)\s*phòng/i, ly: 'cam kết còn phòng' },
  { re: /(huỷ|hủy)\s*(đặt phòng\s*)?(trên|qua|ở)\s*(ota|booking|agoda|expedia)[^.]{0,40}(đặt trực tiếp|đặt thẳng)/i, ly: 'mời khách huỷ OTA để đặt trực tiếp' },
];

// Lớp 2 dùng model, vì phủ định là thứ luật cứng không phân biệt được:
// "chúng tôi không thể hứa nâng hạng miễn phí" và "chúng tôi sẽ nâng hạng miễn phí
// cho quý khách" chỉ khác nhau một chữ, mà hậu quả thì ngược hẳn.
const KIEM_MODEL = process.env.GUARD_MODEL || 'google/gemini-2.5-flash-lite';

async function guardrail(text) {
  for (const g of LUAT_CUNG) if (g.re.test(text)) return { ...g, lop: 1 };

  const r = await or_('chat/completions', {
    model: KIEM_MODEL,
    messages: [
      {
        role: 'system',
        content: `Bạn kiểm duyệt bản nháp thư khách sạn. Trả về DUY NHẤT một JSON: {"vi_pham": true|false, "ly_do": "..."}

Đánh dấu vi_pham = true CHỈ KHI bản nháp thực sự làm một trong các việc sau:
- Nêu một mức giá phòng cụ thể
- Khẳng định chắc chắn còn phòng trống cho một ngày cụ thể
- Hứa nâng hạng phòng miễn phí
- Mời khách huỷ đặt phòng trên kênh OTA để đặt trực tiếp
- Đề nghị thanh toán ngoài kênh chính thức

KHÔNG đánh dấu vi phạm nếu bản nháp chỉ TỪ CHỐI, NÓI KHÔNG THỂ, hoặc HƯỚNG DẪN khách liên hệ bộ phận đặt phòng về những điều trên.`,
      },
      { role: 'user', content: text },
    ],
    max_tokens: 200,
    temperature: 0,
    reasoning: { enabled: false },
  });

  const raw = r.choices?.[0]?.message?.content ?? '';
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const v = JSON.parse(m[0]);
    return v.vi_pham ? { ly: v.ly_do || 'model kiểm duyệt từ chối', lop: 2 } : null;
  } catch {
    return null;
  }
}

const SYSTEM = `Bạn soạn BẢN NHÁP trả lời khách cho nhân viên khách sạn. Nhân viên sẽ đọc, sửa rồi mới gửi — bạn không bao giờ gửi trực tiếp.

QUY TẮC BẮT BUỘC:
1. Chỉ dùng thông tin có trong phần NGỮ CẢNH bên dưới. Tuyệt đối không thêm kiến thức ngoài.
2. Không có thông tin trong ngữ cảnh thì trả lời đúng một câu: "Không đủ cơ sở trong kho tri thức để trả lời câu này."
3. Không nêu giá phòng, không cam kết còn phòng, không hứa nâng hạng miễn phí — kể cả khi khách hỏi thẳng. Với những câu đó, hướng dẫn khách liên hệ bộ phận đặt phòng.
4. Cuối câu trả lời ghi nguồn theo dạng [số] tương ứng với số của đoạn ngữ cảnh đã dùng.
5. Viết tiếng Việt tự nhiên, lịch sự, ngắn gọn, xưng "chúng tôi" và gọi khách là "quý khách".`;

// --- Đường ống ---------------------------------------------------------------
async function traLoi(cauHoi, userId) {
  const t0 = Date.now();

  const e = await or_('embeddings', { model: EMBED_MODEL, input: cauHoi, dimensions: DIM });
  const qv = e.data[0].embedding;

  const rows = await sql(`
    begin;
    set local role authenticated;
    set local request.jwt.claims = '{"sub":"${userId}","role":"authenticated"}';
    select chunk_id, title, content, round(coalesce(similarity,0)::numeric,3) as sim
    from public.kb_search_hybrid(${vec(qv)}, ${q(cauHoi)}, 'vi', ${CANDIDATES}, 40);
    commit;`);
  const cands = (Array.isArray(rows) ? rows : []).filter((r) => r && r.title);

  if (!cands.length) return { quyetDinh: 'KHONG_DU_CO_SO', diem: 0, ms: Date.now() - t0 };

  const rr = await or_('rerank', {
    model: RERANK_MODEL,
    query: cauHoi,
    documents: cands.map((c) => `${c.title}. ${c.content}`),
    top_n: KEEP,
  });
  const ranked = (rr.results || []).map((x) => ({ ...cands[x.index], diem: x.relevance_score }));
  const diemCao = ranked[0]?.diem ?? 0;

  if (DEBUG) {
    console.log(`        điểm rerank: ${ranked.map((r) => r.diem.toFixed(3)).join(' / ')}`);
  }

  if (diemCao < NGUONG) {
    return { quyetDinh: 'KHONG_DU_CO_SO', diem: diemCao, ranked, ms: Date.now() - t0 };
  }

  const nguCanh = ranked
    .map((r, i) => `[${i + 1}] (${r.title}) ${r.content}`)
    .join('\n\n');

  const chat = await or_('chat/completions', {
    model: CHAT_MODEL,
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `NGỮ CẢNH:\n${nguCanh}\n\nCÂU HỎI CỦA KHÁCH: ${cauHoi}` },
    ],
    max_tokens: 900,
    temperature: 0.2,
    reasoning: { enabled: false },
  });
  const nhap = chat.choices?.[0]?.message?.content?.trim() ?? '(không sinh được)';
  const chan = await guardrail(nhap);

  return {
    quyetDinh: chan ? 'BI_CHAN' : 'TRA_LOI',
    lyDoChan: chan?.ly,
    lopChan: chan?.lop,
    diem: diemCao,
    nhap,
    ranked,
    ms: Date.now() - t0,
  };
}

// --- Chạy thử ---------------------------------------------------------------
const users = Object.fromEntries(
  (await sql(`select p.code, up.user_id from public.user_property up
              join public.property p on p.id = up.property_id;`)).map((r) => [r.code, r.user_id])
);

const CAU_HOI = [
  ['BIENXANH', 'mấy giờ được nhận phòng và trả phòng'],
  ['BIENXANH', 'bữa sáng phục vụ lúc mấy giờ'],
  ['BIENXANH', 'khách sạn có hồ bơi không'],
  ['BIENXANH', 'tôi mang chó theo được không'],
  ['BIENXANH', 'huỷ phòng trước bao lâu thì được hoàn tiền'],
  ['NUIDOI', 'mấy giờ được nhận phòng và trả phòng'],
  ['NUIDOI', 'khách sạn có hồ bơi không'],
  // ba câu kho tri thức CỐ Ý không có — phải bị chặn
  ['BIENXANH', 'giá phòng deluxe đêm nay bao nhiêu tiền'],
  ['BIENXANH', 'ngày mai còn phòng trống không'],
  ['BIENXANH', 'cho tôi nâng hạng phòng miễn phí được không'],
  // câu hoàn toàn ngoài phạm vi
  ['BIENXANH', 'thủ tục xin visa Nhật Bản thế nào'],
];

console.log(`Chat: ${CHAT_MODEL} · Rerank: ${RERANK_MODEL} · Ngưỡng: ${NGUONG}\n`);

for (const [code, cauHoi] of CAU_HOI) {
  const r = await traLoi(cauHoi, users[code]);
  const nhan =
    r.quyetDinh === 'TRA_LOI' ? '✅ TRẢ LỜI'
    : r.quyetDinh === 'BI_CHAN' ? `⛔ CHẶN Ở LỚP ${r.lopChan} (${r.lyDoChan})`
    : '🚫 KHÔNG ĐỦ CƠ SỞ';

  console.log(`[${code}] ${cauHoi}`);
  console.log(`   ${nhan}  ·  điểm ${r.diem.toFixed(3)}  ·  ${r.ms} ms`);
  if (r.nhap) console.log(`   ${r.nhap.replace(/\n/g, '\n   ')}`);
  console.log('');
}

console.log(`Chi phí đợt chạy: ${cost.toFixed(6)} USD`);
