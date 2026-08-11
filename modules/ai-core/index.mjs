// LÕI NGHIỆP VỤ — cổng duy nhất để sinh bản nháp trả lời khách.
//
// Đường đi bắt buộc:
//   câu hỏi
//     -> ① NHẬN DIỆN Ý ĐỊNH (luật cứng)   -- chặn giá / phòng trống / ưu đãi ngay
//     -> ② CACHE (khoá gồm phạm vi + phiên bản tri thức)
//     -> embedding -> truy vấn lai -> rerank
//     -> ② CỔNG TIN CẬY                   -- dưới ngưỡng thì dừng, không gọi model chat
//     -> ③ VÙNG LẪN thì hỏi lại ý định bằng model
//     -> model chat
//     -> ④ GUARDRAIL hai lớp              -- không có đường trả về nào bỏ qua
//
// Bốn chốt chặn, không đường vòng. Module này KHÔNG gửi gì cho khách —
// nó chỉ trả bản nháp để nhân viên duyệt.

import { cfg } from './env.mjs';
import { embed, rerank, chat, chatStream, sql, q, vec, LoiNhaCungCap } from './adapters.mjs';
import { kiemDuyet } from './guardrail.mjs';
import { nhanDienLuat, nhanDienBangModel, Y_DINH_CAM } from './intent.mjs';
import { ghiNhatKy } from './log.mjs';
import { taoKhoa, tim, luu } from './cache.mjs';
import { chuanBi } from './chuanbi.mjs';
import { phanLoai } from './classify.mjs';
import { layPrompt, layMauThu, tinhHuongTheoNhan, thanhChiDanMau, MAC_DINH } from './prompt.mjs';
import { layGiongVan, thanhChiDan, loaiKhachTheoNhan } from './tone.mjs';
import { chiPhi } from './adapters.mjs';

// Vùng lẫn: đo được hai dải điểm chồng lấn nhau, nên trong khoảng này một con số
// là không đủ để quyết. Ngoài khoảng thì tin cổng tin cậy, đỡ một lượt gọi model.
const VUNG_LAN = [cfg.rag.threshold, cfg.rag.threshold + 0.15];

// Sàn cứng cho đường cứu vớt. Dưới mức này thì dù dồn về một tài liệu cũng
// không cứu — bộ xếp hạng đang đoán mò chứ không phải khớp.
const SAN_CUU = 0.14;
// Đoạn đầu phải hơn đoạn đầu tiên của tài liệu KHÁC bao nhiêu lần mới tính là
// dồn thật sự.
//
// Con số này đang chỉnh trên mẫu nhỏ: 30 câu tấn công và 18 câu hợp lệ. Đặt 1,8
// thì trượt câu "trời lạnh phòng có sưởi không" — ba đoạn đầu đều cùng tài liệu
// và đều nói về sưởi, mà cách biệt chỉ 1,15 lần. Hạ xuống 1,1 và đo lại: bộ tấn
// công vẫn chặn đủ, vì các câu tấn công bị chặn ở điểm 0,07–0,10, nằm dưới sàn
// SAN_CUU nên không chạm tới luật này.
//
// Phải đo lại khi có dữ liệu câu hỏi thật, và phải đo lại khi đổi bộ xếp hạng.
const BOI_CACH_BIET = 1.1;
// Xét trong bao nhiêu đoạn đầu, và cần bao nhiêu đoạn cùng một tài liệu.
//
// Ban đầu đòi BA ĐOẠN ĐẦU LIÊN TIẾP cùng tài liệu. Điều kiện đó lật qua lật
// lại: câu "trời lạnh phòng có sưởi không" có đoạn thứ ba và thứ tư bằng điểm
// đúng bằng nhau (0,162), thứ tự hai đoạn hoà nhau đổi giữa các lượt chạy nên
// khi thì cứu được khi thì không — cùng một câu hỏi, cùng một kho.
//
// Đếm độ dồn trong năm đoạn đầu thì không phụ thuộc vào cách phá hoà, mà vẫn
// diễn đạt đúng ý cần đo: các đoạn có dồn về một tài liệu hay không.
const XET_TRONG = 5;
const CAN_CUNG_TAI_LIEU = 3;

