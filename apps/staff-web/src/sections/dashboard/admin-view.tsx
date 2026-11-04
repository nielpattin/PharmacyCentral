import { useQuery } from "@tanstack/react-query";
import { Link as RouterLink } from "@tanstack/react-router";

import { ActivityFeed, Card, CardContent, Skeleton, StatTile, type ActivityFeedGroup } from "@pharmacy/ui";

import { translateText } from "../../i18n.ts";
import { canAccessSection } from "../../permissions/section-access.ts";
import { pathForSection, type Section } from "../../router.ts";
import { formatDateTime, formatQuantity, readRows, readSystemOverview, text } from "../../staff-api.ts";
import { collapseActivity, groupByDay } from "../dashboard-activity.ts";
import { isEmployeeRow } from "../governance/employees.ts";
import {
  FAILED_SIGN_IN_LIMIT,
  adminActionLabel,
  failedSignInFigure,
  summarizeServices,
  summarizeUsers,
} from "./admin-metrics.ts";
import { FEED_ROWS, SectionHeading, dayLabel, figureText, formatRelative } from "./shared.tsx";

const HOUR_MS = 3_600_000;

const QUERY_ROOT = ["dashboard-admin"] as const;

/** A stat tile that opens the page behind it, when the role may open that page. */
const LinkedTile = ({
  section,
  roles,
  children,
}: {
  section: Section;
  roles: readonly string[];
  children: (interactive: boolean) => React.JSX.Element;
}): React.JSX.Element =>
  canAccessSection(section, roles) ? (
    <RouterLink
      to={pathForSection(section)}
      className="block rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      {children(true)}
    </RouterLink>
  ) : (
    <div>{children(false)}</div>
  );

/**
 * The Platform Admin's landing page. The administrator administers users, audit, AI integrations and the System page
 * and only reads the rest (ADR 0019), so this shows the state of those, never stock or revenue. Every block reads its
 * own request; one that fails shows "—" or drops out and the rest stays.
 */
export const AdminView = ({ roles }: { roles: readonly string[] }): React.JSX.Element => {
  const usersQuery = useQuery({
    queryKey: [...QUERY_ROOT, "users"],
    queryFn: async () => (await readRows("/api/admin/users")).filter(isEmployeeRow),
    retry: false,
  });
  const systemQuery = useQuery({
    queryKey: [...QUERY_ROOT, "system"],
    queryFn: readSystemOverview,
    retry: false,
  });
  const failedQuery = useQuery({
    queryKey: [...QUERY_ROOT, "failed-sign-ins"],
    queryFn: async () => {
      const params = new URLSearchParams({
        action: "login-failed",
        from: new Date(Date.now() - 24 * HOUR_MS).toISOString(),
        limit: String(FAILED_SIGN_IN_LIMIT),
      });
      return (await readRows(`/api/audit/logs?${params.toString()}`)).length;
    },
    retry: false,
  });
  const auditQuery = useQuery({
    queryKey: [...QUERY_ROOT, "audit"],
    queryFn: () => readRows("/api/audit/logs?limit=60"),
    retry: false,
  });

  const users = usersQuery.data ? summarizeUsers(usersQuery.data) : undefined;
  const services = summarizeServices(systemQuery.data);
  const downNames = services?.down.slice(0, 2).join(", ");

  const events = (auditQuery.data ?? []).map((row, index) => ({
    key: text(row.eventId, text(row.id, String(index))),
    action: adminActionLabel(text(row.action, ""), text(row.entityType, ""), translateText),
    occurredAt: text(row.occurredAt, text(row.occurredAtUtc, "")),
  }));
  const feedGroups: ActivityFeedGroup[] = groupByDay(collapseActivity(events).slice(0, FEED_ROWS), new Date()).map(
    (group) => ({
      key: group.key,
      label: dayLabel(group.offset, group.sample),
      items: group.items.map((item) => ({
        key: item.key,
        title: item.action,
        count: item.count,
        time: formatRelative(item.occurredAt),
        timeTitle: formatDateTime(item.occurredAt),
        dateTime: item.occurredAt,
      })),
    }),
  );

  const tile = (
    isLoading: boolean,
    render: (interactive: boolean) => React.JSX.Element,
    section: Section,
  ): React.JSX.Element =>
    isLoading ? (
      <Skeleton className="h-28 rounded-2xl" />
    ) : (
      <LinkedTile section={section} roles={roles}>
        {render}
      </LinkedTile>
    );

  return (
    <div className="grid gap-8">
      <section className="grid gap-3">
        <SectionHeading title="Platform status" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {tile(
            systemQuery.isPending,
            (interactive) => (
              <StatTile
                interactive={interactive}
                label={translateText("Services healthy")}
                value={services ? `${formatQuantity(services.up)} / ${formatQuantity(services.total)}` : "—"}
                hint={services && services.down.length > 0 ? `${translateText("Down")}: ${downNames}` : undefined}
                tone={services && services.down.length > 0 ? "danger" : undefined}
              />
            ),
            "system",
          )}
          {tile(
            usersQuery.isPending,
            (interactive) => (
              <StatTile
                interactive={interactive}
                label={translateText("Active users")}
                value={figureText(users?.active, formatQuantity)}
                hint={users ? `${formatQuantity(users.deactivated)} ${translateText("deactivated")}` : undefined}
              />
            ),
            "users",
          )}
          {tile(
            usersQuery.isPending,
            (interactive) => (
              <StatTile
                interactive={interactive}
                label={translateText("Users without a role")}
                value={figureText(users?.withoutRole, formatQuantity)}
                tone={users && users.withoutRole > 0 ? "warning" : undefined}
              />
            ),
            "users",
          )}
          {tile(
            failedQuery.isPending,
            (interactive) => (
              <StatTile
                interactive={interactive}
                label={translateText("Failed sign-ins")}
                value={failedQuery.data === undefined ? "—" : failedSignInFigure(failedQuery.data, formatQuantity)}
                hint={translateText("Last 24 hours")}
              />
            ),
            "audit",
          )}
        </div>
      </section>

      {auditQuery.isError ? null : (
        <section className="grid gap-3">
          <SectionHeading title="Recent audit activity" />
          <Card variant="soft">
            <CardContent className="py-4">
              {auditQuery.isPending ? (
                <Skeleton className="h-48" />
              ) : (
                <ActivityFeed
                  groups={feedGroups}
                  empty={translateText("No recent activity")}
                  viewAll={
                    canAccessSection("audit", roles)
                      ? (className) => (
                          <RouterLink to={pathForSection("audit")} className={className}>
                            {translateText("Open audit log")}
                          </RouterLink>
                        )
                      : undefined
                  }
                />
              )}
            </CardContent>
          </Card>
        </section>
      )}
    </div>
  );
};
