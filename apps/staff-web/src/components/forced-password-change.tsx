import { Alert, Button, Field, Input } from "@pharmacy/ui";
import { useState } from "react";

import { translateText } from "../i18n.ts";
import { request } from "../staff-api.ts";

/** The password rule of identity's `change-password` route (12 to 200 characters). */
const MIN_PASSWORD_LENGTH = 12;

/**
 * Shown in place of every section while the employee must change the password (identity refuses the other calls with
 * 403 `password_change_required`). A successful change ends the session, so `onChanged` sends the employee to sign in.
 */
export const ForcedPasswordChange = ({
  onChanged,
  onSignOut,
}: {
  onChanged: () => void;
  onSignOut: () => void;
}): React.JSX.Element => {
  const [currentPassword, setCurrentPassword] = useState("");
  const [nextPassword, setNextPassword] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await request("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, nextPassword }),
      });
      onChanged();
    } catch (reason) {
      setBusy(false);
      setError(
        reason instanceof Error ? translateText(reason.message) : translateText("Unable to change the password."),
      );
    }
  };

  return (
    <div className="login-shell">
      <form onSubmit={(event) => void submit(event)} className="login-card">
        <h1 className="text-xl font-semibold">{translateText("Change your password")}</h1>
        <p className="text-sm text-muted">
          {translateText(
            "Change your password before you continue. You cannot open any page until the change is saved.",
          )}
        </p>
        {error ? <Alert variant="danger">{error}</Alert> : null}
        <Field label={translateText("Current password")}>
          <Input
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            required
          />
        </Field>
        <Field label={translateText("New password")} hint={translateText("At least 12 characters.")}>
          <Input
            type="password"
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            value={nextPassword}
            onChange={(event) => setNextPassword(event.target.value)}
            required
          />
        </Field>
        <Button type="submit" className="w-full" disabled={busy}>
          {translateText("Change password")}
        </Button>
        <Button type="button" variant="outline" className="w-full" onClick={onSignOut}>
          {translateText("Sign out")}
        </Button>
      </form>
    </div>
  );
};
