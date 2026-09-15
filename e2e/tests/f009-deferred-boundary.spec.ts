import { expect, test } from "@playwright/test";

// T031 residual, batch 2 (docs/reviews/journey-test-matrix.md §5.1 /
// tools/check-v03-plan-contracts.test.mjs::F009-CODE-DEFERRED-INVENTORY):
// 21 of the 32 deferred browser checks left after the nav-absence/route-
// unreachability gates are sub-elements of pages F009 already registers as
// *enabled* (ThreadView's composer, /runtime, /runtime/adapters, a project's
// workspace binding, the create-task dialog) — not whole missing routes, so
// they need their own per-page absence assertions instead of a route check.
// The remaining 11 of the 32 are data-model/business-rule/cross-feature
// claims with no discrete UI element to assert absent (see the classifier's
// NOT_APPLICABLE bucket) and are out of scope for this file.

test("BC-027/028/040/058: the task-page composer is retired; the session face owns composition controls", async ({
  page,
}) => {
  await page.goto("/tasks?project=prj_v02_alpha");
  await page.getByRole("button", { name: /Streaming ingest pipeline/ }).click();
  await expect(page).toHaveURL(/\/tasks\/iss_v02_running/);

  // A009: the compat host is read-only now — no instruction composer exists on
  // the task page, so the deferred checks (no model/depth selector, no
  // context-scope selector, no eligibility explainer, no undo window in it)
  // hold vacuously there.
  await expect(page.getByPlaceholder("Enter agent instructions…")).toHaveCount(0);
  await expect(page.getByText(/undo|revoke|撤销/i)).toHaveCount(0);

  // Those controls now live on the session face (F012 §6.2): depth/context
  // selectors, the eligibility disclosure list and the undo window.
  await page.getByRole("button", { name: "打开会话" }).click();
  await page.waitForURL(/\/sessions\//);
  const panel = page.getByRole("region", { name: "派工" });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("combobox", { name: "思考深度" })).toBeVisible();
  await expect(panel.getByRole("combobox", { name: "上下文范围" })).toBeVisible();
  await expect(panel.getByRole("list", { name: "不可选组合" })).toBeVisible();
});

test("BC-033: creating a task has no issue-type selector — coding is the only shape produced", async ({ page }) => {
  await page.goto("/tasks?project=prj_v02_alpha");
  await page.getByRole("button", { name: "新建任务" }).click();
  const dialog = page.getByRole("dialog", { name: "New coding issue" });
  await expect(dialog).toBeVisible();

  await expect(dialog.getByLabel(/issue type|task type|任务类型/i)).toHaveCount(0);
  await expect(dialog.getByRole("combobox", { name: /type/i })).toHaveCount(0);
});

test("BC-054/082/087/088/090/101/116: /runtime has no pause-all, quota, machine-rail, capability-matrix, log-export, machine-health, or per-task controls", async ({
  page,
}) => {
  await page.goto("/runtime");
  // A028: the single runtime read model is the F012 machine projection — the
  // legacy project-scoped health panel was removed with T025.
  await expect(page.getByRole("region", { name: "机器概览" })).toBeVisible();

  // BC-054: F012 (design §6.3 / §9.1.4) now OWNS the pause-all runtime gate —
  // the F009 deferral is released; the control exists and carries a recovery
  // entry when engaged. What must still NOT exist is a quota CONFIGURATION
  // control (facts display is F012's; aggregation stays v0.4, ADR 0017).
  await expect(page.getByRole("button", { name: /暂停全部派工|恢复派工/ })).toHaveCount(1);
  await expect(page.getByRole("button", { name: /quota config|配置额度/i })).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: /quota|额度/i })).toHaveCount(0);
  // BC-087: no dedicated machine left-rail or adapter-tabs-with-overview layout.
  await expect(page.getByRole("navigation", { name: /machine|机器/i })).toHaveCount(0);
  await expect(page.getByRole("tab")).toHaveCount(0);
  // BC-088: adapter capability shown as inline tags (already asserted
  // elsewhere), not a standalone capability matrix.
  await expect(page.getByRole("table", { name: /capabilit/i })).toHaveCount(0);
  // BC-090: log export lives only on /settings/system-diagnostics.
  await expect(page.getByRole("button", { name: /export log|日志导出/i })).toHaveCount(0);
  // BC-101: no machine-level health indicator distinct from per-adapter status.
  await expect(page.getByText(/machine health|机器健康|机器点灯/i)).toHaveCount(0);
  // BC-116: runtime is read-only inventory — no controls scoped to one task/issue.
  await expect(page.getByRole("button", { name: /cancel run|retry|resolve blocker/i })).toHaveCount(0);
});

test("BC-108/109: adapter configuration has no dedicated four-block detail page", async ({ page }) => {
  await page.goto("/runtime/adapters");
  await page.getByRole("radio", { name: "Alpha Platform" }).click();

  // Clicking an adapter's name opens the compat config dialog (a flat form),
  // not a navigation to a separate detail route.
  await page.getByRole("button", { name: "Codex (alpha implementation)" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(/\/runtime\/adapters$/);
  // No four fixed-order block headings a detail page would have.
  for (const heading of [/^overview$/i, /^identity$/i, /^capabilities$/i, /^history$/i]) {
    await expect(dialog.getByRole("heading", { name: heading })).toHaveCount(0);
  }
});

test("BC-102/107/112 (F013 supersede): files/skills tabs now carry repo refs and the primary/reference distinction", async ({
  page,
}) => {
  // F013 registers the files/skills/settings tabs and the repository registry;
  // the Skills reference (BC-107) and the primary-vs-reference distinction
  // (BC-112) are no longer deferred. BC-102's deferred machine affordance is
  // superseded by F013's files-tab machine-scope editors (R1-013) — the old
  // bind-workspace dialog stays out of the project page.
  await page.goto("/projects/prj_v02_alpha/files");
  await expect(page.getByRole("heading", { name: "Alpha Platform" })).toBeVisible();

  await expect(page.getByRole("button", { name: "Skills" })).toBeVisible();
  await expect(page.getByText(/主目录 ·/).first()).toBeVisible();
  await expect(page.getByText(/参考仓库 ·/).first()).toBeVisible();

  // BC-102: machine scope is editable inline; the old bind-workspace affordance is gone.
  await expect(page.getByLabel(/机器范围 read/).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /bind workspace/i })).toHaveCount(0);
});
