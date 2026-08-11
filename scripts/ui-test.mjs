// BỘ ĐO GIAO DIỆN — luồng sửa bản nháp.
//
// Chạy thật trang web trong DOM giả rồi bấm từng nút, kiểm cái nhìn thấy được
// sau mỗi bước. Không phải đọc code đoán, cũng không phải nhìn ảnh chụp.
//
// Có bộ này vì luồng sửa đã hỏng ba kiểu cùng lúc: ô sửa thay thẳng cả thân bản
// nháp nên mất nguồn dẫn, không có đường quay lại, và bỏ nháp xoá trắng không
// hỏi. Kiểu hỏng thứ tư lộ ra ngay lúc viết bộ đo này: gửi từ trong ô sửa thì
// vùng sửa bị xoá mà phần chữ vẫn đang ẩn — bong bóng rỗng không.
//
// Cần jsdom, không phải phụ thuộc lúc chạy thật:
//   npm i jsdom@24        (jsdom mới hơn chưa chạy được trên Node 21)
//   node server/app.mjs   (ở cửa sổ khác)
//   node scripts/ui-test.mjs

import { JSDOM } from 'jsdom';

const html = await (await fetch('http://localhost:5173/')).text();

const NHAP = 'Xin chào quý khách,\n\nGiờ nhận phòng là 14 giờ. [1]\n\nHẹn gặp quý khách,';
const GUI = [];
const json = (d) => ({ ok: true, json: async () => d, text: async () => JSON.stringify(d) });

// Phải cắm fetch giả TRƯỚC khi trang chạy: script của trang gọi mạng ngay lúc
// nạp, gán sau thì đã muộn.
const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  url: 'http://localhost:5173/',
  beforeParse(w) {
    w.fetch = async (u, o) => {
      const url = String(u);
      if (url.includes('/api/khoi-tao'))
        return json({ nguoiDung: [{ code: 'BIENXANH', name: 'Khách sạn Biển Xanh' }],
          cauHinh: {}, chiPhi: { homNay: 0, hanNgay: 5 }, dangTat: [],
          khoTriThuc: { tai_lieu: 32, doan: 115 } });
      if (url.includes('/api/gui')) {
        GUI.push(JSON.parse(o.body));
        return json({ tyLeSua: 0.12, thongKe: { draft_count: 1, usable_ratio: 1, avg_edit_ratio: 0.12, usable_count: 1 } });
      }
      return json({ dong: [] });
    };
  },
});
const { window } = dom;

await new Promise((r) => window.addEventListener('load', r));
await tick();

// Dựng một bong bóng nháp bằng chính hàm của trang
const bong = window.taoBongNhap();
const oNoi = bong.querySelector('[data-noi]');
window.ketThuc(bong, oNoi, {
  ketQua: 'TRA_LOI', diem: 0.41, ms: 6200, logId: 7,
  banNhap: NHAP, nguon: [{ chunk_id: 'x', title: 'Giờ nhận phòng' }],
}, NHAP);

const nut = () => [...bong.querySelectorAll('.nut-hang button')].map((b) => b.textContent.trim());
const bam = (ten) => {
  const b = [...bong.querySelectorAll('.nut-hang button')].find((x) => x.textContent.trim() === ten);
  if (!b) throw new Error(`không thấy nút "${ten}" — đang có: ${nut().join(' / ')}`);
  b.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
};
const oSua = () => bong.querySelector('.o-sua');
const chuHien = () => {
  const c = bong.querySelector('.chu-nhap');
  return c.style.display === 'none' ? null : c.textContent;
};
const co = (s) => bong.textContent.includes(s);

let loi = 0;
const kiem = (ten, dieu, thuc) => {
  if (dieu) console.log(`  ✓ ${ten}`);
  else { loi++; console.log(`  ✗ ${ten}${thuc !== undefined ? `  → thực tế: ${JSON.stringify(thuc)}` : ''}`); }
};

console.log('\n① Trạng thái xem ban đầu');
kiem('ba nút đúng', JSON.stringify(nut()) === '["Gửi ngay","Sửa rồi gửi","Bỏ nháp"]', nut());
kiem('hiện chữ bản nháp', chuHien() === NHAP);
kiem('có dẫn nguồn', co('Nguồn:'));
kiem('chưa có ô sửa', !oSua());

