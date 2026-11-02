import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  Input,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@pharmacy/ui";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { useStaffAction } from "../../hooks/useStaffAction.ts";
import { translateText } from "../../i18n.ts";
import { formatDateTime, request } from "../../staff-api.ts";
import {
  formatLimit,
  formatUsd,
  limitBody,
  limitFormFrom,
  priceBody,
  priceFormFrom,
  type AiBudgetView,
  type ConfiguredModel,
  type LimitForm,
  type PriceForm,
} from "./ai-budget-form.ts";

export const aiBudgetQueryKey = ["ai-budget"] as const;
const AI_BUDGET_PATH = "/api/chatbot/ai-budget";
const AI_PRICE_PATH = "/api/chatbot/ai-prices";

const loadBudget = (): Promise<AiBudgetView> => request<AiBudgetView>(AI_BUDGET_PATH);

const SpendSummary = ({ view }: { view: AiBudgetView }): React.JSX.Element => {
  const unlimited = translateText("No limit");
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      <dt className="text-muted">{translateText("Spent today")}</dt>
      <dd>
        {formatUsd(view.spend.todayUsd)} / {formatLimit(view.limits.dailyUsd, unlimited)}
      </dd>
      <dt className="text-muted">{translateText("Spent this month")}</dt>
      <dd>
        {formatUsd(view.spend.monthUsd)} / {formatLimit(view.limits.monthlyUsd, unlimited)}
      </dd>
      <dt className="text-muted">{translateText("Day and month are counted in")}</dt>
      <dd>{view.timezone}</dd>
    </dl>
  );
};

// Remounted with the saved values as its key, so a save resets the form to the server's numbers.
const LimitsForm = ({ view }: { view: AiBudgetView }): React.JSX.Element => {
  const [form, setForm] = useState<LimitForm>(() => limitFormFrom(view));
  const run = useStaffAction();
  const body = limitBody(form);
  const update = (patch: Partial<LimitForm>): void => setForm((previous) => ({ ...previous, ...patch }));

  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (body)
          void run({
            path: AI_BUDGET_PATH,
            method: "PUT",
            body,
            invalidate: [aiBudgetQueryKey],
            success: "Spend limits saved.",
          });
      }}
    >
      <Field
        label={translateText("Daily limit (USD)")}
        hint={translateText("Blank means no limit. Up to six decimals.")}
      >
        <Input inputMode="decimal" value={form.daily} onChange={(event) => update({ daily: event.target.value })} />
      </Field>
      <Field
        label={translateText("Monthly limit (USD)")}
        hint={translateText("Blank means no limit. Up to six decimals.")}
      >
        <Input inputMode="decimal" value={form.monthly} onChange={(event) => update({ monthly: event.target.value })} />
      </Field>
      <div className="flex justify-end">
        <Button type="submit" disabled={body === undefined}>
          {translateText("Save limits")}
        </Button>
      </div>
    </form>
  );
};

const PriceRow = ({ model }: { model: ConfiguredModel }): React.JSX.Element => {
  const [form, setForm] = useState<PriceForm>(() => priceFormFrom(model));
  const run = useStaffAction();
  const body = priceBody(model, form);
  const update = (patch: Partial<PriceForm>): void => setForm((previous) => ({ ...previous, ...patch }));

  return (
    <TableRow>
      <TableCell>
        <div className="grid gap-0.5">
          <span className="font-medium">{translateText(model.label)}</span>
          <span className="text-xs text-muted">
            {model.provider} / {model.model}
          </span>
        </div>
      </TableCell>
      <TableCell>
        <Input
          aria-label={translateText("Input price per 1M tokens (USD)")}
          inputMode="decimal"
          value={form.input}
          onChange={(event) => update({ input: event.target.value })}
        />
      </TableCell>
      <TableCell>
        <Input
          aria-label={translateText("Output price per 1M tokens (USD)")}
          inputMode="decimal"
          value={form.output}
          onChange={(event) => update({ output: event.target.value })}
        />
      </TableCell>
      <TableCell>
        <Input
          aria-label={translateText("Image price per image (USD, optional)")}
          inputMode="decimal"
          value={form.image}
          onChange={(event) => update({ image: event.target.value })}
        />
      </TableCell>
      <TableCell>
        {model.price ? (
          <span className="text-sm text-muted">{formatDateTime(model.price.updatedAt)}</span>
        ) : (
          <Badge variant="danger">{translateText("Not priced")}</Badge>
        )}
      </TableCell>
      <TableCell>
        <Button
          type="button"
          disabled={body === undefined}
          onClick={() => {
            if (body)
              void run({
                path: AI_PRICE_PATH,
                method: "PUT",
                body,
                invalidate: [aiBudgetQueryKey],
                success: "Price saved.",
              });
          }}
        >
          {translateText("Save price")}
        </Button>
      </TableCell>
    </TableRow>
  );
};

export const AiBudgetPanel = (): React.JSX.Element => {
  const budget = useQuery({ queryKey: aiBudgetQueryKey, queryFn: loadBudget });

  if (budget.isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{translateText("AI spend limits and prices")}</CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="danger">{translateText("Unable to load the AI spend limits.")}</Alert>
        </CardContent>
      </Card>
    );
  }
  if (!budget.data) return <Skeleton className="h-96" />;

  const view = budget.data;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{translateText("AI spend limits and prices")}</CardTitle>
        <CardDescription>
          {translateText(
            "The daily and monthly limits stop AI calls before they reach the provider. A model needs a price before a limit can apply.",
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6">
        <SpendSummary view={view} />
        <LimitsForm key={`${view.limits.dailyUsd}/${view.limits.monthlyUsd}`} view={view} />
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{translateText("Model")}</TableHead>
                <TableHead>{translateText("Input (USD per 1M)")}</TableHead>
                <TableHead>{translateText("Output (USD per 1M)")}</TableHead>
                <TableHead>{translateText("Image (USD each)")}</TableHead>
                <TableHead>{translateText("Price updated")}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {view.models.map((model) => (
                <PriceRow
                  key={`${model.purpose}/${model.provider}/${model.model}/${model.price?.updatedAt ?? "unpriced"}`}
                  model={model}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
};
