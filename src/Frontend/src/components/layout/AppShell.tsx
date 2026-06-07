import { motion } from "motion/react";
import { useCallback, type ReactNode, type UIEvent } from "react";
import {
   ArrowLeftRight,
   BarChart3,
   Building2,
   ChevronDown,
   ClipboardCheck,
   ClipboardList,
   FileText,
   Languages,
   LayoutDashboard,
   LogOut,
   Menu,
   Package,
   RotateCcw,
   Settings,
   ShieldCheck,
   ShoppingBag,
   Siren,
   Truck,
   Users,
   Warehouse,
} from "lucide-react";
import { Button } from "../shadcn/button";
import {
   DropdownMenu,
   DropdownMenuContent,
   DropdownMenuItem,
   DropdownMenuLabel,
   DropdownMenuSeparator,
   DropdownMenuTrigger,
} from "../shadcn/dropdown-menu";
import {
   Sheet,
   SheetClose,
   SheetContent,
   SheetDescription,
   SheetHeader,
   SheetTitle,
   SheetTrigger,
} from "../shadcn/sheet";
import { activeIndicatorTransition } from "../../lib/motion";
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

type NavIconMap = Record<SidebarActiveKey, ReactNode>;

type ShellNavProps = {
   active: SidebarActiveKey;
   isLoggedIn: boolean;
   navIcons: NavIconMap;
   sections: NavSection[];
   variant: "desktop" | "mobile";
};

const accountAvatarUrl = "https://api.dicebear.com/9.x/notionists/svg?seed=pharmacy-staff&backgroundColor=b6e3f4";
let sidebarScrollTop = 0;

function BrandBlock() {
   const t = useT();

   return (
      <div className="brand">
         <img className="brand-mark" src="/brandmark.png" alt="" />
         <div>
            <h2>{t("app.brand")}</h2>
            <p>{t("app.operationsAdmin")}</p>
         </div>
      </div>
   );
}

function ShellNav({ active, isLoggedIn, navIcons, sections, variant }: ShellNavProps) {
   if (!isLoggedIn) {
      return null;
   }

   const activeLayoutId = variant === "desktop" ? "sidebar-active-indicator" : "mobile-sidebar-active-indicator";

   return (
      <>
         {sections.map((section) => (
            <section key={section.id} className="sidebar-section">
               <div className="sidebar-group-label">{section.label}</div>
               <nav className="sidebar-nav" aria-label={section.label}>
                  {section.items.map((item) => {
                     const isActive = active === item.key;
                     const link = (
                        <a key={item.href} className={isActive ? "active" : undefined} href={item.href}>
                           {isActive && (
                              <motion.span
                                 layoutId={activeLayoutId}
                                 className="sidebar-nav-active-indicator"
                                 transition={activeIndicatorTransition}
                                 aria-hidden="true"
                              />
                           )}
                           <span className="sidebar-nav-icon" aria-hidden="true">
                              {navIcons[item.key]}
                           </span>
                           <span className="sidebar-nav-label">{item.label}</span>
                        </a>
                     );

                     return variant === "mobile" ? (
                        <SheetClose key={item.href} asChild>
                           {link}
                        </SheetClose>
                     ) : (
                        link
                     );
                  })}
               </nav>
            </section>
         ))}
      </>
   );
}