console.log('\n② Bấm Sửa rồi gửi');
bam('Sửa rồi gửi');
kiem('có ô sửa', !!oSua());
kiem('ô sửa mang đúng nội dung', oSua()?.value === NHAP);
kiem('chữ tĩnh được ẩn đi', chuHien() === null);
kiem('nguồn dẫn vẫn còn', co('Nguồn:'));
kiem('có nút Quay lại', nut().includes('Quay lại'));
kiem('có mẹo phím tắt', co('Esc'));

console.log('\n③ Sửa nội dung rồi bấm Quay lại');
const SUA = NHAP.replace('14 giờ', '2 giờ chiều');
oSua().value = SUA;
oSua().dispatchEvent(new window.Event('input'));
kiem('hiện lối khôi phục bản gốc', co('Khôi phục bản gốc'));
bam('Quay lại');
kiem('đã đóng ô sửa', !oSua());
kiem('chữ hiện lại, giữ phần đã sửa', chuHien() === SUA, chuHien());
kiem('nhãn báo đã sửa chưa gửi', co('đã sửa · chưa gửi'));
kiem('nút đổi thành Gửi bản đã sửa', nut().includes('Gửi bản đã sửa'), nut());
kiem('nút đổi thành Sửa tiếp', nut().includes('Sửa tiếp'), nut());
kiem('nguồn dẫn vẫn còn', co('Nguồn:'));

console.log('\n④ Vào sửa tiếp — phần đã sửa phải còn nguyên');
bam('Sửa tiếp');
kiem('ô sửa giữ bản đã sửa', oSua()?.value === SUA, oSua()?.value);
console.log('   nhấn Esc');
oSua().dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
kiem('Esc đóng ô sửa', !oSua());
kiem('vẫn giữ nội dung đã sửa', chuHien() === SUA, chuHien());

console.log('\n⑤ Bỏ nháp phải hỏi lại, bấm Không thì về như cũ');
bam('Bỏ nháp');
kiem('có hỏi lại', co('Bỏ bản nháp này?'));
kiem('cảnh báo mất phần đã sửa', co('đã sửa sẽ mất'));
kiem('bong bóng chưa bị xoá', !!bong.parentNode);
bam('Không');
kiem('về lại trạng thái xem', nut().includes('Sửa tiếp'), nut());
kiem('nội dung còn nguyên', chuHien() === SUA, chuHien());

console.log('\n⑥ Gửi thẳng từ trong ô sửa');
bam('Sửa tiếp');
const SUA2 = SUA + '\n\nTrân trọng.';
oSua().value = SUA2;
oSua().dispatchEvent(new window.Event('input'));
bam('Gửi bản đã sửa');
await tick();
kiem('đã gọi API gửi', GUI.length === 1);
kiem('gửi đúng bản đã sửa', GUI[0]?.banDaSua === SUA2);
kiem('gửi kèm bản gốc để đo tỉ lệ sửa', GUI[0]?.banGoc === NHAP);
kiem('ô sửa đã đóng', !oSua());
kiem('CHỮ HIỆN LẠI, không rỗng', chuHien() === SUA2, chuHien());
kiem('nhãn đã gửi', co('Đã gửi'));
kiem('không còn nút nào', nut().length === 0, nut());

console.log('\n⑦ Bỏ nháp thật sự thì mới xoá');
const b2 = window.taoBongNhap();
window.ketThuc(b2, b2.querySelector('[data-noi]'),
  { ketQua: 'TRA_LOI', diem: 0.4, ms: 100, logId: 8, banNhap: NHAP, nguon: [] }, NHAP);
const bam2 = (ten) => [...b2.querySelectorAll('.nut-hang button')]
  .find((x) => x.textContent.trim() === ten)
  .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
bam2('Bỏ nháp'); bam2('Bỏ');
kiem('bong bóng bị xoá', !b2.parentNode);

console.log(loi ? `\n❌ ${loi} chỗ sai\n` : '\n✅ tất cả đúng\n');
process.exit(loi ? 1 : 0);

function tick() { return new Promise((r) => setTimeout(r, 60)); }
