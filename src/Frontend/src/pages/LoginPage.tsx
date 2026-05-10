import { useState, type FormEvent } from "react";
import { navigate } from "../lib/router";
import { getPostLoginRedirectPath, setPostLoginRedirectPath, signIn } from "../lib/auth";
import { useT } from "../lib/i18n";

export default function LoginPage() {
   const t = useT();
   const [username, setUsername] = useState("");
   const [password, setPassword] = useState("");
   const [showPassword, setShowPassword] = useState(false);
   const [isSubmitting, setIsSubmitting] = useState(false);
   const [formError, setFormError] = useState<string | null>(null);
   const [fieldErrors, setFieldErrors] = useState<{ username?: string; password?: string }>({});

   function clearFieldError(field: "username" | "password") {
      setFieldErrors((current) => {
         if (current[field] === undefined) {
            return current;
         }

         return { ...current, [field]: undefined };
      });
   }

   function handleSubmit(event: FormEvent<HTMLFormElement>) {
      event.preventDefault();

      const validation = signIn({ username, password });
      if (!validation.isValid) {
         setFieldErrors(validation.fieldErrors);
         setFormError(t("auth.formError"));
         return;
      }

      setIsSubmitting(true);
      setFieldErrors({});
      setFormError(null);
      navigate(getPostLoginRedirectPath());
      setPostLoginRedirectPath("/dashboard");
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
                     <span className="field-label">{t("auth.username")}</span>
                     <input
                        className="field-input"
                        autoFocus
                        autoComplete="username"
                        value={username}
                        onChange={(event) => {
                           setUsername(event.target.value);
                           clearFieldError("username");
                        }}
                        aria-invalid={fieldErrors.username !== undefined}
                        aria-describedby={fieldErrors.username !== undefined ? "login-username-error" : undefined}
                     />
                     {fieldErrors.username !== undefined ? (
                        <span id="login-username-error" className="field-error">
                           {fieldErrors.username}
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
                        {t("auth.signIn")}
                     </button>
                  </div>
               </form>
            </div>
         </section>
      </main>
   );
}
