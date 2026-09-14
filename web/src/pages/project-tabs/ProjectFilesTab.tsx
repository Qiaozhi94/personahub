import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ProjectRepositoryRef, Repository, RepositoryMachinePath, Scope } from "@personahub/shared";
import { useProjectRepositories } from "@/hooks/use-skills";
import { apiClient, toApiError } from "@/lib/api-client";

// F013 T017（文件 tab）：主代码目录（primary，可写）与只读参考仓库的完整管理面：
// 绑定 / 改绑主目录、增删参考仓库（本地路径或远程地址）、机器级与项目级 scope。
// 添加动作只做识别与落库，不手填名称（FR-004）；参考仓库恒只读（FR-003）。

type RepoDetail = {
  repository: Repository;
  machine_path: Omit<RepositoryMachinePath, "repository_id"> | null;
};

function linesOf(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

function readPrefixes(text: string): string[] {
  const lines = linesOf(text);
  return lines.length > 0 ? lines : [""];
}

function writePrefixes(text: string): string[] {
  return linesOf(text);
}

function prefixesText(prefixes: string[] | undefined, fallback: string[]): string {
  return (prefixes ?? fallback).join("\n");
}

function repositoryLabel(detail: RepoDetail | undefined, fallbackId: string): string {
  return detail?.repository.display_name ?? fallbackId;
}

function repositoryPath(detail: RepoDetail | undefined, legacyPath: string | null | undefined): string | null {
  return detail?.machine_path?.real_path ?? detail?.machine_path?.raw_path ?? legacyPath ?? null;
}

export function ProjectFilesTab({
  projectId,
  legacyWorkspacePath,
}: {
  projectId: string;
  /** F013 migration projection: keep the existing primary path visible while the runtime authorization UI converges. */
  legacyWorkspacePath?: string | null;
}) {
  const refsQuery = useProjectRepositories(projectId);
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [referenceSource, setReferenceSource] = useState("");
  const [primarySource, setPrimarySource] = useState("");
  const primaryEdited = useRef(false);

  const refs = refsQuery.data?.references ?? [];
  const primary = refs.find((ref) => ref.role === "primary") ?? null;
  const references = refs.filter((ref) => ref.role === "reference");
  // 整体替换（PUT projects/:id/repositories）只有在引用列表成功加载且不在刷新中时
  // 才允许执行：否则空数组快照会把服务端既有引用整体删掉。
  const refsReady = refsQuery.isSuccess && !refsQuery.isFetching;

  const assertRefsReady = (): boolean => {
    if (!refsReady) {
      setMessage("仓库引用尚未加载成功，请稍后重试。");
      return false;
    }
    return true;
  };

  useEffect(() => {
    if (!primaryEdited.current && !primary && legacyWorkspacePath) {
      setPrimarySource(legacyWorkspacePath);
    }
  }, [legacyWorkspacePath, primary]);

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ["projects", projectId, "repositories"] });
    void queryClient.invalidateQueries({ queryKey: ["projects", projectId] });
    void queryClient.invalidateQueries({ queryKey: ["repositories"] });
  };

  const toCollection = (overrides: Record<string, Scope> = {}) => ({
    primary: primary
      ? {
          repository_id: primary.repository_id,
          access: primary.access,
          scope: overrides[primary.repository_id] ?? primary.scope_json ?? undefined,
        }
      : null,
    references: references.map((ref) => ({
      repository_id: ref.repository_id,
      scope: overrides[ref.repository_id] ?? ref.scope_json ?? undefined,
    })),
  });

  const bindPrimary = async (): Promise<void> => {
    const source = primarySource.trim();
    if (source === "") return;
    if (!assertRefsReady()) return;
    setBusy(true);
    setMessage(null);
    try {
      const resolved = await apiClient.repositories.resolve(source);
      if (resolved.kind !== "local_dir" || !resolved.authorizable || !resolved.real_path) {
        setMessage("主目录必须是这台执行机器上可访问的本地目录；远程地址只能作为参考仓库。");
        return;
      }
      const created = await apiClient.repositories.create(source);
      const machine = (await apiClient.repositories.get(created.repository.id)).machine_path;
      if (!machine) {
        await apiClient.repositories.authorize(created.repository.id, resolved.real_path, "read_write");
      }
      await apiClient.repositories.setForProject(projectId, {
        primary: { repository_id: created.repository.id, access: "read_write" },
        references: references
          .filter((ref) => ref.repository_id !== created.repository.id)
          .map((ref) => ({ repository_id: ref.repository_id, scope: ref.scope_json ?? undefined })),
      });
      setMessage(
        machine && machine.access !== "read_write"
          ? `已绑定主目录：${resolved.display_name}（机器授权为只读，实际访问按只读）`
          : `已绑定主目录：${resolved.display_name}（可写）`,
      );
      setPrimarySource("");
      refresh();
    } catch (error) {
      setMessage(toApiError(error).message);
    } finally {
      setBusy(false);
    }
  };

  const addReference = async (): Promise<void> => {
    const source = referenceSource.trim();
    if (source === "") return;
    if (!assertRefsReady()) return;
    setBusy(true);
    setMessage(null);
    try {
      const resolved = await apiClient.repositories.resolve(source);
      if (resolved.kind === "remote_url") {
        const created = await apiClient.repositories.create(source);
        const collection = toCollection();
        await apiClient.repositories.setForProject(projectId, {
          ...collection,
          references: [...collection.references, { repository_id: created.repository.id }],
        });
        setMessage(`已添加远程参考仓库：${resolved.display_name}（需克隆到执行机器并授权路径后才能用于执行）`);
      } else if (!resolved.authorizable || !resolved.real_path) {
        setMessage(`无法添加：${resolved.unauthorized_reason ?? "路径不可用"}`);
        return;
      } else {
        const created = await apiClient.repositories.create(source);
        const machine = (await apiClient.repositories.get(created.repository.id)).machine_path;
        if (!machine) {
          await apiClient.repositories.authorize(created.repository.id, resolved.real_path, "read_only");
        }
        const collection = toCollection();
        await apiClient.repositories.setForProject(projectId, {
          ...collection,
          references: [...collection.references, { repository_id: created.repository.id }],
        });
        setMessage(`已添加参考仓库：${resolved.display_name}（只读）`);
      }
      setReferenceSource("");
      refresh();
    } catch (error) {
      setMessage(toApiError(error).message);
    } finally {
      setBusy(false);
    }
  };

  const removeReference = async (ref: ProjectRepositoryRef): Promise<void> => {
    if (!assertRefsReady()) return;
    setBusy(true);
    setMessage(null);
    try {
      const collection = toCollection();
      await apiClient.repositories.setForProject(projectId, {
        ...collection,
        references: collection.references.filter((entry) => entry.repository_id !== ref.repository_id),
      });
      setMessage(`已移除参考仓库：${ref.repository_id}`);
      refresh();
    } catch (error) {
      setMessage(toApiError(error).message);
    } finally {
      setBusy(false);
    }
  };

  const saveProjectScope = async (repositoryId: string, scope: Scope): Promise<void> => {
    if (!assertRefsReady()) return;
    setBusy(true);
    setMessage(null);
    try {
      await apiClient.repositories.setForProject(projectId, toCollection({ [repositoryId]: scope }));
      setMessage(`已更新项目范围：${repositoryId}`);
      refresh();
    } catch (error) {
      setMessage(toApiError(error).message);
    } finally {
      setBusy(false);
    }
  };

  const saveMachineScope = async (
    ref: ProjectRepositoryRef,
    detail: RepoDetail | undefined,
    scope: Scope,
  ): Promise<void> => {
    const machine = detail?.machine_path;
    if (!machine) {
      setMessage("该仓库尚未在这台执行机器上授权，无法编辑机器范围。");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await apiClient.repositories.authorize(ref.repository_id, machine.raw_path, machine.access, scope);
      setMessage(`已更新机器范围：${repositoryLabel(detail, ref.repository_id)}`);
      refresh();
    } catch (error) {
      setMessage(toApiError(error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <section aria-label="主目录">
        <h3 className="text-sm font-medium">主目录（可写，最多一个）</h3>
        {primary ? (
          <ul aria-label="主目录引用">
            <RepositoryRefRow
              ref_={primary}
              legacyWorkspacePath={legacyWorkspacePath}
              busy={busy}
              refsReady={refsReady}
              onRemove={null}
              onSaveMachineScope={saveMachineScope}
              onSaveProjectScope={saveProjectScope}
              setMessage={setMessage}
            />
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">尚未绑定主目录。</p>
        )}
        <div className="mt-3 flex gap-2">
          <input
            value={primarySource}
            onChange={(event) => {
              primaryEdited.current = true;
              setPrimarySource(event.target.value);
            }}
            placeholder="本地路径（自动识别，无需填写名称）"
            aria-label="主目录路径"
          />
          <button
            type="button"
            aria-label={primary ? "改绑主目录" : "绑定主目录"}
            onClick={() => void bindPrimary()}
            disabled={busy || !refsReady || primarySource.trim() === ""}
          >
            {primary ? "改绑主目录" : "绑定主目录"}
          </button>
        </div>
      </section>

      <section aria-label="参考仓库" className="mt-6">
        <h3 className="text-sm font-medium">参考仓库（只读，可多个）</h3>
        {references.length > 0 ? (
          <ul aria-label="参考仓库引用">
            {references.map((ref) => (
              <RepositoryRefRow
                key={ref.repository_id}
                ref_={ref}
                legacyWorkspacePath={null}
                busy={busy}
                refsReady={refsReady}
                onRemove={removeReference}
                onSaveMachineScope={saveMachineScope}
                onSaveProjectScope={saveProjectScope}
                setMessage={setMessage}
              />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">尚未添加参考仓库。</p>
        )}
        <div className="mt-3 flex gap-2">
          <input
            value={referenceSource}
            onChange={(event) => setReferenceSource(event.target.value)}
            placeholder="本地路径或仓库地址（自动识别，无需填写名称）"
            aria-label="添加代码仓"
          />
          <button
            type="button"
            aria-label="添加参考仓库"
            onClick={() => void addReference()}
            disabled={busy || !refsReady || referenceSource.trim() === ""}
          >
            {busy ? "识别中…" : "添加参考仓库"}
          </button>
        </div>
      </section>

      {message ? (
        <p role="status" className="mt-2 text-sm text-muted-foreground">
          {message}
        </p>
      ) : null}
    </div>
  );
}

function RepositoryRefRow({
  ref_,
  legacyWorkspacePath,
  busy,
  refsReady,
  onRemove,
  onSaveMachineScope,
  onSaveProjectScope,
  setMessage,
}: {
  ref_: ProjectRepositoryRef;
  legacyWorkspacePath: string | null | undefined;
  busy: boolean;
  refsReady: boolean;
  onRemove: ((ref: ProjectRepositoryRef) => Promise<void>) | null;
  onSaveMachineScope: (ref: ProjectRepositoryRef, detail: RepoDetail | undefined, scope: Scope) => Promise<void>;
  onSaveProjectScope: (repositoryId: string, scope: Scope) => Promise<void>;
  setMessage: (message: string | null) => void;
}) {
  const detailQuery = useQuery({
    queryKey: ["repositories", ref_.repository_id],
    queryFn: () => apiClient.repositories.get(ref_.repository_id),
  });
  const detail = detailQuery.data as RepoDetail | undefined;
  const machine = detail?.machine_path ?? null;
  const isPrimary = ref_.role === "primary";
  const [machineRead, setMachineRead] = useState<string | null>(null);
  const [machineWrite, setMachineWrite] = useState<string | null>(null);
  const [projectRead, setProjectRead] = useState<string | null>(null);
  const [projectWrite, setProjectWrite] = useState<string | null>(null);

  const machineReadValue = machineRead ?? prefixesText(machine?.scope_json?.read, [""]);
  const machineWriteValue =
    machineWrite ?? prefixesText(machine?.scope_json?.write, machine?.access === "read_write" ? [""] : []);
  const projectReadValue = projectRead ?? prefixesText(ref_.scope_json?.read, [""]);
  const projectWriteValue = projectWrite ?? prefixesText(ref_.scope_json?.write, []);
  const path = repositoryPath(detail, legacyWorkspacePath);

  const saveMachine = async (): Promise<void> => {
    if (!machine) {
      setMessage("该仓库尚未在这台执行机器上授权，无法编辑机器范围。");
      return;
    }
    await onSaveMachineScope(ref_, detail, {
      read: readPrefixes(machineReadValue),
      write: isPrimary
        ? writePrefixes(machineWriteValue)
        : (machine.scope_json?.write ?? (machine.access === "read_write" ? [""] : [])),
    });
    setMachineRead(null);
    setMachineWrite(null);
  };

  const saveProject = async (): Promise<void> => {
    await onSaveProjectScope(ref_.repository_id, {
      read: readPrefixes(projectReadValue),
      write: isPrimary ? writePrefixes(projectWriteValue) : [],
    });
    setProjectRead(null);
    setProjectWrite(null);
  };

  return (
    <li className="mt-3" data-testid={`repo-ref-${ref_.repository_id}`}>
      <div>
        {isPrimary ? "主目录" : "参考仓库"} · {repositoryLabel(detail, ref_.repository_id)}
        {path ? ` · ${path}` : ""} · {isPrimary && ref_.access === "read_write" ? "可写" : "只读"}
      </div>

      <div className="mt-2 grid gap-2">
        <label className="text-sm">
          机器范围（read，每行一个前缀，空=整仓）
          <textarea
            className="block w-full"
            rows={2}
            aria-label={`机器范围 read ${ref_.repository_id}`}
            value={machineReadValue}
            onChange={(event) => setMachineRead(event.target.value)}
          />
        </label>
        {isPrimary ? (
          <label className="text-sm">
            机器范围（write，每行一个前缀，空=不开放写）
            <textarea
              className="block w-full"
              rows={2}
              aria-label={`机器范围 write ${ref_.repository_id}`}
              value={machineWriteValue}
              onChange={(event) => setMachineWrite(event.target.value)}
            />
          </label>
        ) : null}
        <button
          type="button"
          aria-label={`保存机器范围 ${ref_.repository_id}`}
          onClick={() => void saveMachine()}
          disabled={busy || !machine}
        >
          保存机器范围
        </button>

        <label className="text-sm">
          项目范围（read，每行一个前缀，空=整仓）
          <textarea
            className="block w-full"
            rows={2}
            aria-label={`项目范围 read ${ref_.repository_id}`}
            value={projectReadValue}
            onChange={(event) => setProjectRead(event.target.value)}
          />
        </label>
        {isPrimary ? (
          <label className="text-sm">
            项目范围（write，每行一个前缀，空=不开放写）
            <textarea
              className="block w-full"
              rows={2}
              aria-label={`项目范围 write ${ref_.repository_id}`}
              value={projectWriteValue}
              onChange={(event) => setProjectWrite(event.target.value)}
            />
          </label>
        ) : null}
        <button
          type="button"
          aria-label={`保存项目范围 ${ref_.repository_id}`}
          onClick={() => void saveProject()}
          disabled={busy || !refsReady}
        >
          保存项目范围
        </button>

        {onRemove && !isPrimary ? (
          <button
            type="button"
            aria-label={`删除参考仓库 ${ref_.repository_id}`}
            onClick={() => void onRemove(ref_)}
            disabled={busy || !refsReady}
          >
            删除参考仓库
          </button>
        ) : null}
      </div>
    </li>
  );
}
