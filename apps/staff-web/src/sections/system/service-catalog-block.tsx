import { useQuery } from "@tanstack/react-query";

import { Alert, Skeleton } from "@pharmacy/ui";

import { translateText } from "../../i18n.ts";
import { readSystemCatalog, SYSTEM_CATALOG_QUERY_KEY, type SystemServiceEntry } from "./catalog-api.ts";
import { SYSTEM_STATIC_STALE_MS } from "./constants.ts";
import { catalogView } from "./catalog-state.ts";

// Every state of the block fills this height, so the charts below it never move when the catalog arrives.
const RESERVED_HEIGHT = "min-h-56";

const NameList = ({
  names,
  onOpenService,
}: {
  names: readonly string[];
  onOpenService: (name: string) => void;
}): React.JSX.Element =>
  names.length === 0 ? (
    <span className="text-sm text-muted">{translateText("None")}</span>
  ) : (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
      {names.map((name) => (
        <li key={name}>
          <button type="button" className="text-link" onClick={() => onOpenService(name)}>
            {name}
          </button>
        </li>
      ))}
    </ul>
  );

const EventList = ({ events }: { events: readonly string[] }): React.JSX.Element =>
  events.length === 0 ? (
    <span className="text-sm text-muted">{translateText("None")}</span>
  ) : (
    <ul className="grid gap-1 font-mono text-xs">
      {events.map((event) => (
        <li key={event} className="break-all">
          {event}
        </li>
      ))}
    </ul>
  );

const CatalogDetails = ({
  entry,
  onOpenService,
}: {
  entry: SystemServiceEntry;
  onOpenService: (name: string) => void;
}): React.JSX.Element => (
  <div className="grid gap-x-6 gap-y-4 md:grid-cols-2">
    <section className="grid content-start gap-2">
      <h3 className="text-sm font-medium">{translateText("About")}</h3>
      <p className="text-sm">{translateText(entry.description)}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted">{translateText("Database")}</dt>
        <dd className="font-mono text-xs">{entry.database ?? translateText("None")}</dd>
        <dt className="text-muted">{translateText("Port")}</dt>
        <dd className="tabular-nums">{entry.port}</dd>
      </dl>
    </section>
    <section className="grid content-start gap-4">
      <div className="grid gap-2">
        <h3 className="text-sm font-medium">{translateText("Calls")}</h3>
        <NameList names={entry.dependsOn} onOpenService={onOpenService} />
      </div>
      <div className="grid gap-2">
        <h3 className="text-sm font-medium">{translateText("Called by")}</h3>
        <NameList names={entry.calledBy} onOpenService={onOpenService} />
      </div>
    </section>
    <section className="grid gap-4 md:col-span-2 md:grid-cols-2">
      <div className="grid content-start gap-2">
        <h3 className="text-sm font-medium">{translateText("Events published")}</h3>
        <EventList events={entry.events.published} />
      </div>
      <div className="grid content-start gap-2">
        <h3 className="text-sm font-medium">{translateText("Events consumed")}</h3>
        <EventList events={entry.events.consumed} />
      </div>
    </section>
  </div>
);

/**
 * The About, Calls, Called by and events block of the service sheet. A failed catalog shows its own message in
 * the reserved space and leaves the rest of the sheet working.
 */
export const ServiceCatalogBlock = ({
  serviceName,
  onOpenService,
}: {
  serviceName: string;
  onOpenService: (name: string) => void;
}): React.JSX.Element => {
  const catalogQuery = useQuery({
    queryKey: SYSTEM_CATALOG_QUERY_KEY,
    queryFn: readSystemCatalog,
    staleTime: SYSTEM_STATIC_STALE_MS,
    retry: false,
  });
  const view = catalogView(catalogQuery, serviceName);

  let content: React.JSX.Element;
  if (view.status === "ready") {
    content = <CatalogDetails entry={view.entry} onOpenService={onOpenService} />;
  } else if (view.status === "error") {
    content = <Alert variant="danger">{translateText("Service catalog unavailable.")}</Alert>;
  } else if (view.status === "missing") {
    content = <p className="text-sm text-muted">{translateText("This service has no catalog entry.")}</p>;
  } else {
    content = <Skeleton className={`h-full w-full ${RESERVED_HEIGHT}`} />;
  }

  return <div className={RESERVED_HEIGHT}>{content}</div>;
};
