import { Link as RouterLink } from "@tanstack/react-router";

export const StaffNotFoundPage = (): React.JSX.Element => (
  <div className="login-shell">
    <div className="login-card">
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="text-sm text-muted">The staff workspace page does not exist.</p>
      <RouterLink to="/" className="text-sm font-medium text-primary">
        Return to dashboard
      </RouterLink>
    </div>
  </div>
);
