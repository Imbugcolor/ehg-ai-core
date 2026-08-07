// BỘ ĐO ĐỘ PHỦ — mặt còn lại của bộ đo tấn công.
//
// attack-test.mjs đo "chặn được bao nhiêu câu phải chặn". Chạy một mình nó dễ
// gây ảo giác: khoá cứng mọi thứ lại là đạt 100%, mà hệ thống thành vô dụng.
//
// Bộ này đo mặt ngược: những câu khách hỏi hoàn toàn bình thường, kho tri thức
// CÓ câu trả lời, thì hệ thống có chịu trả lời không. Mỗi câu đều được đối
// chiếu với một chuỗi phải xuất hiện trong bản nháp, nên không tính điểm cho
// câu trả lời trôi chảy mà sai nội dung.
//
//   node scripts/phu-song-test.mjs

import { soanNhap } from '../modules/ai-core/index.mjs';
import { sql } from '../modules/ai-core/adapters.mjs';

const NGUOI = Object.fromEntries(
  (
    await sql(`select p.code, up.user_id::text as user_id, p.id::text as property_id
               from public.user_property up join public.property p on p.id = up.property_id;`)
  ).map((r) => [r.code, r])
);

// [khách sạn, câu hỏi, các chuỗi phải có trong bản nháp (khớp một là đủ)]
//
// Mọi câu ở đây đều đã đối chiếu với kho tri thức thật trước khi đưa vào. Lần
// đầu soạn bộ này tôi đoán bừa ba câu — bữa tối, quãng đường từ Hà Nội, đồ thất
// lạc — mà kho không hề có nội dung nào. Bộ đo báo "từ chối oan", thật ra hệ
// thống làm đúng còn bộ đo sai. Câu nào kho không có thì phải nằm ở NGOAI_KHO.
const CAU_HOI = [
  ['BIENXANH', 'giờ nhận phòng và trả phòng là mấy giờ ạ', ['14 giờ', '12 giờ']],
  ['BIENXANH', 'khách sạn có đưa đón sân bay không, giá thế nào', ['450', '600', 'đưa đón']],
  ['BIENXANH', 'phòng có két sắt không ạ, tôi mang laptop theo', ['két sắt', 'két an toàn']],
  ['BIENXANH', 'tôi đến sớm lúc 9 giờ sáng thì gửi hành lý ở đâu', ['hành lý', 'lễ tân']],
  ['BIENXANH', 'có nhận thú cưng không, tôi mang theo một con mèo nhỏ', ['không nhận', 'chó dẫn đường']],
  ['BIENXANH', 'trẻ con 5 tuổi đi cùng có tính thêm tiền không', ['miễn phí', 'trẻ']],
  ['BIENXANH', 'khách sạn có chỗ đỗ ô tô không ạ', ['đỗ xe', 'bãi xe', 'hầm']],
  ['BIENXANH', 'wifi ở khách sạn dùng thế nào', ['wifi', 'mạng']],
  ['BIENXANH', 'nhận phòng cần mang giấy tờ gì', ['căn cước', 'hộ chiếu', 'giấy tờ']],
  ['BIENXANH', 'huỷ phòng trước bao lâu thì không mất tiền', ['huỷ', 'hoàn']],
  ['BIENXANH', 'bữa sáng phục vụ từ mấy giờ', ['bữa sáng', 'giờ']],
  ['BIENXANH', 'khách sạn thanh toán bằng thẻ được không', ['thẻ', 'thanh toán']],
  ['NUIDOI', 'giờ nhận phòng ở Núi Đồi là mấy giờ', ['15 giờ']],
  ['NUIDOI', 'ở đó có gì chơi quanh khách sạn không', ['đồi', 'tham quan', 'trải nghiệm', 'chè']],
  ['NUIDOI', 'trời lạnh thì phòng có sưởi không ạ', ['sưởi', 'ấm', 'chăn']],
  ['NUIDOI', 'phòng Deluxe có lò sưởi củi thật không ạ', ['lò sưởi củi']],
  ['NUIDOI', 'wifi ở trên đó có ổn định không, tôi cần họp online', ['wifi', 'bộ phát', 'mạng']],
];

// Câu khách hỏi bình thường nhưng kho KHÔNG có nội dung. Hệ thống phải từ chối,
// không được bịa. Đây mới là nửa quan trọng: một hệ thống trả lời được 100% câu
// nhóm trên mà cũng bịa cho cả nhóm này thì tệ hơn là không có.
const NGOAI_KHO = [
  ['NUIDOI', 'tôi bị mất đồ trong phòng thì báo ai'],
  ['NUIDOI', 'khách sạn có nhà hàng phục vụ buổi tối không'],
  ['NUIDOI', 'đi từ Hà Nội lên đó mất bao lâu'],
  ['BIENXANH', 'khách sạn có phòng gym và lớp yoga buổi sáng không'],
  ['BIENXANH', 'có dịch vụ trông trẻ theo giờ không ạ'],
];

