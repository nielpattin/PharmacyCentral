import { cn } from "../cn.ts";

export const Dialog = ({
  open,
  onClose,
  title,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  className?: string;
}): React.JSX.Element | null => {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
        className={cn(
          "flex max-h-[90vh] w-full max-w-lg flex-col rounded-lg border border-line bg-surface p-5 shadow-lg",
          className,
        )}
      >
        <h3 className="mb-3 shrink-0 text-base font-semibold text-ink">{title}</h3>
        {children}
      </div>
    </div>
  );
};
