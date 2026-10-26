import { Link as RouterLink } from "@tanstack/react-router";

import { useT } from "../i18n.ts";

export const StaffNotFoundPage = (): React.JSX.Element => {
  const t = useT();
  return (
    <div className="login-shell">
      <div className="login-card">
        <h1 className="text-xl font-semibold">{t("notFound.title")}</h1>
        <p className="text-sm text-muted">{t("notFound.description")}</p>
        <RouterLink to="/" className="text-sm font-medium text-primary">
          {t("notFound.goDashboard")}
        </RouterLink>
      </div>
    </div>
  );
};