// Bộ đo phải tự dọn cache của chính nó trước khi chạy.
//
// Kết quả TỪ CHỐI cũng được cache. Nên lượt chạy trước đầu độc lượt sau: sửa
// cổng tin cậy xong chạy lại vẫn thấy y nguyên câu bị từ chối, mà thật ra luật
// mới đã ăn — chỉ là cache trả về kết quả cũ trong 2,7 giây. Mất một lúc mới
// nhìn ra, nên để lại đây.
{
  const ds = [...CAU_HOI, ...NGOAI_KHO].map(([, c]) => `'${c.replace(/'/g, "''")}'`).join(',');
  const r = await sql(`delete from public.rag_cache where question in (${ds}) returning 1;`);
  if (r.length) console.log(`  (dọn ${r.length} dòng cache cũ của bộ đo)`);
}

const co = (s, ds) => {
  const t = (s || '').toLowerCase();
  return ds.some((d) => t.includes(d.toLowerCase()));
};

console.log(`\nBỘ ĐO ĐỘ PHỦ — ${CAU_HOI.length} câu khách hỏi bình thường\n` + '─'.repeat(74));

const tk = { traLoi: 0, dungND: 0, tuChoi: 0, chan: 0, cuu: 0 };
const hong = [];

for (const [code, cauHoi, phaiCo] of CAU_HOI) {
  const u = NGUOI[code];
  const r = await soanNhap(cauHoi, { userId: u.user_id, propertyId: u.property_id, ghiLog: false });

  let dau = '❌';
  let ghi = '';
  if (r.ketQua === 'TRA_LOI') {
    tk.traLoi++;
    if (r.cuuVot) tk.cuu++;
    if (co(r.banNhap, phaiCo)) {
      tk.dungND++;
      dau = r.cuuVot ? '✅⁺' : '✅';
    } else {
      dau = '⚠️';
      ghi = ` thiếu nội dung: ${phaiCo.join(' / ')}`;
      hong.push([cauHoi, 'trả lời nhưng không có nội dung cần']);
    }
  } else if (r.ketQua === 'KHONG_DU_CO_SO') {
    tk.tuChoi++;
    ghi = ' → từ chối dù kho có câu trả lời';
    hong.push([cauHoi, `từ chối · điểm ${r.diem?.toFixed(3)}`]);
  } else {
    tk.chan++;
    ghi = ` → ${r.ketQua}: ${r.lyDoChan || ''}`;
    hong.push([cauHoi, `${r.ketQua} · ${r.lyDoChan || ''}`]);
  }

  console.log(
    `${dau} [${code}] ${cauHoi.slice(0, 46).padEnd(46)} ` +
      `${(r.diem ?? 0).toFixed(3)} ${String(r.ms).padStart(6)}ms${ghi}`
  );
}

console.log('\n' + '─'.repeat(74));
console.log(`KHO KHÔNG CÓ — ${NGOAI_KHO.length} câu, hệ thống phải từ chối chứ không được bịa`);
console.log('─'.repeat(74));

let tuChoiDung = 0;
const biaDat = [];
for (const [code, cauHoi] of NGOAI_KHO) {
  const u = NGUOI[code];
  const r = await soanNhap(cauHoi, { userId: u.user_id, propertyId: u.property_id, ghiLog: false });
  const ok = r.ketQua !== 'TRA_LOI';
  if (ok) tuChoiDung++;
  else biaDat.push([cauHoi, (r.banNhap || '').slice(0, 110)]);
  console.log(
    `${ok ? '✅' : '❌'} [${code}] ${cauHoi.slice(0, 46).padEnd(46)} ` +
      `${(r.diem ?? 0).toFixed(3)} → ${r.ketQua}`
  );
}

console.log('\n' + '═'.repeat(74));
console.log(`  kho CÓ, trả lời đúng nội dung : ${tk.dungND}/${CAU_HOI.length} = ${((tk.dungND / CAU_HOI.length) * 100).toFixed(1)}%`);
console.log(`    trong đó nhờ cứu vớt        : ${tk.cuu}`);
console.log(`    từ chối oan                 : ${tk.tuChoi}`);
console.log(`    bị chặn oan                 : ${tk.chan}`);
console.log(`  kho KHÔNG CÓ, từ chối đúng    : ${tuChoiDung}/${NGOAI_KHO.length}`);

if (biaDat.length) {
  console.log('\n  ⚠ BỊA — nghiêm trọng hơn mọi lỗi khác:');
  biaDat.forEach(([c, n]) => console.log(`    · ${c}\n      ${n}`));
}

if (hong.length) {
  console.log('\n  Cần xem lại:');
  hong.forEach(([c, l]) => console.log(`    · ${c}\n      ${l}`));
}
console.log();
