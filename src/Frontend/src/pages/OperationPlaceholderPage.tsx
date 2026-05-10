import type { ReactNode } from "react";
import { AppShell } from "../components/layout/AppShell";
import { PageHeader } from "../components/layout/PageHeader";
import type { SidebarActiveKey } from "../lib/sidebar";

type OperationPlaceholderPageProps = {
   active: SidebarActiveKey;
   title: string;
   breadcrumb: ReactNode;
};

export default function OperationPlaceholderPage({ active, title, breadcrumb }: OperationPlaceholderPageProps) {
   return (
      <AppShell active={active} breadcrumb={breadcrumb}>
         <PageHeader title={title} />
      </AppShell>
   );
}
