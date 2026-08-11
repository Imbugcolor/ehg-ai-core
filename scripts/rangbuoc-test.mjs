// Kiểm ba ràng buộc cứng của mô hình dữ liệu nền.
// Đây là những chỗ mà một lỗi là hỏng quan hệ với khách hàng, nên phải chặn
// ở TẦNG DỮ LIỆU chứ không dựa vào kỷ luật của code.

import { sql, q } from '../modules/ai-core/adapters.mjs';

let dat = 0, truot = 0;
const kt = (ten, dung, ct = '') => {
  if (dung) { dat++; console.log(`  ✅ ${ten}`); }
  else { truot++; console.log(`  ❌ ${ten}${ct ? ' — ' + ct : ''}`); }
};

const thu = async (sqlText) => {
  try { await sql(sqlText); return { ok: true }; }
  catch (e) { return { ok: false, msg: String(e.message).slice(0, 200) }; }
};

const props = Object.fromEntries(
  (await sql(`select code, id from public.property;`)).map((r) => [r.code, r.id])
);
const uid = (await sql(`select id from auth.users limit 1;`))[0].id;

// dọn dữ liệu thử cũ
await sql(`delete from public.booking where booking_code like 'TEST-%';`);

// ─────────────────────────────────────────────────────────────────────────────
console.log('══ E2 · Booking OTA không bao giờ được đẩy sang PMS ══\n');
{
  await sql(`insert into public.booking (booking_code, source, channel_name, channel_confirmation_code, guest_name)
             values ('TEST-OTA', 'OTA', 'Agoda', 'AG-TEST-1', 'Khach OTA');`);
  const bId = (await sql(`select id from public.booking where booking_code = 'TEST-OTA';`))[0].id;

  await sql(`insert into public.booking_segment
             (booking_id, property_id, source, arrival_date, departure_date, coh_room_type, room_count, adult_count)
             values ('${bId}', '${props.BIENXANH}', 'DIRECT', '2026-09-10','2026-09-12','DLX',1,2);`);
  const seg = (await sql(`select id, source, sync_enabled from public.booking_segment where booking_id='${bId}';`))[0];

  kt('segment tự lấy nguồn từ booking cha, không tin giá trị truyền vào', seg.source === 'OTA',
     `đang là ${seg.source}`);
  kt('sync_enabled mặc định là false', seg.sync_enabled === false);

  const r = await thu(`update public.booking_segment set sync_enabled = true where id = '${seg.id}';`);
  kt('bật sync cho booking OTA → BỊ CHẶN', !r.ok && /E2/.test(r.msg), r.ok ? 'cho qua!' : r.msg.slice(0, 70));
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n══ Booking direct thì bật sync được ══\n');
{
  await sql(`insert into public.booking (booking_code, source, guest_name)
             values ('TEST-DIRECT', 'DIRECT', 'Khach Direct');`);
  const bId = (await sql(`select id from public.booking where booking_code='TEST-DIRECT';`))[0].id;
  await sql(`insert into public.booking_segment
             (booking_id, property_id, source, arrival_date, departure_date, coh_room_type, room_count, adult_count)
             values ('${bId}', '${props.BIENXANH}', 'DIRECT', '2026-09-10','2026-09-12','DLX',1,2);`);
  const seg = (await sql(`select id from public.booking_segment where booking_id='${bId}';`))[0];

  const r = await thu(`update public.booking_segment set sync_enabled = true where id='${seg.id}';`);
  kt('booking direct bật sync được bình thường', r.ok, r.msg);

  const r2 = await thu(`insert into public.booking_segment
    (booking_id, property_id, source, arrival_date, departure_date, coh_room_type, room_count, adult_count)
    values ('${bId}', '${props.BIENXANH}', 'DIRECT', '2026-09-12','2026-09-10','DLX',1,2);`);
  kt('ngày đi trước ngày đến → bị chặn', !r2.ok);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n══ E4 · Chưa có người duyệt thì không được đẩy ══\n');
{
  const seg = (await sql(`select s.id, s.property_id from public.booking_segment s
                          join public.booking b on b.id = s.booking_id
                          where b.booking_code='TEST-DIRECT' limit 1;`))[0];

  await sql(`insert into public.sync_job (segment_id, property_id, idempotency_key, payload)
             values ('${seg.id}', '${seg.property_id}', 'TEST-KHOA-1', '{}'::jsonb);`);
  const job = (await sql(`select id from public.sync_job where idempotency_key='TEST-KHOA-1';`))[0];

  const r = await thu(`update public.sync_job set status='dang_chay' where id='${job.id}';`);
  kt('chạy job chưa duyệt → BỊ CHẶN', !r.ok && /E4/.test(r.msg), r.ok ? 'cho qua!' : r.msg.slice(0, 70));

  await sql(`update public.sync_job set approved_by='${uid}', approved_at=now() where id='${job.id}';`);
  const r2 = await thu(`update public.sync_job set status='dang_chay' where id='${job.id}';`);
  kt('duyệt xong thì chạy được', r2.ok, r2.msg);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n══ E10 · Khoá chống trùng ══\n');
{
  const seg = (await sql(`select s.id, s.property_id from public.booking_segment s
                          join public.booking b on b.id=s.booking_id
                          where b.booking_code='TEST-DIRECT' limit 1;`))[0];
  const r = await thu(`insert into public.sync_job (segment_id, property_id, idempotency_key)
                       values ('${seg.id}', '${seg.property_id}', 'TEST-KHOA-1');`);
  kt('trùng khoá chống trùng → BỊ CHẶN ở tầng dữ liệu', !r.ok);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n══ Mapping Registry · không tìm thấy thì NÉM LỖI ══\n');
{
  await sql(`insert into public.mapping_registry (property_id, code_type, coh_code, pms_code)
             values ('${props.BIENXANH}', 'room_type', 'DELUXE_TWIN', 'DLX-T')
             on conflict do nothing;`);

  const ok = await sql(`select public.map_code('${props.BIENXANH}','room_type','DELUXE_TWIN') as code;`);
  kt('mã đã map → dịch đúng', ok[0].code === 'DLX-T', `được ${ok[0].code}`);

  const r = await thu(`select public.map_code('${props.BIENXANH}','room_type','CHUA_MAP');`);
  kt('mã chưa map → NÉM LỖI, không trả giá trị mặc định',
     !r.ok && /MAPPING_THIEU/.test(r.msg), r.ok ? 'trả về giá trị nào đó!' : '');

  const r2 = await thu(`select public.map_code('${props.NUIDOI}','room_type','DELUXE_TWIN');`);
  kt('cùng mã nhưng khách sạn khác → cũng ném lỗi', !r2.ok);
  console.log('     → đúng thiết kế: bản dịch mã theo TỪNG khách sạn, không dùng chung');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n══ E8 · Ghi vết bất biến ══\n');
{
  const n = await sql(`select count(*) as n from public.audit_log where table_name='booking';`);
  kt('thao tác trên booking tự sinh ghi vết', Number(n[0].n) > 0, `có ${n[0].n} dòng`);

  const r = await thu(`delete from public.audit_log where id = (select min(id) from public.audit_log);`);
  kt('xoá ghi vết → BỊ CHẶN', !r.ok && /chỉ được ghi thêm/.test(r.msg));

  const r2 = await thu(`update public.audit_log set note='sua trom' where id=(select min(id) from public.audit_log);`);
  kt('sửa ghi vết → BỊ CHẶN', !r2.ok);
}

// dọn
await sql(`delete from public.booking where booking_code like 'TEST-%';`);

console.log(`\n${'═'.repeat(62)}`);
console.log(`Đạt ${dat} · Trượt ${truot}`);
process.exit(truot === 0 ? 0 : 1);