// Truy hồi đúng nhưng điểm thấp thì các đoạn đầu sẽ dồn về cùng một tài liệu và
// bỏ xa phần còn lại. Truy hồi sai thì điểm thấp đi kèm phân tán — mỗi đoạn một
// tài liệu, cách biệt không đáng kể. Hàm này phân biệt hai trường hợp đó.
function xetDonTaiLieu(giuLai, diem) {
  if (diem < SAN_CUU || giuLai.length < CAN_CUNG_TAI_LIEU) return null;

  // Tài liệu đứng đầu phải chiếm đủ chỗ trong nhóm dẫn đầu. Xếp hạng nhất mà
  // các đoạn sau tản mát mỗi nơi một tài liệu thì đó là đoán mò, không phải khớp.
  const dau = giuLai[0].title;
  const dauNhom = giuLai.slice(0, XET_TRONG);
  const soDong = dauNhom.filter((g) => g.title === dau).length;
  if (soDong < CAN_CUNG_TAI_LIEU) return null;

  const khac = dauNhom.find((g) => g.title !== dau);
  // Không có tài liệu nào khác lọt vào nhóm dẫn đầu thì cách biệt coi như vô hạn.
  const diemKhac = khac?.diem ?? 0;
  if (diemKhac > 0 && diem < diemKhac * BOI_CACH_BIET) return null;

  return {
    taiLieu: dau,
    soDoanDong: soDong,
    cachBiet: diemKhac > 0 ? Number((diem / diemKhac).toFixed(2)) : null,
  };
}

const HE_THONG = MAC_DINH.soan_nhap;   // bản thật đọc từ bảng ai_prompt

// Model tự nhận không đủ cơ sở theo quy tắc 2. Câu đó KHÔNG phải bản nháp —
// đưa nguyên nó cho nhân viên dưới nhãn TRA_LOI là báo cáo sai: đường ống nói
// "đã trả lời được" trong khi thứ nó trả về là lời từ chối.
//
// Đo được ở câu "tôi bị mất đồ trong phòng thì báo ai": điểm 0,332 qua ngưỡng
// bình thường, cổng tin cậy cho đi, model đọc ngữ cảnh xong thấy không có nội
// dung nào về đồ thất lạc nên từ chối — mà kết quả vẫn ghi TRA_LOI.
//
// Bắt bằng cụm "kho tri thức" chứ không bằng nguyên câu ở quy tắc 2. Model
// không đọc thuộc lòng: đo được nó viết "chưa có thông tin cụ thể trong kho
// tri thức" thay vì đúng câu quy định, và bộ nhận diện khớp chuỗi cứng trượt
// ngay — bản nháp từ chối lọt xuống dưới nhãn TRA_LOI.
//
// "Kho tri thức" là từ nội bộ. Thư gửi khách không bao giờ được nhắc tới nó,
// nên bản nháp nào có cụm này thì hoặc là lời từ chối, hoặc là đang để lộ
// chuyện bên trong — cả hai đều không phải thứ đưa cho nhân viên gửi đi.
const TU_CHOI_CUA_MODEL = /kho tri thức|khong du co so/i;

/**
 * @returns {{ketQua:'TRA_LOI'|'KHONG_DU_CO_SO'|'BI_CHAN'|'CHAN_Y_DINH',
 *            diem:number, banNhap?:string, yDinh?:string,
 *            lyDoChan?:string, lopChan?:number, nguon?:Array, ms:number}}
 */
