/** Reasons a control is refused, shown as the title of a disabled button. Keys are the English rule sentences. */
export const permissionLiterals: Record<string, string> = {
  "Only a Pharmacy Manager can publish prices.": "Chỉ Quản lý nhà thuốc được phát hành giá.",
  "The creator of a price draft cannot publish that draft.": "Người tạo bản nháp không được phát hành bản nháp đó.",
  "Only a Pharmacist can create prescriptions.": "Chỉ Dược sĩ được tạo đơn thuốc.",
  "Only a Pharmacist can dispense prescriptions.": "Chỉ Dược sĩ được cấp phát đơn thuốc.",
  "Only a Pharmacist can cancel prescriptions.": "Chỉ Dược sĩ được hủy đơn thuốc.",
  "Only a Pharmacist can create a counter invoice.": "Chỉ Dược sĩ được tạo hóa đơn tại quầy.",
  "Only a Pharmacist can answer consultations.": "Chỉ Dược sĩ được trả lời tư vấn.",
  "Only a Pharmacist or Pharmacy Manager can process online orders.":
    "Chỉ Dược sĩ hoặc Quản lý nhà thuốc được xử lý đơn hàng online.",
  "Only a Pharmacist can confirm cash payments.": "Chỉ Dược sĩ được xác nhận thanh toán tiền mặt.",
  "Only a Pharmacist can refund counter payments.": "Chỉ Dược sĩ được hoàn tiền thanh toán tại quầy.",
  "Only a Pharmacy Manager can refund payments.": "Chỉ Quản lý nhà thuốc được hoàn tiền thanh toán.",
  "Only a Pharmacy Manager can set a sales target.": "Chỉ Quản lý nhà thuốc được đặt mục tiêu doanh số.",
  "Only a Pharmacist or Pharmacy Manager can view payment invoices.":
    "Chỉ Dược sĩ hoặc Quản lý nhà thuốc được xem hóa đơn thanh toán.",
  "Only a Pharmacist can look up customers.": "Chỉ Dược sĩ được tra cứu khách hàng.",
  "Only a Pharmacy Manager can view the finance summary.": "Chỉ Quản lý nhà thuốc được xem tổng quan tài chính.",
  "Only a Pharmacy Manager can create purchase orders.": "Chỉ Quản lý nhà thuốc được tạo đơn mua hàng.",
  "Only a Pharmacy Manager can approve purchase orders.": "Chỉ Quản lý nhà thuốc được duyệt đơn mua hàng.",
  "Only a Pharmacy Manager can cancel purchase orders.": "Chỉ Quản lý nhà thuốc được hủy đơn mua hàng.",
  "Only a Pharmacy Manager can view reorder suggestions.": "Chỉ Quản lý nhà thuốc được xem gợi ý đặt hàng.",
  "Only Warehouse Staff can view goods receipts.": "Chỉ Nhân viên kho được xem phiếu nhập hàng.",
  "Only Warehouse Staff can receive goods.": "Chỉ Nhân viên kho được nhận hàng.",
  "Only a Pharmacist, Pharmacy Manager or Warehouse Staff can view stock balances.":
    "Chỉ Dược sĩ, Quản lý nhà thuốc hoặc Nhân viên kho được xem tồn kho.",
  "Only a Pharmacist, Pharmacy Manager or Warehouse Staff can view batches.":
    "Chỉ Dược sĩ, Quản lý nhà thuốc hoặc Nhân viên kho được xem lô hàng.",
  "Only a Pharmacy Manager or Warehouse Staff can view stock movements.":
    "Chỉ Quản lý nhà thuốc hoặc Nhân viên kho được xem biến động tồn kho.",
  "Only a Pharmacy Manager or Warehouse Staff can view adjustments.":
    "Chỉ Quản lý nhà thuốc hoặc Nhân viên kho được xem điều chỉnh tồn kho.",
  "Only a Pharmacist, Pharmacy Manager or Warehouse Staff can view disposal records.":
    "Chỉ Dược sĩ, Quản lý nhà thuốc hoặc Nhân viên kho được xem biên bản tiêu hủy.",
  "Only a Pharmacist or Warehouse Staff can create a disposal record.":
    "Chỉ Dược sĩ hoặc Nhân viên kho được lập biên bản tiêu hủy.",
  "Only a Pharmacy Manager can approve or reject disposal records.":
    "Chỉ Quản lý nhà thuốc được duyệt hoặc từ chối biên bản tiêu hủy.",
  "Only a Pharmacy Manager or Warehouse Staff can view transfers.":
    "Chỉ Quản lý nhà thuốc hoặc Nhân viên kho được xem điều chuyển.",
  "Only a Pharmacy Manager or Warehouse Staff can view stocktakes.":
    "Chỉ Quản lý nhà thuốc hoặc Nhân viên kho được xem kiểm kê.",
  "Only a Pharmacy Manager or Warehouse Staff can view returns and removals.":
    "Chỉ Quản lý nhà thuốc hoặc Nhân viên kho được xem trả hàng và loại tồn.",
  "Only Warehouse Staff can create batches.": "Chỉ Nhân viên kho được tạo lô hàng.",
  "Only a Pharmacist or Pharmacy Manager can release or reject batches.":
    "Chỉ Dược sĩ hoặc Quản lý nhà thuốc được kiểm định lô.",
  "Only Warehouse Staff can record stock movements.": "Chỉ Nhân viên kho được ghi nhận biến động tồn kho.",
  "Only Warehouse Staff can create stock adjustments.": "Chỉ Nhân viên kho được tạo điều chỉnh tồn kho.",
  "Only a Pharmacy Manager can approve or reject adjustments.":
    "Chỉ Quản lý nhà thuốc được duyệt hoặc từ chối điều chỉnh.",
  "Only Warehouse Staff can create transfers.": "Chỉ Nhân viên kho được tạo điều chuyển.",
  "Only a Pharmacy Manager can approve transfers.": "Chỉ Quản lý nhà thuốc được duyệt điều chuyển.",
  "Only Warehouse Staff can ship or receive transfers.": "Chỉ Nhân viên kho được xuất hoặc nhận điều chuyển.",
  "Only a Pharmacy Manager or the Warehouse Staff who created it can cancel a transfer.":
    "Chỉ Quản lý nhà thuốc hoặc Nhân viên kho đã tạo mới được hủy điều chuyển.",
  "Only Warehouse Staff can start stocktakes.": "Chỉ Nhân viên kho được tạo phiếu kiểm kê.",
  "Only Warehouse Staff can record stock counts.": "Chỉ Nhân viên kho được ghi số kiểm đếm.",
  "Only a Pharmacy Manager can post stocktakes.": "Chỉ Quản lý nhà thuốc được ghi nhận kết quả kiểm kê.",
  "Only Warehouse Staff can record returns.": "Chỉ Nhân viên kho được ghi nhận trả hàng.",
  "Only a Pharmacist, Pharmacy Manager or Warehouse Staff can view replenishment requests.":
    "Chỉ Dược sĩ, Quản lý nhà thuốc hoặc Nhân viên kho được xem yêu cầu bổ sung hàng.",
  "Only a Pharmacist or Pharmacy Manager can request replenishment.":
    "Chỉ Dược sĩ hoặc Quản lý nhà thuốc được tạo yêu cầu bổ sung hàng.",
  "Only Warehouse Staff can approve, reject or fulfil replenishment requests.":
    "Chỉ Nhân viên kho được duyệt, từ chối hoặc hoàn tất yêu cầu bổ sung hàng.",
  "Only Warehouse Staff or the person who requested it can cancel a replenishment request.":
    "Chỉ Nhân viên kho hoặc người tạo yêu cầu mới được hủy yêu cầu bổ sung hàng.",
  "Only a Pharmacy Manager can change the catalog, units and prices.":
    "Chỉ Quản lý nhà thuốc được thay đổi danh mục, đơn vị và giá.",
  "Only a Platform Admin can create, edit or delete sites, storage locations and suppliers.":
    "Chỉ Quản trị nền tảng được tạo, sửa hoặc xóa cơ sở, vị trí lưu trữ và nhà cung cấp.",
  "Only a Platform Admin can import sites, storage locations or suppliers.":
    "Chỉ Quản trị nền tảng được nhập cơ sở, vị trí lưu trữ hoặc nhà cung cấp.",
  "Only a Pharmacy Manager can import products.": "Chỉ Quản lý nhà thuốc được nhập sản phẩm.",
  "Only Warehouse Staff can import opening balances.": "Chỉ Nhân viên kho được nhập tồn đầu kỳ.",
  "Only a Pharmacist or Pharmacy Manager can change search synonyms.":
    "Chỉ Dược sĩ hoặc Quản lý nhà thuốc được sửa từ đồng nghĩa tìm kiếm.",
  "Only a Pharmacist or Pharmacy Manager can approve search synonyms.":
    "Chỉ Dược sĩ hoặc Quản lý nhà thuốc được duyệt từ đồng nghĩa tìm kiếm.",
  "Only a Platform Admin can manage staff accounts.": "Chỉ Quản trị nền tảng được quản lý tài khoản nhân viên.",
  "Only a Platform Admin can change AI credentials.": "Chỉ Quản trị nền tảng được đổi khóa AI.",
  "Only records at your assigned sites can be changed.": "Chỉ sửa được bản ghi thuộc cơ sở được gán cho bạn.",
};
