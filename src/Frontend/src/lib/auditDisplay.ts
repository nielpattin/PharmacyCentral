type Translate = (key: string, params?: Record<string, string | number>) => string;

const stockChangeSummaryPattern = /^Posted stock movement\s+.+$/i;
const returnSummaryPattern = /^Posted return movement\s+.+$/i;

export function formatAuditSummary(t: Translate, summary: string | null, fallback: string) {
   if (summary === null || summary.trim() === "") {
      return fallback;
   }

   if (stockChangeSummaryPattern.test(summary)) {
      return t("audit.summary.stockUpdated");
   }

   if (returnSummaryPattern.test(summary)) {
      return t("audit.summary.returnRecorded");
   }

   return summary;
}
