// Nạp bộ tri thức từ data/kb/*.md vào Supabase.
//   • Mỗi tiêu đề "##" là một tài liệu (kb_document)
//   • Mỗi đoạn văn là một mẩu tri thức (kb_chunk)
// Chạy lại nhiều lần cho ra cùng kết quả: tài liệu cũ cùng tiêu đề bị xoá trước khi nạp.
//
// Dùng lớp kết nối chung ở modules/ai-core, nên đổi nhà cung cấp embedding
// chỉ cần sửa .env, không đụng vào file này.

import fs from 'node:fs';
import { embed, sql, chiPhi, q, vec } from '../modules/ai-core/adapters.mjs';
import { cfg } from '../modules/ai-core/env.mjs';

const MODEL = cfg.embedding.model;
const DIM = cfg.embedding.dim;
const EMBED_VERSION = process.env.EMBEDDING_VERSION_OVERRIDE || 'v4-token300-overlap15';
const EMBED_BATCH = 32;
const INSERT_BATCH = 25;

const KB_DIR = new URL('../data/kb/', import.meta.url);

function parseFile(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error(`thiếu phần frontmatter`);

  const meta = {};
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }

  const docs = [];
  for (const block of m[2].split(/^## /m).slice(1)) {
    const lines = block.split('\n');
    const title = lines[0].trim();
    const doanVan = lines
      .slice(1)
      .join('\n')
      .split(/\n\s*\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 20);
    const chunks = gomDoan(doanVan);
    if (chunks.length) docs.push({ title, chunks });
  }
  return { meta, docs };
}

// Cắt đoạn theo kích thước, có phần chồng lấn, và KHÔNG bao giờ gộp qua ranh
// giới tiêu đề — mỗi tài liệu cắt riêng.
//
// Vì sao đổi: cách cũ lấy mỗi đoạn văn làm một mẩu, ra chừng 40–60 token, quá
// nhỏ. Câu trả lời bị xé vụn nên tìm ra một mảnh mà thiếu vế còn lại. Thiết kế
// yêu cầu 200–500 token, chồng lấn 15%.
//
// Ước lượng token cho tiếng Việt: khoảng 3,5 ký tự một token với các bộ tách
// từ đa ngữ. Đây là ƯỚC LƯỢNG, không phải đếm thật — đủ dùng để gom đoạn.
const uocToken = (s) => Math.ceil(s.length / 3.5);
const TOKEN_MUC_TIEU = Number(process.env.CHUNK_TOKENS || 300);
const TY_LE_CHONG_LAN = Number(process.env.CHUNK_OVERLAP || 0.15);

function gomDoan(doanVan) {
  const ra = [];
  let hienTai = [];
  let token = 0;

  const chot = () => {
    if (!hienTai.length) return;
    ra.push(hienTai.join('\n\n'));
    // Giữ lại phần cuối làm chồng lấn, để câu bị cắt giữa chừng vẫn còn ngữ cảnh
    const canGiu = Math.round(TOKEN_MUC_TIEU * TY_LE_CHONG_LAN);
    const giu = [];
    let t = 0;
    for (let i = hienTai.length - 1; i >= 0 && t < canGiu; i--) {
      giu.unshift(hienTai[i]);
      t += uocToken(hienTai[i]);
    }
    hienTai = giu;
    token = t;
  };

  for (const d of doanVan) {
    const t = uocToken(d);
    // Đoạn nào tự nó đã vượt mức thì đứng riêng, không nhét chung
    if (t >= TOKEN_MUC_TIEU) {
      chot();
      ra.push(d);
      hienTai = [];
      token = 0;
      continue;
    }
    if (token + t > TOKEN_MUC_TIEU) chot();
    hienTai.push(d);
    token += t;
  }
  if (hienTai.length) ra.push(hienTai.join('\n\n'));

  // Bỏ mẩu trùng lặp hoàn toàn do phần chồng lấn sinh ra
  return [...new Set(ra)];
}

