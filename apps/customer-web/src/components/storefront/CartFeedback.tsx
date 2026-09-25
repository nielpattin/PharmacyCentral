import { cn } from "@pharmacy/ui";

/**
 * Add-to-cart feedback floats above the page instead of joining its flow. An inline message shoves the product
 * grid down by its own height at the exact moment the shopper clicks, which reads as the page flashing.
 */
export const CartFeedback = ({
  notice,
  error,
}: {
  notice?: string | undefined;
  error?: string | undefined;
}): React.JSX.Element | null => {
  const message = error ?? notice;
  if (!message) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 left-4 right-4 z-50 flex justify-center sm:left-auto sm:right-6 sm:justify-end">
      <p
        role="status"
        aria-live="polite"
        className={cn(
          "max-w-md rounded-md border px-4 py-3 text-sm shadow-lg",
          error ? "border-danger/30 bg-danger-soft text-danger" : "border-primary/30 bg-primary-soft text-primary-dark",
        )}
      >
        {message}
      </p>
    </div>
  );
};
