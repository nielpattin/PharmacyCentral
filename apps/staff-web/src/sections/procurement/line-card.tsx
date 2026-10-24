import { Button, Card, CardContent, CardHeader, CardTitle } from "@pharmacy/ui";

import { translateText } from "../../i18n.ts";

/** One line of a purchase order or goods receipt, with its remove action when there is more than one line. */
export const LineCard = ({
  index,
  removable,
  onRemove,
  children,
}: {
  index: number;
  removable: boolean;
  onRemove: () => void;
  children: React.ReactNode;
}): React.JSX.Element => (
  <Card>
    <CardHeader className="grid-cols-[1fr_auto] items-center gap-3 border-b-0 pb-0">
      <CardTitle className="text-sm">
        {translateText("Line")} {index + 1}
      </CardTitle>
      {removable ? (
        <Button type="button" variant="danger-soft" size="sm" onClick={onRemove}>
          {translateText("Remove line")}
        </Button>
      ) : null}
    </CardHeader>
    <CardContent>{children}</CardContent>
  </Card>
);
