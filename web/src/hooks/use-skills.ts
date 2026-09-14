import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient, toApiError } from "@/lib/api-client";

// F013 T018：能力面（Skills 列表 + 整页详情）的数据获取入口。
// 两层状态并报：skills.state（全局意图）与 skill_space_state（Space 生效结果）。

export function useSkills(spaceId: string | null) {
  return useQuery({
    queryKey: ["skills", spaceId],
    queryFn: () => apiClient.skills.list(spaceId ?? undefined),
    enabled: spaceId !== null,
  });
}

export function useSkill(skillId: string | null) {
  return useQuery({
    queryKey: ["skills", skillId],
    queryFn: () => apiClient.skills.get(skillId!),
    enabled: skillId !== null,
  });
}

export function useSkillRevisions(skillId: string | null) {
  return useQuery({
    queryKey: ["skills", skillId, "revisions"],
    queryFn: () => apiClient.skills.revisions(skillId!),
    enabled: skillId !== null,
  });
}

export function useSkillDetail(skillId: string | null, version: number | null) {
  return useQuery({
    queryKey: ["skills", skillId, "revision", version],
    queryFn: () => apiClient.skills.revisionDetail(skillId!, version!),
    enabled: skillId !== null && version !== null,
  });
}

export function useSkillFiles(skillId: string | null, version: number | null) {
  return useQuery({
    queryKey: ["skills", skillId, "revision", version, "files"],
    queryFn: () => apiClient.skills.files(skillId!, version!),
    enabled: skillId !== null && version !== null,
  });
}

export function useSkillDelivery(skillId: string | null, version: number | null) {
  return useQuery({
    queryKey: ["skills", skillId, "revision", version, "delivery"],
    queryFn: () => apiClient.skills.delivery(skillId!, version!),
    enabled: skillId !== null && version !== null,
  });
}

export function useSkillScan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      try {
        return await apiClient.skills.scan();
      } catch (error) {
        throw toApiError(error);
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["skills"] });
    },
  });
}

export function useResolveConflict(skillId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { spaceId: string; keepSkillId: string }) => {
      try {
        return await apiClient.skills.resolveConflict(skillId, input.spaceId, input.keepSkillId);
      } catch (error) {
        throw toApiError(error);
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["skills"] });
    },
  });
}

export function useDisableSkill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (skillId: string) => {
      try {
        return await apiClient.skills.disable(skillId);
      } catch (error) {
        throw toApiError(error);
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["skills"] });
    },
  });
}

export function useProjectSkillRefs(projectId: string) {
  return useQuery({
    queryKey: ["projects", projectId, "skillRefs"],
    queryFn: () => apiClient.skills.listProjectRefs(projectId),
  });
}

export function useSetProjectDefaultSkill(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { skillId: string; pinnedVersion?: number | null }) => {
      try {
        return await apiClient.skills.setProjectDefault(projectId, input.skillId, input.pinnedVersion ?? null);
      } catch (error) {
        throw toApiError(error);
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["projects", projectId, "skillRefs"] });
    },
  });
}

export function useProjectRepositories(projectId: string) {
  return useQuery({
    queryKey: ["projects", projectId, "repositories"],
    queryFn: () => apiClient.repositories.listByProject(projectId),
  });
}
