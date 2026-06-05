import type { ReactNode } from "react";
import {
   ArrowLeftRight,
   BarChart3,
   Building2,
   ChevronDown,
   FileText,
   LayoutDashboard,
   ClipboardList,
   ClipboardCheck,
   Package,
   RotateCcw,
   Siren,
   ShieldCheck,
   ShoppingBag,
   Truck,
   Users,
   Warehouse,
} from "lucide-react";
import { setLanguage, useLanguage, useT } from "../../lib/i18n";
import { navigate } from "../../lib/router";
import { logout, useAuth } from "../../lib/auth";
import { filterNavSections, type NavSection } from "../../lib/access";
import type { SidebarActiveKey } from "../../lib/sidebar";

type AppShellProps = {
   active: SidebarActiveKey;
   breadcrumb: ReactNode;
   children: ReactNode;
};

const accountAvatarUrl = "https://api.dicebear.com/9.x/notionists/svg?seed=pharmacy-staff&backgroundColor=b6e3f4";

export function AppShell({ active, breadcrumb, children }: AppShellProps) {
   const authUser = useAuth();
   const language = useLanguage();
   const t = useT();
   const nextLanguage = language === "vi" ? "en" : "vi";

   const navIcons: Record<SidebarActiveKey, ReactNode> = {
      dashboard: <LayoutDashboard size={16} strokeWidth={2} />,
      prescriptions: <FileText size={16} strokeWidth={2} />,
      transfers: <ArrowLeftRight size={16} strokeWidth={2} />,
      sites: <Building2 size={16} strokeWidth={2} />,
      catalog: <ShoppingBag size={16} strokeWidth={2} />,
      supplier: <Truck size={16} strokeWidth={2} />,
      receiving: <Warehouse size={16} strokeWidth={2} />,
      stocktake: <ClipboardList size={16} strokeWidth={2} />,
      inventory: <Package size={16} strokeWidth={2} />,
      adjustments: <ClipboardCheck size={16} strokeWidth={2} />,
      returns: <RotateCcw size={16} strokeWidth={2} />,
      quality: <ShieldCheck size={16} strokeWidth={2} />,
      recalls: <Siren size={16} strokeWidth={2} />,
      reporting: <BarChart3 size={16} strokeWidth={2} />,
      audit: <ShieldCheck size={16} strokeWidth={2} />,
      users: <Users size={16} strokeWidth={2} />,
   };

   const sidebarSections: NavSection[] = [
      {
         id: "operations" as const,
         label: t("nav.operations"),
         items: [
            { key: "dashboard" as const, href: "/dashboard", label: t("nav.dashboard") },
            { key: "prescriptions" as const, href: "/dashboard/prescriptions", label: t("nav.prescription") },
            { key: "transfers" as const, href: "/dashboard/transfers", label: t("nav.transfer") },
         ],
      },
      {
         id: "masterData" as const,
         label: t("nav.masterData"),
         items: [
            { key: "sites" as const, href: "/dashboard/sites", label: t("nav.sites") },
            { key: "catalog" as const, href: "/dashboard/catalog", label: t("nav.catalog") },
            { key: "supplier" as const, href: "/dashboard/supplier", label: t("nav.supplier") },
            { key: "receiving" as const, href: "/dashboard/receiving", label: t("nav.receiving") },
            { key: "stocktake" as const, href: "/dashboard/stocktake", label: t("nav.stocktake") },
         ],
      },
      {
         id: "governance" as const,
         label: t("nav.governance"),
         items: [
            { key: "inventory" as const, href: "/dashboard/inventory", label: t("nav.inventory") },
            { key: "adjustments" as const, href: "/dashboard/adjustments", label: t("nav.adjustments") },
            { key: "returns" as const, href: "/dashboard/returns", label: t("nav.returns") },
            { key: "quality" as const, href: "/dashboard/quality", label: t("nav.quality") },
            { key: "recalls" as const, href: "/dashboard/recalls", label: t("nav.recalls") },
            { key: "reporting" as const, href: "/dashboard/reporting", label: t("nav.reporting") },
            { key: "audit" as const, href: "/dashboard/audit", label: t("nav.audit") },
            { key: "users" as const, href: "/dashboard/users", label: t("nav.users") },
         ],
      },
   ];

   const visibleSidebarSections = filterNavSections(authUser, sidebarSections);
   const isLoggedIn = authUser !== null;
   const accountName = authUser?.displayName ?? "";
   const accountEmail = authUser?.email ?? "";
   const accountRole = authUser?.roles !== undefined && authUser.roles.length > 0 ? authUser.roles[0] : "";

   async function handleSignOut() {
      await logout();
      navigate("/login");
   }

   return (
      <div className="app-shell">
         <div className="app">
            <aside className="sidebar">
               <div className="brand">
                  <img className="brand-mark" src="/brandmark.png" alt="" />
                  <div>
                     <h2>{t("app.brand")}</h2>
                     <p>{t("app.operationsAdmin")}</p>
                  </div>
               </div>

               {isLoggedIn
                  ? visibleSidebarSections.map((section) => (
                       <section key={section.id} className="sidebar-section">
                          <div className="sidebar-group-label">{section.label}</div>
                          <nav className="sidebar-nav" aria-label={section.label}>
                             {section.items.map((item) => (
                                <a
                                   key={item.href}
                                   className={active === item.key ? "active" : undefined}
                                   href={item.href}
                                >
                                   <span className="sidebar-nav-icon" aria-hidden="true">
                                      {navIcons[item.key]}
                                   </span>
                                   <span>{item.label}</span>
                                </a>
                             ))}
                          </nav>
                       </section>
                    ))
                  : null}
            </aside>

            <main className="main">
               <div className="topbar">
                  <div className="breadcrumb">{breadcrumb}</div>

                  <details className="profile-menu">
                     <summary className="profile-trigger">
                        <img className="profile-photo" src={accountAvatarUrl} alt="" />
                        <span className="profile-copy">
                           <strong>{accountName}</strong>
                           <span>{accountRole}</span>
                        </span>
                        <ChevronDown className="profile-chevron" size={16} strokeWidth={2} aria-hidden="true" />
                     </summary>

                     <div className="profile-dropdown" role="menu" aria-label={accountName}>
                        <div className="profile-menu-section">
                           <span className="profile-menu-label">{accountEmail}</span>
                        </div>
                        <button type="button" className="profile-menu-item" disabled>
                           {t("account.settings")}
                        </button>
                        <button type="button" className="profile-menu-item" onClick={() => setLanguage(nextLanguage)}>
                           {t("account.language")}: {t(`language.${nextLanguage}`)}
                        </button>
                        <button type="button" className="profile-menu-item" onClick={() => void handleSignOut()}>
                           {t("account.signOut")}
                        </button>
                     </div>
                  </details>
               </div>

               <div className={active === "sites" ? "content-panel content-panel-sites" : "content-panel"}>
                  {children}
               </div>
            </main>
         </div>
      </div>
   );
}
