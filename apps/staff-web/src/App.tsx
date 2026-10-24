import { Link as RouterLink, Navigate, useLocation, useNavigate, useSearch } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { z } from "zod";
import {
  BadgeDollarSign,
  BarChart3,
  Building2,
  ClipboardList,
  ChevronDown,
  FileText,
  LayoutDashboard,
  LogOut,
  MapPin,
  Menu,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Ruler,
  Server,
  Settings,
  Keyboard,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Tags,
  Upload,
  X,
} from "lucide-react";

import { Alert, Breadcrumb, Button, Field, Input, PageHeader, ToastProvider, type BreadcrumbItem } from "@pharmacy/ui";

import { setSessionSnapshot, useSession } from "./auth.ts";
import { ConfirmProvider } from "./components/confirm.tsx";
import { HotkeysListener } from "./components/hotkeys-listener.tsx";
import { PageActionsContext } from "./components/page-actions.tsx";
import { ShortcutsDialog } from "./components/shortcuts-dialog.tsx";
import { useHotkey } from "./hooks/useHotkey.ts";
import { useMountEffect } from "./hooks/useMountEffect.ts";
import { useStoredState } from "./hooks/useStoredState.ts";
import { StaffNotFoundPage } from "./pages/NotFoundPage.tsx";
import { toggleLanguage, translateText, useLanguage } from "./i18n.ts";
import { datasets } from "./import-datasets.ts";
import { AiIntegrationsSection } from "./sections/ai-integrations-section.tsx";
import { CatalogSection } from "./sections/catalog-section.tsx";
import { DashboardSection } from "./sections/dashboard-section.tsx";
import { FinanceSection } from "./sections/finance-section.tsx";
import { GovernanceSection } from "./sections/governance-section.tsx";
import { ImportSection } from "./sections/import-section.tsx";
import { InventorySection } from "./sections/inventory-section.tsx";
import { MasterDataSection } from "./sections/master-data-section.tsx";
import { OrdersSection } from "./sections/orders-section.tsx";
import { PrescriptionsSection } from "./sections/prescriptions-section.tsx";
import { ProcurementSection } from "./sections/procurement-section.tsx";
import { SearchSynonymsSection } from "./sections/search-synonyms-section.tsx";
import { SystemSection } from "./sections/system-section.tsx";
import { request, setIdentityContextsEnabled } from "./staff-api.ts";
import { governanceTabPaths, pathForSection, sectionFromPath, type Section, type StaffPath } from "./router.ts";
import "./styles.css";

export type NavItem = { key: Section; label: string; icon: React.JSX.Element };
type NavGroup = { id: string; label: string; items: NavItem[] };

const sidebarCollapsedStorageKey = "pharmacy-central:sidebar-collapsed";

const sectionRoles: Record<Section, readonly string[]> = {
  dashboard: ["Platform Admin", "Pharmacy Manager", "Warehouse Staff"],
  pharmacistOverview: ["Pharmacist", "Pharmacy Manager"],
  prescriptions: ["Pharmacist", "Pharmacy Manager"],
  orders: ["Pharmacist", "Pharmacy Manager"],
  transfers: ["Warehouse Staff"],
  replenishment: ["Pharmacist", "Warehouse Staff"],
  sites: ["Platform Admin", "Pharmacy Manager"],
  storageLocations: ["Platform Admin", "Pharmacy Manager"],
  catalog: ["Platform Admin", "Pharmacy Manager"],
  searchSynonyms: ["Platform Admin", "Pharmacy Manager", "Pharmacist"],
  units: ["Platform Admin", "Pharmacy Manager"],
  pricing: ["Platform Admin", "Pharmacy Manager"],
  supplier: ["Platform Admin", "Pharmacy Manager"],
  importProducts: ["Platform Admin", "Pharmacy Manager"],
  importSites: ["Platform Admin", "Pharmacy Manager"],
  importLocations: ["Platform Admin", "Pharmacy Manager"],
  importSuppliers: ["Platform Admin", "Pharmacy Manager"],
  importStock: ["Platform Admin", "Pharmacy Manager", "Warehouse Staff"],
  receiving: ["Warehouse Staff"],
  procurement: ["Platform Admin", "Pharmacy Manager"],
  stocktake: ["Warehouse Staff"],
  inventory: ["Warehouse Staff"],
  adjustments: ["Warehouse Staff"],
  returns: ["Warehouse Staff"],
  quality: ["Warehouse Staff"],
  reporting: ["Platform Admin", "Pharmacy Manager", "Warehouse Staff"],
  finance: ["Platform Admin", "Pharmacy Manager"],
  users: ["Platform Admin"],
  audit: ["Platform Admin"],
  aiIntegrations: ["Platform Admin"],
  system: ["Platform Admin"],
};