const t0 = Date.now();
console.log(`Model: ${MODEL} · ${DIM} chiều · phiên bản ${EMBED_VERSION}\n`);

const users = await sql(`select id from auth.users order by created_at limit 1;`);
if (!users.length) throw new Error('Chưa có người dùng nào để làm người duyệt tài liệu');
const approver = users[0].id;

const files = fs.readdirSync(KB_DIR).filter((f) => f.endsWith('.md')).sort();
let nDoc = 0;
let nChunk = 0;

for (const file of files) {
  const { meta, docs } = parseFile(new URL(file, KB_DIR));
  const isShared = meta.scope === 'chung';

  let propId = null;
  if (!isShared) {
    const p = await sql(
      `insert into public.property (code, name) values (${q(meta.property_code)}, ${q(meta.property_name)})
       on conflict (code) do update set name = excluded.name returning id;`
    );
    propId = p[0].id;
  }

  console.log(`── ${isShared ? 'Dùng chung cả chuỗi' : meta.property_name}  (${file})`);

  for (const doc of docs) {
    await sql(
      `delete from public.kb_document
       where title = ${q(doc.title)}
         and property_id is not distinct from ${propId ? `'${propId}'` : 'null'};`
    );

    const d = await sql(
      `insert into public.kb_document
         (property_id, title, topic, source_type, lang, status, approved_by, approved_at, owner_user_id, is_synthetic)
       values (${propId ? `'${propId}'` : 'null'}, ${q(doc.title)}, ${q(doc.title)}, 'sop',
               ${q(meta.lang || 'vi')}, 'published', '${approver}', now(), '${approver}',
               ${meta.synthetic === 'false' ? 'false' : 'true'})
       returning id;`
    );
    const docId = d[0].id;

    // Nhét tiêu đề vào trước nội dung khi sinh vector: đoạn tách khỏi tiêu đề
    // thì mất ngữ cảnh chủ đề và bị xếp hạng sai — đã đo được điều này.
    const toEmbed = doc.chunks.map((c) => `${doc.title}\n${c}`);
    const vectors = [];
    for (let i = 0; i < toEmbed.length; i += EMBED_BATCH) {
      vectors.push(...(await embed(toEmbed.slice(i, i + EMBED_BATCH))));
    }

    for (let i = 0; i < doc.chunks.length; i += INSERT_BATCH) {
      const slice = doc.chunks.slice(i, i + INSERT_BATCH);
      const values = slice
        .map((c, k) => {
          const idx = i + k;
          return `('${docId}',${propId ? `'${propId}'` : 'null'},${idx},${q(c)},${vec(vectors[idx])},${q(MODEL)},${DIM},${q(EMBED_VERSION)})`;
        })
        .join(',');
      await sql(
        `insert into public.kb_chunk
           (document_id, property_id, chunk_index, content, embedding, embedding_model, embedding_dim, embedding_version)
         values ${values};`
      );
    }

    nDoc++;
    nChunk += doc.chunks.length;
    console.log(`   ${doc.title}  —  ${doc.chunks.length} đoạn`);
  }
  console.log('');
}

const stat = await sql(`
  select
    (select count(*) from public.kb_document)                          as tai_lieu,
    (select count(*) from public.kb_chunk)                             as doan,
    (select count(distinct embedding_version) from public.kb_chunk)    as so_phien_ban,
    (select count(*) from public.property)                             as khach_san;`);

console.log('══ Tổng kết ══');
console.log(`   Nạp lần này : ${nDoc} tài liệu · ${nChunk} đoạn`);
console.log(`   Trong CSDL  : ${stat[0].tai_lieu} tài liệu · ${stat[0].doan} đoạn · ${stat[0].khach_san} khách sạn`);
console.log(`   Phiên bản vector đang tồn tại: ${stat[0].so_phien_ban}`);
console.log(`   Số lượt gọi : ${chiPhi.luotGoi}`);
console.log(`   Thời gian   : ${((Date.now() - t0) / 1000).toFixed(1)} giây`);
