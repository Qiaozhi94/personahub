import { useSkillDetail, useSkillDelivery, useSkillFiles, useSkillRevisions } from "@/hooks/use-skills";

// F013 T018：Skill 整页详情（只读下钻）：来源、版本、要求、下发状态与只读文件。
// 构建期 revision 对外不存在（读取 API 过滤 published）；版本切换只读已发布行。

export function SkillDetailPage({ skillId }: { skillId: string }) {
  const revisionsQuery = useSkillRevisions(skillId);
  const revisions = revisionsQuery.data?.revisions ?? [];
  const current = revisions.find((revision) => revision.published_at !== null);
  const detail = useSkillDetail(skillId, current?.version ?? null);
  const files = useSkillFiles(skillId, current?.version ?? null);
  const delivery = useSkillDelivery(skillId, current?.version ?? null);

  return (
    <main aria-label="Skill 详情">
      <div className="px-6 pt-6">
        <h1 className="text-xl font-semibold">{detail.data?.revision.title ?? "Skill"}</h1>
        {detail.data && (
          <p className="text-sm text-muted-foreground">
            版本 v{detail.data.revision.version} · 内容指纹 {detail.data.revision.content_hash.slice(0, 12)}…
          </p>
        )}
      </div>

      <section className="px-6 pt-4" aria-label="版本历史">
        <h2 className="text-sm font-medium">版本</h2>
        <ul>
          {revisions.map((revision) => (
            <li key={revision.version}>
              v{revision.version}
              {revision.published_at ? "" : "（构建期，未发布）"}
            </li>
          ))}
        </ul>
      </section>

      <section className="px-6 pt-4" aria-label="要求">
        <h2 className="text-sm font-medium">要求</h2>
        {detail.data ? (
          <ul>
            {(detail.data.completion_requirements as Array<Record<string, unknown>>).map((requirement) => {
              const typed = requirement as { id?: string; strength?: string; tags?: string[]; description?: string };
              return (
                <li key={typed.id}>
                  <span>{typed.id}</span> · {typed.strength === "hard" ? "硬要求" : "软要求"}
                  {typed.tags && typed.tags.length > 0 ? ` · ${typed.tags.join(", ")}` : ""}
                  {typed.description ? <p className="text-sm text-muted-foreground">{typed.description}</p> : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p role="status">加载中…</p>
        )}
      </section>

      <section className="px-6 pt-4" aria-label="只读文件">
        <h2 className="text-sm font-medium">只读文件</h2>
        {files.data && files.data.files.length > 0 ? (
          <ul>
            {files.data.files.map((file) => (
              <li key={file.rel_path}>
                {file.rel_path} · {file.size_bytes} 字节 · {file.content_hash.slice(0, 12)}…
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">该版本没有附带文件。</p>
        )}
      </section>

      <section className="px-6 py-4" aria-label="下发状态">
        <h2 className="text-sm font-medium">下发状态</h2>
        {delivery.data && delivery.data.deliveries.length > 0 ? (
          <ul>
            {delivery.data.deliveries.map((row) => (
              <li key={`${row.runtime_id}-${row.cli_provider}`}>
                {row.cli_provider} @ {row.runtime_id} · {row.state}
                {row.detail ? ` · ${row.detail}` : ""}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">尚无下发记录：激活后按机器上的 CLI 安装逐一下发。</p>
        )}
      </section>
    </main>
  );
}
