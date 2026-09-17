import { RouterProvider } from "@tanstack/react-router";

import { router } from "./router.ts";

export const App = (): React.JSX.Element => <RouterProvider router={router} />;
