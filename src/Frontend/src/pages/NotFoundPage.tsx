import styles from "./NotFoundPage.module.css";
import { useT } from "../lib/i18n";

export default function NotFoundPage() {
   const t = useT();

   return (
      <main className={styles.page}>
         <section className={`${styles.card} card`}>
            <div className="section">
               <div className="section-kicker">404</div>
               <h1>{t("notFound.title")}</h1>
               <p className="desc">{t("notFound.description")}</p>
               <div className="page-actions">
                  <a className="btn primary" href="/">
                     {t("notFound.goHome")}
                  </a>
                  <a className="btn secondary" href="/dashboard">
                     {t("notFound.goDashboard")}
                  </a>
               </div>
            </div>
         </section>
      </main>
   );
}
