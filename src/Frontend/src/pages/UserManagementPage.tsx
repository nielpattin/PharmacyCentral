import { useMemo, useState } from "react";
import {
   createAdminUser,
   loadAdminRoles,
   loadAdminUsers,
   loadSites,
   resetAdminUserPassword,
   revokeAdminUserSessions,
   updateAdminUserAccess,
   type AdminUserCreateRequest,
   type AdminUserDetails,
   type SiteDto,
} from "../api/pharmacyClient";
import { AppShell } from "../components/layout/AppShell";
import { Breadcrumbs } from "../components/layout/Breadcrumbs";
import { PageHeader } from "../components/layout/PageHeader";
import { Badge } from "../components/shadcn/badge";
import { Button } from "../components/shadcn/button";
import { EmptyState } from "../components/ui/EmptyState";
import { Field } from "../components/ui/Field";
import { useMountEffect } from "../hooks/useMountEffect";
import { useT } from "../lib/i18n";
import styles from "./UserManagementPage.module.css";

type CreateUserForm = {
   email: string;
   displayName: string;
   password: string;
   roles: string[];
   siteIds: string[];
};

type AccessForm = {
   roles: string[];
   siteIds: string[];
};

type PasswordForm = {
   newPassword: string;
};

const blankCreateForm: CreateUserForm = {
   email: "",
   displayName: "",
   password: "",
   roles: [],
   siteIds: [],
};

