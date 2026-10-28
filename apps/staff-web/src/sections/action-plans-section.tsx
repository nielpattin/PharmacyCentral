import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  DataTable,
  RowActions,
  Select,
  StatusBadge,
  StatusCell,
  useToast,
  type DataColumn,
} from "@pharmacy/ui";
import { useMemo, useState } from "react";

import { useSession } from "../auth.ts";
import { dataTableLabels } from "../components/data-table-labels.ts";
import { SavedViewsMenu } from "../components/saved-views-menu.tsx";
import { useListUrlState } from "../hooks/useListUrlState.ts";
import { usePagedList } from "../hooks/usePagedList.ts";
import { useSearchDraft } from "../hooks/useSearchDraft.ts";
import { useStaffReferences } from "../hooks/useStaffReferences.ts";
import { translateText } from "../i18n.ts";
import { canChangeActionPlanStatus, canEditActionPlan } from "../permissions/staff-permissions.ts";
import { formatDate, formatDateTime, writeJson, type JsonRecord } from "../staff-api.ts";
import { referenceName } from "./procurement/labels.ts";
import {
  ACTION_PLANS_KEY,
  ACTION_PLANS_PATH,
  ACTION_PLAN_STATUSES,
  actionPlanPath,
  isActionPlanStatus,
  parseActionPlan,
  type ActionPlan,
} from "./action-plans/contract.ts";
import { EditPlanDrawer } from "./action-plans/edit-plan-drawer.tsx";
import { ownerNameOf, ownerOptionsFor, canReadStaffDirectory } from "./action-plans/owners.ts";
import { ACTION_PLAN_LIST_DEFAULTS, actionPlanListParams, visiblePlans } from "./action-plans/list-query.ts";
import { planWriteProblem } from "./action-plans/problems.ts";
import { useStaffDirectory } from "./action-plans/queries.ts";
import { isOverdue, STATUS_LABELS, STATUS_TONES, SOURCE_LABELS, todayIsoDate } from "./action-plans/plan-state.ts";

/** A conflict the list is showing: the write was refused because a live plan for the same item exists. */
type Conflict = { message: string; planId: string };

