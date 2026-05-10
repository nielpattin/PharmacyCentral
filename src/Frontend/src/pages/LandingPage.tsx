import { useT } from "../lib/i18n";

export default function LandingPage() {
   const t = useT();

   return (
      <div className="landing-page">
         <header className="landing-hero card">
            <div className="section landing-hero-inner">
               <div className="landing-copy">
                  <div className="landing-eyebrow">{t("landing.eyebrow")}</div>
                  <h1>{t("landing.title")}</h1>
                  <p className="desc">{t("landing.description")}</p>
                  <div className="page-actions landing-actions">
                     <a className="btn primary" href="/dashboard">
                        {t("landing.openDashboard")}
                     </a>
                     <a className="btn secondary" href="/dashboard/sites">
                        {t("landing.manageSites")}
                     </a>
                  </div>
               </div>

               <div className="landing-panel">
                  <section className="card landing-card">
                     <div className="section">
                        <div className="section-header">
                           <h2 className="section-title">{t("landing.operations")}</h2>
                           <span className="badge b-role">{t("landing.planned")}</span>
                        </div>
                        <div className="landing-list">
                           <div>
                              <strong>{t("landing.dashboardName")}</strong>
                              <span>{t("landing.dashboardDesc")}</span>
                           </div>
                           <div>
                              <strong>{t("landing.prescriptionName")}</strong>
                              <span>{t("landing.prescriptionDesc")}</span>
                           </div>
                           <div>
                              <strong>{t("landing.transferName")}</strong>
                              <span>{t("landing.transferDesc")}</span>
                           </div>
                        </div>
                     </div>
                  </section>

                  <section className="card landing-card">
                     <div className="section">
                        <div className="section-header">
                           <h2 className="section-title">{t("landing.masterData")}</h2>
                           <span className="badge b-role">{t("landing.ready")}</span>
                        </div>
                        <div className="landing-list">
                           <div>
                              <strong>{t("landing.sitesName")}</strong>
                              <span>{t("landing.sitesDesc")}</span>
                           </div>
                           <div>
                              <strong>{t("landing.storageLocationsName")}</strong>
                              <span>{t("landing.storageLocationsDesc")}</span>
                           </div>
                        </div>
                     </div>
                  </section>
               </div>
            </div>
         </header>
      </div>
   );
}
