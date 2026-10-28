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
  ListChecks,
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
  TrendingUp,
  Upload,
  X,
} from "lucide-react";

import { Alert, Breadcrumb, Button, Field, Input, PageHeader, ToastProvider, type BreadcrumbItem } from "@pharmacy/ui";

import {
  currentSession,
  PASSWORD_CHANGED_MESSAGE,
  SESSION_EXPIRED_MESSAGE,
  setSessionSnapshot,
  staffAccessRefusal,
  useSession,
} from "./auth.ts";
import { ConfirmProvider } from "./components/confirm.tsx";
import { ForcedPasswordChange } from "./components/forced-password-change.tsx";
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
import { ActionPlansSection } from "./sections/action-plans-section.tsx";
import { AnalyticsSection } from "./sections/analytics-section.tsx";
import { CatalogSection } from "./sections/catalog-section.tsx";
import { DashboardSection } from "./sections/dashboard-section.tsx";
import { FinanceSection } from "./sections/finance-section.tsx";
import { GovernanceSection } from "./sections/governance-section.tsx";
import { ImportSection } from "./sections/import-section.tsx";
import { INVENTORY_TAB_ACTIONS, isInventoryTab, type InventoryTab } from "./sections/inventory/tabs.ts";
import { InventorySection } from "./sections/inventory-section.tsx";
import { canAccessSection } from "./permissions/section-access.ts";
import { tabGate } from "./permissions/staff-permissions.ts";
import { MasterDataSection } from "./sections/master-data-section.tsx";
import { OrdersSection } from "./sections/orders-section.tsx";
import { PrescriptionsSection } from "./sections/prescriptions-section.tsx";
import { ProcurementSection } from "./sections/procurement-section.tsx";
import { SearchSynonymsSection } from "./sections/search-synonyms-section.tsx";
import { SystemSection } from "./sections/system-section.tsx";
import { request, setIdentityContextsEnabled, setSessionEndedListener } from "./staff-api.ts";
import { governanceTabPaths, pathForSection, sectionFromPath, type Section, type StaffPath } from "./router.ts";
import "./styles.css";

export type NavItem = { key: Section; label: string; icon: React.JSX.Element };
type NavGroup = { id: string; label: string; items: NavItem[] };

/** A staff account as `/api/auth/me` and `/api/auth/login` answer it. */
type StaffAccount = {
  id: string;
  actorType: "employee" | "customer";
  email?: string;
  displayName: string;
  roles: string[];
  siteIds: string[];
  passwordChangeRequired: boolean;
};

const sidebarCollapsedStorageKey = "pharmacy-central:sidebar-collapsed";

/** Sections that open the inventory workspace, each on its own first tab. */
const INVENTORY_SECTIONS: ReadonlySet<Section> = new Set([
  "transfers",
  "replenishment",
  "stocktake",
  "inventory",
  "adjustments",
  "returns",
  "quality",
]);

/** The sidebar item that stands for each inventory tab, so the highlight follows the tab on screen. */
const INVENTORY_TAB_SECTION: Record<InventoryTab, Section> = {
  Balances: "inventory",
  Batches: "quality",
  Movements: "inventory",
  Transfers: "transfers",
  Replenishment: "replenishment",
  Returns: "returns",
  Adjustments: "adjustments",
  Stocktake: "stocktake",
};

