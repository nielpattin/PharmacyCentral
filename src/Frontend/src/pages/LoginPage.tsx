import { useState, type FormEvent } from "react";
import { login, validateLoginCredentials, getPostLoginRedirectPath, setPostLoginRedirectPath } from "../lib/auth";
import { navigate, usePathname } from "../lib/router";
import { useMountEffect } from "../hooks/useMountEffect";
import { useT } from "../lib/i18n";

export default function LoginPage() {
   const t = useT();
   const pathname = usePathname();
   const [email, setEmail] = useState("");
   const [password, setPassword] = useState("");
   const [showPassword, setShowPassword] = useState(false);
   const [isSubmitting, setIsSubmitting] = useState(false);
   const [formError, setFormError] = useState<string | null>(null);
   const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});

   useMountEffect(() => {
      if (pathname !== "/login") {
         setPostLoginRedirectPath(pathname);
      }
   });

   function clearFieldError(field: "email" | "password") {
      setFieldErrors((current) => {
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

   return (
      <main className="login-page">
         <section className="login-card card">
            <div className="section">
               <header className="login-header">
                  <div className="login-brand">
                     <img className="brand-mark" src="/brandmark.png" alt="" />
                     <div>
                        <h1>{t("auth.title")}</h1>
                        <p className="desc">{t("auth.subtitle")}</p>
                     </div>
                  </div>
               </header>

               {formError !== null ? <div className="notice danger-note">{formError}</div> : null}

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
                     {fieldErrors.email !== undefined ? (
                        <span id="login-email-error" className="field-error">
                           {fieldErrors.email}
                        </span>
                     ) : null}
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
                        <button
                           type="button"
                           className="btn secondary btn-sm login-password-toggle"
                           onClick={() => setShowPassword((current) => !current)}
                           aria-pressed={showPassword}
                        >
                           {showPassword ? t("auth.hidePassword") : t("auth.showPassword")}
                        </button>
                     </div>
                     {fieldErrors.password !== undefined ? (
                        <span id="login-password-error" className="field-error">
                           {fieldErrors.password}
                        </span>
                     ) : null}
                  </label>

                  <div className="form-actions login-actions">
                     <button className="btn primary" type="submit" disabled={isSubmitting}>
                        {isSubmitting ? t("auth.signingIn") : t("auth.signIn")}
                     </button>
                  </div>
               </form>
            </div>
         </section>
      </main>
   );
}
