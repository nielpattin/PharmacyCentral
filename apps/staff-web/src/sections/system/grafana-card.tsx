import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@pharmacy/ui";

import { EmptyState } from "../../components/forms.tsx";
import { translateText } from "../../i18n.ts";
import { grafanaLinks } from "./grafana-links.ts";

// Grafana holds what this page does not: RED per service, traces, logs, the service graph and the messaging panels.
export const GrafanaCard = ({ baseUrl }: { baseUrl: string | undefined }): React.JSX.Element => (
  <Card>
    <CardHeader className="grid gap-1 border-b-0 pb-0">
      <CardTitle className="text-sm font-medium">{translateText("Grafana")}</CardTitle>
      <CardDescription>
        {translateText("Open the dashboards in a new tab. RED, traces, logs and the service graph live there.")}
      </CardDescription>
    </CardHeader>
    <CardContent>
      {baseUrl === undefined ? (
        <EmptyState>{translateText("No dashboards configured.")}</EmptyState>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {grafanaLinks(baseUrl).map((link) => (
            <li key={link.key}>
              <a
                href={link.url}
                target="_blank"
                rel="noreferrer"
                className="grid h-full gap-1 rounded-lg border border-line p-3 text-sm outline-none hover:bg-surface-soft focus-visible:ring-2 focus-visible:ring-primary/50"
              >
                <span className="font-medium text-link">{translateText(link.label)}</span>
                <span className="text-muted">{translateText(link.description)}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </CardContent>
  </Card>
);
