import { useProjectSkillRefs, useSkills, useSetProjectDefaultSkill } from "@/hooks/use-skills";
import { useSelectedSpace } from "@/hooks/use-spaces";
import { buildUrl, useRouter } from "@/app/router";

// F013 T017（Skills tab）：项目默认 Skill 引用与只读下钻。项目只保存引用
// （FR-007），不复制内容；修改 Skill 不会在项目侧产生副本。

export function ProjectSkillsTab({ projectId }: { projectId: string }) {
  const router = useRouter();
  const refsQuery = useProjectSkillRefs(projectId);
  const selected = useSelectedSpace();
  const skillsQuery = useSkills(selected.data?.id ?? null);
  const setDefault = useSetProjectDefaultSkill(projectId);

  const refs = refsQuery.data?.refs ?? [];
  const defaultRef = refs.find((ref) => ref.is_default);
  const allSkills = skillsQuery.data?.skills ?? [];

  return (
    <div>
      <p className="text-sm text-muted-foreground">
        {defaultRef
          ? `默认 Skill：${defaultRef.skill_id}${defaultRef.pinned_version ? `（固定 v${defaultRef.pinned_version}）` : "（跟随最新版本）"}`
          : "尚未选择默认 Skill。"}
      </p>

      <label className="mt-3 block text-sm" htmlFor="f013-default-skill">
        选择默认 Skill（只保存引用）
      </label>
      <select
        id="f013-default-skill"
        aria-label="选择默认 Skill"
        value={defaultRef?.skill_id ?? ""}
        onChange={(event) => {
          const value = event.target.value;
          setDefault.mutate({ skillId: value === "" ? null : value });
        }}
      >
        <option value="">—</option>
        {allSkills
          .filter((skill) => skill.state === "active" && skill.space_state === "active")
          .map((skill) => (
            <option key={skill.id} value={skill.id}>
              {skill.display_name}（v{skill.current_revision}）
            </option>
          ))}
      </select>

      <button
        type="button"
        className="mt-3"
        onClick={() => router.navigate(buildUrl("/capabilities"))}
        aria-label="前往能力面"
      >
        在能力面查看全部 Skill
      </button>
    </div>
  );
}