const navGroups: NavGroup[] = [
  {
    id: "operations",
    label: "Operations",
    items: [
      { key: "dashboard", label: "Dashboard", icon: <LayoutDashboard size={16} strokeWidth={2} /> },
      { key: "analytics", label: "Analytics", icon: <TrendingUp size={16} strokeWidth={2} /> },
      { key: "actionPlans", label: "Action plans", icon: <ListChecks size={16} strokeWidth={2} /> },
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

  const governanceTab = location.pathname === governanceTabPaths.users ? "Users" : "Audit";
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

  // Ends the session in this tab and shows the sign-in card, with `message` when given. Every cached response goes, so
  // the next employee on this browser sees none of this one's rows (shell US4, Decision 8).
  const endSession = (message: string | undefined): void => {
    setIdentityContextsEnabled(false);
    setSessionSnapshot({ authenticated: false });
    queryClient.clear();
    setEmail("");
    setPassword("");
    setError(message);
  };

  // A 401 that the identity-context retry did not clear ends the session. The URL is kept, so the same page opens
  // once the employee signs in again (shell Decision 6).
  useMountEffect(() => {
    setSessionEndedListener(() => {
      if (currentSession().authenticated) endSession(SESSION_EXPIRED_MESSAGE);
    });
    return () => setSessionEndedListener(undefined);
  });

  // A refused account keeps no session: the server ends it before the notice shows (shell Decision 7).
  const refuseSession = async (message: string): Promise<void> => {
    await request("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    endSession(message);
  };

  useMountEffect(() => {
    void request("/api/auth/csrf")
      .then(() => request<StaffAccount>("/api/auth/me"))
      .then(async (current) => {
        const refusal = staffAccessRefusal(current);
        if (refusal) return refuseSession(refusal);
        setEmail(current.email ?? "");
        setSessionSnapshot({
          authenticated: true,
          userId: current.id,
          displayName: current.displayName,
          roles: current.roles,
          siteIds: current.siteIds,
          passwordChangeRequired: current.passwordChangeRequired,
        });
        setIdentityContextsEnabled(true);
      })
      .catch(() => setSessionSnapshot({ authenticated: false }))
      .finally(() => setAuthReady(true));
  });

  const login = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    try {
      // `audience: "employee"` makes identity refuse a customer account before it sets any session cookie.
      const account = await request<StaffAccount>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password, audience: "employee" }),
      });
      const refusal = staffAccessRefusal(account);
      if (refusal) {
        await refuseSession(refusal);
        return;
      }
      setSessionSnapshot({
        authenticated: true,
        userId: account.id,
        displayName: account.displayName,
        roles: account.roles,
        siteIds: account.siteIds,
        passwordChangeRequired: account.passwordChangeRequired,
      });
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
      endSession(undefined);
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

  // An unknown page shows the same message to anyone, signed in or out (shell Decision 10).
  if (!requestedSection) return <StaffNotFoundPage />;

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

  // Until the password is changed no section opens: identity refuses every other call (shell Decision 9).
  if (session.passwordChangeRequired) {
    return (
      <ForcedPasswordChange onChanged={() => endSession(PASSWORD_CHANGED_MESSAGE)} onSignOut={() => void signOut()} />
    );
  }

  if (requestedSection !== activeSection) return <Navigate to={pathForSection(activeSection)} replace />;

  const governanceTabLabel = activeSection === "users" || activeSection === "audit" ? governanceTab : undefined;
  // Several sidebar items open the one inventory workspace, and its tab can move to another item's subject. The tab
  // then names the page, so the title and the breadcrumb leaf agree with what is on screen.
  const inventoryTab =
    INVENTORY_SECTIONS.has(activeSection) &&
    typeof search.tab === "string" &&
    isInventoryTab(search.tab) &&
    tabGate(INVENTORY_TAB_ACTIONS[search.tab], session).allowed
      ? search.tab
      : undefined;
  const searchTab = typeof search.tab === "string" && search.tab !== "" ? search.tab : governanceTabLabel;
  const tabSection = inventoryTab === undefined ? undefined : INVENTORY_TAB_SECTION[inventoryTab];
  // The item shown as current: the tab's own item when this role has it, else the one that was opened.
  const navSection =
    tabSection !== undefined && visibleNavGroups.some((group) => group.items.some((item) => item.key === tabSection))
      ? tabSection
      : activeSection;
  const activeGroup = visibleNavGroups.find((group) => group.items.some((item) => item.key === navSection));
  const activeLabel = activeGroup?.items.find((item) => item.key === navSection)?.label ?? "Dashboard";
  const tabValue = INVENTORY_SECTIONS.has(activeSection) ? inventoryTab : searchTab;
  const currentTab = tabValue && tabValue !== activeLabel ? tabValue : undefined;
  const breadcrumbItems: BreadcrumbItem[] = [
    ...(activeGroup ? [{ label: translateText(activeGroup.label) }] : []),
    { label: translateText(activeLabel), ...(currentTab ? { href: pathForSection(navSection) } : {}) },
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
      case "analytics":
        return <AnalyticsSection key={activeSection} />;
      case "actionPlans":
        return <ActionPlansSection key={activeSection} />;
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
                    // A plain anchor, not a router Link: the router marks the link whose path matches as current,
                    // which would ignore the tab-aware navSection.
                    const active = navSection === item.key;
                    return (
                      <a
                        key={item.key}
                        href={pathForSection(item.key)}
                        className={active ? "active" : undefined}
                        title={sidebarCollapsed ? translateText(item.label) : undefined}
                        onClick={(event) => {
                          setMobileNavOpen(false);
                          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0)
                            return;
                          event.preventDefault();
                          void navigate({ to: pathForSection(item.key) });
                        }}
                        {...(active ? { "aria-current": "page" as const } : {})}
                      >
                        {active ? <span className="sidebar-nav-active-indicator" aria-hidden="true" /> : null}
                        <span className="sidebar-nav-icon" aria-hidden="true">
                          {item.icon}
                        </span>
                        <span className="sidebar-nav-label">{translateText(item.label)}</span>
                      </a>
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
                  <span>
                    {roles.length > 0 ? roles.map((role) => translateText(role)).join(", ") : translateText("Employee")}
                  </span>
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
                title={translateText(inventoryTab ?? activeLabel)}
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
