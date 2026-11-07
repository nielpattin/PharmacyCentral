import { canAccessSection } from "../permissions/section-access.ts";
import { pathForSection, type Section, type StaffPath } from "../router.ts";

/** The first-level destinations of the staff sidebar. */
export type WorkspaceId =
  | "overview"
  | "actionPlans"
  | "counter"
  | "inventory"
  | "purchasing"
  | "finance"
  | "catalog"
  | "administration"
  | "dataImport";

/**
 * One page in the sidebar. `entries` are the routes that open it; several routes can be tabs of the same page. The
 * first entry the signed-in role may open becomes the page link, unless `section` names a better default.
 */
export type PageDefinition = {
  id: string;
  label: string;
  section?: Section;
  entries: readonly Section[];
};

export type WorkspaceDefinition = {
  id: WorkspaceId;
  label: string;
  pages: readonly PageDefinition[];
  /** Resolvable for breadcrumbs and page search, but not rendered in the sidebar. */
  hidden?: true;
  /** Rendered below the working workspaces, above the sidebar footer. */
  pinned?: true;
};

/**
 * The staff information architecture: workspace > page > tab. A page is one sidebar entry even when it holds several
 * tabs. `docs/product/staff-shell-sign-in-and-navigation.md` owns the role rules; this list owns the grouping.
 */
export const WORKSPACES: readonly WorkspaceDefinition[] = [
  {
    id: "overview",
    label: "Overview",
    pages: [
      { id: "dashboard", label: "Dashboard", entries: ["dashboard"] },
      { id: "analytics", label: "Analytics", entries: ["analytics"] },
    ],
  },
  {
    id: "actionPlans",
    label: "Action plans",
    pages: [{ id: "actionPlans", label: "Action plans", entries: ["actionPlans"] }],
  },
  {
    id: "counter",
    label: "Pharmacy counter",
    pages: [
      {
        id: "prescriptions",
        label: "Prescriptions",
        section: "prescriptions",
        entries: ["pharmacistOverview", "prescriptions"],
      },
      { id: "orders", label: "Online orders", entries: ["orders"] },
    ],
  },
  {
    id: "inventory",
    label: "Inventory",
    pages: [
      {
        id: "inventory",
        label: "Inventory",
        section: "inventory",
        entries: ["inventory", "transfers", "replenishment", "stocktake", "adjustments", "returns", "quality"],
      },
    ],
  },
  {
    id: "purchasing",
    label: "Purchasing",
    pages: [
      {
        id: "purchasing",
        label: "Purchasing",
        section: "procurement",
        entries: ["procurement", "receiving"],
      },
    ],
  },
  {
    id: "finance",
    label: "Finance",
    pages: [{ id: "finance", label: "Finance", entries: ["finance"] }],
  },
  {
    id: "catalog",
    label: "Catalog",
    pages: [
      { id: "products", label: "Products", entries: ["catalog"] },
      { id: "units", label: "Units", entries: ["units"] },
      { id: "pricing", label: "Pricing", entries: ["pricing"] },
      { id: "synonyms", label: "Search synonyms", entries: ["searchSynonyms"] },
      { id: "sites", label: "Sites", entries: ["sites"] },
      { id: "locations", label: "Storage locations", entries: ["storageLocations"] },
      { id: "suppliers", label: "Suppliers", entries: ["supplier"] },
    ],
  },
  {
    id: "administration",
    label: "Administration",
    pinned: true,
    pages: [
      { id: "users", label: "Users & audit", section: "users", entries: ["users", "audit"] },
      { id: "ai", label: "AI integrations", entries: ["aiIntegrations"] },
      { id: "system", label: "System", entries: ["system"] },
    ],
  },
  {
    id: "dataImport",
    label: "Data import",
    hidden: true,
    pages: [
      { id: "importProducts", label: "Import products", entries: ["importProducts"] },
      { id: "importSites", label: "Import sites", entries: ["importSites"] },
      { id: "importLocations", label: "Import storage locations", entries: ["importLocations"] },
      { id: "importSuppliers", label: "Import suppliers", entries: ["importSuppliers"] },
      { id: "importStock", label: "Import opening balances", entries: ["importStock"] },
    ],
  },
];

