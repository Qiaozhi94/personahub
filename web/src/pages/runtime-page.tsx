import { useState } from "react";
import { ProjectPicker } from "@/pages/project-picker";
import { PageFrame, PageHeading, PageSection } from "@/pages/page-frame";
import { RuntimeHealthPanel } from "@/components/runtime-health/RuntimeHealthPanel";
import { buildUrl, useRouter } from "@/app/router";

// /runtime (A025/A028 runtime half): inventory of dispatchable execution
// resources — read-only. Adapter configuration lives one level deeper at
// /runtime/adapters; schema facts live in settings, not here.

export function RuntimePage() {
  const [projectId, setProjectId] = useState<string | null>(null);
  const { navigate } = useRouter();

  return (
    <PageFrame>
      <PageHeading title="运行时" />
      <ProjectPicker selectedId={projectId} onSelect={setProjectId} label="按项目查看执行资源" />

      {projectId !== null ? (
        <PageSection title="执行资源" description="adapter 可用性、代码目录锁、队列与后台任务；只读。">
          <RuntimeHealthPanel projectId={projectId} />
          <button
            type="button"
            onClick={() => navigate(buildUrl("/runtime/adapters"))}
            className="w-fit rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent"
          >
            打开适配器设置
          </button>
        </PageSection>
      ) : null}
    </PageFrame>
  );
}
