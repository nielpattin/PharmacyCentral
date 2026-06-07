type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

const NO_ACTIVE_PRICE_MARKER = "No active published price found";

export function mapPaymentError(error: unknown, t: TranslateFn): string {
   const message = error instanceof Error ? error.message : String(error);

   if (message.includes(NO_ACTIVE_PRICE_MARKER)) {
      return t("payment.noActivePriceError");
   }

   return message;
}