export type VisiblePage = {
  id: string;
  label: string;
  /** The route the sidebar and page search open. */
  section: Section;
  path: StaffPath;
  /** Every route that opens this page, filtered to the role. Used to mark it active. */
  entries: readonly Section[];
};

export type VisibleWorkspace = {
  id: WorkspaceId;
  label: string;
  pages: readonly VisiblePage[];
  pinned: boolean;
  /** True when the role sees one page: the sidebar shows that page directly, with no parent row. */
  flat: boolean;
};

export type PageLocation = { workspace: WorkspaceDefinition; page: PageDefinition };

/** The workspace and page a route belongs to, including hidden pages such as the data imports. */
export const pageForSection = (section: Section): PageLocation | undefined => {
  for (const workspace of WORKSPACES) {
    const page = workspace.pages.find((candidate) => candidate.entries.includes(section));
    if (page) return { workspace, page };
  }
  return undefined;
};

/** The sidebar for one role, with empty workspaces dropped and one-page workspaces flattened. */
export const visibleWorkspaces = (roles: readonly string[]): readonly VisibleWorkspace[] =>
  WORKSPACES.filter((workspace) => workspace.hidden !== true)
    .map((workspace) => {
      const pages = workspace.pages.flatMap((page): VisiblePage[] => {
        const entries = page.entries.filter((section) => canAccessSection(section, roles));
        if (entries.length === 0) return [];
        const section = page.section !== undefined && canAccessSection(page.section, roles) ? page.section : entries[0];
        if (section === undefined) return [];
        return [{ id: page.id, label: page.label, section, path: pathForSection(section), entries }];
      });
      return {
        id: workspace.id,
        label: workspace.label,
        pages,
        pinned: workspace.pinned === true,
        flat: pages.length === 1,
      };
    })
    .filter((workspace) => workspace.pages.length > 0);

export type PaletteEntry = { section: Section; label: string; workspace: string; path: StaffPath };

/** Every page the role may open, including the hidden imports, for the Ctrl/Cmd+K page search. */
export const paletteEntries = (roles: readonly string[]): readonly PaletteEntry[] => {
  const entries: PaletteEntry[] = [];
  for (const workspace of WORKSPACES) {
    for (const page of workspace.pages) {
      const section =
        page.section !== undefined && canAccessSection(page.section, roles)
          ? page.section
          : page.entries.find((entry) => canAccessSection(entry, roles));
      if (section !== undefined) {
        entries.push({ section, label: page.label, workspace: workspace.label, path: pathForSection(section) });
      }
    }
  }
  if (canAccessSection("account", roles)) {
    entries.push({
      section: "account",
      label: "Account settings",
      workspace: "Account",
      path: pathForSection("account"),
    });
  }
  return entries;
};

/** Filters page search on the labels the user sees, so an accentless Vietnamese query still matches. */
export const filterPaletteEntries = (
  entries: readonly PaletteEntry[],
  query: string,
  translate: (key: string) => string,
): readonly PaletteEntry[] => {
  const needle = searchKey(query.trim());
  if (needle === "") return entries;
  return entries.filter((entry) =>
    searchKey(`${translate(entry.label)} ${translate(entry.workspace)}`).includes(needle),
  );
};

/** Where a role lands after sign-in. A Pharmacist keeps the counter summary; everyone else keeps the dashboard. */
export const landingSection = (roles: readonly string[]): Section => {
  if (canAccessSection("dashboard", roles)) return "dashboard";
  if (canAccessSection("pharmacistOverview", roles)) return "pharmacistOverview";
  return visibleWorkspaces(roles)[0]?.pages[0]?.section ?? "dashboard";
};

/** Case- and accent-insensitive search, so "don thuoc" finds "Đơn thuốc". */
export const searchKey = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/đ/g, "d");
