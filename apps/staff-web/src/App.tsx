import { Link as RouterLink, Navigate, useLocation, useNavigate, useSearch } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { z } from "zod";
import {
  BarChart3,
  ChevronDown,
  ChevronRight,
  FileText,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Menu,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Tags,
  Upload,
  X,
  Keyboard,
} from "lucide-react";

import {
  Alert,
  Breadcrumb,
  Button,
  Field,
  Input,
  PageHeader,
  ToastProvider,
  type AccessGrant,
  type BreadcrumbItem,
} from "@pharmacy/ui";

import { currentSession, SESSION_EXPIRED_MESSAGE, setSessionSnapshot, staffAccessRefusal, useSession } from "./auth.ts";
import { ConfirmProvider } from "./components/confirm.tsx";
import { CommandPalette } from "./components/command-palette.tsx";
import { ForcedPasswordChange } from "./components/forced-password-change.tsx";
import { HotkeysListener } from "./components/hotkeys-listener.tsx";
import { PageActionsContext } from "./components/page-actions.tsx";
import { ShortcutsDialog } from "./components/shortcuts-dialog.tsx";
import { useHotkey } from "./hooks/useHotkey.ts";
import { useMountEffect } from "./hooks/useMountEffect.ts";
import { useStoredState } from "./hooks/useStoredState.ts";
import { formatShortcut } from "./lib/hotkeys.ts";
import { StaffNotFoundPage } from "./pages/NotFoundPage.tsx";
import { toggleLanguage, translateText, useLanguage } from "./i18n.ts";
import { datasets } from "./import-datasets.ts";
import {
  landingSection,
  pageForSection,
  paletteEntries,
  visibleWorkspaces,
  type VisiblePage,
  type VisibleWorkspace,
  type WorkspaceId,
} from "./navigation/workspaces.ts";
import { AiIntegrationsSection } from "./sections/ai-integrations-section.tsx";
import { AccountSection } from "./sections/account-section.tsx";
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
import { accessTokens, ApiProblemError, request, setSessionEndedListener } from "./staff-api.ts";
import { governanceTabPaths, pathForSection, sectionFromPath, type Section, type StaffPath } from "./router.ts";
import "./styles.css";

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

const workspaceIcons: Record<WorkspaceId, React.JSX.Element> = {
  overview: <LayoutDashboard size={16} strokeWidth={2} />,
  actionPlans: <ListChecks size={16} strokeWidth={2} />,
  counter: <FileText size={16} strokeWidth={2} />,
  inventory: <Package size={16} strokeWidth={2} />,
  purchasing: <ShoppingBag size={16} strokeWidth={2} />,
  finance: <BarChart3 size={16} strokeWidth={2} />,
  catalog: <Tags size={16} strokeWidth={2} />,
  administration: <ShieldCheck size={16} strokeWidth={2} />,
  dataImport: <Upload size={16} strokeWidth={2} />,
};

/** The tab a route opens before its URL names one. */
const defaultTabBySection: Partial<Record<Section, string>> = {
  pharmacistOverview: "Counter transactions",
  procurement: "Purchase orders",
  receiving: "Goods receipts",
};

