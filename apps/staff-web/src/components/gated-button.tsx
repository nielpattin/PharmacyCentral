import { Button, cn } from "@pharmacy/ui";

import type { AccessResult } from "../permissions/staff-permissions.ts";

export type GatedButtonProps = React.ComponentProps<typeof Button> & { gate: AccessResult };

/**
 * A button that may be out of reach for the current staff member. Allowed: a plain button. Refused: it stays on
 * screen, dimmed, with the reason as its `title`, and it swallows the click. `aria-disabled` rather than `disabled`
 * keeps it focusable, so a keyboard or screen-reader user reaches the same reason. Nothing is sent to the server.
 */
export const GatedButton = ({ gate, onClick, className, ...props }: GatedButtonProps): React.JSX.Element => {
  if (gate.allowed) return <Button onClick={onClick} className={className} {...props} />;
  return (
    <Button
      {...props}
      aria-disabled="true"
      title={gate.reason}
      className={cn("cursor-not-allowed opacity-50", className)}
      onClick={(event) => event.preventDefault()}
    />
  );
};
