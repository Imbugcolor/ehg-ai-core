// Thư viện giọng văn (HM3.6).
//
// Giọng văn nằm trong cơ sở dữ liệu, KHÔNG viết cứng trong prompt. Yêu cầu là
// "nghiệp vụ tự sửa mẫu, không cần dev" — sửa cách xưng hô hay câu mở đầu là
// việc của Marketing, không phải việc phải chờ triển khai lại code.
//
// Chọn bản phù hợp nhất theo thứ tự ưu tiên:
//   riêng khách sạn + đúng loại khách  >  riêng khách sạn + chung
//   >  cả chuỗi + đúng loại khách      >  cả chuỗi + chung

import { sql, q } from './adapters.mjs';

const NHO_TAM_MS = Number(process.env.AI_TONE_TTL_MS || 60_000);
const nhoTam = new Map();

// Nhãn ý định nào thì dùng giọng nào
const NHAN_SANG_LOAI_KHACH = {
  KHIEU_NAI: 'khieu_nai',
  DOAN_B2B: 'doan_b2b',
};

export function loaiKhachTheoNhan(nhan, khachVip = false) {
  if (khachVip) return 'vip';
  return NHAN_SANG_LOAI_KHACH[nhan] || 'chung';
}

export async function layGiongVan({ propertyId = null, loaiKhach = 'chung', ngonNgu = 'vi' } = {}) {
  const khoa = `${propertyId || '-'}|${loaiKhach}|${ngonNgu}`;
  const c = nhoTam.get(khoa);
  if (c && Date.now() - c.luc < NHO_TAM_MS) return c.data;

  const r = await sql(`
    select * from public.ai_giong_van_ap_dung(
      ${propertyId ? `'${propertyId}'` : 'null'}, ${q(loaiKhach)}, ${q(ngonNgu)});`);
  const data = r.length
    ? {
        moTa: r[0].mo_ta,
        cauMo: r[0].cau_mo,
        cauKet: r[0].cau_ket,
        tuNenDung: r[0].tu_nen_dung || [],
        tuTranh: r[0].tu_tranh || [],
      }
    : null;

  nhoTam.set(khoa, { luc: Date.now(), data });
  return data;
}

/** Ghép thành đoạn chỉ dẫn để chèn vào prompt. */
export function thanhChiDan(g) {
  if (!g) return '';
  const d = [`GIỌNG VĂN BẮT BUỘC: ${g.moTa}`];
  if (g.cauMo) d.push(`Mở đầu bằng: "${g.cauMo}"`);
  if (g.cauKet) d.push(`Kết thúc bằng: "${g.cauKet}"`);
  if (g.tuNenDung?.length) d.push(`Nên dùng: ${g.tuNenDung.join(', ')}`);
  if (g.tuTranh?.length) d.push(`TRÁNH dùng: ${g.tuTranh.join(', ')}`);
  return d.join('\n');
}

export function xoaNhoTam() {
  nhoTam.clear();
}