export async function soanNhap(cauHoi, { userId, lang = 'vi', propertyId = null, ghiLog = true, onToken = null, onGiaiDoan = null } = {}) {
  const t0 = Date.now();
  const ket = (o) => ({ ms: Date.now() - t0, ...o });

  // Nhà cung cấp lỗi thì KHÔNG chặn nhân viên làm việc (yêu cầu HM3.9) và
  // KHÔNG im lặng (nguyên tắc E9). Trả về kết quả rõ ràng để giao diện hiện
  // "không sinh được bản nháp, mời nhân viên tự viết".
  const batLoi = (e) => {
    if (e instanceof LoiNhaCungCap) {
      return ket({ ketQua: 'LOI_NHA_CUNG_CAP', diem: 0, loiLoai: e.loai, loiMsg: e.msg });
    }
    throw e;
  };

  let kq;
  try {
    kq = await chayDuongOng(cauHoi, { userId, lang, propertyId, onToken, onGiaiDoan }, ket);
  } catch (e) {
    kq = batLoi(e);
  }
  // Ghi nhật ký MỘT lần ở cuối, và trả kèm mã dòng nhật ký để nối với
  // phần ghi nhận nhân viên sửa bản nháp (HM3.8).
  if (ghiLog) kq.logId = await ghiNhatKy({ cauHoi, userId, ...kq });
  return kq;
}

