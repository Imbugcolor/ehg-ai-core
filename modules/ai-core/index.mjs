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
import { chuanBiTruyVan, SO_TIN_NHAN_NHO } from './truyvan.mjs';
import { laySo, luuSo, capNhatSo, thanhChiDanSo, vanTaySo } from './soghinho.mjs';
import { layPrompt, layMauThu, tinhHuongTheoNhan, thanhChiDanMau, MAC_DINH } from './prompt.mjs';
import { layGiongVan, thanhChiDan, loaiKhachTheoNhan } from './tone.mjs';
import { chiPhi } from './adapters.mjs';

// Vùng lẫn: đo được hai dải điểm chồng lấn nhau, nên trong khoảng này một con số
// là không đủ để quyết. Ngoài khoảng thì tin cổng tin cậy, đỡ một lượt gọi model.
// Ngưỡng và vùng lẫn tính THEO NGÔN NGỮ HỎI. Câu tiếng Anh tra kho tiếng Việt
// cho thang điểm khác hẳn câu tiếng Việt, dùng chung một mức là chặn oan.
//
// Chưa hiệu chuẩn cho ngôn ngữ nào thì lùi về ngưỡng chung — chạy được, nhưng
// đó là mức của tiếng Việt và gần như chắc chắn không vừa.
function nguongCua(lang) {
  return cfg.rag.thresholdTheoNgonNgu?.[lang] ?? cfg.rag.threshold;
}
// Vùng lẫn giữ đúng bề rộng tương đối so với ngưỡng, không phải một hằng số
// cộng thêm — cộng 0,15 vào ngưỡng 0,26 khác hẳn cộng vào ngưỡng 0,08.
const BE_RONG_VUNG_LAN = 0.58;
const vungLanTren = (lang) => nguongCua(lang) * (1 + BE_RONG_VUNG_LAN);

