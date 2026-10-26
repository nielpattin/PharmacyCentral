import { Alert, Dialog } from "@pharmacy/ui";
import { useState } from "react";

import { setSessionSnapshot, useSession } from "../../auth.ts";
import { CustomerAuthForm } from "./CustomerAuthForm.tsx";

/**
 * Opened over the current page when a 401 ends the shopper's session (customer-web Decision 20). The page does not
 * move: a successful sign-in replaces the session snapshot, which closes the dialog and lets the page refetch.
 */
export const SessionEndedDialog = (): React.JSX.Element | null => {
  const session = useSession();
  const [signedUpNotice, setSignedUpNotice] = useState<string>();
  const notice = session.sessionEndedNotice;
  if (session.authenticated || notice === undefined) return null;

  return (
    <Dialog
      open
      title="Đăng nhập để tiếp tục"
      onClose={() => setSessionSnapshot({ authenticated: false, resolved: true })}
    >
      <div className="grid gap-4">
        <Alert variant="danger">{notice}</Alert>
        {signedUpNotice ? <Alert variant="info">{signedUpNotice}</Alert> : null}
        <CustomerAuthForm onSignedUp={setSignedUpNotice} />
      </div>
    </Dialog>
  );
};
