import { QueryClientProvider } from "@tanstack/react-query";
import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { queryClient } from "./query-client.ts";
import { router } from "./router.ts";
import "./index.css";

const QueryDevtools = import.meta.env.DEV
  ? lazy(() =>
      import("@tanstack/react-query-devtools").then(({ ReactQueryDevtools }) => ({ default: ReactQueryDevtools })),
    )
  : undefined;

const root = document.querySelector<HTMLDivElement>("#root");
if (!root) throw new Error("Staff application root was not found");
createRoot(root).render(
  <QueryClientProvider client={queryClient}>
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>
    {QueryDevtools ? (
      <Suspense fallback={null}>
        <QueryDevtools initialIsOpen={false} />
      </Suspense>
    ) : null}
  </QueryClientProvider>,
);