export const canAccessSection = (section: Section, roles: readonly string[]): boolean =>
  roles.includes("Platform Admin") || sectionRoles[section].some((role) => roles.includes(role));

const navGroups: NavGroup[] = [
  {
    id: "operations",
    label: "Operations",
    items: [
      { key: "dashboard", label: "Dashboard", icon: <LayoutDashboard size={16} strokeWidth={2} /> },
      { key: "pharmacistOverview", label: "Pharmacist overview", icon: <FileText size={16} strokeWidth={2} /> },
      { key: "prescriptions", label: "Prescriptions", icon: <FileText size={16} strokeWidth={2} /> },
      { key: "orders", label: "Online orders", icon: <ShoppingBag size={16} strokeWidth={2} /> },
      { key: "transfers", label: "Transfers", icon: <Package size={16} strokeWidth={2} /> },
      { key: "replenishment", label: "Replenishment", icon: <Package size={16} strokeWidth={2} /> },
      { key: "procurement", label: "Procurement", icon: <ShoppingBag size={16} strokeWidth={2} /> },
      { key: "reporting", label: "Reporting", icon: <BarChart3 size={16} strokeWidth={2} /> },
      { key: "finance", label: "Finance", icon: <BarChart3 size={16} strokeWidth={2} /> },
    ],
  },
  {
    id: "master-data",
    label: "Master data",
    items: [
      { key: "sites", label: "Sites", icon: <Building2 size={16} strokeWidth={2} /> },
      { key: "storageLocations", label: "Storage locations", icon: <MapPin size={16} strokeWidth={2} /> },
      { key: "catalog", label: "Catalog", icon: <Tags size={16} strokeWidth={2} /> },
      { key: "searchSynonyms", label: "Search synonyms", icon: <Sparkles size={16} strokeWidth={2} /> },
      { key: "units", label: "Units", icon: <Ruler size={16} strokeWidth={2} /> },
      { key: "pricing", label: "Pricing", icon: <BadgeDollarSign size={16} strokeWidth={2} /> },
      { key: "supplier", label: "Suppliers", icon: <Building2 size={16} strokeWidth={2} /> },
    ],
  },
  {
    id: "data-import",
    label: "Data import",
    items: [
      { key: "importProducts", label: datasets.catalog.label, icon: <Upload size={16} strokeWidth={2} /> },
      { key: "importSites", label: datasets.sites.label, icon: <Upload size={16} strokeWidth={2} /> },
      {
        key: "importLocations",
        label: datasets.storageLocations.label,
        icon: <Upload size={16} strokeWidth={2} />,
      },
      { key: "importSuppliers", label: datasets.suppliers.label, icon: <Upload size={16} strokeWidth={2} /> },
      { key: "importStock", label: datasets.openingBalances.label, icon: <Upload size={16} strokeWidth={2} /> },
    ],
  },
  {
    id: "warehouse",
    label: "Warehouse",
    items: [
      { key: "receiving", label: "Receiving", icon: <ShoppingBag size={16} strokeWidth={2} /> },
      { key: "stocktake", label: "Stocktake", icon: <ClipboardList size={16} strokeWidth={2} /> },
      { key: "inventory", label: "Inventory", icon: <Package size={16} strokeWidth={2} /> },
      { key: "adjustments", label: "Adjustments", icon: <Package size={16} strokeWidth={2} /> },
      { key: "returns", label: "Returns and removals", icon: <Package size={16} strokeWidth={2} /> },
      { key: "quality", label: "Quality", icon: <ShieldCheck size={16} strokeWidth={2} /> },
    ],
  },
  {
    id: "governance",
    label: "Governance",
    items: [
      { key: "users", label: "Users", icon: <ShieldCheck size={16} strokeWidth={2} /> },
      { key: "audit", label: "Audit", icon: <ShieldCheck size={16} strokeWidth={2} /> },
      { key: "aiIntegrations", label: "AI integrations", icon: <Sparkles size={16} strokeWidth={2} /> },
      { key: "system", label: "System", icon: <Server size={16} strokeWidth={2} /> },
    ],
  },
];

