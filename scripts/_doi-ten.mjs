// Đổi tên định danh cơ sở dữ liệu sang tiếng Anh, trên toàn bộ mã nguồn.
//
//   node scripts/_doi-ten.mjs          -- chạy khô
//   node scripts/_doi-ten.mjs --that   -- chạy thật
//
// ── Ba cái bẫy, đều đã sập một lần rồi mới ra được cách này ────────────────
//
// 1. Thay mù \b<tên>\b trên cả tệp thì đổi luôn GIÁ TRỊ, không chỉ tên cột.
//    `tinh_nang` vừa là tên cột (ai_kill_switch.tinh_nang) vừa là một giá trị
//    enum ('toan_he','khach_san','tinh_nang'). Thay cả hai thì danh sách giá
//    trị thành nửa Việt nửa Anh.
//    -> Trong SQL, bỏ qua mọi thứ nằm giữa hai dấu nháy đơn.
//
// 2. Không phải chuỗi backtick nào trong JS cũng là SQL. Phần lớn là chuỗi
//    hiển thị, và ${ten} trong đó là BIẾN JS. Thay bừa thì `${ten}` thành
//    `${name}` trong khi tham số hàm vẫn tên là ten.
//    -> Chỉ thay trong backtick có dáng SQL.
//
// 3. Không phải .thuoc_tinh nào cũng là cột. Đối tượng kết quả của soanNhap có
//    trường `diem`, `nguon` — thay thành .score, .source là hỏng.
//    -> Chỉ thay tên CÓ GẠCH DƯỚI. Cột thì snake_case (ket_qua, ban_nhap),
//       trường JS thì một từ hoặc camelCase (diem, nguon, ketQua).
//
// Những cột một từ — diem, ten, ma, so, luc, boi, nguon, khoa, bang, nguoi,
// truoc, sau — vẫn được đổi trong SQL, nhưng chỗ JS đọc chúng phải sửa tay.
// Script in danh sách ở cuối để soát.

import fs from 'node:fs';
import path from 'node:path';
import { THEO_DO_DAI } from './_ten-tieng-anh.mjs';

const THAT = process.argv.includes('--that');
const GOC = process.cwd();
const BO_QUA = new Set(['node_modules', '.git', 'data']);

const dem = {};
const ghi = (cu, n) => { if (n) dem[cu] = (dem[cu] || 0) + n; };

function thay(s) {
  for (const [cu, moi] of THEO_DO_DAI) {
    const re = new RegExp(`\\b${cu}\\b`, 'g');
    const n = (s.match(re) || []).length;
    if (n) { ghi(cu, n); s = s.replace(re, moi); }
  }
  return s;
}

/** SQL: thay khắp, trừ phần nằm giữa hai dấu nháy đơn (hằng chuỗi, giá trị enum). */
function thaySql(s) {
  return s
    .split(/('(?:[^']|'')*')/)
    .map((phan, i) => (i % 2 === 1 ? phan : thay(phan)))
    .join('');
}

// JS/HTML: thay trên CẢ tệp, nhưng chỉ tên CÓ GẠCH DƯỚI, và bỏ qua phần nằm
// trong nháy đơn hoặc nháy kép.
//
// Cách trước tách theo backtick để tìm chuỗi SQL, và sập bẫy thứ tư — BACKTICK
// LỒNG NHAU. Chuỗi SQL nào chứa một template lồng bên trong thì backtick trong
// cắt đôi chuỗi ngoài, nửa sau không được đổi. Đây là kiểu hỏng khó thấy nhất
// vì nó im lặng: câu lệnh vẫn chạy, chỉ sai vài cột.
//
// Cách này không cần biết chuỗi nào là SQL. Trong dự án này, định danh
// snake_case CÓ GẠCH DƯỚI chỉ xuất hiện ở đúng hai chỗ:
//   • tên cột và tên bảng          -> cần đổi
//   • giá trị enum trong nháy đơn  -> KHÔNG được đổi
//     ('tinh_nang', 'soan_nhap', 'xin_loi_su_co', 'toan_he'…)
// Che phần trong nháy lại là đủ tách hai nhóm đó.
const NHAY = /('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/;

function thayJs(s) {
  return s
    .split(NHAY)
    .map((phan, i) => {
      if (i % 2 === 1) return phan;   // trong nháy: giá trị, giữ nguyên
      for (const [cu, moi] of THEO_DO_DAI) {
        if (!cu.includes('_')) continue;
        const re = new RegExp(`\\b${cu}\\b`, 'g');
        const n = (phan.match(re) || []).length;
        if (n) { ghi(cu, n); phan = phan.replace(re, moi); }
      }
      return phan;
    })
    .join('');
}

function duyet(thuMuc, ra = []) {
  for (const t of fs.readdirSync(thuMuc, { withFileTypes: true })) {
    if (BO_QUA.has(t.name)) continue;
    const p = path.join(thuMuc, t.name);
    if (t.isDirectory()) duyet(p, ra);
    else if (/\.(sql|mjs|html)$/.test(t.name) && !t.name.startsWith('_')) ra.push(p);
  }
  return ra;
}

let tongTep = 0;
for (const tep of duyet(GOC)) {
  const goc = fs.readFileSync(tep, 'utf8');
  const moi = tep.endsWith('.sql') ? thaySql(goc) : thayJs(goc);
  if (moi !== goc) {
    tongTep++;
    if (THAT) fs.writeFileSync(tep, moi);
  }
}

const top = Object.entries(dem).sort((a, b) => b[1] - a[1]);
console.log(`${THAT ? 'ĐÃ ĐỔI' : 'CHẠY KHÔ'} — ${tongTep} tệp · ${top.length} định danh · ${top.reduce((a, b) => a + b[1], 0)} chỗ`);

// Cột một từ: SQL đã đổi, còn chỗ JS đọc chúng phải soát tay.
const MOT_TU = THEO_DO_DAI.filter(([k]) => !k.includes('_')).map(([k, v]) => `${k}→${v}`);
console.log(`\nCỘT MỘT TỪ — SQL đã đổi, phải soát tay chỗ JS đọc:\n  ${MOT_TU.join(' · ')}`);