/** The tab each inventory route opens, so the breadcrumb names the view even before `?tab=` is written. */
const inventoryDefaultTab: Partial<Record<Section, InventoryTab>> = {
  inventory: "Balances",
  transfers: "Transfers",
  replenishment: "Replenishment",
  stocktake: "Stocktake",
  adjustments: "Adjustments",
  returns: "Returns",
  quality: "Batches",
};

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
  const workspaces = visibleWorkspaces(roles);
  const requestedSection = sectionFromPath(location.pathname);
  const activeSection =
    requestedSection && canAccessSection(requestedSection, roles) ? requestedSection : landingSection(roles);
  const activePage = pageForSection(activeSection);
  const activeVisibleWorkspace =
    activePage === undefined ? undefined : workspaces.find((workspace) => workspace.id === activePage.workspace.id);
  const activeVisiblePage = activeVisibleWorkspace?.pages.find((page) => page.entries.includes(activeSection));
  const pageTitle = activePage?.page.label ?? "Account settings";

  const governanceTab = location.pathname === governanceTabPaths.users ? "Users" : "Audit";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [authReady, setAuthReady] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useStoredState(sidebarCollapsedStorageKey, z.boolean(), false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [actionsTarget, setActionsTarget] = useState<HTMLElement | null>(null);
  const profileMenuRef = useRef<HTMLDetailsElement>(null);
  const search = useSearch({ strict: false }) as Record<string, unknown>;
  const authenticated = session.authenticated;

  useHotkey("[", () => setSidebarCollapsed(!sidebarCollapsed), { label: "Toggle sidebar", when: authenticated });
  useHotkey(
    "mod+k",
    (event) => {
      event.preventDefault();
      setPaletteOpen(true);
    },
    { label: "Open page search", when: authenticated, allowWhileEditing: true },
  );
  useHotkey("?", () => setShortcutsOpen(true), { label: "Show keyboard shortcuts", when: authenticated });
  useHotkey("escape", () => setMobileNavOpen(false), {
    label: "Close navigation",
    when: mobileNavOpen,
    allowWhileEditing: true,
  });

  // Ends the session in this tab and shows the sign-in card, with `message` when given. Every cached response goes, so
  // the next employee on this browser sees none of this one's rows (shell US4, Decision 8).
  const endSession = (message: string | undefined): void => {
    accessTokens.clear();
    setSessionSnapshot({ authenticated: false });
    queryClient.clear();
    setEmail("");
    setPassword("");
    setError(message);
  };

  // A 401 from a service route ends the session. The URL is kept, so the same page opens
  // once the employee signs in again (shell Decision 6).
  useMountEffect(() => {
    setSessionEndedListener(() => {
      if (currentSession().authenticated) endSession(SESSION_EXPIRED_MESSAGE);
    });
    return () => setSessionEndedListener(undefined);
  });

  // A refused account keeps no session: its token is dropped before the notice shows (shell Decision 7).
  const refuseSession = (message: string): void => endSession(message);

  // A token held from an earlier visit, or handed over by the Google callback, is checked with identity before the
  // shell opens: `/api/auth/me` reads the account, so a deactivated or changed account is seen here.
  useMountEffect(() => {
    accessTokens.adoptUrlFragment();
    const finish = (): void => setAuthReady(true);
    if (!accessTokens.current()) {
      setSessionSnapshot({ authenticated: false });
      finish();
      return;
    }
    void request<StaffAccount>("/api/auth/me")
      .then((current) => {
        const refusal = staffAccessRefusal(current);
        if (refusal) {
          refuseSession(refusal);
          return;
        }
        setEmail(current.email ?? "");
        setSessionSnapshot({
          authenticated: true,
          userId: current.id,
          displayName: current.displayName,
          roles: current.roles,
          siteIds: current.siteIds,
          passwordChangeRequired: current.passwordChangeRequired,
        });
      })
      .catch((reason: unknown) => {
        if (reason instanceof ApiProblemError && reason.problem.status === 401) accessTokens.clear();
        setSessionSnapshot({ authenticated: false });
      })
      .finally(finish);
  });

  const login = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    try {
      // `audience: "employee"` makes identity refuse a customer account before it issues a token.
      const { accessToken, accessTokenExpiresAt, ...account } = await request<StaffAccount & AccessGrant>(
        "/api/auth/login",
        {
          method: "POST",
          body: JSON.stringify({ email, password, audience: "employee" }),
        },
      );
      accessTokens.set({ accessToken, accessTokenExpiresAt });
      const refusal = staffAccessRefusal(account);
      if (refusal) {
        refuseSession(refusal);
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
      setError(undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Staff login failed");
    }
  };

  const signOut = (): void => {
    endSession(undefined);
    void navigate({ to: pathForSection("dashboard") });
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
      <ForcedPasswordChange
        onChanged={() => setSessionSnapshot({ ...currentSession(), passwordChangeRequired: false })}
        onSignOut={signOut}
      />
    );
  }

  if (requestedSection !== activeSection) return <Navigate to={pathForSection(activeSection)} replace />;

  const governanceTabLabel = activeSection === "users" || activeSection === "audit" ? governanceTab : undefined;
  const inventorySectionTab = inventoryDefaultTab[activeSection];
  const requestedInventoryTab =
    inventorySectionTab !== undefined &&
    typeof search.tab === "string" &&
    isInventoryTab(search.tab) &&
    tabGate(INVENTORY_TAB_ACTIONS[search.tab], session).allowed
      ? search.tab
      : undefined;
  const inventoryTab =
    requestedInventoryTab ??
    (inventorySectionTab !== undefined && tabGate(INVENTORY_TAB_ACTIONS[inventorySectionTab], session).allowed
      ? inventorySectionTab
      : undefined);
  const searchTab =
    inventorySectionTab === undefined && typeof search.tab === "string" && search.tab !== "" ? search.tab : undefined;
  const currentTab = inventoryTab ?? governanceTabLabel ?? searchTab ?? defaultTabBySection[activeSection];
  const showWorkspaceCrumb =
    activePage !== undefined &&
    (activePage.workspace.hidden === true || (activeVisibleWorkspace !== undefined && !activeVisibleWorkspace.flat));
  const breadcrumbItems: BreadcrumbItem[] = [
    ...(showWorkspaceCrumb && activePage ? [{ label: translateText(activePage.workspace.label) }] : []),
    {
      label: translateText(pageTitle),
      ...(currentTab !== undefined && currentTab !== pageTitle && activeVisiblePage
        ? { href: activeVisiblePage.path }
        : {}),
    },
    ...(currentTab !== undefined && currentTab !== pageTitle ? [{ label: translateText(currentTab) }] : []),
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
      case "finance":
        return <FinanceSection key={activeSection} />;
      case "users":
        return <GovernanceSection key={location.pathname} initialTab={governanceTab} />;
      case "audit":
        return <GovernanceSection key={location.pathname} initialTab={governanceTab} />;
      case "aiIntegrations":
        return <AiIntegrationsSection key={activeSection} />;
      case "system":
        return <SystemSection key={activeSection} />;
      case "dashboard":
        return <DashboardSection key={activeSection} roles={roles} />;
      case "analytics":
        return <AnalyticsSection key={activeSection} />;
      case "actionPlans":
        return <ActionPlansSection key={activeSection} />;
      case "account":
        return <AccountSection key={activeSection} />;
    }
  };

  // A plain anchor, not a router Link: the sidebar's active page follows the route, and a new tab must still work.
  const navigateTo =
    (path: StaffPath) =>
    (event: React.MouseEvent<HTMLAnchorElement>): void => {
      setMobileNavOpen(false);
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
      event.preventDefault();
      void navigate({ to: path });
    };

  const renderWorkspace = (workspace: VisibleWorkspace): React.JSX.Element | null => {
    const primary = workspace.pages[0];
    if (primary === undefined) return null;
    const active = workspace.pages.some((page) => page.entries.includes(activeSection));
    if (workspace.flat) {
      return (
        <a
          key={workspace.id}
          href={primary.path}
          className={`sidebar-nav-link${active ? " active" : ""}`}
          title={sidebarCollapsed ? translateText(primary.label) : undefined}
          onClick={navigateTo(primary.path)}
          {...(active ? { "aria-current": "page" as const } : {})}
        >
          {active ? <span className="sidebar-nav-active-indicator" aria-hidden="true" /> : null}
          <span className="sidebar-nav-icon" aria-hidden="true">
            {workspaceIcons[workspace.id]}
          </span>
          <span className="sidebar-nav-label">{translateText(primary.label)}</span>
        </a>
      );
    }

    const childrenId = `sidebar-children-${workspace.id}`;
    return (
      <div key={workspace.id} className={`sidebar-workspace${active ? " active" : ""}`}>
        <a
          href={primary.path}
          className="sidebar-nav-link sidebar-parent"
          title={sidebarCollapsed ? translateText(workspace.label) : undefined}
          onClick={navigateTo(primary.path)}
          aria-expanded={active}
          aria-controls={childrenId}
        >
          <span className="sidebar-nav-icon" aria-hidden="true">
            {workspaceIcons[workspace.id]}
          </span>
          <span className="sidebar-nav-label">{translateText(workspace.label)}</span>
          <span className="sidebar-chevron" aria-hidden="true">
            {active ? <ChevronDown size={14} strokeWidth={2} /> : <ChevronRight size={14} strokeWidth={2} />}
          </span>
        </a>
        <div id={childrenId} className="sidebar-children" hidden={!active}>
          {workspace.pages.map((page: VisiblePage) => {
            const pageActive = page.entries.includes(activeSection);
            return (
              <a
                key={page.id}
                href={page.path}
                className={`sidebar-child-link${pageActive ? " active" : ""}`}
                onClick={navigateTo(page.path)}
                {...(pageActive ? { "aria-current": "page" as const } : {})}
              >
                {pageActive ? <span className="sidebar-nav-active-indicator" aria-hidden="true" /> : null}
                <span className="sidebar-nav-label">{translateText(page.label)}</span>
              </a>
            );
          })}
        </div>
      </div>
    );
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
          <button
            type="button"
            className="sidebar-search"
            onClick={() => setPaletteOpen(true)}
            aria-label={translateText("Open page search")}
            title={formatShortcut("mod+k")}
          >
            <Search size={15} strokeWidth={2} aria-hidden="true" />
            <span className="sidebar-search-label">{translateText("Search pages")}</span>
            <kbd className="sidebar-search-key">{formatShortcut("mod+k")}</kbd>
          </button>
          <div className="sidebar-scroll">
            <div className="sidebar-groups">
              {workspaces.filter((workspace) => !workspace.pinned).map((workspace) => renderWorkspace(workspace))}
            </div>
            {workspaces.some((workspace) => workspace.pinned) ? (
              <div className="sidebar-pinned">
                <div className="sidebar-divider" aria-hidden="true" />
                {workspaces.filter((workspace) => workspace.pinned).map((workspace) => renderWorkspace(workspace))}
              </div>
            ) : null}
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
              onClick={() => setPaletteOpen(true)}
              aria-label={translateText("Open page search")}
              title={formatShortcut("mod+k")}
            >
              <Search size={17} strokeWidth={2} aria-hidden="true" />
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
            <details ref={profileMenuRef} className="profile-menu">
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
                <button
                  type="button"
                  className="profile-menu-item"
                  onClick={() => {
                    profileMenuRef.current?.removeAttribute("open");
                    void navigate({ to: pathForSection("account") });
                  }}
                >
                  <Settings size={15} strokeWidth={2} /> {translateText("Account settings")}
                </button>
                <button type="button" className="profile-menu-item" onClick={() => toggleLanguage()}>
                  <span>{language.toUpperCase()}</span> {translateText("Switch language")}
                </button>
                <button type="button" className="profile-menu-item" onClick={signOut}>
                  <LogOut size={15} strokeWidth={2} /> {translateText("Sign out")}
                </button>
              </div>
            </details>
          </div>
          <PageActionsContext.Provider value={actionsTarget}>
            <div className="content-panel">
              <PageHeader
                title={translateText(pageTitle)}
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
      <CommandPalette
        key={paletteOpen ? "open" : "closed"}
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        entries={paletteEntries(roles)}
        onSelect={(path) => {
          setPaletteOpen(false);
          void navigate({ to: path });
        }}
      />
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
