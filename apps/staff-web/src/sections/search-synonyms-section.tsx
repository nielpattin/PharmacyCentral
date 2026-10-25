import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Badge, Button, Field, Textarea, useToast } from "@pharmacy/ui";
import { useRef, useState } from "react";

import { useSession } from "../auth.ts";
import { useConfirm } from "../components/confirm.tsx";
import { DataTable, type Column } from "../components/data-table.tsx";
import { EntityDrawer } from "../components/entity-drawer.tsx";
import { SubTabs } from "../components/forms.tsx";
import { GatedButton } from "../components/gated-button.tsx";
import { PageActions } from "../components/page-actions.tsx";
import { useHotkey } from "../hooks/useHotkey.ts";
import { useListUrlState } from "../hooks/useListUrlState.ts";
import { useUnsavedChangesGuard } from "../hooks/useUnsavedChangesGuard.ts";
import { translateText } from "../i18n.ts";
import { can } from "../permissions/staff-permissions.ts";
import { parseSearchSynonymTerms, searchSynonymTermsProblem } from "../search-synonym-terms.ts";
import {
  approveSearchSynonymGroup,
  ApiProblemError,
  createSearchSynonymGroup,
  deleteSearchSynonymGroup,
  formatDateTime,
  listSearchSynonymGroups,
  text,
  updateSearchSynonymGroup,
  type JsonRecord,
  type SearchSynonymGroup,
} from "../staff-api.ts";

const searchSynonymsQueryKey = ["search-synonyms"] as const;

const TABS = ["Pending review", "In use"] as const;
const LIST_DEFAULTS = { tab: "Pending review" } as const;

type SynonymMutation =
  | { kind: "create"; terms: string[] }
  | { kind: "update"; group: SearchSynonymGroup; terms: string[] }
  | { kind: "approve"; group: SearchSynonymGroup }
  | { kind: "delete"; group: SearchSynonymGroup };

const runSynonymMutation = async (input: SynonymMutation): Promise<unknown> => {
  switch (input.kind) {
    case "create":
      return createSearchSynonymGroup(input.terms);
    case "update":
      return updateSearchSynonymGroup(input.group.id, input.terms, input.group.version);
    case "approve":
      return approveSearchSynonymGroup(input.group.id, input.group.version);
    case "delete":
      return deleteSearchSynonymGroup(input.group.id);
  }
};

const successMessages: Record<SynonymMutation["kind"], string> = {
  create: "Group created and sent for review.",
  update: "Group updated and sent for review.",
  approve: "Group approved. It is now in search.",
  delete: "Group deleted.",
};

// Maps the catalog-service problem codes to staff-facing text, which a generic action toast cannot do, so this
// section keeps its own mutation. Anything unknown shows the server's own message.
const problemMessage = (reason: unknown): string => {
  if (reason instanceof ApiProblemError) {
    switch (reason.problem.code) {
      case "self_review_forbidden":
        return translateText("You cannot approve your own change. Another staff member must approve it.");
      case "version_conflict":
        return translateText(
          "This group changed after you opened it. The list has been reloaded. Check it and try again.",
        );
      case "already_approved":
        return translateText("This group is already approved.");
      case "search_synonym_not_found":
        return translateText("This group no longer exists. The list has been reloaded.");
      case "invalid_request":
        return translateText("The terms do not meet the rules. Check the list and try again.");
    }
  }
  return reason instanceof Error ? translateText(reason.message) : translateText("Unable to save the change.");
};

const termsOf = (row: JsonRecord): string[] => (Array.isArray(row.terms) ? row.terms.map(String) : []);

const SynonymDrawer = ({
  group,
  busy,
  onSave,
  onClose,
}: {
  group: SearchSynonymGroup | undefined;
  busy: boolean;
  onSave: (terms: string[]) => void;
  onClose: () => void;
}): React.JSX.Element => {
  const confirm = useConfirm();
  const initial = group ? group.terms.join("\n") : "";
  const [draft, setDraft] = useState(initial);
  const formRef = useRef<HTMLFormElement>(null);
  const terms = parseSearchSynonymTerms(draft);
  const problem = terms.length > 0 ? searchSynonymTermsProblem(terms) : undefined;
  const isDirty = draft !== initial;
  useUnsavedChangesGuard(isDirty);
  useHotkey(
    "mod+s",
    (event) => {
      event.preventDefault();
      formRef.current?.requestSubmit();
    },
    { label: "Save", allowWhileEditing: true },
  );

  const requestClose = async (): Promise<void> => {
    if (
      isDirty &&
      !(await confirm({
        title: "Discard unsaved changes?",
        description: "Your changes have not been saved.",
        confirmLabel: "Discard",
        tone: "danger",
      }))
    )
      return;
    onClose();
  };

  return (
    <EntityDrawer
      open
      onClose={() => void requestClose()}
      title={group ? translateText("Edit search synonyms") : translateText("New search synonym group")}
      subtitle={group ? `${translateText("Version")} ${group.version}` : undefined}
      details={
        <form
          ref={formRef}
          id="search-synonym-form"
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (problem === undefined && terms.length > 0) onSave(terms);
          }}
        >
          {group ? (
            <p className="text-sm text-muted">
              {translateText(
                "Saving sends the group back to pending review. It leaves search until another staff member approves it.",
              )}
            </p>
          ) : null}
          <Field
            label={translateText("Terms")}
            hint={translateText(
              "One term per line, or separate terms with commas. Use 2 to 20 terms, each 1 to 60 characters.",
            )}
          >
            <Textarea
              aria-label={translateText("Terms")}
              rows={group ? 8 : 5}
              value={draft}
              spellCheck={false}
              onChange={(event) => setDraft(event.target.value)}
            />
          </Field>
          {problem ? <p className="text-sm text-danger">{translateText(problem)}</p> : null}
        </form>
      }
      footer={
        <>
          <Button variant="outline" onClick={() => void requestClose()}>
            {translateText("Cancel")}
          </Button>
          <Button
            type="submit"
            form="search-synonym-form"
            disabled={busy || problem !== undefined || terms.length === 0}
          >
            {translateText(group ? "Save changes" : "Submit for review")}
          </Button>
        </>
      }
    />
  );
};

