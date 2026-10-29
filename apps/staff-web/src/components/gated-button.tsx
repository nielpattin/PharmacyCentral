import { Button } from "@pharmacy/ui";

import type { AccessResult } from "../permissions/staff-permissions.ts";

export type GatedButtonProps = React.ComponentProps<typeof Button> & { gate: AccessResult };

/**
 * A button that may be out of reach for the current staff member. Allowed: a plain button. Refused: nothing is
 * rendered, as in Odoo. The server and the edge still refuse the call on their own.
 */
export const GatedButton = ({ gate, onClick, className, ...props }: GatedButtonProps): React.JSX.Element | null => {
  if (!gate.allowed) return null;
  return <Button onClick={onClick} className={className} {...props} />;
};
