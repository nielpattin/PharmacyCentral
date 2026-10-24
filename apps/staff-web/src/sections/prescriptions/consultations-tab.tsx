import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  StatusBadge,
  Textarea,
  useToast,
} from "@pharmacy/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { useListUrlState } from "../../hooks/useListUrlState.ts";
import { usePagedList } from "../../hooks/usePagedList.ts";
import { referenceLabel, useStaffReferences } from "../../hooks/useStaffReferences.ts";
import { translateText } from "../../i18n.ts";
import { ApiProblemError, formatDateTime, formatQuantity, request, text, type JsonRecord } from "../../staff-api.ts";
import {
  activeStatus,
  CONSULTATION_STATUSES,
  consultationTone,
  newIdempotencyKey,
  queryParam,
  recordList,
  statusParam,
} from "../sales/rules.ts";
import { ListToolbar } from "../sales/shared.tsx";

const CONSULTATION_DEFAULTS = { q: "", status: "Open" } as const;

const REPLY_MAX_LENGTH = 2000;

const FIELD_LABELS: ReadonlyArray<readonly [key: string, label: string]> = [
  ["code", "Prescription code"],
  ["patientName", "Patient"],
  ["doctorName", "Doctor"],
  ["facilityName", "Issuing facility"],
  ["diagnosis", "Diagnosis"],
  ["issuedOn", "Issued on"],
];

/**
 * Open consultation requests from shoppers, oldest unanswered first in the Open tab. Customers see only their own;
 * staff see every request, and only a pharmacist (`canOperateCounter`) may answer.
 */
