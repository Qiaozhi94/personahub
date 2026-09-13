import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiClient, toApiError } from "@/lib/api-client";
import type { Project } from "@personahub/shared";

// F013 T017（设置 tab）：归档 / 恢复 / 删除（引用保护）。

export function ProjectSettingsTab({ projectId, project }: { projectId: string; project: Project }) {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ["projects"] });
    void queryClient.invalidateQueries({ queryKey: ["project", projectId] });
  };

  const archive = async (): Promise<void> => {
    try {
      await apiClient.projects.archive(projectId);
      refresh();
    } catch (error) {
      setMessage(toApiError(error).message);
    }
  };

  const restore = async (): Promise<void> => {
    try {
      await apiClient.projects.restore(projectId);
      refresh();
    } catch (error) {
      setMessage(toApiError(error).message);
    }
  };

  const remove = async (): Promise<void> => {
    try {
      await apiClient.projects.remove(projectId);
      refresh();
    } catch (error) {
      setMessage(toApiError(error).message);
    }
  };

  return (
    <div>
      <p className="text-sm text-muted-foreground">
        归属 Space：{project.space_id} · 状态：{project.state === "archived" ? "已归档" : "进行中"}
      </p>
      <div className="mt-3 flex gap-2">
        {project.state === "active" ? (
          <button type="button" onClick={() => void archive()} aria-label="归档项目">
            归档
          </button>
        ) : (
          <button type="button" onClick={() => void restore()} aria-label="恢复项目">
            恢复
          </button>
        )}
        <button type="button" onClick={() => void remove()} aria-label="删除项目">
          删除（受引用保护）
        </button>
      </div>
      {message ? (
        <p role="status" className="mt-2 text-sm text-muted-foreground">
          {message}
        </p>
      ) : null}
    </div>
  );
}
