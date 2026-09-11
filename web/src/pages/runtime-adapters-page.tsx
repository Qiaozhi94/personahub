import { useState } from "react";
import { ProjectPicker } from "@/pages/project-picker";
import { PageFrame, PageHeading, PageSection } from "@/pages/page-frame";
import { AdapterSettings } from "@/components/adapter/AdapterSettings";

// /runtime/adapters (A025–A027): the single production entry for adapter
// configuration while F012 owns the final execution-identity contract.

export function RuntimeAdaptersPage() {
  const [projectId, setProjectId] = useState<string | null>(null);

  return (
    <PageFrame>
      <PageHeading title="适配器" />
      <ProjectPicker selectedId={projectId} onSelect={setProjectId} label="按项目管理适配器" />

      {projectId !== null ? (
        <PageSection title="适配器配置" description="创建、验证、删除适配器并设置项目默认项。">
          <AdapterSettings projectId={projectId} />
        </PageSection>
      ) : null}
    </PageFrame>
  );
}
