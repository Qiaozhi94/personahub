import { RouterProvider } from "@/app/router";
import { ApplicationShell } from "@/app/ApplicationShell";
import { AppRoutes } from "@/app/AppRoutes";

// Production entry: V3.44 application shell (F009) hosting the M1 route
// manifest. The previous three-column AppLayout no longer renders anywhere;
// its remaining components survive only as transitional hosts inside the new
// pages until F011–F013 retire them.

export function App() {
  return (
    <RouterProvider>
      <ApplicationShell>
        <AppRoutes />
      </ApplicationShell>
    </RouterProvider>
  );
}
