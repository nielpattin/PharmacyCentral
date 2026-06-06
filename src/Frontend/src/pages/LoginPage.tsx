import { useState, type FormEvent } from "react";
import { loadFirstAdminSetupStatus } from "../api/pharmacyClient";
import { login, validateLoginCredentials, getPostLoginRedirectPath, setPostLoginRedirectPath, setupFirstAdmin } from "../lib/auth";
import { navigate, usePathname } from "../lib/router";
import { useMountEffect } from "../hooks/useMountEffect";
import { useT } from "../lib/i18n";

type LoginFieldErrors = { email?: string; password?: string };
type SetupFieldErrors = LoginFieldErrors & { displayName?: string };

export default function LoginPage() {
   const t = useT();
   const pathname = usePathname();
   const [email, setEmail] = useState("");
   const [password, setPassword] = useState("");
   const [setupEmail, setSetupEmail] = useState("");
   const [setupPassword, setSetupPassword] = useState("");
   const [setupDisplayName, setSetupDisplayName] = useState("");
   const [showPassword, setShowPassword] = useState(false);
   const [requiresAdminSetup, setRequiresAdminSetup] = useState(false);
   const [isSetupStatusLoading, setIsSetupStatusLoading] = useState(true);
   const [isSubmitting, setIsSubmitting] = useState(false);
   const [formError, setFormError] = useState<string | null>(null);
   const [fieldErrors, setFieldErrors] = useState<LoginFieldErrors>({});
   const [setupFieldErrors, setSetupFieldErrors] = useState<SetupFieldErrors>({});

   useMountEffect(() => {
      if (pathname !== "/login") {
         setPostLoginRedirectPath(pathname);
      }

      void refreshSetupStatus();
   });

   async function refreshSetupStatus() {
      try {
         const status = await loadFirstAdminSetupStatus();
         setRequiresAdminSetup(status.requiresAdminSetup);
      } catch {
         setRequiresAdminSetup(false);
      } finally {
         setIsSetupStatusLoading(false);
      }
   }

   function clearFieldError(field: "email" | "password") {
      setFieldErrors((current) => {
         if (current[field] === undefined) {
            return current;
         }

         return { ...current, [field]: undefined };
      });
   }

   function clearSetupFieldError(field: "email" | "password" | "displayName") {
      setSetupFieldErrors((current) => {
         if (current[field] === undefined) {
            return current;
         }

         return { ...current, [field]: undefined };
      });
   }

   async function handleSubmit(event: FormEvent<HTMLFormElement>) {
      event.preventDefault();

      const validation = validateLoginCredentials({ email, password });
      if (!validation.isValid) {
         setFieldErrors(validation.fieldErrors);
         setFormError(t("auth.formError"));
         return;
      }

      setIsSubmitting(true);
      setFieldErrors({});
      setFormError(null);

      try {
         await login({ email, password });
         const redirectPath = getPostLoginRedirectPath();
         setPostLoginRedirectPath("/dashboard");
         navigate(redirectPath);
      } catch (error) {
         setFormError(error instanceof Error ? error.message : t("errors.requestFailed", { status: 0 }));
      } finally {
         setIsSubmitting(false);
      }
   }

   async function handleSetupSubmit(event: FormEvent<HTMLFormElement>) {
      event.preventDefault();

      const validation = validateSetupCredentials();
      if (!validation.isValid) {
         setSetupFieldErrors(validation.fieldErrors);
         setFormError(t("auth.formError"));
         return;
      }

      setIsSubmitting(true);
      setSetupFieldErrors({});
      setFormError(null);

      try {
         await setupFirstAdmin({ email: setupEmail, password: setupPassword, displayName: setupDisplayName });
         setPostLoginRedirectPath("/dashboard");
         navigate("/dashboard");
      } catch (error) {
         setFormError(error instanceof Error ? error.message : t("errors.requestFailed", { status: 0 }));
         await refreshSetupStatus();
      } finally {
         setIsSubmitting(false);
      }
   }

   function validateSetupCredentials() {
      const errors: SetupFieldErrors = {};
      if (setupEmail.trim().length === 0) {
         errors.email = "Email is required.";
      }

      if (setupDisplayName.trim().length === 0) {
         errors.displayName = "Display name is required.";
      }

      if (setupPassword.trim().length === 0) {
         errors.password = "Password is required.";
      }

      return {
         isValid: Object.keys(errors).length === 0,
         fieldErrors: errors,
      };
   }

   return (
      <main className="login-page">
         <section className="login-card card">
            <div className="section">
               <header className="login-header">
                  <div className="login-brand">
                     <img className="brand-mark" src="/brandmark.png" alt="" />
                     <div>
                        <h1>{requiresAdminSetup ? t("auth.setupTitle") : t("auth.title")}</h1>
                        <p className="desc">{requiresAdminSetup ? t("auth.setupSubtitle") : t("auth.subtitle")}</p>
                     </div>
                  </div>
               </header>

               {formError !== null ? <div className="notice danger-note">{formError}</div> : null}
               {isSetupStatusLoading ? <div className="notice">{t("common.loading")}</div> : null}

               {requiresAdminSetup ? (
                  <form className="login-form" onSubmit={handleSetupSubmit}>
                     <label className="field">
                        <span className="field-label">{t("auth.displayName")}</span>
                        <input
                           className="field-input"
                           autoFocus
                           type="text"
                           autoComplete="name"
                           value={setupDisplayName}
                           onChange={(event) => {
                              setSetupDisplayName(event.target.value);
                              clearSetupFieldError("displayName");
                           }}
                           aria-invalid={setupFieldErrors.displayName !== undefined}
                           aria-describedby={setupFieldErrors.displayName !== undefined ? "setup-display-name-error" : undefined}
                        />
                        {setupFieldErrors.displayName !== undefined ? <span id="setup-display-name-error" className="field-error">{setupFieldErrors.displayName}</span> : null}
                     </label>

                     <label className="field">
                        <span className="field-label">{t("auth.email")}</span>
                        <input
                           className="field-input"
                           type="email"
                           autoComplete="email"
                           value={setupEmail}
                           onChange={(event) => {
                              setSetupEmail(event.target.value);
                              clearSetupFieldError("email");
                           }}
                           aria-invalid={setupFieldErrors.email !== undefined}
                           aria-describedby={setupFieldErrors.email !== undefined ? "setup-email-error" : undefined}
                        />
                        {setupFieldErrors.email !== undefined ? <span id="setup-email-error" className="field-error">{setupFieldErrors.email}</span> : null}
                     </label>

                     <label className="field">
                        <span className="field-label">{t("auth.password")}</span>
                        <div className="login-password-row">
                           <input
                              className="field-input"
                              type={showPassword ? "text" : "password"}
                              autoComplete="new-password"
                              value={setupPassword}
                              onChange={(event) => {
                                 setSetupPassword(event.target.value);
                                 clearSetupFieldError("password");
                              }}
                              aria-invalid={setupFieldErrors.password !== undefined}
                              aria-describedby={setupFieldErrors.password !== undefined ? "setup-password-error" : undefined}
                           />
                           <button type="button" className="btn secondary btn-sm login-password-toggle" onClick={() => setShowPassword((current) => !current)} aria-pressed={showPassword}>
                              {showPassword ? t("auth.hidePassword") : t("auth.showPassword")}
                           </button>
                        </div>
                        {setupFieldErrors.password !== undefined ? <span id="setup-password-error" className="field-error">{setupFieldErrors.password}</span> : null}
                     </label>

                     <div className="form-actions login-actions">
                        <button className="btn primary" type="submit" disabled={isSubmitting || isSetupStatusLoading}>
                           {isSubmitting ? t("auth.settingUp") : t("auth.createFirstAdmin")}
                        </button>
                     </div>
                  </form>
               ) : (
                  <form className="login-form" onSubmit={handleSubmit}>
                     <label className="field">
                        <span className="field-label">{t("auth.email")}</span>
                        <input
                           className="field-input"
                           autoFocus
                           type="email"
                           autoComplete="email"
                           value={email}
                           onChange={(event) => {
                              setEmail(event.target.value);
                              clearFieldError("email");
                           }}
                           aria-invalid={fieldErrors.email !== undefined}
                           aria-describedby={fieldErrors.email !== undefined ? "login-email-error" : undefined}
                        />
                        {fieldErrors.email !== undefined ? <span id="login-email-error" className="field-error">{fieldErrors.email}</span> : null}
                     </label>

                     <label className="field">
                        <span className="field-label">{t("auth.password")}</span>
                        <div className="login-password-row">
                           <input
                              className="field-input"
                              type={showPassword ? "text" : "password"}
                              autoComplete="current-password"
                              value={password}
                              onChange={(event) => {
                                 setPassword(event.target.value);
                                 clearFieldError("password");
                              }}
                              aria-invalid={fieldErrors.password !== undefined}
                              aria-describedby={fieldErrors.password !== undefined ? "login-password-error" : undefined}
                           />
                           <button type="button" className="btn secondary btn-sm login-password-toggle" onClick={() => setShowPassword((current) => !current)} aria-pressed={showPassword}>
                              {showPassword ? t("auth.hidePassword") : t("auth.showPassword")}
                           </button>
                        </div>
                        {fieldErrors.password !== undefined ? <span id="login-password-error" className="field-error">{fieldErrors.password}</span> : null}
                     </label>

                     <div className="form-actions login-actions">
                        <button className="btn primary" type="submit" disabled={isSubmitting || isSetupStatusLoading}>
                           {isSubmitting ? t("auth.signingIn") : t("auth.signIn")}
                        </button>
                     </div>
                  </form>
               )}
            </div>
         </section>
      </main>
   );
}
