import type { ReactNode } from "react";

interface AppLayoutProps {
  left: ReactNode;
  center: ReactNode;
  right: ReactNode;
}

export function AppLayout({ left, center, right }: AppLayoutProps) {
  return (
    <div className="grid h-screen grid-cols-[300px_minmax(600px,1fr)_340px] overflow-hidden">
      <aside className="flex flex-col gap-4 overflow-auto border-r border-border bg-secondary px-4 py-4">
        {left}
      </aside>
      <main className="grid min-w-0 grid-rows-[58px_1fr] overflow-hidden bg-background">{center}</main>
      <aside className="flex flex-col gap-3 overflow-auto border-l border-border bg-background px-3.5 py-4">
        {right}
      </aside>
    </div>
  );
}
