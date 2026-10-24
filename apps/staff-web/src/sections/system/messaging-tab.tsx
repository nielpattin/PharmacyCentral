import type { SystemOverview } from "../../staff-api.ts";
import { QueuesCard } from "./queues-card.tsx";
import { SearchIndexCard } from "./search-index-card.tsx";

export const MessagingTab = ({ overview }: { overview: SystemOverview }): React.JSX.Element => (
  <div className="grid gap-4">
    <QueuesCard queues={overview.queues} />
    <SearchIndexCard searchIndex={overview.searchIndex} />
  </div>
);
