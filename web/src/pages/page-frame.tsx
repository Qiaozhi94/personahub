import { PageLoading } from "@/components/primitives/page-state";

export function PageFrame({ children }: { children: React.ReactNode }) {
  return <div className="grid content-start gap-4 p-6">{children}</div>;
}

export function PageHeading({ title, actions }: { title: string; actions?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h1 className="text-base font-semibold">{title}</h1>
      {actions}
    </div>
  );
}

/** One-line page section with a stable title, used by the transitional hosts. */
export function PageSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-2 rounded-lg border border-border bg-card p-4">
      <div className="grid gap-0.5">
        <h2 className="text-sm font-semibold">{title}</h2>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

export function PageSkeletonFallback({ label = "正在加载" }: { label?: string }) {
  return <PageLoading label={label} />;
}