const BrandBlock = (): React.JSX.Element => (
  <div className="brand">
    <img className="brand-mark" src="/brandmark.png" alt="" />
    <div>
      <h2>{translateText("Pharmacy Central")}</h2>
      <p>{translateText("Operations admin")}</p>
    </div>
  </div>
);

const StaffApp = (): React.JSX.Element => {
  const session = useSession();
  const language = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const roles = session.roles ?? [];
  const visibleNavGroups = navGroups
    .map((group) => ({ ...group, items: group.items.filter((item) => canAccessSection(item.key, roles)) }))
    .filter((group) => group.items.length > 0);
  const firstVisibleSection = visibleNavGroups[0]?.items[0]?.key ?? "dashboard";
  const requestedSection = sectionFromPath(location.pathname);
  const activeSection =
    requestedSection && canAccessSection(requestedSection, roles) ? requestedSection : firstVisibleSection;

  const governanceTab =
    location.pathname === governanceTabPaths.createUser
      ? "Create user"
      : location.pathname === governanceTabPaths.editAccess
        ? "Edit access"
        : location.pathname === governanceTabPaths.users
          ? "Users"
          : "Audit";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [authReady, setAuthReady] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useStoredState(sidebarCollapsedStorageKey, z.boolean(), false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [actionsTarget, setActionsTarget] = useState<HTMLElement | null>(null);
  const search = useSearch({ strict: false }) as Record<string, unknown>;
  const authenticated = session.authenticated;

  useHotkey("[", () => setSidebarCollapsed(!sidebarCollapsed), { label: "Toggle sidebar", when: authenticated });
  useHotkey("?", () => setShortcutsOpen(true), { label: "Show keyboard shortcuts", when: authenticated });
  useHotkey("escape", () => setMobileNavOpen(false), {
    label: "Close navigation",
    when: mobileNavOpen,
    allowWhileEditing: true,
  });

  useMountEffect(() => {
    void request("/api/auth/csrf")
      .then(() =>
        request<{ id: string; actorType: "employee" | "customer"; email?: string; roles: string[] }>("/api/auth/me"),
      )
      .then((current) => {
        if (current.actorType !== "employee") throw new Error("Employee account required");
        setEmail(current.email ?? "");
        setSessionSnapshot({ authenticated: true, userId: current.id, roles: current.roles });
        setIdentityContextsEnabled(true);
      })
      .catch(() => setSessionSnapshot({ authenticated: false }))
      .finally(() => setAuthReady(true));
  });

  const login = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    try {
      const response = await request<{ id: string; actorType: "employee" | "customer"; roles: string[] }>(
        "/api/auth/login",
        {
          method: "POST",
          body: JSON.stringify({ email, password }),
        },
      );
      if (response.actorType !== "employee") throw new Error("Employee account required");
      setSessionSnapshot({ authenticated: true, userId: response.id, roles: response.roles });
      setIdentityContextsEnabled(true);
      setError(undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Staff login failed");
    }
  };

  const signOut = async (): Promise<void> => {
    try {
      await request("/api/auth/logout", { method: "POST" });
    } finally {
      setIdentityContextsEnabled(false);
      setSessionSnapshot({ authenticated: false });
      setEmail("");
      setPassword("");
      void navigate({ to: pathForSection("dashboard") });
    }
  };

  if (!authReady) {
    return (
      <div className="login-shell">
        <div className="login-card">
          <BrandBlock />
          <p className="text-sm text-muted">{translateText("Checking session...")}</p>
        </div>
      </div>
    );
  }

  if (!session.authenticated) {
    return (
      <div className="login-shell">
        <form onSubmit={login} className="login-card">
          <BrandBlock />
          {error ? <Alert variant="danger">{translateText(error)}</Alert> : null}
          <Field label={translateText("Email")}>
            <Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
          </Field>
          <Field label={translateText("Password")}>
            <Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required />
          </Field>
          <Button type="submit" className="w-full">
            {translateText("Sign in")}
          </Button>
        </form>
      </div>
    );
  }

  if (!requestedSection) return <StaffNotFoundPage />;
  if (requestedSection !== activeSection) return <Navigate to={pathForSection(activeSection)} replace />;

  const activeGroup = visibleNavGroups.find((group) => group.items.some((item) => item.key === activeSection));
  const activeLabel = activeGroup?.items.find((item) => item.key === activeSection)?.label ?? "Dashboard";
  const governanceTabLabel = activeSection === "users" || activeSection === "audit" ? governanceTab : undefined;
  const tabValue = typeof search.tab === "string" && search.tab !== "" ? search.tab : governanceTabLabel;
  const currentTab = tabValue && tabValue !== activeLabel ? tabValue : undefined;
  const breadcrumbItems: BreadcrumbItem[] = [
    ...(activeGroup ? [{ label: translateText(activeGroup.label) }] : []),
    { label: translateText(activeLabel), ...(currentTab ? { href: pathForSection(activeSection) } : {}) },
    ...(currentTab ? [{ label: translateText(currentTab) }] : []),
  ];

  const renderSection = (): React.JSX.Element => {
    switch (activeSection) {
      case "pharmacistOverview":
        return <PrescriptionsSection key={activeSection} initialTab="Counter transactions" />;
      case "prescriptions":
        return <PrescriptionsSection key={activeSection} initialTab="Prescriptions" />;
      case "orders":
        return <OrdersSection key={activeSection} />;
      case "transfers":
        return <InventorySection key={activeSection} initialTab="Transfers" />;
      case "replenishment":
        return <InventorySection key={activeSection} initialTab="Replenishment" />;
      case "sites":
        return <MasterDataSection key={activeSection} kind="sites" />;
      case "storageLocations":
        return <MasterDataSection key={activeSection} kind="locations" />;
      case "catalog":
        return <CatalogSection key={activeSection} kind="products" />;
      case "searchSynonyms":
        return <SearchSynonymsSection key={activeSection} />;
      case "units":
        return <CatalogSection key={activeSection} kind="units" />;
      case "pricing":
        return <CatalogSection key={activeSection} kind="pricing" />;
      case "supplier":
        return <MasterDataSection key={activeSection} kind="suppliers" />;
      case "importProducts":
        return <ImportSection key={activeSection} dataset={datasets.catalog} />;
      case "importSites":
        return <ImportSection key={activeSection} dataset={datasets.sites} />;
      case "importLocations":
        return <ImportSection key={activeSection} dataset={datasets.storageLocations} />;
      case "importSuppliers":
        return <ImportSection key={activeSection} dataset={datasets.suppliers} />;
      case "importStock":
        return <ImportSection key={activeSection} dataset={datasets.openingBalances} />;
      case "receiving":
        return <ProcurementSection key={activeSection} initialTab="Goods receipts" />;
      case "procurement":
        return <ProcurementSection key={activeSection} initialTab="Purchase orders" />;
      case "stocktake":
        return <InventorySection key={activeSection} initialTab="Stocktake" />;
      case "inventory":
        return <InventorySection key={activeSection} initialTab="Balances" />;
      case "adjustments":
        return <InventorySection key={activeSection} initialTab="Adjustments" />;
      case "returns":
        return <InventorySection key={activeSection} initialTab="Returns" />;
      case "quality":
        return <InventorySection key={activeSection} initialTab="Batches" />;
      case "reporting":
        return <FinanceSection key={activeSection} initialTab="Reports" />;
      case "finance":
        return <FinanceSection key={activeSection} initialTab="Summary" />;
      case "users":
        return <GovernanceSection key={location.pathname} initialTab={governanceTab} />;
      case "audit":
        return <GovernanceSection key={location.pathname} initialTab={governanceTab} />;
      case "aiIntegrations":
        return <AiIntegrationsSection key={activeSection} />;
      case "system":
        return <SystemSection key={activeSection} />;
      case "dashboard":
        return <DashboardSection key={activeSection} />;
    }
  };

  return (
    <div className="app-shell">
      <div className={`app${sidebarCollapsed ? " sidebar-collapsed" : ""}`}>
        <aside id="staff-navigation" className={`sidebar${mobileNavOpen ? " mobile-open" : ""}`}>
          <div className="sidebar-head">
            <BrandBlock />
            <button
              type="button"
              className="sidebar-collapse-toggle"
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              aria-expanded={!sidebarCollapsed}
              aria-controls="staff-navigation"
              aria-label={translateText("Toggle sidebar")}
              title={translateText(sidebarCollapsed ? "Expand navigation" : "Collapse navigation")}
            >
              {sidebarCollapsed ? (
                <PanelLeftOpen size={18} strokeWidth={2} aria-hidden="true" />
              ) : (
                <PanelLeftClose size={18} strokeWidth={2} aria-hidden="true" />
              )}
            </button>
          </div>
          <button
            type="button"
            className="mobile-nav-close"
            onClick={() => setMobileNavOpen(false)}
            aria-label={translateText("Close navigation")}
          >
            <X size={18} strokeWidth={2} aria-hidden="true" />
            <span>{translateText("Close navigation")}</span>
          </button>
          <div className="sidebar-scroll">
            {visibleNavGroups.map((group) => (
              <section key={group.id} className="sidebar-section">
                <div className="sidebar-group-label">{translateText(group.label)}</div>
                <nav className="sidebar-nav" aria-label={translateText(group.label)}>
                  {group.items.map((item) => {
                    const active = activeSection === item.key;
                    return (
                      <RouterLink
                        key={item.key}
                        to={pathForSection(item.key)}
                        className={active ? "active" : undefined}
                        title={sidebarCollapsed ? translateText(item.label) : undefined}
                        onClick={() => setMobileNavOpen(false)}
                        {...(active ? { "aria-current": "page" as const } : {})}
                      >
                        {active ? <span className="sidebar-nav-active-indicator" aria-hidden="true" /> : null}
                        <span className="sidebar-nav-icon" aria-hidden="true">
                          {item.icon}
                        </span>
                        <span className="sidebar-nav-label">{translateText(item.label)}</span>
                      </RouterLink>
                    );
                  })}
                </nav>
              </section>
            ))}
          </div>
        </aside>
        {mobileNavOpen ? (
          <button
            type="button"
            className="mobile-nav-backdrop"
            onClick={() => setMobileNavOpen(false)}
            aria-label={translateText("Close navigation")}
          />
        ) : null}
        <main className="main">
          <div className="topbar">
            <button
              type="button"
              className="mobile-nav-toggle"
              onClick={() => setMobileNavOpen(true)}
              aria-controls="staff-navigation"
              aria-expanded={mobileNavOpen}
              aria-label={translateText("Open navigation")}
            >
              <Menu size={19} strokeWidth={2} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="topbar-icon-button"
              onClick={() => setShortcutsOpen(true)}
              aria-label={translateText("Show keyboard shortcuts")}
              title={translateText("Show keyboard shortcuts")}
            >
              <Keyboard size={17} strokeWidth={2} aria-hidden="true" />
            </button>
            <details className="profile-menu">
              <summary className="profile-trigger">
                <span className="profile-copy">
                  <strong>{email || translateText("Staff account")}</strong>
                  <span>{translateText("Employee")}</span>
                </span>
                <ChevronDown className="profile-chevron" size={16} strokeWidth={2} aria-hidden="true" />
              </summary>
              <div className="profile-dropdown">
                <div className="profile-menu-label">{email || translateText("Employee account")}</div>
                <button type="button" className="profile-menu-item" disabled>
                  <Settings size={15} strokeWidth={2} /> {translateText("Account settings")}
                </button>
                <button type="button" className="profile-menu-item" onClick={() => toggleLanguage()}>
                  <span>{language.toUpperCase()}</span> {translateText("Switch language")}
                </button>
                <button type="button" className="profile-menu-item" onClick={() => void signOut()}>
                  <LogOut size={15} strokeWidth={2} /> {translateText("Sign out")}
                </button>
              </div>
            </details>
          </div>
          <PageActionsContext.Provider value={actionsTarget}>
            <div className="content-panel">
              <PageHeader
                title={translateText(activeLabel)}
                breadcrumb={
                  <Breadcrumb
                    items={breadcrumbItems}
                    label={translateText("Breadcrumb")}
                    renderLink={({ href, className, children }) => (
                      <RouterLink to={href as StaffPath} className={className}>
                        {children}
                      </RouterLink>
                    )}
                  />
                }
                actions={
                  <>
                    <div ref={setActionsTarget} className="flex flex-wrap items-center gap-2" />
                    <Button variant="secondary" size="sm" onClick={() => void queryClient.invalidateQueries()}>
                      <RefreshCw size={14} strokeWidth={2} aria-hidden="true" />
                      {translateText("Refresh")}
                    </Button>
                  </>
                }
              />
              {error ? <Alert variant="danger">{translateText(error)}</Alert> : null}
              {renderSection()}
            </div>
          </PageActionsContext.Provider>
        </main>
      </div>
      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
};

export const App = (): React.JSX.Element => {
  const language = useLanguage();
  const toastLabels = useMemo(
    () => ({ region: translateText("Notifications"), dismiss: translateText("Dismiss") }),
    [language],
  );
  return (
    <ToastProvider labels={toastLabels}>
      <ConfirmProvider>
        <HotkeysListener />
        <StaffApp />
      </ConfirmProvider>
    </ToastProvider>
  );
};
