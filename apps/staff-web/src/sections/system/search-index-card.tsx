import { Alert } from "@pharmacy/ui";

import { translateText } from "../../i18n.ts";
import { formatQuantity, type SystemSearchIndex, type SystemSectionResult } from "../../staff-api.ts";
import { SectionCard } from "./system-cards.tsx";

export const SearchIndexCard = ({
  searchIndex,
}: {
  searchIndex: SystemSectionResult<SystemSearchIndex[]>;
}): React.JSX.Element => (
  <SectionCard title="Search index" description="Documents per search collection.">
    {searchIndex.status === "unavailable" ? (
      <Alert variant="danger">{translateText(searchIndex.error)}</Alert>
    ) : searchIndex.data.length === 0 ? (
      <p className="text-sm text-muted">{translateText("No collections reported.")}</p>
    ) : (
      <ul className="grid divide-y divide-line text-sm">
        {searchIndex.data.map((collection) => (
          <li key={collection.name} className="flex items-center justify-between gap-3 py-2">
            <span className="truncate font-medium" title={collection.name}>
              {collection.name}
            </span>
            <span className="shrink-0 tabular-nums text-muted">
              {`${formatQuantity(collection.documents)} ${translateText("documents")}`}
            </span>
          </li>
        ))}
      </ul>
    )}
  </SectionCard>
);
