import { EmptyState } from "@/components/primitives/page-state";
import { useRouter } from "@/app/router";
import { PageFrame } from "@/pages/page-frame";

// Unified not-found view: unregistered surfaces, unknown top-level paths, and
// other illegal deep links land here with the attempted path preserved in the
// page and exactly one recovery action.

export function NotFoundPage({ attemptedPath }: { attemptedPath: string }) {
  const { navigate } = useRouter();
  return (
    <PageFrame>
      <EmptyState
        title="页面不存在"
        description={`没有找到 ${attemptedPath} 对应的页面。`}
        action={{ label: "回到项目列表", onAction: () => navigate("/projects") }}
      />
    </PageFrame>
  );
}