function toggleValue(values: string[], value: string) {
   return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

function formatDateTime(value: string) {
   return new Date(value).toLocaleString();
}

export default function UserManagementPage() {
   const t = useT();
   const [users, setUsers] = useState<AdminUserDetails[]>([]);
   const [roles, setRoles] = useState<string[]>([]);
   const [sites, setSites] = useState<SiteDto[]>([]);
   const [selectedUserId, setSelectedUserId] = useState("");
   const [search, setSearch] = useState("");
   const [roleFilter, setRoleFilter] = useState("");
   const [createForm, setCreateForm] = useState<CreateUserForm>(blankCreateForm);
   const [accessForm, setAccessForm] = useState<AccessForm>({ roles: [], siteIds: [] });
   const [passwordForm, setPasswordForm] = useState<PasswordForm>({ newPassword: "" });
   const [isLoading, setIsLoading] = useState(true);
   const [isSaving, setIsSaving] = useState(false);
   const [banner, setBanner] = useState<string | null>(null);
   const [notice, setNotice] = useState<string | null>(null);

   const selectedUser = useMemo(
      () => users.find((user) => user.id === selectedUserId) ?? null,
      [selectedUserId, users],
   );
   const normalizedSearch = search.trim().toLowerCase();
   const visibleUsers = useMemo(
      () =>
         users.filter((user) => {
            const matchesSearch =
               normalizedSearch.length === 0 ||
               user.email.toLowerCase().includes(normalizedSearch) ||
               user.displayName.toLowerCase().includes(normalizedSearch);
            const matchesRole = roleFilter === "" || user.roles.includes(roleFilter);
            return matchesSearch && matchesRole;
         }),
      [normalizedSearch, roleFilter, users],
   );

   useMountEffect(() => {
      void refreshData();
   });

   async function refreshData(preferredUserId?: string) {
      setIsLoading(true);
      setBanner(null);
      try {
         const [userData, roleData, siteData] = await Promise.all([loadAdminUsers(), loadAdminRoles(), loadSites()]);
         setUsers(userData);
         setRoles(roleData);
         setSites(siteData);
         const nextUserId = preferredUserId ?? selectedUserId;
         const nextSelected = userData.find((user) => user.id === nextUserId) ?? userData[0] ?? null;
         setSelectedUserId(nextSelected?.id ?? "");
         setAccessForm({ roles: nextSelected?.roles ?? [], siteIds: nextSelected?.siteIds ?? [] });
      } catch (error) {
         setBanner(error instanceof Error ? error.message : t("users.errors.load"));
      } finally {
         setIsLoading(false);
      }
   }

   function selectUser(user: AdminUserDetails) {
      setSelectedUserId(user.id);
      setAccessForm({ roles: user.roles, siteIds: user.siteIds });
      setNotice(null);
      setPasswordForm({ newPassword: "" });
      setBanner(null);
   }

   function siteName(siteId: string) {
      return sites.find((site) => site.id === siteId)?.name ?? siteId;
   }

   function siteSummary(siteIds: string[]) {
      if (siteIds.length === 0) return t("users.noSites");
      if (siteIds.length === sites.length) return t("users.allSites");
      return siteIds.slice(0, 2).map(siteName).join(", ") + (siteIds.length > 2 ? ` +${siteIds.length - 2}` : "");
   }

   function validateCreateForm() {
      if (
         createForm.email.trim().length === 0 ||
         createForm.displayName.trim().length === 0 ||
         createForm.password.trim().length === 0
      ) {
         return t("users.validation.account");
      }

      if (createForm.roles.length === 0) {
         return t("users.validation.roles");
      }

      if (createForm.siteIds.length === 0) {
         return t("users.validation.sites");
      }

      return null;
   }

   async function handleCreateUser() {
      const validationError = validateCreateForm();
      if (validationError !== null) {
         setBanner(validationError);
         return;
      }

      setIsSaving(true);
      setBanner(null);
      setNotice(null);
      try {
         const request: AdminUserCreateRequest = {
            email: createForm.email.trim(),
            displayName: createForm.displayName.trim(),
            password: createForm.password,
            roles: createForm.roles,
            siteIds: createForm.siteIds,
         };
         const created = await createAdminUser(request);
         setCreateForm(blankCreateForm);
         setNotice(t("users.created"));
         await refreshData(created.id);
      } catch (error) {
         setBanner(error instanceof Error ? error.message : t("users.errors.create"));
      } finally {
         setIsSaving(false);
      }
   }

   async function handleSaveAccess() {
      if (selectedUser === null) return;
      if (accessForm.roles.length === 0) {
         setBanner(t("users.validation.roles"));
         return;
      }
      if (accessForm.siteIds.length === 0) {
         setBanner(t("users.validation.sites"));
         return;
      }

      setIsSaving(true);
      setBanner(null);
      setNotice(null);
      try {
         const updated = await updateAdminUserAccess(selectedUser.id, accessForm);
         setNotice(t("users.updated"));
         await refreshData(updated.id);
      } catch (error) {
         setBanner(error instanceof Error ? error.message : t("users.errors.update"));
      } finally {
         setIsSaving(false);
      }
   }

   async function handleResetPassword() {
      if (selectedUser === null) return;
      if (passwordForm.newPassword.trim().length === 0) {
         setBanner(t("users.validation.password"));
         return;
      }

      setIsSaving(true);
      setBanner(null);
      setNotice(null);
      try {
         const updated = await resetAdminUserPassword(selectedUser.id, { newPassword: passwordForm.newPassword });
         setPasswordForm({ newPassword: "" });
         setNotice(t("users.passwordReset"));
         await refreshData(updated.id);
      } catch (error) {
         setBanner(error instanceof Error ? error.message : t("users.errors.passwordReset"));
      } finally {
         setIsSaving(false);
      }
   }

   async function handleRevokeSessions() {
      if (selectedUser === null) return;

      setIsSaving(true);
      setBanner(null);
      setNotice(null);
      try {
         const updated = await revokeAdminUserSessions(selectedUser.id);
         setNotice(t("users.sessionsRevoked"));
         await refreshData(updated.id);
      } catch (error) {
         setBanner(error instanceof Error ? error.message : t("users.errors.revokeSessions"));
      } finally {
         setIsSaving(false);
      }
   }

   return (
      <AppShell
         active="users"
         breadcrumb={<Breadcrumbs items={[{ label: t("app.brand"), href: "/dashboard" }, { label: t("nav.users") }]} />}
      >
         <div className={styles.usersPage}>
            <PageHeader
               title={t("users.title")}
               actions={<Button onClick={() => void refreshData()}>{t("common.refresh")}</Button>}
            />
            {banner !== null ? <div className="notice danger-note">{banner}</div> : null}
            {notice !== null ? <div className="notice success-note">{notice}</div> : null}

            <section className="rounded-md border border-border bg-card text-card-foreground shadow-none">
               <div className="p-4">
                  <div className="flex items-start justify-between gap-3">
                     <div>
                        <h2 className="m-0 text-sm font-semibold text-foreground">{t("users.createTitle")}</h2>
                        <p className="mt-1 text-sm text-muted-foreground">{t("users.createDesc")}</p>
                     </div>
                  </div>
                  <div className={`form-grid ${styles.usersCreateGrid}`}>
                     <Field label={t("users.email")} required>
                        <input
                           className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                           value={createForm.email}
                           onChange={(event) => setCreateForm({ ...createForm, email: event.target.value })}
                        />
                     </Field>
                     <Field label={t("users.displayName")} required>
                        <input
                           className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                           value={createForm.displayName}
                           onChange={(event) => setCreateForm({ ...createForm, displayName: event.target.value })}
                        />
                     </Field>
                     <Field label={t("users.password")} required hint={t("users.passwordHint")}>
                        <input
                           className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                           type="password"
                           value={createForm.password}
                           onChange={(event) => setCreateForm({ ...createForm, password: event.target.value })}
                        />
                     </Field>
                  </div>
                  <div className={styles.usersAccessGrid}>
                     <div>
                        <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t("users.roles")}</h3>
                        <div className={styles.choiceGrid}>
                           {roles.map((role) => (
                              <label key={role} className={styles.choicePill}>
                                 <input
                                    type="checkbox"
                                    checked={createForm.roles.includes(role)}
                                    onChange={() =>
                                       setCreateForm({ ...createForm, roles: toggleValue(createForm.roles, role) })
                                    }
                                 />
                                 {role}
                              </label>
                           ))}
                        </div>
                     </div>
                     <div>
                        <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t("users.siteAccess")}</h3>
                        <div className={styles.choiceGrid}>
                           {sites.map((site) => (
                              <label key={site.id} className={styles.choicePill}>
                                 <input
                                    type="checkbox"
                                    checked={createForm.siteIds.includes(site.id)}
                                    onChange={() =>
                                       setCreateForm({
                                          ...createForm,
                                          siteIds: toggleValue(createForm.siteIds, site.id),
                                       })
                                    }
                                 />
                                 {site.name}
                              </label>
                           ))}
                        </div>
                     </div>
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                     <Button disabled={isSaving} onClick={() => void handleCreateUser()}>
                        {isSaving ? t("common.saving") : t("users.createButton")}
                     </Button>
                     <Button onClick={() => setCreateForm(blankCreateForm)}>{t("common.reset")}</Button>
                  </div>
               </div>
            </section>

            <div className={styles.usersGrid}>
               <section className="rounded-md border border-border bg-card text-card-foreground shadow-none">
                  <div className="p-4">
                     <div className="flex items-start justify-between gap-3">
                        <div>
                           <h2 className="m-0 text-sm font-semibold text-foreground">{t("users.registryTitle")}</h2>
                           <p className="mt-1 text-sm text-muted-foreground">{t("users.registryDesc")}</p>
                        </div>
                        <Badge variant="outline">
                           {isLoading ? t("common.loading") : `${visibleUsers.length} ${t("common.records")}`}
                        </Badge>
                     </div>
                     <div className={`flex flex-wrap items-center gap-2 ${styles.usersToolbar}`}>
                        <input
                           className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                           placeholder={t("users.searchPlaceholder")}
                           value={search}
                           onChange={(event) => setSearch(event.target.value)}
                        />
                        <select
                           className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                           value={roleFilter}
                           onChange={(event) => setRoleFilter(event.target.value)}
                        >
                           <option value="">{t("users.allRoles")}</option>
                           {roles.map((role) => (
                              <option key={role} value={role}>
                                 {role}
                              </option>
                           ))}
                        </select>
                     </div>
                     {isLoading ? (
                        <EmptyState icon="…" title={t("users.loading")} description={t("users.fetching")} />
                     ) : visibleUsers.length === 0 ? (
                        <EmptyState icon="0" title={t("users.emptyTitle")} description={t("users.emptyDesc")} />
                     ) : (
                        <div className="overflow-x-auto">
                           <table className={`w-full border-collapse text-sm ${styles.usersTable}`}>
                              <thead>
                                 <tr>
                                    <th>{t("users.user")}</th>
                                    <th>{t("users.roles")}</th>
                                    <th>{t("users.siteAccess")}</th>
                                    <th>{t("users.createdOn")}</th>
                                    <th>{t("common.actions")}</th>
                                 </tr>
                              </thead>
                              <tbody>
                                 {visibleUsers.map((user) => (
                                    <tr key={user.id} className={selectedUserId === user.id ? "selected" : undefined}>
                                       <td>
                                          <strong>{user.displayName}</strong>
                                          <span className={styles.tableMuted}>{user.email}</span>
                                       </td>
                                       <td>
                                          {user.roles.map((role) => (
                                             <Badge key={role} variant="outline">
                                                {role}
                                             </Badge>
                                          ))}
                                       </td>
                                       <td>{siteSummary(user.siteIds)}</td>
                                       <td>{formatDateTime(user.createdAtUtc)}</td>
                                       <td>
                                          <Button size="sm" onClick={() => selectUser(user)}>
                                             {t("users.review")}
                                          </Button>
                                       </td>
                                    </tr>
                                 ))}
                              </tbody>
                           </table>
                        </div>
                     )}
                  </div>
               </section>

               <aside className="rounded-md border border-border bg-card text-card-foreground shadow-none">
                  <div className="p-4">
                     <div className="flex items-start justify-between gap-3">
                        <div>
                           <h2 className="m-0 text-sm font-semibold text-foreground">{t("users.editorTitle")}</h2>
                           <p className="mt-1 text-sm text-muted-foreground">{t("users.editorDesc")}</p>
                        </div>
                     </div>
                     {selectedUser === null ? (
                        <EmptyState
                           icon="?"
                           title={t("users.noSelectionTitle")}
                           description={t("users.noSelectionDesc")}
                        />
                     ) : (
                        <div className={styles.usersEditor}>
                           <div className={styles.detailStack}>
                              <div>
                                 <span>{t("users.displayName")}</span>
                                 <strong>{selectedUser.displayName}</strong>
                              </div>
                              <div>
                                 <span>{t("users.email")}</span>
                                 <strong>{selectedUser.email}</strong>
                              </div>
                              <div>
                                 <span>{t("users.updatedOn")}</span>
                                 <strong>{formatDateTime(selectedUser.updatedAtUtc)}</strong>
                              </div>
                           </div>
                           <div>
                              <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t("users.roles")}</h3>
                              <div className={styles.choiceGrid}>
                                 {roles.map((role) => (
                                    <label key={role} className={styles.choicePill}>
                                       <input
                                          type="checkbox"
                                          checked={accessForm.roles.includes(role)}
                                          onChange={() =>
                                             setAccessForm({
                                                ...accessForm,
                                                roles: toggleValue(accessForm.roles, role),
                                             })
                                          }
                                       />
                                       {role}
                                    </label>
                                 ))}
                              </div>
                           </div>
                           <div>
                              <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t("users.siteAccess")}</h3>
                              <div className={styles.choiceGrid}>
                                 {sites.map((site) => (
                                    <label key={site.id} className={styles.choicePill}>
                                       <input
                                          type="checkbox"
                                          checked={accessForm.siteIds.includes(site.id)}
                                          onChange={() =>
                                             setAccessForm({
                                                ...accessForm,
                                                siteIds: toggleValue(accessForm.siteIds, site.id),
                                             })
                                          }
                                       />
                                       {site.name}
                                    </label>
                                 ))}
                              </div>
                           </div>
                           <div>
                              <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t("users.security")}</h3>
                              <Field label={t("users.newPassword")} hint={t("users.newPasswordHint")}>
                                 <input
                                    className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                                    type="password"
                                    value={passwordForm.newPassword}
                                    onChange={(event) => setPasswordForm({ newPassword: event.target.value })}
                                 />
                              </Field>
                              <div className="flex flex-wrap justify-end gap-2">
                                 <Button disabled={isSaving} onClick={() => void handleResetPassword()}>
                                    {t("users.resetPassword")}
                                 </Button>
                                 <Button
                                    variant="destructive"
                                    disabled={isSaving}
                                    onClick={() => void handleRevokeSessions()}
                                 >
                                    {t("users.revokeSessions")}
                                 </Button>
                              </div>
                           </div>
                           <div className="flex flex-wrap justify-end gap-2">
                              <Button disabled={isSaving} onClick={() => void handleSaveAccess()}>
                                 {isSaving ? t("common.saving") : t("users.saveAccess")}
                              </Button>
                           </div>
                        </div>
                     )}
                  </div>
               </aside>
            </div>
         </div>
      </AppShell>
   );
}
