import { Button, Card } from "@pharmacy/ui";
import { type ReactNode } from "react";

import { translateText } from "../i18n.ts";
import type { AccessResult } from "../permissions/staff-permissions.ts";
import { GatedButton } from "./gated-button.tsx";
import { PageActions } from "./page-actions.tsx";

/** One numbered line of a multi-line form (transfer, count, prescription). Lay its fields out as children. */
export const LineCard = ({
  index,
  onRemove,
  children,
}: {
  index: number;
  onRemove?: (() => void) | undefined;
  children: ReactNode;
}): React.JSX.Element => (
  <Card className="grid gap-3 p-4 sm:col-span-2">
    <div className="flex items-center justify-between gap-2">
      <p className="text-sm font-semibold text-ink">
        {translateText("Line")} {index + 1}
      </p>
      {onRemove ? (
        <Button size="sm" variant="danger-ghost" onClick={onRemove}>
          {translateText("Remove line")}
        </Button>
      ) : null}
    </div>
    <div className="grid gap-3 sm:grid-cols-2">{children}</div>
  </Card>
);

export const AddLineButton = ({ onAdd }: { onAdd: () => void }): React.JSX.Element => (
  <div className="sm:col-span-2">
    <Button size="sm" variant="outline" onClick={onAdd}>
      {translateText("Add line")}
    </Button>
  </div>
);

/** The "Create" action in the shell header. Pages with a create flow render one. */
export const CreateAction = ({
  label,
  onClick,
  gate,
  variant,
}: {
  label: string;
  onClick: () => void;
  /** Set when the role may not create; the button is then dimmed with the reason. */
  gate?: AccessResult;
  variant?: "secondary";
}): React.JSX.Element => (
  <PageActions>
    <GatedButton gate={gate ?? { allowed: true }} size="sm" {...(variant ? { variant } : {})} onClick={onClick}>
      {translateText(label)}
    </GatedButton>
  </PageActions>
);
