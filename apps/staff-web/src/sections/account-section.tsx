import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  Input,
  Skeleton,
  useToast,
} from "@pharmacy/ui";
import { useState } from "react";

import { currentSession, setSessionSnapshot, useSession } from "../auth.ts";
import { useUnsavedChangesGuard } from "../hooks/useUnsavedChangesGuard.ts";
import { useStaffReferences } from "../hooks/useStaffReferences.ts";
import { translateText } from "../i18n.ts";
import { referenceName } from "./procurement/labels.ts";
import { readOne, request, writeJson } from "../staff-api.ts";
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  passwordProblem,
  profileChanges,
  profileProblem,
  type ProfileForm,
} from "./account/account-form.ts";

/** The signed-in employee as `/api/auth/me` answers it. */
type OwnAccount = {
  id: string;
  email: string;
  displayName: string;
  phoneNumber: string | null;
  isActive: boolean;
  roles: string[];
  siteIds: string[];
};

const accountQueryKey = (userId: string | undefined): readonly unknown[] => ["staff-own-account", userId];

const Fact = ({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element => (
  <div className="grid gap-1">
    <dt className="text-xs font-medium text-muted">{translateText(label)}</dt>
    <dd className="text-sm text-ink">{children}</dd>
  </div>
);

const initialsOf = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(-2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");

const ProfileCard = ({ account }: { account: OwnAccount }): React.JSX.Element => {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [saved, setSaved] = useState<ProfileForm>({
    displayName: account.displayName,
    phoneNumber: account.phoneNumber ?? "",
  });
  const [form, setForm] = useState<ProfileForm>(saved);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const references = useStaffReferences();
  const changes = profileChanges(form, saved);
  useUnsavedChangesGuard(changes !== undefined);

  const save = async (): Promise<void> => {
    const problem = profileProblem(form);
    if (problem) {
      setError(translateText(problem));
      return;
    }
    if (!changes) return;
    setBusy(true);
    setError(undefined);
    try {
      const updated = await writeJson<OwnAccount>("/api/auth/me", "PATCH", changes);
      const next = { displayName: updated.displayName, phoneNumber: updated.phoneNumber ?? "" };
      setSaved(next);
      setForm(next);
      setSessionSnapshot({ ...currentSession(), displayName: updated.displayName });
      queryClient.setQueryData(accountQueryKey(updated.id), updated);
      toast.success(translateText("Account information saved."));
    } catch (reason) {
      setError(translateText(reason instanceof Error ? reason.message : "The request failed."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{translateText("Profile")}</CardTitle>
        <CardDescription>
          {translateText(
            "Your name and phone number appear in staff lists and on the records you handle. The email is your sign-in name, and an administrator manages your roles and sites.",
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="grid size-11 shrink-0 place-items-center rounded-full bg-primary-soft text-sm font-semibold text-primary-dark"
          >
            {initialsOf(saved.displayName)}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-ink">{saved.displayName}</p>
            <p className="truncate text-xs text-muted">{account.email}</p>
          </div>
        </div>

        <dl className="grid items-start gap-4 sm:grid-cols-2">
          <Fact label="Email">{account.email}</Fact>
          <Fact label="Status">
            <Badge variant={account.isActive ? "success" : "secondary"}>
              {translateText(account.isActive ? "Active" : "Deactivated")}
            </Badge>
          </Fact>
          <Fact label="Roles">
            <span className="flex flex-wrap gap-1.5">
              {account.roles.map((role) => (
                <Badge key={role}>{translateText(role)}</Badge>
              ))}
            </span>
          </Fact>
          <Fact label="Sites">
            {account.siteIds.length === 0 ? (
              <span className={account.roles.includes("Platform Admin") ? undefined : "text-muted"}>
                {translateText(account.roles.includes("Platform Admin") ? "All sites" : "No site assigned")}
              </span>
            ) : references.loading ? (
              <Skeleton className="h-6 w-40" />
            ) : (
              <span className="flex flex-wrap gap-1.5">
                {account.siteIds.map((siteId) => (
                  <Badge key={siteId} variant="outline">
                    {referenceName(references.sites, siteId, ["code", "name"])}
                  </Badge>
                ))}
              </span>
            )}
          </Fact>
        </dl>

        <form
          className="grid max-w-md gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <Field label={translateText("Display name")}>
            <Input
              value={form.displayName}
              autoComplete="name"
              maxLength={200}
              onChange={(event) => setForm({ ...form, displayName: event.target.value })}
              required
            />
          </Field>
          <Field
            label={translateText("Phone number")}
            hint={translateText("Used by colleagues and administrators to reach you.")}
          >
            <Input
              value={form.phoneNumber}
              inputMode="tel"
              autoComplete="tel"
              onChange={(event) => setForm({ ...form, phoneNumber: event.target.value })}
              required
            />
          </Field>
          {error ? <Alert variant="danger">{error}</Alert> : null}
          <div>
            <Button type="submit" disabled={busy || changes === undefined}>
              {translateText("Save changes")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};

const PasswordCard = ({ onChanged }: { onChanged: () => void }): React.JSX.Element => {
  const [currentPassword, setCurrentPassword] = useState("");
  const [nextPassword, setNextPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    const problem = passwordProblem(nextPassword, confirmPassword);
    if (problem) {
      setError(translateText(problem));
      return;
    }
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
      setError(translateText(reason instanceof Error ? reason.message : "Unable to change the password."));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{translateText("Change password")}</CardTitle>
        <CardDescription>
          {translateText(
            "Changing the password ends every session of this account, on every browser. Sign in again with the new password.",
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid max-w-md gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
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
              maxLength={MAX_PASSWORD_LENGTH}
              value={nextPassword}
              onChange={(event) => setNextPassword(event.target.value)}
              required
            />
          </Field>
          <Field label={translateText("Confirm new password")}>
            <Input
              type="password"
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              maxLength={MAX_PASSWORD_LENGTH}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              required
            />
          </Field>
          {error ? <Alert variant="danger">{error}</Alert> : null}
          <div>
            <Button type="submit" disabled={busy}>
              {translateText("Change password")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};

/**
 * The signed-in employee's own account: the identity facts they cannot edit, the name and phone they can, and the
 * password change. `onPasswordChanged` hands the sign-out to the shell, because identity ends every session on a change.
 */
export const AccountSection = ({ onPasswordChanged }: { onPasswordChanged: () => void }): React.JSX.Element => {
  const session = useSession();
  const account = useQuery({
    queryKey: accountQueryKey(session.userId),
    queryFn: () => readOne<OwnAccount>("/api/auth/me"),
  });

  return (
    <section className="grid items-start gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      {account.data ? (
        <ProfileCard account={account.data} />
      ) : account.error ? (
        <Alert variant="danger">
          {translateText(account.error instanceof Error ? account.error.message : "The request failed.")}
        </Alert>
      ) : (
        <div role="status">
          <Skeleton className="h-96" />
          <span className="sr-only">{translateText("Loading account...")}</span>
        </div>
      )}
      <PasswordCard onChanged={onPasswordChanged} />
    </section>
  );
};
