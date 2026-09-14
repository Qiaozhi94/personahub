import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";

// F012 T015 (§6.3): machine overview strip + the "暂停全部派工" runtime gate.
// The machine projection is the read model owned by RuntimeProjectionService;
// the gate row is dispatch_gates('runtime','local') — pausing blocks NEW
// dispatches only and never touches a running Attempt (PRD §5.10).

export function RuntimeMachineSection() {
  const qc = useQueryClient();
  const machine = useQuery({
    queryKey: ["f012", "runtime", "local"],
    queryFn: () => apiClient.f012.runtimeMachine("local"),
  });
  const setGate = useMutation({
    mutationFn: (paused: boolean) =>
      apiClient.f012.setGate("runtime", "local", { state: paused ? "paused" : "open", reason: paused ? "用户暂停全部派工" : null }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["f012", "runtime", "local"] });
    },
  });

  if (machine.isLoading) {
    return <p className="text-sm text-muted-foreground">读取机器概览…</p>;
  }
  if (machine.isError || !machine.data) {
    return <p className="text-sm text-muted-foreground">机器概览不可用（需要 F012 runtime 投影）。</p>;
  }

  const snapshot = machine.data;
  const gate = snapshot.runtime_gate;

  return (
    <section aria-label="机器概览" className="grid gap-3 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm">
          <span className="font-medium">{snapshot.machine.label}</span>
          <span className="ml-2 text-muted-foreground">
            {snapshot.adapters.length} adapter · 队列 {snapshot.queue.queued_count} · 运行中{" "}
            {snapshot.queue.running_run_ids.length} · 锁 {snapshot.workspace_locks.length}
          </span>
          {snapshot.background.outbox.poison > 0 ? (
            <span className="ml-2 text-destructive">投递死信 {snapshot.background.outbox.poison}</span>
          ) : null}
        </div>
        {gate.state === "paused" ? (
          <button
            type="button"
            className="rounded-md border border-emerald-600/50 px-3 py-1.5 text-sm text-emerald-700 hover:bg-accent"
            onClick={() => setGate.mutate(false)}
            disabled={setGate.isPending}
          >
            恢复派工（闸门已暂停 · rev {gate.revision}）
          </button>
        ) : (
          <button
            type="button"
            className="rounded-md border border-amber-600/50 px-3 py-1.5 text-sm text-amber-700 hover:bg-accent"
            onClick={() => setGate.mutate(true)}
            disabled={setGate.isPending}
          >
            暂停全部派工
          </button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        暂停只阻止新派工——运行中的 Attempt 继续执行；重启后暂停意图保留。额度事实按 ADR 0017 缺失显示为 “—”，不用 0 冒充。
      </p>
    </section>
  );
}
