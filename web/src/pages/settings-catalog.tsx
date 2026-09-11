import { buildUrl, useRouter } from "@/app/router";

// Settings catalog (review R1-004): exactly the two real settings sub-pages,
// rendered on every settings page so each one is discoverable by clicking —
// never by typing a URL. The active entry carries aria-current.

const SETTINGS_PAGES = [
  { path: "/settings/system-diagnostics", label: "系统诊断" },
  { path: "/settings/legacy-workflows", label: "历史工作流" },
] as const;

export function SettingsCatalog({ active }: { active: "/settings/system-diagnostics" | "/settings/legacy-workflows" }) {
  const { navigate } = useRouter();
  return (
    <nav aria-label="设置目录" className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted-foreground">设置</span>
      {SETTINGS_PAGES.map((page) => {
        const isActive = page.path === active;
        return (
          <a
            key={page.path}
            href={page.path}
            aria-current={isActive ? "page" : undefined}
            onClick={(event) => {
              event.preventDefault();
              navigate(buildUrl(page.path));
            }}
            className={
              isActive
                ? "rounded-full border border-primary bg-accent-soft px-3 py-1 text-xs text-primary"
                : "rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:bg-accent"
            }
          >
            {page.label}
          </a>
        );
      })}
    </nav>
  );
}
