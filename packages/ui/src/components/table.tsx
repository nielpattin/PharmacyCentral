import { cn } from "../cn.ts";

type TableProps = React.TableHTMLAttributes<HTMLTableElement>;
type CellProps = React.TdHTMLAttributes<HTMLTableCellElement>;
type HeaderCellProps = React.ThHTMLAttributes<HTMLTableCellElement>;

export const Table = ({ className, ...props }: TableProps): React.JSX.Element => (
  <div className="overflow-x-auto">
    <table className={cn("w-full border-collapse text-left text-sm", className)} {...props} />
  </div>
);

export const TableHeader = (props: React.HTMLAttributes<HTMLTableSectionElement>): React.JSX.Element => (
  <thead {...props} />
);

export const TableBody = (props: React.HTMLAttributes<HTMLTableSectionElement>): React.JSX.Element => (
  <tbody {...props} />
);

export const TableRow = ({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>): React.JSX.Element => (
  <tr className={cn("border-b border-line last:border-0", className)} {...props} />
);

export const TableHead = ({ className, ...props }: HeaderCellProps): React.JSX.Element => (
  <th className={cn("px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted", className)} {...props} />
);

export const TableCell = ({ className, ...props }: CellProps): React.JSX.Element => (
  <td className={cn("px-3 py-2 text-ink", className)} {...props} />
);
