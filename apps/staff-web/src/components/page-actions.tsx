import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** The action slot in the shell's page header. The shell provides the element; null until it has mounted. */
export const PageActionsContext = createContext<HTMLElement | null>(null);

/**
 * Puts buttons into the shell header next to Refresh, so each page keeps its actions with its content.
 *
 * Usage: `<PageActions><Button size="sm" onClick={openCreate}>{translateText("Create")}</Button></PageActions>`
 */
export const PageActions = ({ children }: { children: ReactNode }): React.JSX.Element | null => {
  const target = useContext(PageActionsContext);
  return target ? createPortal(children, target) : null;
};
