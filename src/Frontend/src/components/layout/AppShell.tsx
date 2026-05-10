import type { ReactNode } from "react";
import {
   ArrowLeftRight,
   BarChart3,
   Building2,
   ChevronDown,
   FileText,
   LayoutDashboard,
   Package,
   RotateCcw,
   ShieldCheck,
   ShoppingBag,
   Truck,
   Warehouse,
} from "lucide-react";
import { setLanguage, useLanguage, useT } from "../../lib/i18n";
import type { SidebarActiveKey } from "../../lib/sidebar";

type AppShellProps = {
   active: SidebarActiveKey;
   breadcrumb: ReactNode;
   children: ReactNode;
};

const accountAvatarUrl = "https://api.dicebear.com/9.x/notionists/svg?seed=pharmacy-staff&backgroundColor=b6e3f4";

export function AppShell({ active, breadcrumb, children }: AppShellProps) {
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
      inventory: <Package size={16} strokeWidth={2} />,
      returns: <RotateCcw size={16} strokeWidth={2} />,
      reporting: <BarChart3 size={16} strokeWidth={2} />,
      audit: <ShieldCheck size={16} strokeWidth={2} />,
   };

   const sidebarSections = [
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
         ],
      },
      {
         id: "governance" as const,
         label: t("nav.governance"),
         items: [
            { key: "inventory" as const, href: "/dashboard/inventory", label: t("nav.inventory") },
            { key: "returns" as const, href: "/dashboard/returns", label: t("nav.returns") },
            { key: "reporting" as const, href: "/dashboard/reporting", label: t("nav.reporting") },
            { key: "audit" as const, href: "/dashboard/audit", label: t("nav.audit") },
         ],
      },
   ];

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

               {sidebarSections.map((section) => (
                  <section key={section.id} className="sidebar-section">
                     <div className="sidebar-group-label">{section.label}</div>
                     <nav className="sidebar-nav" aria-label={section.label}>
                        {section.items.map((item) => (
                           <a key={item.href} className={active === item.key ? "active" : undefined} href={item.href}>
                              <span className="sidebar-nav-icon" aria-hidden="true">
                                 {navIcons[item.key]}
                              </span>
                              <span>{item.label}</span>
                           </a>
                        ))}
                     </nav>
                  </section>
               ))}
            </aside>

            <main className="main">
               <div className="topbar">
                  <div className="breadcrumb">{breadcrumb}</div>

                  <details className="profile-menu">
                     <summary className="profile-trigger">
                        <img className="profile-photo" src={accountAvatarUrl} alt="" />
                        <span className="profile-copy">
                           <strong>{t("account.name")}</strong>
                           <span>{t("account.role")}</span>
                        </span>
                        <ChevronDown className="profile-chevron" size={16} strokeWidth={2} aria-hidden="true" />
                     </summary>

                     <div className="profile-dropdown" role="menu" aria-label={t("account.name")}>
                        <button type="button" className="profile-menu-item" disabled>
                           {t("account.settings")}
                        </button>
                        <button type="button" className="profile-menu-item" onClick={() => setLanguage(nextLanguage)}>
                           {t("account.language")}: {t(`language.${nextLanguage}`)}
                        </button>
                        <button type="button" className="profile-menu-item" disabled>
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
