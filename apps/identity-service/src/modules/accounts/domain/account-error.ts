/**
 * A refusal the account routes answer with a status, a stable `code` and a Vietnamese `detail` the screens show.
 * `reason` and `accountId` are set only on a failed sign-in, so the route can audit the attempt without the password.
 */
export class AccountError extends Error {
  public reason?: string;
  public accountId?: string | undefined;

  public constructor(
    public readonly status: number,
    public readonly code: string,
    title: string,
    public readonly detail: string,
  ) {
    super(title);
    this.name = "AccountError";
  }
}

export const accountErrors = {
  emailTaken: () =>
    new AccountError(409, "conflict", "An account with this email already exists", "Email này đã có tài khoản."),
  phoneRequired: () =>
    new AccountError(
      400,
      "phone_required",
      "A phone number is required for an employee",
      "Nhân viên phải có số điện thoại liên hệ.",
    ),
  unknownRole: () => new AccountError(400, "request_failed", "Unknown employee role", "Vai trò không hợp lệ."),
  roleRequired: () =>
    new AccountError(400, "role_required", "At least one role is required", "Chọn ít nhất một vai trò."),
  siteRequired: () => new AccountError(400, "site_required", "At least one site is required", "Chọn ít nhất một site."),
  employeeNotFound: () =>
    new AccountError(404, "employee_not_found", "Employee account not found", "Không tìm thấy nhân viên."),
  selfChange: (detail: string) =>
    new AccountError(403, "self_change_forbidden", "An administrator cannot change their own account", detail),
  lastPlatformAdmin: () =>
    new AccountError(
      409,
      "last_platform_admin",
      "At least one active Platform Admin is required",
      "Phải còn ít nhất một Quản trị nền tảng đang hoạt động.",
    ),
  accountDeactivated: () =>
    new AccountError(
      409,
      "account_deactivated",
      "Account is deactivated",
      "Tài khoản đã bị vô hiệu hóa. Hãy kích hoạt lại trước khi đặt lại mật khẩu.",
    ),
  passwordChangeRequired: () =>
    new AccountError(
      403,
      "password_change_required",
      "Password change required",
      "Bạn cần đổi mật khẩu trước khi tiếp tục.",
    ),
  invalidCredentials: () =>
    new AccountError(401, "request_failed", "Invalid email or password", "Email hoặc mật khẩu không đúng."),
  notVerified: () =>
    new AccountError(401, "request_failed", "Email address is not verified", "Email chưa được xác thực."),
  employeeRequired: () =>
    new AccountError(
      403,
      "employee_required",
      "Employee account required",
      "Cần tài khoản nhân viên để vào khu vực này.",
    ),
  passwordSignInRequired: () =>
    new AccountError(
      403,
      "password_sign_in_required",
      "Employee accounts sign in with a password",
      "Tài khoản nhân viên đăng nhập bằng mật khẩu.",
    ),
  currentPasswordInvalid: () =>
    new AccountError(400, "request_failed", "Current password is invalid", "Mật khẩu hiện tại không đúng."),
  auditUnavailable: () =>
    new AccountError(
      503,
      "audit_unavailable",
      "Audit log unavailable",
      "Không ghi được nhật ký nên thay đổi chưa được lưu. Hãy thử lại.",
    ),
};