export const ConsultationsTab = ({ canOperateCounter }: { canOperateCounter: boolean }): React.JSX.Element => {
  const queryClient = useQueryClient();
  const toast = useToast();
  const references = useStaffReferences();
  const { values, setValues } = useListUrlState(CONSULTATION_DEFAULTS);
  const status = activeStatus(values.status, CONSULTATION_STATUSES, "Open");
  const consultations = usePagedList({
    key: ["staff-consultations"],
    path: "/api/prescriptions/consultations",
    params: { status: statusParam(status), q: queryParam(values.q) },
    limit: 50,
  });
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [replyErrors, setReplyErrors] = useState<Record<string, string>>({});
  // One key per consultation, kept while the answer is unknown, so a retry of the same reply cannot record a second
  // answer. The key is spent once the server answers, so a later request starts a new one.
  const [replyKeys, setReplyKeys] = useState<Record<string, string>>({});
  const [sending, setSending] = useState<string>();
  const [notice, setNotice] = useState<string>();

  const sendReply = async (consultation: JsonRecord): Promise<void> => {
    const id = text(consultation.id, "");
    const reply = (replyDrafts[id] ?? "").trim();
    if (!reply) return;
    setSending(id);
    setReplyErrors((current) => ({ ...current, [id]: "" }));
    try {
      const idempotencyKey = replyKeys[id] ?? newIdempotencyKey();
      setReplyKeys((current) => ({ ...current, [id]: idempotencyKey }));
      await request(`/api/prescriptions/consultations/${encodeURIComponent(id)}/answer`, {
        method: "POST",
        body: JSON.stringify({ reply }),
        idempotencyKey,
      });
      setReplyDrafts((current) => {
        const remaining = { ...current };
        delete remaining[id];
        return remaining;
      });
      setReplyKeys((current) => {
        const remaining = { ...current };
        delete remaining[id];
        return remaining;
      });
      toast.success(translateText("Consultation answered."));
      await queryClient.invalidateQueries({ queryKey: ["staff-consultations"] });
    } catch (reason) {
      // A server answer spends the key, so the next attempt is a new request. A network failure keeps it: the answer
      // may already have been stored under that key.
      if (reason instanceof ApiProblemError) {
        setReplyKeys((current) => ({ ...current, [id]: newIdempotencyKey() }));
      }
      // Another pharmacist answered first: the refetch drops the request from the open queue.
      if (reason instanceof ApiProblemError && reason.problem.code === "consultation_already_answered") {
        setNotice("Another pharmacist already answered this request.");
        await queryClient.invalidateQueries({ queryKey: ["staff-consultations"] });
        return;
      }
      setReplyErrors((current) => ({
        ...current,
        [id]: reason instanceof Error ? reason.message : "Unable to answer the consultation request",
      }));
    } finally {
      setSending(undefined);
    }
  };

  return (
    <div className="grid gap-3">
      <ListToolbar
        pageKey="consultations"
        defaults={CONSULTATION_DEFAULTS}
        query={values.q}
        onQueryChange={(q) => setValues({ q })}
        searchPlaceholder="Search by patient name or prescription code"
        statuses={CONSULTATION_STATUSES}
        status={status}
        onStatusChange={(next) => setValues({ status: next }, { history: "push" })}
      />
      {notice ? <Alert variant="info">{translateText(notice)}</Alert> : null}
      {consultations.error ? <Alert variant="danger">{translateText(consultations.error.message)}</Alert> : null}
      {consultations.isLoading ? (
        <p className="text-sm text-muted">{translateText("Loading consultation requests…")}</p>
      ) : null}
      {!consultations.isLoading && consultations.rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line p-6 text-center text-sm text-muted">
          {translateText("No consultation requests.")}
        </p>
      ) : null}
      <div className="grid gap-3">
        {consultations.rows.map((consultation) => {
          const id = text(consultation.id, "");
          const prescription = (consultation.prescription ?? {}) as JsonRecord;
          const fields = FIELD_LABELS.flatMap(([key, label]) => {
            const value = text(prescription[key], "");
            return value === "" || value === "-" ? [] : [{ label, value }];
          });
          // Lines no catalog product could fill lead the card, so the pharmacist reads the gaps first.
          const lines = recordList(consultation.lines).sort(
            (left, right) => Number(right.needsHelp === true) - Number(left.needsHelp === true),
          );
          const replyDraft = replyDrafts[id] ?? "";
          const isOpen = text(consultation.status, "") === "Open";
          return (
            <Card key={id}>
              <CardHeader className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle>
                    {consultation.siteId
                      ? referenceLabel(references.sites, consultation.siteId, ["code", "name"])
                      : translateText("No store selected")}
                  </CardTitle>
                  <CardDescription>
                    {translateText("Sent at")} {formatDateTime(consultation.createdAt)}
                  </CardDescription>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge tone={consultationTone(text(consultation.status, ""))}>
                    {translateText(text(consultation.status, "-"))}
                  </StatusBadge>
                  <Badge variant="secondary">{translateText(consultation.source === "qr" ? "QR code" : "Photo")}</Badge>
                </div>
              </CardHeader>
              <CardContent className="grid gap-3">
                {fields.length ? (
                  <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {fields.map((field) => (
                      <div key={field.label}>
                        <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
                          {translateText(field.label)}
                        </dt>
                        <dd className="text-sm text-ink">{field.value}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
                {consultation.note ? (
                  <div className="rounded-md border border-line bg-surface-soft p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                      {translateText("Shopper note")}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{text(consultation.note, "")}</p>
                  </div>
                ) : null}
                <div className="grid gap-2">
                  {lines.map((line, index) => (
                    <ConsultationLineCard key={text(line.id, String(index))} line={line} />
                  ))}
                </div>
                {isOpen && !canOperateCounter ? (
                  <p className="text-sm text-muted">{translateText("Waiting for a pharmacist to reply.")}</p>
                ) : isOpen ? (
                  <div className="grid gap-2">
                    <label
                      className="text-xs font-semibold uppercase tracking-wide text-muted"
                      htmlFor={`consultation-reply-${id}`}
                    >
                      {translateText("Your reply")}
                    </label>
                    <Textarea
                      id={`consultation-reply-${id}`}
                      rows={3}
                      maxLength={REPLY_MAX_LENGTH}
                      placeholder={translateText("Tell the shopper which medicines to take instead")}
                      value={replyDraft}
                      onChange={(event) => setReplyDrafts((current) => ({ ...current, [id]: event.target.value }))}
                    />
                    {replyErrors[id] ? <Alert variant="danger">{translateText(replyErrors[id])}</Alert> : null}
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs text-muted">
                        {replyDraft.length}/{REPLY_MAX_LENGTH}
                      </span>
                      <Button
                        size="sm"
                        disabled={!replyDraft.trim() || sending !== undefined}
                        onClick={() => void sendReply(consultation)}
                      >
                        {translateText("Send reply")}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-md border border-line bg-surface-soft p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                      {translateText("Pharmacist reply")}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{text(consultation.reply, "")}</p>
                    <p className="mt-1 text-xs text-muted">
                      {translateText("Answered at")} {formatDateTime(consultation.answeredAt)}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
      {consultations.hasMore ? (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" disabled={consultations.isLoadingMore} onClick={consultations.loadMore}>
            {translateText(consultations.isLoadingMore ? "Loading more…" : "Load more")}
          </Button>
        </div>
      ) : null}
    </div>
  );
};

const ConsultationLineCard = ({ line }: { line: JsonRecord }): React.JSX.Element => {
  const activeIngredients = Array.isArray(line.activeIngredients)
    ? line.activeIngredients.filter((item): item is string => typeof item === "string")
    : [];
  const details = [
    activeIngredients.length ? `${translateText("Active ingredients")}: ${activeIngredients.join(", ")}` : undefined,
    line.strength ? `${translateText("Strength")}: ${text(line.strength, "")}` : undefined,
    line.dosageForm ? `${translateText("Dosage form")}: ${text(line.dosageForm, "")}` : undefined,
    line.quantity !== null && line.quantity !== undefined
      ? `${translateText("Quantity")}: ${formatQuantity(line.quantity)}${line.unit ? ` ${text(line.unit, "")}` : ""}`
      : undefined,
    line.usage ? `${translateText("Usage")}: ${text(line.usage, "")}` : undefined,
    line.name && line.rawText !== line.name ? `${translateText("As printed")}: ${text(line.rawText, "")}` : undefined,
  ].filter((detail): detail is string => Boolean(detail));
  return (
    <div className="rounded-md border border-line p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong className="text-sm text-ink">{text(line.name ?? line.rawText, "-")}</strong>
        {line.needsHelp === true ? <Badge variant="danger">{translateText("Needs a substitute")}</Badge> : null}
      </div>
      {details.length ? <p className="mt-1 text-xs text-muted">{details.join(" · ")}</p> : null}
    </div>
  );
};