async function chayDuongOng(cauHoi, { userId, lang, propertyId = null, onToken = null, onGiaiDoan = null }, ket) {
  const bao = (ten, chiTiet) => onGiaiDoan?.({ giaiDoan: ten, ...chiTiet });

  // ⓪ Một lượt truy vấn duy nhất lấy đủ: nút tắt, phạm vi, phiên bản tri thức,
  // hạn mức chi phí. Trước đây là ba vòng riêng, tốn khoảng một giây rưỡi.
  const cb = await chuanBi(userId, propertyId);

  const tat = cb.timTat('soan_nhap');
  if (tat) return ket({ ketQua: 'AI_DANG_TAT', diem: 0, lyDoChan: tat.lyDo, lopChan: -1 });

  // ① Ý định bị cấm — chặn trước, không cho vào RAG. Nhanh nhất và tất định
  // nhất, nên đặt trước cả cache: câu bị cấm thì không đáng phải tra cache.
  const yLuat = nhanDienLuat(cauHoi);
  if (yLuat) {
    return ket({
      ketQua: 'CHAN_Y_DINH',
      yDinh: yLuat,
      diem: 0,
      lyDoChan: Y_DINH_CAM[yLuat].ten,
      lopChan: 0,
      banNhap: Y_DINH_CAM[yLuat].mau ?? undefined,
    });
  }

  // ② Cache. Khoá gồm cả phạm vi khách sạn nên người của khách sạn này không
  // bao giờ ăn được câu trả lời của khách sạn kia.
  const nguCanhCache = cb.nguCanhCache;
  const khoa = taoKhoa({ cauHoi, lang, ...nguCanhCache });
  const daCo = await tim(khoa);
  if (daCo) return ket({ ...daCo, tuCache: true });

  bao('tim_kiem');
  // Phân loại là một lượt gọi model nhưng nhãn của nó chỉ cần tới lúc chọn giọng
  // văn. Cho nó chạy nền thay vì bắt việc tìm kiếm đứng chờ — đo được tiết kiệm
  // hơn một giây trên đường tới chữ đầu tiên.
  const huaNhan = cfg.phanLoai ? phanLoai(cauHoi).catch(() => null) : Promise.resolve(null);
  const qv = await embed(cauHoi);

  // RLS của người dùng vẫn áp dụng: chạy dưới role authenticated với đúng uid.
  // Lấy kèm mã tài liệu và SỐ PHIÊN BẢN, không chỉ tiêu đề.
  //
  // Trích dẫn chỉ có tiêu đề thì truy vết được một nửa: biết bản nháp dựa trên
  // tài liệu nào, nhưng không biết dựa trên BẢN NÀO của tài liệu đó. Kho tri
  // thức sẽ liên tục được sửa, nên vài tháng sau đọc lại một bản nháp cũ sẽ
  // không biết lúc đó chính sách viết gì — đúng thứ mà trích dẫn sinh ra để
  // giải quyết.
  //
  // Phép nối này vẫn chạy dưới RLS của người dùng, nên không mở thêm đường
  // nhìn sang khách sạn khác.
  const rows = await sql(`
    begin;
    set local role authenticated;
    set local request.jwt.claims = '{"sub":"${userId}","role":"authenticated"}';
    select s.chunk_id, s.document_id, s.title, s.content, d.version, d.updated_at
    from public.kb_search_hybrid(${vec(qv)}, ${q(cauHoi)}, ${q(lang)}, ${cfg.rag.candidates}, 40) s
    join public.kb_document d on d.id = s.document_id
    order by s.rrf_score desc;
    commit;`);
  const ungVien = (Array.isArray(rows) ? rows : []).filter((r) => r && r.title);
  if (!ungVien.length) return ket({ ketQua: 'KHONG_DU_CO_SO', diem: 0, soUngVien: 0 });

  bao('xep_hang', { soUngVien: ungVien.length });
  // Giọng văn cũng chạy song song với xếp hạng — cả hai không phụ thuộc nhau.
  const huaGiong = huaNhan
    .then((n) => layGiongVan({ propertyId, loaiKhach: loaiKhachTheoNhan(n?.nhan), ngonNgu: lang }))
    .catch(() => null);

  const xepHang = await rerank(
    cauHoi,
    ungVien.map((c) => `${c.title}. ${c.content}`),
    cfg.rag.keep
  );
  const giuLai = xepHang.map((x) => ({ ...ungVien[x.index], diem: x.relevance_score }));
  const diem = giuLai[0]?.diem ?? 0;

  // Tới đây nhãn chắc chắn đã xong từ lâu — chờ nó không tốn thêm gì.
  const nhan = await huaNhan;

  // ③ Không đủ cơ sở thì dừng, không tốn một lượt gọi model chat nào.
  //
  // Nhưng điểm tuyệt đối của bộ xếp hạng không phải xác suất. Đo được: câu
  // "có nhận thú cưng không, tôi mang theo một con mèo nhỏ" lấy đúng cả bốn
  // đoạn "Chính sách thú cưng" lên đầu, mà điểm chỉ 0,184 — vì kho viết
  // "thú cưng" và "chó", không có chữ "mèo" nào. Truy hồi đúng, cổng chặn sai.
  //
  // Nên đọc thêm một tín hiệu TƯƠNG ĐỐI: nếu mấy đoạn đầu cùng dồn về một tài
  // liệu và bỏ xa đoạn của tài liệu khác, đó là bằng chứng kho thật sự có câu
  // trả lời, dù điểm thấp. Vẫn có sàn cứng bên dưới để không cứu bừa.
  // Chỉ tính là cứu vớt khi điểm THẬT SỰ dưới ngưỡng — không thì mọi câu dồn
  // về một tài liệu đều bị gắn nhãn cứu vớt và con số theo dõi thành vô nghĩa.
  const cuuVot = diem < cfg.rag.threshold ? xetDonTaiLieu(giuLai, diem) : null;
  if (diem < cfg.rag.threshold && !cuuVot) {
    await luu(khoa, { cauHoi, lang, ...nguCanhCache, ketQua: 'KHONG_DU_CO_SO', diem, nguon: giuLai });
    return ket({ ketQua: 'KHONG_DU_CO_SO', diem, soUngVien: ungVien.length, nhan, nguon: giuLai });
  }

  // ④ Trong vùng lẫn thì hỏi thêm model xem ý định có nằm trong nhóm cấm không.
  if (diem <= VUNG_LAN[1]) {
    const yModel = await nhanDienBangModel(cauHoi);
    if (yModel) {
      return ket({
        ketQua: 'CHAN_Y_DINH',
        yDinh: yModel,
        diem,
        lyDoChan: Y_DINH_CAM[yModel].ten,
        lopChan: 2,
        banNhap: Y_DINH_CAM[yModel].mau ?? undefined,
        nguon: giuLai,
      });
    }
  }

  // Hạn mức đã lấy sẵn từ lượt chuẩn bị, kiểm TRƯỚC khi gọi model.
  if (cb.hanMuc.vuot)
    return ket({ ketQua: 'VUOT_HAN_MUC', diem, lyDoChan: cb.hanMuc.lyDo, lopChan: -2, nhan, nguon: giuLai });

  // Prompt đọc từ bảng cấu hình, thư mẫu chọn theo nhãn ý định. Cả hai đều lùi
  // về bản trong code nếu bảng trống hoặc lỗi — mất cấu hình không phải lý do
  // để ngừng soạn nháp.
  const [heThong, mau] = await Promise.all([
    layPrompt('soan_nhap', lang),
    layMauThu({ propertyId, tinhHuong: tinhHuongTheoNhan(nhan?.nhan), ngonNgu: lang }),
  ]);
  const chiDanMau = thanhChiDanMau(mau);

  const nguCanh = giuLai.map((r, i) => `[${i + 1}] (${r.title}) ${r.content}`).join('\n\n');
  // Giọng văn lấy từ cơ sở dữ liệu theo khách sạn và loại khách, không viết cứng
  // trong prompt — để Marketing sửa được mà không cần triển khai lại code.
  const chiDanGiong = thanhChiDan(await huaGiong);

  // Thứ tự có ý nghĩa: quy tắc bắt buộc trước, rồi giọng văn, rồi khung thư.
  // Chỉ dẫn đứng sau không được phép nới lỏng chỉ dẫn đứng trước — khung thư là
  // gợi ý bố cục, không phải chỗ lách các điều cấm ở prompt gốc.
  const tinNhan = [
    { role: 'system', content: [heThong, chiDanGiong, chiDanMau].filter(Boolean).join('\n\n') },
    { role: 'user', content: `NGỮ CẢNH:\n${nguCanh}\n\nCÂU HỎI CỦA KHÁCH: ${cauHoi}` },
  ];

  bao('soan_nhap', { nguon: giuLai.map((g) => ({ chunk_id: g.chunk_id, title: g.title })) });
  // Có onToken thì sinh theo dòng chảy để nhân viên thấy chữ chạy ra ngay.
  const banNhap = onToken ? await chatStream(tinNhan, {}, onToken) : await chat(tinNhan);
  bao('kiem_duyet');

  // Model tự nhận không đủ cơ sở thì đó là KHONG_DU_CO_SO, không phải bản nháp.
  // Cache lại để lần sau khỏi tốn thêm một lượt gọi model cho cùng câu hỏi.
  if (TU_CHOI_CUA_MODEL.test(banNhap)) {
    await luu(khoa, { cauHoi, lang, ...nguCanhCache, ketQua: 'KHONG_DU_CO_SO', diem, nguon: giuLai });
    return ket({
      ketQua: 'KHONG_DU_CO_SO',
      diem,
      soUngVien: ungVien.length,
      nhan,
      tokens: chiPhi.lanCuoi,
      nguon: giuLai,
      lyDoChan: 'ngữ cảnh lấy được không chứa câu trả lời, model tự từ chối',
    });
  }

  // ⑤ Không có đường trả về nào bỏ qua bước này.
  const kd = await kiemDuyet(banNhap);
  if (kd.viPham) {
    return ket({ ketQua: 'BI_CHAN', diem, banNhap, lyDoChan: kd.lyDo, lopChan: kd.lop, nhan, tokens: chiPhi.lanCuoi, nguon: giuLai });
  }

  await luu(khoa, { cauHoi, lang, ...nguCanhCache, ketQua: 'TRA_LOI', diem, banNhap, nguon: giuLai });
  // Ghi lại việc đã cứu vớt để còn soát: nếu về sau tỉ lệ sửa của nhóm cứu vớt
  // cao hơn hẳn nhóm qua thẳng thì luật này đang nới quá tay.
  return ket({ ketQua: 'TRA_LOI', diem, soUngVien: ungVien.length, banNhap, nhan, tokens: chiPhi.lanCuoi, nguon: giuLai, cuuVot });
}

export { chiPhi } from './adapters.mjs';
export { cfg } from './env.mjs';
