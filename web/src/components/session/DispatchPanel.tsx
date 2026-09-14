import { useEffect, useMemo, useState } from "react";
import type { Dispatch, EligibilityResponse } from "@personahub/shared";
import { Button } from "@/components/ui/button";
import {
  useActiveDispatch,
  useCancelAttempt,
  useCancelDispatch,
  useConfirmDispatch,
  useEligibility,
  useStartNow,
} from "@/hooks/use-f012";

// F012 T015: the dispatch picker + undo countdown banner (design §6.2).
// Model / depth / context scope are chosen separately — never merged into a
// preset. Blocked combos stay visible with their reasons (置灰但可见); after
// confirm, the undo banner offers 撤销 / 立即开始 until the draft enters
// starting, where only 取消 Attempt remains (§5.1 starting 不再接受撤销).

export interface DispatchPanelProps {
  sessionId: string;
  purpose: "execute" | "validate" | "design_cases";
  onDispatched?: (dispatch: Dispatch) => void;
}

const PURPOSES: Array<{ value: DispatchPanelProps["purpose"]; label: string }> = [
  { value: "execute", label: "执行" },
  { value: "validate", label: "验证" },
  { value: "design_cases", label: "设计验收用例" },
];

export function DispatchPanel({ sessionId, purpose, onDispatched }: DispatchPanelProps) {
  const [contextScope, setContextScope] = useState<"all" | "result_only" | "goal_only">("all");
  const [depth, setDepth] = useState<"high" | "medium" | "low">("high");
  const [selected, setSelected] = useState<string | null>(null);
  const eligibility = useEligibility(sessionId, purpose, contextScope, true);
  const confirmDispatch = useConfirmDispatch(sessionId);

  const candidates = useMemo(() => eligibility.data?.candidates ?? [], [eligibility.data]);
  const selectableCandidates = useMemo(
    () => candidates.filter((c) => c.tier !== "blocked" && c.identity.depth_normalized === depth),
    [candidates, depth],
  );
  const blockedCandidates = useMemo(
    () => candidates.filter((c) => c.tier === "blocked"),
    [candidates],
  );

  function confirm() {
    const candidate = selectableCandidates.find((c) => c.identity.adapter_config_id === selected) ?? selectableCandidates[0];
    if (!candidate) return;
    confirmDispatch.mutate(
      {
        body: {
          room_id: sessionId,
          purpose,
          adapter_config_id: candidate.identity.adapter_config_id,
          model: candidate.identity.model,
          depth_raw: candidate.identity.depth_raw,
          depth_normalized: candidate.identity.depth_normalized,
          context_scope: contextScope,
        },
        idempotencyKey: `crq_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      },
      { onSuccess: (data) => onDispatched?.(data.dispatch) },
    );
  }

  return (
    <section aria-label="派工" className="grid gap-2 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-1">
          用途
          <select
            aria-label="派工用途"
            value={purpose}
            onChange={() => undefined}
            className="rounded border border-input bg-background px-2 py-1"
          >
            {PURPOSES.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1">
          上下文范围
          <select
            aria-label="上下文范围"
            value={contextScope}
            onChange={(e) => setContextScope(e.target.value as typeof contextScope)}
            className="rounded border border-input bg-background px-2 py-1"
          >
            <option value="all">全部</option>
            <option value="result_only">只给结果</option>
            <option value="goal_only">只给目标</option>
          </select>
        </label>
        <label className="flex items-center gap-1">
          思考深度
          <select
            aria-label="思考深度"
            value={depth}
            onChange={(e) => setDepth(e.target.value as typeof depth)}
            className="rounded border border-input bg-background px-2 py-1"
          >
            <option value="high">high</option>
            <option value="medium">medium</option>
            <option value="low">low</option>
          </select>
        </label>
        <Button type="button" size="sm" disabled={selectableCandidates.length === 0 || confirmDispatch.isPending} onClick={confirm}>
          确认派工
        </Button>
      </div>

      {selectableCandidates.length > 0 ? (
        <ul className="grid gap-1 text-xs">
          {selectableCandidates.map((candidate) => {
            const key = `${candidate.identity.adapter_config_id}/${candidate.identity.model}`;
            return (
              <li key={key}>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="dispatch-candidate"
                    checked={selected === candidate.identity.adapter_config_id}
                    onChange={() => setSelected(candidate.identity.adapter_config_id)}
                  />
                  <span className="font-mono">
                    {candidate.identity.model}/{candidate.identity.depth_normalized}
                  </span>
                  <span className={candidate.tier === "recommended" ? "text-emerald-600" : "text-amber-600"}>
                    {candidate.tier === "recommended" ? "推荐" : "可选"}
                  </span>
                  <span className="text-muted-foreground">{candidate.reasons.map((r) => r.code).join(", ")}</span>
                </label>
              </li>
            );
          })}
        </ul>
      ) : null}

      {blockedCandidates.length > 0 ? (
        <ul className="grid gap-1 text-xs text-muted-foreground" aria-label="不可选组合">
          {blockedCandidates.slice(0, 6).map((candidate) => (
            <li key={`${candidate.identity.adapter_config_id}/${candidate.identity.model}`}>
              <span className="line-through">{candidate.identity.model}</span>
              {candidate.reasons.map((reason) => (
                <span key={reason.code} className="ml-2">
                  {reason.code}: {reason.consequence}
                </span>
              ))}
            </li>
          ))}
        </ul>
      ) : null}

      {eligibility.isError ? <p className="text-xs text-destructive">无法获取 eligibility：{(eligibility.error as Error).message}</p> : null}
    </section>
  );
}

export interface UndoBannerProps {
  sessionId: string;
  dispatch: Dispatch;
  onGone?: () => void;
}

/** 撤销倒计时横幅（§6.2）: draft → 撤销 / 立即开始; starting → 只留取消 Attempt;
 *  dispatched → 显示执行组合并允许取消 Attempt。 */
export function UndoBanner({ sessionId, dispatch, onGone }: UndoBannerProps) {
  const cancelDispatch = useCancelDispatch(sessionId);
  const startNow = useStartNow(sessionId);
  const cancelAttempt = useCancelAttempt(sessionId);
  const active = useActiveDispatch(sessionId, dispatch.id);
  const current = active.data?.dispatch ?? dispatch;
  const [remainingMs, setRemainingMs] = useState(() => Math.max(0, Date.parse(current.grace_deadline_at) - Date.now()));

  useEffect(() => {
    if (current.state !== "draft") return;
    const timer = setInterval(() => {
      setRemainingMs(Math.max(0, Date.parse(current.grace_deadline_at) - Date.now()));
    }, 250);
    return () => clearInterval(timer);
  }, [current.state, current.grace_deadline_at]);

  const firstAttempt = active.data?.attempts?.[0];

  if (current.state === "cancelled" || current.state === "start_failed") {
    return (
      <div role="status" className="rounded-md border border-border bg-muted/30 p-3 text-sm">
        {current.state === "cancelled" ? "已撤销——窗口内取消不产生任何执行记录。" : `启动失败：${current.failed_reason_code ?? "未知原因"}`}
        <Button variant="outline" size="sm" className="ml-3" onClick={onGone}>
          关闭
        </Button>
      </div>
    );
  }

  if (current.state === "dispatched") {
    return (
      <div role="status" className="rounded-md border border-border bg-muted/30 p-3 text-sm">
        已指派（{current.model}/{current.depth_normalized}）——starting 后撤销入口已消失，只能取消当前 Attempt。
        {firstAttempt && (firstAttempt.state === "queued" || firstAttempt.state === "running") ? (
          <Button
            variant="destructive"
            size="sm"
            className="ml-3"
            onClick={() => cancelAttempt.mutate(firstAttempt.id, { onSuccess: onGone })}
          >
            取消 Attempt
          </Button>
        ) : null}
      </div>
    );
  }

  if (current.state === "starting") {
    return (
      <div role="status" className="rounded-md border border-border bg-muted/30 p-3 text-sm">
        启动中——组装上下文并等待首个 Attempt…
      </div>
    );
  }

  return (
    <div role="status" className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
      撤销窗口 {Math.ceil(remainingMs / 1000)}s——窗口结束后自动开始执行。
      <Button
        variant="outline"
        size="sm"
        className="ml-3"
        disabled={cancelDispatch.isPending}
        onClick={() => cancelDispatch.mutate(current.id, { onSuccess: onGone })}
      >
        撤销
      </Button>
      <Button size="sm" className="ml-2" disabled={startNow.isPending} onClick={() => startNow.mutate(current.id, { onSuccess: onGone })}>
        立即开始
      </Button>
    </div>
  );
}

export type { EligibilityResponse };
