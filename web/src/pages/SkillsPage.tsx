import { useState } from "react";
import { useResolveConflict, useSkills, useSkillScan } from "@/hooks/use-skills";
import { useSelectedSpace } from "@/hooks/use-spaces";
import { buildUrl, useRouter } from "@/app/router";
import type { SkillListItem } from "@personahub/shared";

// F013 T018：能力面——一张 Skills 表，普通 Skill 与编组共用（带 steps 的行标为
// 编组）。两层状态分别显示"已禁用"（全局意图）与"被同名项遮蔽"/"同名冲突"
// （Space 生效结果）；conflict 必须给出可执行的下一步（resolve-conflict）。

function capabilityStateLabel(skill: SkillListItem): { label: string; tone: "ok" | "warn" | "muted" } | null {
  if (skill.state === "disabled") return { label: "已禁用", tone: "muted" };
  if (skill.space_state === "conflict") return { label: "同名冲突", tone: "warn" };
  if (skill.space_state === "shadowed") return { label: "被同名项遮蔽", tone: "muted" };
  if (skill.space_state === null) return { label: "未生效", tone: "muted" };
  return { label: "生效中", tone: "ok" };
}

function SkillRow({ skill, spaceId, onOpen }: { skill: SkillListItem; spaceId: string; onOpen: () => void }) {
  const resolve = useResolveConflict(skill.id);
  const state = capabilityStateLabel(skill);
  return (
    <tr key={skill.id} className="cursor-pointer" onClick={onOpen}>
      <td>{skill.display_name}</td>
      <td>{skill.source_kind}</td>
      <td>v{skill.current_revision}</td>
      <td>{skill.has_steps ? `编组（${skill.step_count} 步）` : "单一 Skill"}</td>
      <td>
        <span data-tone={state?.tone}>{state?.label}</span>
        {skill.space_state === "conflict" ? (
          <button
            type="button"
            className="ml-2"
            aria-label={`保留 ${skill.display_name}`}
            disabled={resolve.isPending}
            onClick={(event) => {
              event.stopPropagation();
              resolve.mutate({ spaceId, keepSkillId: skill.id });
            }}
          >
            {resolve.isPending ? "处理中…" : "保留此 Skill"}
          </button>
        ) : null}
      </td>
    </tr>
  );
}

export function SkillsPage() {
  const router = useRouter();
  const selected = useSelectedSpace();
  const skillsQuery = useSkills(selected.data?.id ?? null);
  const scan = useSkillScan();
  const [filter, setFilter] = useState("");

  const skills = skillsQuery.data?.skills ?? [];
  const visible = skills.filter((skill) => skill.display_name.toLowerCase().includes(filter.toLowerCase()));

  return (
    <main aria-label="能力">
      <div className="flex items-baseline justify-between gap-4 px-6 pt-6">
        <div>
          <h1 className="text-xl font-semibold">能力</h1>
          <p className="text-sm text-muted-foreground">
            项目与任务可复用的方法；带步骤的方法即编组。当前 Space：{selected.data?.name ?? "—"}
          </p>
        </div>
        <button type="button" onClick={() => scan.mutate()} disabled={scan.isPending} aria-label="重新扫描 Skill 来源">
          {scan.isPending ? "扫描中…" : "重新扫描"}
        </button>
      </div>

      <div className="px-6 pt-4">
        <input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="按名称筛选"
          aria-label="按名称筛选"
        />
      </div>

      <div className="px-6 py-4">
        {skillsQuery.isLoading ? (
          <p role="status">加载中…</p>
        ) : visible.length === 0 ? (
          <p role="status" className="text-sm text-muted-foreground">
            当前 Space 没有可见的 Skill。迁移产生的方法会在升级后出现；也可以重新扫描。
          </p>
        ) : (
          <table aria-label="Skills 列表">
            <thead>
              <tr>
                <th scope="col">名称</th>
                <th scope="col">来源</th>
                <th scope="col">版本</th>
                <th scope="col">编组</th>
                <th scope="col">状态</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((skill) => {
                return (
                  <SkillRow
                    key={skill.id}
                    skill={skill}
                    spaceId={selected.data!.id}
                    onOpen={() => router.navigate(buildUrl(`/capabilities/${encodeURIComponent(skill.id)}`))}
                  />
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}
