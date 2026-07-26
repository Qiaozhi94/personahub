import type { ReactNode } from "react";

interface AppLayoutProps {
  left: ReactNode;
  center: ReactNode;
  right: ReactNode;
}

export function AppLayout({ left, center, right }: AppLayoutProps) {
  return (
    <div className="grid h-screen grid-cols-[220px_minmax(420px,1fr)_260px] overflow-hidden xl:grid-cols-[300px_minmax(600px,1fr)_340px]">
      <aside className="flex min-w-0 flex-col gap-4 overflow-y-auto overflow-x-hidden border-r border-border bg-secondary px-4 py-4">
        {left}
      </aside>
      <main className="grid min-w-0 grid-rows-[58px_1fr] overflow-hidden bg-background">{center}</main>
      <aside className="flex min-w-0 flex-col gap-3 overflow-y-auto overflow-x-hidden border-l border-border bg-background px-3.5 py-4">
        {right}
      </aside>
    </div>
  );
}