// Sàn cứng cho đường cứu vớt. Dưới mức này thì dù dồn về một tài liệu cũng
// không cứu — bộ xếp hạng đang đoán mò chứ không phải khớp.
const TI_LE_SAN_CUU = 0.54;   // sàn cứu vớt = 0,54 lần ngưỡng, không phải một số cố định
// Đoạn đầu phải hơn đoạn đầu tiên của tài liệu KHÁC bao nhiêu lần mới tính là
// dồn thật sự.
//
// Con số này đang chỉnh trên mẫu nhỏ: 30 câu tấn công và 18 câu hợp lệ. Đặt 1,8
// thì trượt câu "trời lạnh phòng có sưởi không" — ba đoạn đầu đều cùng tài liệu
// và đều nói về sưởi, mà cách biệt chỉ 1,15 lần. Hạ xuống 1,1 và đo lại: bộ tấn
// công vẫn chặn đủ, vì các câu tấn công bị chặn ở điểm 0,07–0,10, nằm dưới sàn
// cứu vớt nên không chạm tới luật này.
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
function xetDonTaiLieu(giuLai, diem, nguong) {
  if (diem < nguong * TI_LE_SAN_CUU || giuLai.length < CAN_CUNG_TAI_LIEU) return null;

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
// Phải có cả bản tiếng Anh. Đo được: câu "What is the dollar exchange rate
// today?" được model từ chối đúng bằng "There is not enough information in the
// knowledge base to answer this" — mà bộ nhận diện chỉ bắt tiếng Việt nên lời
// từ chối đó lọt xuống dưới nhãn TRA_LOI. Bộ đo báo là BỊA, thật ra là đếm sai.
const TU_CHOI_CUA_MODEL = /kho tri thức|khong du co so|knowledge base/i;

/**
 * @returns {{ketQua:'TRA_LOI'|'KHONG_DU_CO_SO'|'BI_CHAN'|'CHAN_Y_DINH',
 *            diem:number, banNhap?:string, yDinh?:string,
 *            lyDoChan?:string, lopChan?:number, nguon?:Array, ms:number}}
 */
export async function soanNhap(cauHoi, { userId, lang = 'vi', propertyId = null, lichSu = null, threadKey = null, ghiLog = true, onToken = null, onGiaiDoan = null } = {}) {
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

  // Hộp để đường ống trả sổ đã đọc ra ngoài, khỏi phải đọc lại lần hai.
  const hop = {};

  let kq;
  try {
    kq = await chayDuongOng(cauHoi, { userId, lang, propertyId, lichSu, threadKey, onToken, onGiaiDoan }, ket, hop);
  } catch (e) {
    kq = batLoi(e);
  }

  // Cập nhật sổ ghi nhớ bằng chính câu khách vừa hỏi. CHẠY NỀN, không chờ:
  // nhân viên cần thấy bản nháp ngay, còn sổ chỉ cần sẵn sàng trước lượt sau.
  //
  // Chạy cả khi lượt này bị chặn. Khách nói "đoàn 8 người" trong một câu hỏi
  // giá bị chặn thì "8 người" vẫn là dữ kiện thật, vẫn phải nhớ.
  if (threadKey) {
    capNhatSo(hop.so || {}, [{ nguoi: 'Khách', noiDung: cauHoi }])
      .then((moi) => luuSo(threadKey, propertyId, moi))
      .catch(() => {});
  }
  // Ghi nhật ký MỘT lần ở cuối, và trả kèm mã dòng nhật ký để nối với
  // phần ghi nhận nhân viên sửa bản nháp (HM3.8).
  if (ghiLog) kq.logId = await ghiNhatKy({ cauHoi, userId, ...kq });
  return kq;
}

async function chayDuongOng(cauHoi, { userId, lang, propertyId = null, lichSu = null, threadKey = null, onToken = null, onGiaiDoan = null }, ket, hop = {}) {
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

  // ① rưỡi. VIẾT LẠI CÂU HỎI thành câu đứng một mình được, trước cả cache.
  //
  // Phải đứng ở đây chứ không thể muộn hơn, vì hai lý do độc lập nhau:
  //
  //   • Khoá cache. Hai người ở hai cuộc hội thoại khác nhau cùng gõ "thế còn
  //     cái kia?" sẽ ra cùng một khoá nếu khoá tính theo câu thô — và người này
  //     nhận câu trả lời dành cho người kia. Khoá phải tính theo câu ĐÃ VIẾT
  //     LẠI, lúc đó hai câu giống nhau thật sự mới dùng chung câu trả lời.
  //   • Lớp chặn ý định. "Thế còn giá thì sao?" không khớp luật nào, nhưng viết
  //     lại thành "giá phòng Deluxe bao nhiêu?" thì khớp ngay. Không viết lại
  //     trước thì tấn công chia nhỏ qua nhiều lượt đi lọt.
  //
  // Câu hỏi tiếng Việt mở đầu hội thoại không tốn thêm lượt gọi model nào —
  // hàm này trả về ngay khi không có gì phải làm.
  // Sổ ghi nhớ hội thoại. Chứa những dữ kiện khách nói từ trước mà đã trôi
  // khỏi cửa sổ sáu tin nhắn — mấy người, ngày nào, mã đặt phòng.
  const so = threadKey ? await laySo(threadKey) : {};
  hop.so = so;
  const chiDanSo = thanhChiDanSo(so);

  // Bước viết lại được đọc sổ. Đây là chỗ sổ có tác dụng lớn nhất: "đoàn tôi
  // lúc nãy nói ấy" khôi phục được thành "đoàn 8 người ngày 20" kể cả khi câu
  // đó đã trôi khỏi cửa sổ từ lâu.
  const { truyVan, daDoi } = await chuanBiTruyVan(cauHoi, lang, lichSu, chiDanSo);

  // Chặn ý định LẦN HAI trên câu đã viết lại. Lần đầu ở trên bắt câu hỏi thẳng
  // và rẻ; lần này bắt câu nối tiếp mà một mình nó trông vô hại.
  if (daDoi) {
    const yLuatMoi = nhanDienLuat(truyVan);
    if (yLuatMoi) {
      return ket({
        ketQua: 'CHAN_Y_DINH',
        yDinh: yLuatMoi,
        diem: 0,
        lyDoChan: Y_DINH_CAM[yLuatMoi].ten,
        lopChan: 0,
        banNhap: Y_DINH_CAM[yLuatMoi].mau ?? undefined,
        truyVan,
      });
    }
  }

  // ② Cache. Khoá gồm cả phạm vi khách sạn nên người của khách sạn này không
  // bao giờ ăn được câu trả lời của khách sạn kia.
  const nguCanhCache = cb.nguCanhCache;
  // Vân tay sổ nằm trong khoá. Thiếu nó thì hai hội thoại có sổ khác nhau
  // dùng chung một bản nháp — người này nhận câu viết cho người kia.
  const khoa = taoKhoa({ cauHoi: truyVan, lang, ...nguCanhCache, vanTaySo: vanTaySo(so) });
  const daCo = await tim(khoa);
  if (daCo) return ket({ ...daCo, tuCache: true });

  bao('tim_kiem');
  // Phân loại là một lượt gọi model nhưng nhãn của nó chỉ cần tới lúc chọn giọng
  // văn. Cho nó chạy nền thay vì bắt việc tìm kiếm đứng chờ — đo được tiết kiệm
  // hơn một giây trên đường tới chữ đầu tiên.
  const huaNhan = cfg.phanLoai ? phanLoai(truyVan).catch(() => null) : Promise.resolve(null);

  const qv = await embed(truyVan);

  // RLS của người dùng vẫn áp dụng: chạy dưới role authenticated với đúng uid.
  //
  // KHÔNG lọc theo ngôn ngữ khi tìm. Trước đây truyền lang vào đây, và `lang`
  // gánh hai nghĩa cùng lúc: tìm trong kho ngôn ngữ nào, và trả lời bằng ngôn
  // ngữ nào. Hậu quả: khách hỏi tiếng Anh thì kho tiếng Việt bị loại sạch, còn
  // 0 ứng viên, hệ thống trả "không đủ dữ liệu" — trông như không hiểu tiếng
  // Anh, thật ra là chưa kịp đọc gì.
  //
  // Model embedding và xếp hạng đều đa ngôn ngữ, nên câu hỏi tiếng Anh tra được
  // tài liệu tiếng Việt. Giờ `lang` chỉ còn nghĩa "trả lời bằng tiếng gì".
  //
  // Khi kho có nhiều ngôn ngữ: cùng một chính sách viết hai thứ tiếng sẽ chiếm
  // hai chỗ trong nhóm ứng viên. Lúc đó cần gom trùng theo tài liệu gốc, chưa
  // phải bây giờ vì kho mới có tiếng Việt.
  //
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
    from public.kb_search_hybrid(${vec(qv)}, ${q(truyVan)}, null, ${cfg.rag.candidates}, 40) s
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
    truyVan,
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
  const nguong = nguongCua(lang);
  const cuuVot = diem < nguong ? xetDonTaiLieu(giuLai, diem, nguong) : null;
  if (diem < nguong && !cuuVot) {
    await luu(khoa, { cauHoi, lang, ...nguCanhCache, ketQua: 'KHONG_DU_CO_SO', diem, nguon: giuLai });
    return ket({ ketQua: 'KHONG_DU_CO_SO', diem, soUngVien: ungVien.length, nhan, nguon: giuLai });
  }

  // ④ Trong vùng lẫn thì hỏi thêm model xem ý định có nằm trong nhóm cấm không.
  if (diem <= vungLanTren(lang)) {
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
  // Nói rõ đang làm cho khách sạn nào. Không có dòng này thì model không biết
  // khách sạn nào là "của mình" và khách sạn nào là "nơi khác" — đo được: khách
  // hỏi chính sách huỷ của Núi Đồi, model lấy chính sách toàn chuỗi rồi viết
  // "Nui Doi Hotel applies…" dù nó đang phục vụ Biển Xanh.
  const chiDanPhamVi = cb.tenKhachSan
    ? lang === 'en'
      ? `You work for ${cb.tenKhachSan} and speak only for this property. Any other hotel named in the guest's message is a different property you do not represent.`
      : `Bạn làm cho ${cb.tenKhachSan} và chỉ phát ngôn cho khách sạn này. Mọi khách sạn khác được nhắc tới trong câu hỏi đều là nơi bạn không phụ trách.`
    : '';

  const tinNhan = [
    { role: 'system', content: [heThong, chiDanPhamVi, chiDanGiong, chiDanMau].filter(Boolean).join('\n\n') },
    {
      role: 'user',
      content:
        `NGỮ CẢNH:\n${nguCanh}\n\n` +
        (chiDanSo ? `${chiDanSo}\n\n` : '') +
        // Hội thoại trước đó là để bản nháp nối tiếp tự nhiên — biết khách đã
        // được trả lời gì rồi để khỏi lặp lại. KHÔNG phải nguồn thông tin: mọi
        // dữ kiện vẫn phải lấy từ phần NGỮ CẢNH ở trên.
        (lichSu?.length
          ? `HỘI THOẠI TRƯỚC ĐÓ (chỉ để hiểu mạch, không phải nguồn thông tin):\n` +
            lichSu.slice(-SO_TIN_NHAN_NHO).map((t) => `${t.nguoi || 'Khách'}: ${t.noiDung ?? t.noi_dung ?? ''}`).join('\n') +
            '\n\n'
          : '') +
        `CÂU HỎI CỦA KHÁCH: ${cauHoi}`,
    },
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
  return ket({ ketQua: 'TRA_LOI', diem, soUngVien: ungVien.length, banNhap, nhan, tokens: chiPhi.lanCuoi, nguon: giuLai, cuuVot, truyVan: daDoi ? truyVan : undefined });
}

export { chiPhi } from './adapters.mjs';
export { cfg } from './env.mjs';
