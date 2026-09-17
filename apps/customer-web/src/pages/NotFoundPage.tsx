import { Button } from "@pharmacy/ui";
import { useNavigate } from "@tanstack/react-router";

export const NotFoundPage = (): React.JSX.Element => {
  const navigate = useNavigate();
  return (
    <main className="mx-auto grid min-h-screen max-w-lg place-items-center px-4 text-center text-ink">
      <div>
        <p className="text-sm font-medium text-primary">404</p>
        <h1 className="mt-2 text-2xl font-semibold">Không tìm thấy trang</h1>
        <p className="mt-2 text-sm text-muted">Đường dẫn bạn truy cập không tồn tại trong ứng dụng khách hàng.</p>
        <Button className="mt-6" onClick={() => void navigate({ to: "/" })}>
          Về trang chủ
        </Button>
      </div>
    </main>
  );
};
