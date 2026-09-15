import { PageFrame, PageHeading, PageSection } from "@/pages/page-frame";
import { RuntimeMachineSection } from "@/components/runtime/RuntimeMachineSection";
import { buildUrl, useRouter } from "@/app/router";

// /runtime (A025/A028 runtime half): inventory of dispatchable execution
// resources — read-only. Adapter configuration lives one level deeper at
// /runtime/adapters; schema facts live in settings, not here. Runtime facts
// come from the single F012 projection (RuntimeMachineSection); the legacy
// project-scoped health panel was removed in T025.

export function RuntimePage() {
  const { navigate } = useRouter();

  return (
    <PageFrame>
      <PageHeading title="运行时" />
      <RuntimeMachineSection />

      <PageSection title="执行资源" description="adapter 可用性、代码目录锁、队列与后台任务；只读。">
        <button
          type="button"
          onClick={() => navigate(buildUrl("/runtime/adapters"))}
          className="w-fit rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent"
        >
          打开适配器设置
        </button>
      </PageSection>
    </PageFrame>
  );
}
