import type { Request, Response } from "express";

import { actorSiteIds } from "../middleware/trusted-request.ts";

/**
 * True when the caller may see or act on a record at `siteId`. A site-scoped employee needs the site among their
 * assigned sites; Platform Admin and internal services have no site limit (`actorSiteIds` is undefined for them).
 */
export const actorMaySeeSite = (request: Request, siteId: string): boolean => {
  const scope = actorSiteIds(request);
  return scope === undefined || scope.includes(siteId);
};

export const siteAccessDenied = (response: Response) =>
  response.status(403).json({
    title: "Site access denied",
    status: 403,
    code: "site_access_denied",
    detail: "Bản ghi này thuộc site bạn chưa được phân công.",
  });
