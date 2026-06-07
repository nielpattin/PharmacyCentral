import { useState, type FormEvent } from "react";
import { AlertCircle, Eye, EyeOff, Globe2, LockKeyhole, LogIn, Mail, UserRound } from "lucide-react";
import { ApiRequestError, loadFirstAdminSetupStatus } from "../api/pharmacyClient";
import { login, validateLoginCredentials, getPostLoginRedirectPath, setPostLoginRedirectPath, setupFirstAdmin } from "../lib/auth";
import { navigate, usePathname } from "../lib/router";
import { useMountEffect } from "../hooks/useMountEffect";
import { setLanguage, useLanguage, useT } from "../lib/i18n";
import { canAccessPath, getDefaultPathForUser } from "../lib/access";
import styles from "./LoginPage.module.css";

type LoginFieldErrors = { email?: string; password?: string };
type SetupFieldErrors = LoginFieldErrors & { displayName?: string };

export default function LoginPage() {
   const t = useT();
   const language = useLanguage();
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

   function getLoginErrorMessage(error: unknown) {
      if (error instanceof ApiRequestError && error.status === 401) {
         return t("auth.invalidCredentials");
      }

      return error instanceof Error ? error.message : t("errors.requestFailed", { status: 0 });
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
         const user = await login({ email, password });
         const preferredPath = getPostLoginRedirectPath();
         const redirectPath = canAccessPath(user, preferredPath) ? preferredPath : getDefaultPathForUser(user);
         setPostLoginRedirectPath(getDefaultPathForUser(user));
         navigate(redirectPath);
      } catch (error) {
         setFormError(getLoginErrorMessage(error));
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
         const user = await setupFirstAdmin({ email: setupEmail, password: setupPassword, displayName: setupDisplayName });
         const redirectPath = getDefaultPathForUser(user);
         setPostLoginRedirectPath(redirectPath);
         navigate(redirectPath);
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
      <main className={styles.page}>
         <div aria-hidden="true" className={styles.bgOrb} />
         <section className={styles.panel} aria-label={requiresAdminSetup ? t("auth.setupTitle") : t("auth.title")}>
            <div className={`${styles.loginCard} card`}>
               <header className={styles.cardHeader}>
                  <div className={styles.brandRow}>
                     <img className={styles.brandMark} src="/brandmark.png" alt="" />
                     <div>
                        <h1>{requiresAdminSetup ? t("auth.setupTitle") : t("auth.title")}</h1>
                        {requiresAdminSetup ? <p className={styles.tagline}>{t("auth.setupSubtitle")}</p> : null}
                     </div>
                  </div>
               </header>

               <div className={styles.cardBody}>
                  {formError !== null ? (
                     <div className={`notice danger-note ${styles.formNotice}`}>
                        <AlertCircle aria-hidden="true" size={16} />
                        <span>{formError}</span>
                     </div>
                  ) : null}
                  {isSetupStatusLoading ? <div className={`notice ${styles.formNotice}`}>{t("common.loading")}</div> : null}

                  {requiresAdminSetup ? (
                     <>
                     <h2 className={styles.formTitle}>{t("auth.setupFormTitle")}</h2>
                     <form className={styles.form} onSubmit={handleSetupSubmit}>
                        <label className="field">
                           <span className="field-label">{t("auth.displayName")}</span>
                           <span className={`${styles.inputWrap} ${styles.hasIcon}`}>
                              <UserRound className={styles.inputIcon} aria-hidden="true" size={18} />
                              <input
                                 className="field-input"
                                 autoFocus
                                 type="text"
                                 autoComplete="name"
                                 placeholder={t("auth.displayNamePlaceholder")}
                                 value={setupDisplayName}
                                 onChange={(event) => {
                                    setSetupDisplayName(event.target.value);
                                    clearSetupFieldError("displayName");
                                 }}
                                 aria-invalid={setupFieldErrors.displayName !== undefined}
                                 aria-describedby={setupFieldErrors.displayName !== undefined ? "setup-display-name-error" : undefined}
                              />
                           </span>
                           {setupFieldErrors.displayName !== undefined ? <span id="setup-display-name-error" className="field-error">{setupFieldErrors.displayName}</span> : null}
                        </label>

                        <label className="field">
                           <span className="field-label">{t("auth.email")}</span>
                           <span className={`${styles.inputWrap} ${styles.hasIcon}`}>
                              <Mail className={styles.inputIcon} aria-hidden="true" size={18} />
                              <input
                                 className="field-input"
                                 type="email"
                                 autoComplete="email"
                                 placeholder={t("auth.emailPlaceholder")}
                                 value={setupEmail}
                                 onChange={(event) => {
                                    setSetupEmail(event.target.value);
                                    clearSetupFieldError("email");
                                 }}
                                 aria-invalid={setupFieldErrors.email !== undefined}
                                 aria-describedby={setupFieldErrors.email !== undefined ? "setup-email-error" : undefined}
                              />
                           </span>
                           {setupFieldErrors.email !== undefined ? <span id="setup-email-error" className="field-error">{setupFieldErrors.email}</span> : null}
                        </label>

                        <label className="field">
                           <span className="field-label">{t("auth.password")}</span>
                           <span className={`${styles.inputWrap} ${styles.hasIcon} ${styles.hasAction}`}>
                              <LockKeyhole className={styles.inputIcon} aria-hidden="true" size={18} />
                              <input
                                 className="field-input"
                                 type={showPassword ? "text" : "password"}
                                 autoComplete="new-password"
                                 placeholder={t("auth.passwordPlaceholder")}
                                 value={setupPassword}
                                 onChange={(event) => {
                                    setSetupPassword(event.target.value);
                                    clearSetupFieldError("password");
                                 }}
                                 aria-invalid={setupFieldErrors.password !== undefined}
                                 aria-describedby={setupFieldErrors.password !== undefined ? "setup-password-error" : undefined}
                              />
                              <button type="button" className={styles.inputAction} onClick={() => setShowPassword((current) => !current)} aria-label={showPassword ? t("auth.hidePassword") : t("auth.showPassword")} aria-pressed={showPassword}>
                                 {showPassword ? <EyeOff aria-hidden="true" size={18} /> : <Eye aria-hidden="true" size={18} />}
                              </button>
                           </span>
                           {setupFieldErrors.password !== undefined ? <span id="setup-password-error" className="field-error">{setupFieldErrors.password}</span> : null}
                        </label>

                        <button className={`btn primary ${styles.submit}`} type="submit" disabled={isSubmitting || isSetupStatusLoading}>
                           <span>{isSubmitting ? t("auth.settingUp") : t("auth.createFirstAdmin")}</span>
                           <LogIn aria-hidden="true" size={18} />
                        </button>
                     </form>
                     </>
                  ) : (
                     <>
                     <h2 className={styles.formTitle}>{t("auth.formTitle")}</h2>
                     <form className={styles.form} onSubmit={handleSubmit}>
                        <label className="field">
                           <span className="field-label">{t("auth.email")}</span>
                           <span className={`${styles.inputWrap} ${styles.hasIcon}`}>
                              <Mail className={styles.inputIcon} aria-hidden="true" size={18} />
                              <input
                                 className="field-input"
                                 autoFocus
                                 type="email"
                                 autoComplete="email"
                                 placeholder={t("auth.emailPlaceholder")}
                                 value={email}
                                 onChange={(event) => {
                                    setEmail(event.target.value);
                                    clearFieldError("email");
                                 }}
                                 aria-invalid={fieldErrors.email !== undefined}
                                 aria-describedby={fieldErrors.email !== undefined ? "login-email-error" : undefined}
                              />
                           </span>
                           {fieldErrors.email !== undefined ? <span id="login-email-error" className="field-error">{fieldErrors.email}</span> : null}
                        </label>

                        <label className="field">
                           <span className="field-label">{t("auth.password")}</span>
                           <span className={`${styles.inputWrap} ${styles.hasIcon} ${styles.hasAction}`}>
                              <LockKeyhole className={styles.inputIcon} aria-hidden="true" size={18} />
                              <input
                                 className="field-input"
                                 type={showPassword ? "text" : "password"}
                                 autoComplete="current-password"
                                 placeholder={t("auth.passwordPlaceholder")}
                                 value={password}
                                 onChange={(event) => {
                                    setPassword(event.target.value);
                                    clearFieldError("password");
                                 }}
                                 aria-invalid={fieldErrors.password !== undefined}
                                 aria-describedby={fieldErrors.password !== undefined ? "login-password-error" : undefined}
                              />
                              <button type="button" className={styles.inputAction} onClick={() => setShowPassword((current) => !current)} aria-label={showPassword ? t("auth.hidePassword") : t("auth.showPassword")} aria-pressed={showPassword}>
                                 {showPassword ? <EyeOff aria-hidden="true" size={18} /> : <Eye aria-hidden="true" size={18} />}
                              </button>
                           </span>
                           {fieldErrors.password !== undefined ? <span id="login-password-error" className="field-error">{fieldErrors.password}</span> : null}
                        </label>

                        <button className={`btn primary ${styles.submit}`} type="submit" disabled={isSubmitting || isSetupStatusLoading}>
                           <span>{isSubmitting ? t("auth.signingIn") : t("auth.signIn")}</span>
                           <LogIn aria-hidden="true" size={18} />
                        </button>
                     </form>
                     </>
                  )}

               </div>
               <footer className={styles.cardFooter}>
                  <label className={styles.language} aria-label={t("language.switch")}>
                     <Globe2 aria-hidden="true" size={16} />
                     <select value={language} onChange={(event) => setLanguage(event.target.value === "vi" ? "vi" : "en")}>
                        <option value="en">English</option>
                        <option value="vi">Tiếng Việt</option>
                     </select>
                  </label>
               </footer>
            </div>
         </section>
      </main>
   );
}
