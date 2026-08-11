// Đổi tên định danh cơ sở dữ liệu sang tiếng Anh, trên toàn bộ mã nguồn.
//
// Chạy khô trước để xem sẽ đổi gì:   node scripts/_doi-ten.mjs
// Chạy thật:                          node scripts/_doi-ten.mjs --that

import fs from 'node:fs';
import path from 'node:path';
import { THEO_DO_DAI, AN_TOAN_TRONG_JS, NGUY_HIEM_TRONG_JS } from './_ten-tieng-anh.mjs';

const THAT = process.argv.includes('--that');
const GOC = process.cwd();
const BO_QUA = new Set(['node_modules', '.git', 'data']);

function duyet(thuMuc, ra = []) {
  for (const t of fs.readdirSync(thuMuc, { withFileTypes: true })) {
    if (BO_QUA.has(t.name)) continue;
    const p = path.join(thuMuc, t.name);
    if (t.isDirectory()) duyet(p, ra);
    else if (/\.(sql|mjs|html)$/.test(t.name) && !t.name.startsWith('_')) ra.push(p);
  }
  return ra;
}

const dem = {};
let tongTep = 0;

for (const tep of duyet(GOC)) {
  const laSql = tep.endsWith('.sql');
  const banDo = laSql ? THEO_DO_DAI : AN_TOAN_TRONG_JS;

  const goc = fs.readFileSync(tep, 'utf8');
  let s = goc;
  for (const [cu, moi] of banDo) {
    const re = new RegExp(`\\b${cu}\\b`, 'g');
    const n = (s.match(re) || []).length;
    if (n) {
      dem[cu] = (dem[cu] || 0) + n;
      s = s.replace(re, moi);
    }
  }

  if (s !== goc) {
    tongTep++;
    const soDong = goc.split('\n').filter((d, i) => d !== s.split('\n')[i]).length;
    console.log(`  ${path.relative(GOC, tep).padEnd(52)} ${soDong} dòng`);
    if (THAT) fs.writeFileSync(tep, s);
  }
}

console.log(`\n${THAT ? 'ĐÃ ĐỔI' : 'CHẠY KHÔ'} — ${tongTep} tệp`);
const top = Object.entries(dem).sort((a, b) => b[1] - a[1]);
console.log(`${top.length} định danh, tổng ${top.reduce((a, b) => a + b[1], 0)} chỗ`);

// Nhắc lại những tên phải soát tay trong JS
console.log('\nCÒN PHẢI SOÁT TAY trong .mjs/.html (tên ngắn, trùng từ vựng JS):');
console.log('  ' + [...NGUY_HIEM_TRONG_JS].join(' · '));
