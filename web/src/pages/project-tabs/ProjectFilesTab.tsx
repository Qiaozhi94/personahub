import { useState } from "react";
import { useProjectRepositories } from "@/hooks/use-skills";
import { apiClient } from "@/lib/api-client";
import { useQueryClient } from "@tanstack/react-query";

// F013 T017（文件 tab）：主代码目录（primary，可写）与只读参考仓库列表。
// 添加入口：本地路径 / 仓库地址 → resolve 自动识别（不手填名称）→ 授权 → 绑定。

export function ProjectFilesTab({ projectId }: { projectId: string }) {
  const refsQuery = useProjectRepositories(projectId);
  const queryClient = useQueryClient();
  const [source, setSource] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refs = refsQuery.data?.references ?? [];
  const primary = refs.find((ref) => ref.role === "primary");
  const references = refs.filter((ref) => ref.role === "reference");

  const addReference = async (): Promise<void> => {
    setBusy(true);
    setMessage(null);
    try {
      const resolved = await apiClient.repositories.resolve(source);
      if (!resolved.authorizable || !resolved.real_path) {
        setMessage(`无法授权：${resolved.unauthorized_reason ?? "路径不可用"}`);
        return;
      }
      const created = await apiClient.repositories.create(source);
      await apiClient.repositories.authorize(created.repository.id, resolved.real_path, "read_only");
      await apiClient.repositories.setForProject(projectId, {
        references: [{ repository_id: created.repository.id }],
      });
      setMessage(`已添加参考仓库：${resolved.display_name}（只读）`);
      setSource("");
      void queryClient.invalidateQueries({ queryKey: ["projects", projectId, "repositories"] });
    } catch (error) {
      setMessage(toApiErrorLocal(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <ul aria-label="仓库引用">
        {primary ? (
          <li>主目录 · {primary.repository_id} · 可写</li>
        ) : (
          <li className="text-sm text-muted-foreground">尚未绑定主目录。</li>
        )}
        {references.map((ref) => (
          <li key={ref.repository_id}>参考仓库 · {ref.repository_id} · 只读</li>
        ))}
      </ul>

      <div className="mt-3 flex gap-2">
        <input
          value={source}
          onChange={(event) => setSource(event.target.value)}
          placeholder="本地路径或仓库地址（自动识别，无需填写名称）"
          aria-label="添加代码仓"
        />
        <button type="button" onClick={() => void addReference()} disabled={busy || source.trim() === ""}>
          {busy ? "识别中…" : "添加参考仓库"}
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

function toApiErrorLocal(error: unknown): string {
  try {
    const parsed = JSON.parse((error as { message?: string }).message ?? "{}") as { message?: string };
    if (parsed.message) return parsed.message;
  } catch {
    // fallthrough
  }
  return "操作失败，请重试。";
}

// keep apiClient import used even if tree-shaken in tests
void apiClient;
