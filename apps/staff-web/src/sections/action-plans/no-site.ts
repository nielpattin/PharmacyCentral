import { ApiProblemError } from "../../staff-api.ts";

/**
 * An employee who is not Platform Admin and has no assigned site cannot read any site-scoped list: the edge and the
 * service refuse the request. The page says so in words instead of showing a blank list or a bare refusal. A session
 * that has not yet named its roles is not judged.
 */
export const hasNoAssignedSite = (session: {
  roles?: readonly string[] | undefined;
  siteIds?: readonly string[] | undefined;
}): boolean => {
  if (session.roles === undefined) return false;
  if (session.roles.includes("Platform Admin")) return false;
  return (session.siteIds ?? []).length === 0;
};

/** The list request was refused for the caller's site access (HTTP 403), which reads the same as having no site. */
export const isSiteAccessRefusal = (error: unknown): boolean =>
  error instanceof ApiProblemError && error.problem.status === 403;