export function AppShell({ active, breadcrumb, children }: AppShellProps) {
   const authUser = useAuth();
   const language = useLanguage();
   const t = useT();
   const nextLanguage = language === "vi" ? "en" : "vi";
   const setSidebarScrollNode = useCallback((node: HTMLDivElement | null) => {
      if (node === null) {
         return;
      }

      node.scrollTop = sidebarScrollTop;
      const activeLink = node.querySelector("a.active");
      activeLink?.scrollIntoView({ block: "nearest" });
      sidebarScrollTop = node.scrollTop;
   }, []);

   const navIcons: NavIconMap = {
      dashboard: <LayoutDashboard size={16} strokeWidth={2} />,
      prescriptions: <FileText size={16} strokeWidth={2} />,
      transfers: <ArrowLeftRight size={16} strokeWidth={2} />,
      sites: <Building2 size={16} strokeWidth={2} />,
      catalog: <ShoppingBag size={16} strokeWidth={2} />,
      pricing: <ShoppingBag size={16} strokeWidth={2} />,
      supplier: <Truck size={16} strokeWidth={2} />,
      receiving: <Warehouse size={16} strokeWidth={2} />,
      procurement: <ShoppingBag size={16} strokeWidth={2} />,
      stocktake: <ClipboardList size={16} strokeWidth={2} />,
      inventory: <Package size={16} strokeWidth={2} />,
      adjustments: <ClipboardCheck size={16} strokeWidth={2} />,
      returns: <RotateCcw size={16} strokeWidth={2} />,
      quality: <ShieldCheck size={16} strokeWidth={2} />,
      recalls: <Siren size={16} strokeWidth={2} />,
      reporting: <BarChart3 size={16} strokeWidth={2} />,
      finance: <BarChart3 size={16} strokeWidth={2} />,
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
            { key: "pricing" as const, href: "/dashboard/pricing", label: t("nav.pricing") },
            { key: "supplier" as const, href: "/dashboard/supplier", label: t("nav.supplier") },
            { key: "receiving" as const, href: "/dashboard/receiving", label: t("nav.receiving") },
            { key: "procurement" as const, href: "/dashboard/procurement", label: t("nav.procurement") },
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
            { key: "finance" as const, href: "/dashboard/finance", label: t("nav.finance") },
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

   function handleSidebarScroll(event: UIEvent<HTMLDivElement>) {
      sidebarScrollTop = event.currentTarget.scrollTop;
   }

   async function handleSignOut() {
      await logout();
      navigate("/login");
   }

   return (
      <div className="app-shell">
         <div className="app">
            <aside className="sidebar">
               <BrandBlock />

               <div ref={setSidebarScrollNode} className="sidebar-scroll" onScroll={handleSidebarScroll}>
                  <ShellNav
                     active={active}
                     isLoggedIn={isLoggedIn}
                     navIcons={navIcons}
                     sections={visibleSidebarSections}
                     variant="desktop"
                  />
               </div>
            </aside>

            <main className="main">
               <div className="topbar">
                  <div className="topbar-leading">
                     <Sheet>
                        <SheetTrigger asChild>
                           <Button
                              className="mobile-nav-trigger"
                              variant="outline"
                              size="icon"
                              aria-label={t("nav.operations")}
                           >
                              <Menu size={17} strokeWidth={2} aria-hidden="true" />
                           </Button>
                        </SheetTrigger>
                        <SheetContent side="left" className="mobile-sidebar-sheet" showCloseButton={false}>
                           <SheetHeader className="mobile-sidebar-header">
                              <SheetTitle className="sr-only">{t("app.brand")}</SheetTitle>
                              <SheetDescription className="sr-only">{t("app.operationsAdmin")}</SheetDescription>
                              <BrandBlock />
                           </SheetHeader>
                           <div className="sidebar-scroll mobile-sidebar-scroll">
                              <ShellNav
                                 active={active}
                                 isLoggedIn={isLoggedIn}
                                 navIcons={navIcons}
                                 sections={visibleSidebarSections}
                                 variant="mobile"
                              />
                           </div>
                        </SheetContent>
                     </Sheet>
                     <div className="breadcrumb">{breadcrumb}</div>
                  </div>

                  <DropdownMenu>
                     <DropdownMenuTrigger asChild>
                        <button type="button" className="profile-trigger">
                           <img className="profile-photo" src={accountAvatarUrl} alt="" />
                           <span className="profile-copy">
                              <strong>{accountName}</strong>
                              <span>{accountRole}</span>
                           </span>
                           <ChevronDown className="profile-chevron" size={16} strokeWidth={2} aria-hidden="true" />
                        </button>
                     </DropdownMenuTrigger>
                     <DropdownMenuContent align="end" sideOffset={10} className="profile-dropdown-menu">
                        <DropdownMenuLabel className="profile-dropdown-label">{accountEmail}</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem disabled className="profile-dropdown-item">
                           <Settings size={15} strokeWidth={2} aria-hidden="true" />
                           {t("account.settings")}
                        </DropdownMenuItem>
                        <DropdownMenuItem className="profile-dropdown-item" onClick={() => setLanguage(nextLanguage)}>
                           <Languages size={15} strokeWidth={2} aria-hidden="true" />
                           {t("account.language")}: {t(`language.${nextLanguage}`)}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="profile-dropdown-item" onClick={() => void handleSignOut()}>
                           <LogOut size={15} strokeWidth={2} aria-hidden="true" />
                           {t("account.signOut")}
                        </DropdownMenuItem>
                     </DropdownMenuContent>
                  </DropdownMenu>
               </div>

               <div className={active === "sites" ? "content-panel content-panel-sites" : "content-panel"}>
                  {children}
               </div>
            </main>
         </div>
      </div>
   );
}
