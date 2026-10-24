import { Alert, Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@pharmacy/ui";

import { translateText } from "../../i18n.ts";

// A dashboard card: title and description on top, content below, no coloured accents.
export const SectionCard = ({
  title,
  description,
  unavailable = false,
  action,
  children,
}: {
  title: string;
  description: string;
  unavailable?: boolean;
  action?: React.ReactNode;
  children: React.ReactNode;
}): React.JSX.Element => (
  <Card>
    <CardHeader className="flex items-start justify-between gap-3 border-b-0 pb-0">
      <div className="grid min-w-0 gap-1">
        <CardTitle className="text-sm font-medium">{translateText(title)}</CardTitle>
        <CardDescription>{translateText(description)}</CardDescription>
      </div>
      {unavailable ? <Badge variant="danger">{translateText("Unavailable")}</Badge> : action}
    </CardHeader>
    <CardContent className="grid gap-4">{children}</CardContent>
  </Card>
);

export const UnavailableCard = ({
  title,
  description,
  error,
}: {
  title: string;
  description: string;
  error: string;
}): React.JSX.Element => (
  <SectionCard title={title} description={description} unavailable>
    <Alert variant="danger">{translateText(error)}</Alert>
  </SectionCard>
);
