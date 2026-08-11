// Cấu hình tập trung. Mọi tên model và endpoint nằm ở đây, không rải trong code.
//
// Ba năng lực — embedding, rerank, chat — cấu hình ĐỘC LẬP nhau. Chúng không cần
// cùng một nhà cung cấp, và thường không nên: embedding là quyết định khó đảo
// ngược nhất vì đổi là phải nạp lại toàn bộ tri thức, còn chat là nơi phát sinh
// gần như toàn bộ chi phí.

import fs from 'node:fs';

const envPath = new URL('../../.env', import.meta.url);
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const i = line.indexOf('=');
    if (i > 0 && !line.trimStart().startsWith('#')) {
      const k = line.slice(0, i).trim();
      if (!process.env[k]) process.env[k] = line.slice(i + 1).trim();
    }
  }
}

const need = (k) => {
  const v = process.env[k];
  if (!v) throw new Error(`Thiếu biến môi trường: ${k}`);
  return v;
};
const or = (k, mac) => process.env[k] || mac;

// Mặc định lùi về OpenRouter nếu không khai báo riêng, để cấu hình cũ vẫn chạy.
const OR_BASE = 'https://openrouter.ai/api/v1';
const OR_KEY = process.env.OPEN_ROUTER_API_KEY || '';

export const cfg = {
  supabase: {
    ref: need('SUPABASE_PROJECT_REF'),
    pat: need('ACCESS_TOKEN'),
    url: process.env.SUPABASE_URL,
  },

  embedding: {
    base: or('EMBEDDING_BASE_URL', OR_BASE),
    key: or('EMBEDDING_API_KEY', OR_KEY),
    model: or('EMBEDDING_MODEL', 'openai/text-embedding-3-small'),
    dim: Number(or('EMBEDDING_DIM', 768)),
    version: or('EMBEDDING_VERSION', 'v1'),
  },

  rerank: {
    base: or('RERANK_BASE_URL', OR_BASE),
    key: or('RERANK_API_KEY', OR_KEY),
    model: or('RERANK_MODEL', 'cohere/rerank-v3.5'),
  },

  chat: {
    base: or('CHAT_BASE_URL', OR_BASE),
    key: or('CHAT_API_KEY', OR_KEY),
    model: or('CHAT_MODEL', 'google/gemini-2.5-flash'),
    guardModel: or('GUARD_MODEL', or('CHAT_MODEL', 'google/gemini-2.5-flash')),
    // Model dự phòng khi model chính lỗi. Thử lần lượt theo thứ tự.
    duPhong: (process.env.CHAT_MODEL_FALLBACK || '').split(',').map(s=>s.trim()).filter(Boolean),
  },

  phanLoai: or('AI_PHAN_LOAI', '1') !== '0',

  rag: {
    candidates: Number(or('RAG_CANDIDATES', 20)),
    keep: Number(or('RAG_KEEP', 4)),
    // ⚠ Ngưỡng gắn chặt với model rerank. Cohere v3.5 và Jina v2 cho thang điểm
    // khác hẳn nhau (0.42 so với 0.15 cho cùng một đoạn đúng). Đổi reranker là
    // PHẢI hiệu chuẩn lại bằng scripts/calibrate.mjs, không mang ngưỡng cũ sang.
    threshold: Number(or('RAG_THRESHOLD', 0.5)),
    // Ngưỡng RIÊNG cho từng ngôn ngữ hỏi.
    //
    // Câu hỏi tiếng Anh tra kho tiếng Việt cho thang điểm lệch hẳn so với câu
    // hỏi tiếng Việt: đo được cùng bộ xếp hạng, "Can I bring my dog" đạt 0,707
    // trong khi "What time is check-in" chỉ 0,342 và "airport pickup" 0,198.
    // Dải rộng hơn và thấp hơn tiếng Việt, nên dùng chung một ngưỡng là chặn
    // oan hàng loạt.
    //
    // Không khai báo thì lùi về ngưỡng chung — chạy được nhưng chưa hiệu chuẩn,
    // và scripts/calibrate.mjs sẽ nhắc.
    thresholdTheoNgonNgu: {
      en: process.env.RAG_THRESHOLD_EN ? Number(process.env.RAG_THRESHOLD_EN) : null,
    },
    maxTokens: Number(or('RAG_MAX_TOKENS', 1200)),
  },
};

export const laOpenRouter = (base) => base.includes('openrouter.ai');
