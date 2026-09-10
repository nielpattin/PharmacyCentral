import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BarChart3,
  Building2,
  ClipboardList,
  FileText,
  LayoutDashboard,
  LogOut,
  Package,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Tags,
} from "lucide-react";

import { request } from "./staff-api.ts";
import { setSessionSnapshot, useSession } from "./auth.ts";

import { Alert, Button, Field, Input } from "@pharmacy/ui";

import { useMountEffect } from "./hooks/useMountEffect.ts";
import { toggleLanguage, translateText, useLanguage } from "./i18n.ts";
import { CatalogSection } from "./sections/catalog-section.tsx";
import { DashboardSection } from "./sections/dashboard-section.tsx";
import { FinanceSection } from "./sections/finance-section.tsx";
import { GovernanceSection } from "./sections/governance-section.tsx";
import { InventorySection } from "./sections/inventory-section.tsx";
import { MasterDataSection } from "./sections/master-data-section.tsx";
import { PrescriptionsSection } from "./sections/prescriptions-section.tsx";
import { ProcurementSection } from "./sections/procurement-section.tsx";
import "./index.css";
import { setIdentityContextsEnabled } from "./staff-api.ts";
import "./styles.css";

type Section =
  | "dashboard"
  | "pharmacistOverview"
  | "prescriptions"
  | "transfers"
  | "replenishment"
  | "sites"
  | "catalog"
  | "supplier"
  | "receiving"
  | "procurement"
  | "stocktake"
  | "inventory"
  | "adjustments"
  | "returns"
  | "quality"
  | "reporting"
  | "finance"
  | "users"
  | "audit";
type NavItem = { key: Section; label: string; icon: React.JSX.Element };
type NavGroup = { id: string; label: string; items: NavItem[] };

const sectionRoles: Record<Section, readonly string[]> = {
  dashboard: ["Platform Admin", "Pharmacy Manager", "Warehouse Staff"],
  pharmacistOverview: ["Pharmacist"],
  prescriptions: ["Pharmacist"],
  transfers: ["Warehouse Staff"],
  replenishment: ["Pharmacist", "Warehouse Staff"],
  sites: ["Platform Admin", "Pharmacy Manager"],
  catalog: ["Platform Admin", "Pharmacy Manager"],
  supplier: ["Platform Admin", "Pharmacy Manager"],
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
};

const canAccessSection = (section: Section, roles: readonly string[]): boolean =>
  roles.includes("Platform Admin") || sectionRoles[section].some((role) => roles.includes(role));

const navGroups: NavGroup[] = [
  {
    id: "operations",
    label: "Operations",
    items: [
      { key: "dashboard", label: "Dashboard", icon: <LayoutDashboard size={16} strokeWidth={2} /> },
      { key: "pharmacistOverview", label: "Pharmacist overview", icon: <FileText size={16} strokeWidth={2} /> },
      { key: "prescriptions", label: "Prescriptions", icon: <FileText size={16} strokeWidth={2} /> },
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
      { key: "catalog", label: "Catalog", icon: <Tags size={16} strokeWidth={2} /> },
      { key: "supplier", label: "Suppliers", icon: <Building2 size={16} strokeWidth={2} /> },
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
  const roles = session.roles ?? [];
  const visibleNavGroups = navGroups
    .map((group) => ({ ...group, items: group.items.filter((item) => canAccessSection(item.key, roles)) }))
    .filter((group) => group.items.length > 0);
  const firstVisibleSection = visibleNavGroups[0]?.items[0]?.key ?? "dashboard";
  const [section, setSection] = useState<Section>("dashboard");
  const activeSection = canAccessSection(section, roles) ? section : firstVisibleSection;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [authReady, setAuthReady] = useState(false);

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
      setSection("dashboard");
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

  const renderSection = (): React.JSX.Element => {
    switch (activeSection) {
      case "pharmacistOverview":
        return <PrescriptionsSection key={section} initialTab="Counter transactions" />;
      case "prescriptions":
        return <PrescriptionsSection key={section} initialTab="Prescriptions" />;
      case "transfers":
        return <InventorySection key={section} initialTab="Transfers" />;
      case "replenishment":
        return <InventorySection key={section} initialTab="Replenishment" />;
      case "sites":
        return <MasterDataSection key={section} initialTab="Sites" />;
      case "catalog":
        return <CatalogSection key={section} initialTab="Products" />;
      case "supplier":
        return <MasterDataSection key={section} initialTab="Suppliers" />;
      case "receiving":
        return <ProcurementSection key={section} initialTab="Goods receipts" />;
      case "procurement":
        return <ProcurementSection key={section} initialTab="Purchase orders" />;
      case "stocktake":
        return <InventorySection key={section} initialTab="Stocktake" />;
      case "inventory":
        return <InventorySection key={section} initialTab="Balances" />;
      case "adjustments":
        return <InventorySection key={section} initialTab="Adjustments" />;
      case "returns":
        return <InventorySection key={section} initialTab="Returns" />;
      case "quality":
        return <InventorySection key={section} initialTab="Batches" />;
      case "reporting":
        return <FinanceSection key={section} initialTab="Reports" />;
      case "finance":
        return <FinanceSection key={section} initialTab="Summary" />;
      case "users":
        return <GovernanceSection key={section} initialTab="Users" />;
      case "audit":
        return <GovernanceSection key={section} initialTab="Audit" />;
      case "dashboard":
        return <DashboardSection key={section} />;
    }
  };

  return (
    <div className="app-shell">
      <div className="app">
        <aside className="sidebar">
          <BrandBlock />
          <div className="sidebar-scroll">
            {visibleNavGroups.map((group) => (
              <section key={group.id} className="sidebar-section">
                <div className="sidebar-group-label">{translateText(group.label)}</div>
                <nav className="sidebar-nav" aria-label={translateText(group.label)}>
                  {group.items.map((item) => {
                    const active = section === item.key;
                    return (
                      <a
                        key={item.key}
                        href={`#${item.key}`}
                        className={active ? "active" : undefined}
                        aria-current={active ? "page" : undefined}
                        onClick={(event) => {
                          event.preventDefault();
                          setSection(item.key);
                        }}
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
        <main className="main">
          <div className="topbar">
            <details className="profile-menu">
              <summary className="profile-trigger">
                <span className="profile-copy">
                  <strong>{email || translateText("Staff account")}</strong>
                  <span>{translateText("Employee")}</span>
                </span>
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
          <div className="content-panel">
            {error ? <Alert variant="danger">{translateText(error)}</Alert> : null}
            {renderSection()}
          </div>
        </main>
      </div>
    </div>
  );
};

const root = document.querySelector<HTMLDivElement>("#root");
if (!root) throw new Error("Staff application root was not found");
createRoot(root).render(
  <StrictMode>
    <StaffApp />
  </StrictMode>,
);