/** Search synonym groups under maker-checker review: a change waits for another staff member to approve it. */
export const SearchSynonymsSection = (): React.JSX.Element => {
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const session = useSession();
  const writeGate = can("synonym.write", session);
  const approveRoleAllowed = can("synonym.approve", session).allowed;
  const { values, setValues } = useListUrlState(LIST_DEFAULTS);
  const tab = (TABS as readonly string[]).includes(values.tab) ? values.tab : LIST_DEFAULTS.tab;
  const groupsQuery = useQuery({ queryKey: searchSynonymsQueryKey, queryFn: listSearchSynonymGroups });
  const [drawer, setDrawer] = useState<{ group?: SearchSynonymGroup }>();

  const mutation = useMutation({
    mutationFn: runSynonymMutation,
    onSuccess: (_data, input) => {
      toast.success(translateText(successMessages[input.kind]));
      if (input.kind === "create" || input.kind === "update") setDrawer(undefined);
    },
    onError: (reason) => toast.error(problemMessage(reason)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: searchSynonymsQueryKey }),
  });
  const busy = mutation.isPending;

  useHotkey("n", () => setDrawer({}), { label: "Create new", when: drawer === undefined && writeGate.allowed });

  const approve = async (group: SearchSynonymGroup): Promise<void> => {
    const accepted = await confirm({
      title: "Approve this group?",
      description: "It goes live in search at once.",
      confirmLabel: "Approve",
    });
    if (accepted) mutation.mutate({ kind: "approve", group });
  };

  const remove = async (group: SearchSynonymGroup): Promise<void> => {
    const accepted = await confirm({
      title: "Delete this group?",
      description: "It leaves search at once and no review is needed.",
      tone: "danger",
      confirmLabel: "Delete",
    });
    if (accepted) mutation.mutate({ kind: "delete", group });
  };

  const groups = groupsQuery.data ?? [];
  const groupById = new Map(groups.map((group) => [group.id, group]));
  const visible = groups.filter((group) =>
    tab === "In use" ? group.status === "approved" : group.status === "pending",
  );

  const columns: Column[] = [
    {
      key: "terms",
      label: translateText("Terms"),
      enableSorting: false,
      text: (row) => termsOf(row).join(", "),
      render: (row) => (
        <ul className="flex flex-wrap gap-1.5" aria-label={translateText("Terms")}>
          {termsOf(row).map((term) => (
            <li key={term}>
              <Badge variant="secondary">{term}</Badge>
            </li>
          ))}
        </ul>
      ),
    },
    { key: "version", label: translateText("Version") },
    {
      key: "submittedAt",
      label: translateText("Submitted"),
      text: (row) => formatDateTime(row.submittedAt),
      render: (row) => formatDateTime(row.submittedAt),
    },
    {
      key: "approvedAt",
      label: translateText("Approved"),
      text: (row) => (row.status === "approved" ? formatDateTime(row.approvedAt) : "-"),
      render: (row) => (row.status === "approved" ? formatDateTime(row.approvedAt) : "-"),
    },
    {
      key: "actions",
      label: translateText("Actions"),
      pinned: "right",
      width: 220,
      render: (row) => {
        const group = groupById.get(text(row.id, ""));
        if (!group) return null;
        return (
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            {writeGate.allowed ? (
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => setDrawer({ group })}>
                {translateText("Edit")}
              </Button>
            ) : null}
            {group.status === "pending" && approveRoleAllowed ? (
              <GatedButton
                gate={can("synonym.approve", session, { ownerId: group.submittedBy })}
                size="sm"
                disabled={busy}
                onClick={() => void approve(group)}
              >
                {translateText("Approve")}
              </GatedButton>
            ) : null}
            {writeGate.allowed ? (
              <Button variant="danger-ghost" size="sm" disabled={busy} onClick={() => void remove(group)}>
                {translateText("Delete")}
              </Button>
            ) : null}
          </div>
        );
      },
    },
  ];

  return (
    <>
      <PageActions>
        <GatedButton gate={writeGate} size="sm" onClick={() => setDrawer({})}>
          {translateText("New group")}
        </GatedButton>
      </PageActions>
      <Alert variant="info" className="mb-4">
        {translateText(
          "A group of words shoppers may use for the same symptom. A change goes live only after another staff member approves it.",
        )}
      </Alert>
      {groupsQuery.isError ? (
        <Alert variant="danger" className="mb-3">
          {translateText("Unable to load search synonyms.")}
        </Alert>
      ) : null}
      <SubTabs tabs={[...TABS]} active={tab} onChange={(next) => setValues({ tab: next }, { history: "push" })} />
      <DataTable
        rows={visible}
        columns={columns}
        loading={groupsQuery.isPending}
        empty={translateText(tab === "In use" ? "No groups are in use." : "No groups are waiting for review.")}
        getKey={(row) => text(row.id, "")}
        storageKey="staff:catalog:search-synonyms"
      />
      {drawer ? (
        <SynonymDrawer
          group={drawer.group}
          busy={busy}
          onClose={() => setDrawer(undefined)}
          onSave={(terms) =>
            mutation.mutate(drawer.group ? { kind: "update", group: drawer.group, terms } : { kind: "create", terms })
          }
        />
      ) : null}
    </>
  );
};
