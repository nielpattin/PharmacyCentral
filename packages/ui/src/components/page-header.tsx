import { cn } from "../cn.ts";

export type PageHeaderProps = {
  title: React.ReactNode;
  subtitle?: React.ReactNode | undefined;
  /** Actions shown on the right, such as a refresh button or a primary create button. */
  actions?: React.ReactNode | undefined;
  /** Breadcrumb or other navigation rendered above the title. */
  breadcrumb?: React.ReactNode | undefined;
  className?: string | undefined;
};

export const PageHeader = ({ title, subtitle, actions, breadcrumb, className }: PageHeaderProps): React.JSX.Element => (
  <header className={cn("mb-4 flex flex-wrap items-start justify-between gap-4", className)}>
    <div className="grid min-w-0 gap-1">
      {breadcrumb}
      <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
      {subtitle ? <p className="text-sm text-muted">{subtitle}</p> : null}
    </div>
    {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
  </header>
);