/** The action plans list: every plan the viewer may see, filtered by owner, status and search. */
export const ActionPlansSection = (): React.JSX.Element => {
  const session = useSession();
  const queryClient = useQueryClient();
  const toast = useToast();
  const list = useListUrlState(ACTION_PLAN_LIST_DEFAULTS);
  const references = useStaffReferences();
  const ownerFilter = canReadStaffDirectory(session);
  const directory = useStaffDirectory(ownerFilter);
  const employees = useMemo(() => directory.data ?? [], [directory.data]);
  const [search, setSearch] = useSearchDraft(list.values.q, (q) => list.setValues({ q }));
  const [editingId, setEditingId] = useState<string>();
  const [conflict, setConflict] = useState<Conflict>();
  const plans = usePagedList({
    key: ACTION_PLANS_KEY,
    path: ACTION_PLANS_PATH,
    params: actionPlanListParams(list.values, ownerFilter),
    limit: 100,
  });

  // A row the contract does not match is counted and reported, never shown as a plan with guessed fields.
  const parsed = useMemo(() => plans.rows.map(parseActionPlan), [plans.rows]);
  const rows = useMemo(() => parsed.filter((plan): plan is ActionPlan => plan !== undefined), [parsed]);
  const malformedCount = parsed.length - rows.length;
  const focusId = list.values.plan;
  const shown = visiblePlans(rows, focusId);
  const editing = rows.find((plan) => plan.id === editingId);
  const today = todayIsoDate();
  const ownerOptions = ownerOptionsFor(employees, undefined);

  const writePlan = useMutation({
    mutationFn: ({ id, body }: { id: string; body: JsonRecord }) =>
      writeJson<unknown>(actionPlanPath(id), "PATCH", body),
    onSuccess: async () => {
      toast.success(translateText("Status changed."));
      setConflict(undefined);
      await queryClient.invalidateQueries({ queryKey: ACTION_PLANS_KEY });
    },
    onError: (reason) => {
      const problem = planWriteProblem(reason);
      if (problem.existingPlanId) setConflict({ message: problem.message, planId: problem.existingPlanId });
      else toast.error(problem.message);
    },
  });

  // Shows the plan the conflict names, alone, with the filters cleared so the list cannot hide it.
  const showConflictPlan = (planId: string): void => {
    setConflict(undefined);
    list.setValues({ plan: planId, status: "all", owner: "all", q: "" }, { history: "push" });
  };

  const columns: Array<DataColumn<ActionPlan>> = [
    {
      key: "title",
      label: translateText("Title"),
      render: (row) => <span className="font-medium text-ink">{row.title}</span>,
      text: (row) => row.title,
      truncate: 40,
    },
    {
      key: "sourceType",
      label: translateText("Source"),
      render: (row) => translateText(SOURCE_LABELS[row.sourceType]),
      text: (row) => translateText(SOURCE_LABELS[row.sourceType]),
    },
    {
      key: "siteId",
      hideBelow: "lg",
      label: translateText("Site"),
      render: (row) => (row.siteId === null ? "-" : referenceName(references.sites, row.siteId, ["code", "name"])),
      text: (row) => (row.siteId === null ? "-" : referenceName(references.sites, row.siteId, ["code", "name"])),
      truncate: 24,
    },
    {
      key: "ownerId",
      label: translateText("Owner"),
      render: (row) => ownerNameOf(row.ownerId, employees, session),
      text: (row) => ownerNameOf(row.ownerId, employees, session),
      truncate: 24,
    },
    {
      key: "dueDate",
      label: translateText("Due date"),
      render: (row) => (
        <span className="inline-flex flex-wrap items-center gap-2">
          {formatDate(`${row.dueDate}T00:00:00`)}
          {isOverdue(row, today) ? <StatusBadge tone="danger">{translateText("Overdue")}</StatusBadge> : null}
        </span>
      ),
      text: (row) => row.dueDate,
    },
    {
      key: "status",
      label: translateText("Status"),
      render: (row) => (
        <StatusCell tone={STATUS_TONES[row.status]}>{translateText(STATUS_LABELS[row.status])}</StatusCell>
      ),
      text: (row) => translateText(STATUS_LABELS[row.status]),
    },
    {
      key: "updatedAt",
      hideBelow: "xl",
      label: translateText("Updated"),
      render: (row) => formatDateTime(row.updatedAt),
      text: (row) => row.updatedAt,
    },
    {
      key: "actions",
      label: translateText("Actions"),
      pinned: "right",
      enableSorting: false,
      render: (row) => {
        const statusAccess = canChangeActionPlanStatus(session, row);
        return (
          <RowActions label={translateText("Actions")}>
            <Select
              aria-label={translateText("Change status")}
              className="w-auto min-w-36"
              value={row.status}
              disabled={!statusAccess.allowed || writePlan.isPending}
              title={statusAccess.allowed ? undefined : statusAccess.reason}
              onChange={(event) => {
                const next = event.target.value;
                if (isActionPlanStatus(next)) writePlan.mutate({ id: row.id, body: { status: next } });
              }}
            >
              {ACTION_PLAN_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {translateText(STATUS_LABELS[status])}
                </option>
              ))}
            </Select>
            {canEditActionPlan(session, row).allowed ? (
              <Button size="sm" variant="ghost" onClick={() => setEditingId(row.id)}>
                {translateText("Edit")}
              </Button>
            ) : null}
          </RowActions>
        );
      },
    },
  ];

  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted">
        {translateText(
          "Turn a suggestion or an alert into a plan with one owner, a due date and a status. Every plan appears in this list.",
        )}
      </p>
      {plans.error ? <Alert variant="danger">{translateText(plans.error.message)}</Alert> : null}
      {malformedCount > 0 ? <Alert variant="danger">{translateText("Unexpected action plan response.")}</Alert> : null}
      {directory.error ? <Alert variant="danger">{translateText("Unable to load the staff directory.")}</Alert> : null}
      {conflict ? (
        <Alert variant="danger" className="flex flex-wrap items-center gap-3">
          <span>{conflict.message}</span>
          <Button size="sm" variant="outline" onClick={() => showConflictPlan(conflict.planId)}>
            {translateText("Open the existing plan")}
          </Button>
        </Alert>
      ) : null}
      {focusId !== "" ? (
        <Alert variant="info" className="flex flex-wrap items-center gap-3">
          <span>{translateText("Showing one plan.")}</span>
          {shown.length === 0 && plans.hasMore ? (
            <>
              <span>{translateText("This plan is not in the rows loaded so far. Load more to find it.")}</span>
              <Button size="sm" variant="outline" onClick={plans.loadMore}>
                {translateText("Load more")}
              </Button>
            </>
          ) : null}
          {shown.length === 0 && !plans.hasMore && !plans.isLoading ? (
            <span>{translateText("No plan with this id is in the list.")}</span>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            className="ms-auto"
            onClick={() => list.setValues({ plan: "" }, { history: "push" })}
          >
            {translateText("Show all plans")}
          </Button>
        </Alert>
      ) : null}
      <DataTable
        toolbarStart={
          <>
            {ownerFilter ? (
              <Select
                aria-label={translateText("Owner")}
                className="w-auto min-w-44"
                value={list.values.owner}
                onChange={(event) => list.setValues({ owner: event.target.value })}
              >
                <option value="all">{translateText("All owners")}</option>
                {ownerOptions.map((owner) => (
                  <option key={owner.value} value={owner.value}>
                    {owner.label}
                  </option>
                ))}
              </Select>
            ) : null}
            <Select
              aria-label={translateText("Status")}
              className="w-auto min-w-44"
              value={list.values.status}
              onChange={(event) => list.setValues({ status: event.target.value })}
            >
              <option value="all">{translateText("All statuses")}</option>
              {ACTION_PLAN_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {translateText(STATUS_LABELS[status])}
                </option>
              ))}
            </Select>
          </>
        }
        toolbarExtra={<SavedViewsMenu pageKey="action-plans" defaults={ACTION_PLAN_LIST_DEFAULTS} />}
        storageKey="staff:action-plans"
        labels={dataTableLabels()}
        rows={shown}
        columns={columns}
        getKey={(row) => row.id}
        loading={plans.isLoading}
        empty={translateText("No records found")}
        search={{ value: search, onChange: setSearch, placeholder: translateText("Search by title") }}
        paging={{ hasMore: plans.hasMore, loadingMore: plans.isLoadingMore, onLoadMore: plans.loadMore }}
        exportCsv={{ filename: "action-plans.csv" }}
      />
      {editing ? <EditPlanDrawer plan={editing} onClose={() => setEditingId(undefined)} /> : null}
    </div>
  );
};
