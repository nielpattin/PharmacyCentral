/**
 * A refusal the catalog answers with its own status, code and Vietnamese detail, for rules that are not role checks:
 * the record is in use, its maker approves it, or it would move to another site. Thrown by the repository, mapped to
 * the problem body by the routes.
 */
export type Refusal = { status: number; code: string; title: string; detail: string };

export class RefusalError extends Error {
  public readonly refusal: Refusal;

  public constructor(refusal: Refusal) {
    super(refusal.title);
    this.name = "RefusalError";
    this.refusal = refusal;
  }
}

const IN_USE_DETAIL = "Không thể xóa vì đang được sử dụng. Hãy chuyển sang Ngừng hoạt động.";

export const REFUSALS = {
  siteInUse: { status: 409, code: "in_use", title: "Reference data is in use", detail: IN_USE_DETAIL },
  productInUse: {
    status: 409,
    code: "in_use",
    title: "Reference data is in use",
    detail: 'Sản phẩm đã có đơn vị, giá, tồn kho hoặc đơn hàng. Chuyển sang "Ngừng kinh doanh" thay vì xóa.',
  },
  priceSelfApproval: {
    status: 403,
    code: "self_approval_forbidden",
    title: "The creator of a draft cannot publish it",
    detail: "Người tạo bản nháp không được phát hành bản nháp đó.",
  },
  locationSiteFixed: {
    status: 400,
    code: "location_site_fixed",
    title: "The storage location's site cannot change",
    detail: "Không đổi cơ sở của vị trí lưu trữ. Hãy tạo vị trí mới và chuyển tồn kho.",
  },
} satisfies Record<string, Refusal>;
