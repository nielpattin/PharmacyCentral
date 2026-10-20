import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Badge, Card, CardContent, CardHeader, CardTitle, Dialog, Field, Textarea } from "@pharmacy/ui";

import { useSession } from "../auth.ts";
import { RefreshButton } from "../components/forms.tsx";
import { translateText } from "../i18n.ts";
import {
  approveSearchSynonymGroup,
  createSearchSynonymGroup,
  deleteSearchSynonymGroup,
  formatDateTime,
  listSearchSynonymGroups,
  updateSearchSynonymGroup,
  ApiProblemError,
  type SearchSynonymGroup,
} from "../staff-api.ts";
import { parseSearchSynonymTerms, searchSynonymTermsProblem } from "../search-synonym-terms.ts";

const searchSynonymsQueryKey = ["search-synonyms"] as const;

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

// Maps the catalog-service problem codes to staff-facing text. Anything else shows the server's own message.
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

type GroupActions = {
  userId: string | undefined;
  busy: boolean;
  onEdit: (group: SearchSynonymGroup) => void;
  onApprove: (group: SearchSynonymGroup) => void;
  onDelete: (group: SearchSynonymGroup) => void;
};

const GroupRow = ({
  group,
  userId,
  busy,
  onEdit,
  onApprove,
  onDelete,
}: GroupActions & { group: SearchSynonymGroup }): React.JSX.Element => {
  const ownChange = group.submittedBy === userId;
  const label = group.terms.join(", ");
  return (
    <li className="grid gap-3 rounded-lg border border-line bg-surface p-4">
      <ul className="flex flex-wrap gap-1.5" aria-label={translateText("Terms")}>
        {group.terms.map((term) => (
          <li key={term}>
            <Badge variant="secondary">{term}</Badge>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted">
          {`${translateText("Version")} ${group.version} · ${translateText("Submitted")} ${formatDateTime(group.submittedAt)} · `}
          <Badge variant={ownChange ? "primary" : "outline"}>
            {ownChange ? translateText("You proposed this") : translateText("Another staff member proposed this")}
          </Badge>
          {group.status === "approved" ? ` · ${translateText("Approved")} ${formatDateTime(group.approvedAt)}` : null}
        </p>
        <span className="row-actions">
          <button
            className="ghost-button small"
            type="button"
            aria-label={`${translateText("Edit")} ${label}`}
            disabled={busy}
            onClick={() => onEdit(group)}
          >
            {translateText("Edit")}
          </button>
          {group.status === "pending" ? (
            <span title={ownChange ? translateText("You cannot approve your own change") : undefined}>
              <button
                className="ghost-button small"
                type="button"
                aria-label={`${translateText("Approve")} ${label}`}
                disabled={busy || ownChange}
                onClick={() => onApprove(group)}
              >
                {translateText("Approve")}
              </button>
            </span>
          ) : null}
          <button
            className="danger-button"
            type="button"
            aria-label={`${translateText("Delete")} ${label}`}
            disabled={busy}
            onClick={() => onDelete(group)}
          >
            {translateText("Delete")}
          </button>
        </span>
      </div>
    </li>
  );
};

const GroupList = ({
  headingId,
  title,
  empty,
  groups,
  actions,
}: {
  headingId: string;
  title: string;
  empty: string;
  groups: SearchSynonymGroup[];
  actions: GroupActions;
}): React.JSX.Element => (
  <section aria-labelledby={headingId} className="grid gap-3">
    <h2 id={headingId} className="text-base font-semibold text-ink">
      {translateText(title)}
    </h2>
    {groups.length === 0 ? (
      <p className="rounded-md border border-dashed border-line p-6 text-center text-sm text-muted">
        {translateText(empty)}
      </p>
    ) : (
      <ul className="grid gap-3">
        {groups.map((group) => (
          <GroupRow key={group.id} group={group} {...actions} />
        ))}
      </ul>
    )}
  </section>
);

export const SearchSynonymsSection = (): React.JSX.Element => {
  const queryClient = useQueryClient();
  const userId = useSession().userId;
  const groupsQuery = useQuery({ queryKey: searchSynonymsQueryKey, queryFn: listSearchSynonymGroups });
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<SearchSynonymGroup>();
  const [editDraft, setEditDraft] = useState("");
  const [deleting, setDeleting] = useState<SearchSynonymGroup>();
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();

  const mutation = useMutation({
    mutationFn: runSynonymMutation,
    onMutate: () => {
      setMessage(undefined);
      setError(undefined);
    },
    onSuccess: (_data, input) => {
      setMessage(translateText(successMessages[input.kind]));
      if (input.kind === "create") setDraft("");
      if (input.kind === "update") setEditing(undefined);
      if (input.kind === "delete") setDeleting(undefined);
    },
    onError: (reason) => setError(problemMessage(reason)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: searchSynonymsQueryKey }),
  });

  const busy = mutation.isPending;
  const draftTerms = parseSearchSynonymTerms(draft);
  const draftProblem = draftTerms.length > 0 ? searchSynonymTermsProblem(draftTerms) : undefined;
  const editTerms = parseSearchSynonymTerms(editDraft);
  const editProblem = editTerms.length > 0 ? searchSynonymTermsProblem(editTerms) : undefined;

  const openEdit = (group: SearchSynonymGroup): void => {
    setEditing(group);
    setEditDraft(group.terms.join("\n"));
  };

  const actions: GroupActions = {
    userId,
    busy,
    onEdit: openEdit,
    onApprove: (group) => mutation.mutate({ kind: "approve", group }),
    onDelete: setDeleting,
  };

  const groups = groupsQuery.data ?? [];
  const pending = groups.filter((group) => group.status === "pending");
  const approved = groups.filter((group) => group.status === "approved");

  return (
    <section className="staff-section">
      <div className="page-head">
        <div>
          <h1>{translateText("Search synonyms")}</h1>
          <p className="page-subtitle">
            {translateText(
              "A group of words shoppers may use for the same symptom. A change goes live only after another staff member approves it.",
            )}
          </p>
        </div>
        <RefreshButton onClick={() => void groupsQuery.refetch()} />
      </div>
      {error ? <p className="notice">{error}</p> : null}
      {message ? <p className="success-note">{message}</p> : null}

      <Card>
        <CardHeader>
          <CardTitle>{translateText("New group")}</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            aria-label={translateText("New search synonym group")}
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (draftProblem === undefined && draftTerms.length > 0)
                mutation.mutate({ kind: "create", terms: draftTerms });
            }}
          >
            <Field
              label={translateText("Terms")}
              hint={translateText(
                "One term per line, or separate terms with commas. Use 2 to 20 terms, each 1 to 60 characters.",
              )}
            >
              <Textarea
                aria-label={translateText("Terms")}
                rows={4}
                value={draft}
                spellCheck={false}
                onChange={(event) => setDraft(event.target.value)}
              />
            </Field>
            {draftProblem ? <p className="text-sm text-danger">{translateText(draftProblem)}</p> : null}
            <div className="flex justify-end">
              <button
                className="ghost-button"
                type="submit"
                disabled={busy || draftTerms.length === 0 || draftProblem !== undefined}
              >
                {translateText("Submit for review")}
              </button>
            </div>
          </form>
        </CardContent>
      </Card>

      {groupsQuery.isError ? (
        <p className="notice">{translateText("Unable to load search synonyms.")}</p>
      ) : groupsQuery.data ? (
        <>
          <GroupList
            headingId="search-synonyms-pending"
            title="Pending review"
            empty="No groups are waiting for review."
            groups={pending}
            actions={actions}
          />
          <GroupList
            headingId="search-synonyms-approved"
            title="In use"
            empty="No groups are in use."
            groups={approved}
            actions={actions}
          />
        </>
      ) : (
        <p className="loading-note">{translateText("Loading search synonyms...")}</p>
      )}

      <Dialog
        open={editing !== undefined}
        onClose={() => setEditing(undefined)}
        title={translateText("Edit search synonyms")}
      >
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (editing && editProblem === undefined)
              mutation.mutate({ kind: "update", group: editing, terms: editTerms });
          }}
        >
          <p className="text-sm text-muted">
            {translateText(
              "Saving sends the group back to pending review. It leaves search until another staff member approves it.",
            )}
          </p>
          <Field label={translateText("Terms")}>
            <Textarea
              aria-label={translateText("Terms")}
              rows={6}
              value={editDraft}
              spellCheck={false}
              onChange={(event) => setEditDraft(event.target.value)}
            />
          </Field>
          {editProblem ? <p className="text-sm text-danger">{translateText(editProblem)}</p> : null}
          {error ? <p className="notice">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <button className="ghost-button" type="button" onClick={() => setEditing(undefined)}>
              {translateText("Cancel")}
            </button>
            <button
              className="ghost-button"
              type="submit"
              disabled={busy || editProblem !== undefined || editTerms.length === 0}
            >
              {translateText("Save changes")}
            </button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={deleting !== undefined}
        onClose={() => setDeleting(undefined)}
        title={translateText("Delete search synonyms")}
      >
        <div className="grid gap-3">
          <p className="text-sm text-muted">
            {translateText("Delete this group? It leaves search at once and no review is needed.")}
          </p>
          {error ? <p className="notice">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <button className="ghost-button" type="button" onClick={() => setDeleting(undefined)}>
              {translateText("Cancel")}
            </button>
            <button
              className="danger-button"
              type="button"
              disabled={busy}
              onClick={() => deleting && mutation.mutate({ kind: "delete", group: deleting })}
            >
              {translateText("Delete")}
            </button>
          </div>
        </div>
      </Dialog>
    </section>
  );
};
