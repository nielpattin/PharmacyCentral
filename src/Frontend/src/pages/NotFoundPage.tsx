import styles from "./NotFoundPage.module.css";
import { useT } from "../lib/i18n";

export default function NotFoundPage() {
   const t = useT();

   return (
      <main className={styles.page}>
         <section className={`${styles.card} card`}>
            <div className="p-4">
               <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">404</div>
               <h1>{t("notFound.title")}</h1>
               <p className="desc">{t("notFound.description")}</p>
               <div className="page-actions">
                  <a className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-xs hover:bg-primary/90" href="/">
                     {t("notFound.goHome")}
                  </a>
                  <a className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium shadow-xs hover:bg-accent hover:text-accent-foreground" href="/dashboard">
                     {t("notFound.goDashboard")}
                  </a>
               </div>
            </div>
         </section>
      </main>
   );
}
