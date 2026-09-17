import { cn } from "@pharmacy/ui";

export const SectionHeading = ({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon: React.ReactNode;
  title: string;
  description?: string | undefined;
  action?: React.ReactNode;
  className?: string | undefined;
}): React.JSX.Element => (
  <div className={cn("mb-4 flex flex-wrap items-end justify-between gap-3", className)}>
    <div className="flex items-start gap-3">
      <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-md bg-primary-soft text-primary-dark">
        {icon}
      </span>
      <div>
        <h2 className="text-lg font-semibold text-ink">{title}</h2>
        {description ? <p className="mt-0.5 text-sm text-muted">{description}</p> : null}
      </div>
    </div>
    {action}
  </div>
);
