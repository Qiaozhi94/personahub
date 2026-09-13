import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { toApiError } from "@/lib/api-client";

// F013 T008：Space 是任务列表与项目列表的可见范围；选中态存在服务端，
// 前端不自行推断"当前 Space"（design §4）。

export function useSpaces() {
  return useQuery({
    queryKey: ["spaces"],
    queryFn: () => apiClient.spaces.list(),
  });
}

export function useSelectedSpace() {
  const query = useSpaces();
  return {
    ...query,
    data: query.data ? (query.data.spaces.find((space) => space.is_selected) ?? null) : null,
  };
}

export function useCreateSpace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => {
      try {
        return await apiClient.spaces.create(name);
      } catch (error) {
        throw toApiError(error);
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["spaces"] });
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      void queryClient.invalidateQueries({ queryKey: ["issues"] });
      void queryClient.invalidateQueries({ queryKey: ["skills"] });
    },
  });
}

export function useSelectSpace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      try {
        return await apiClient.spaces.select(id);
      } catch (error) {
        throw toApiError(error);
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["spaces"] });
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      void queryClient.invalidateQueries({ queryKey: ["issues"] });
      void queryClient.invalidateQueries({ queryKey: ["skills"] });
    },
  });
}
