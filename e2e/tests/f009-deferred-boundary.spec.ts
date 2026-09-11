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

test("BC-027/028/040/058: the composer has no execution-composition, context-scope, eligibility-explanation, or undo-window controls", async ({
  page,
}) => {
  await page.goto("/tasks?project=prj_v02_alpha");
  await page.getByRole("button", { name: /Streaming ingest pipeline/ }).click();
  await expect(page).toHaveURL(/\/tasks\/iss_v02_running/);

  const composer = page.getByPlaceholder("Enter agent instructions…");
  await composer.waitFor({ state: "visible" });
  const form = composer.locator("xpath=ancestor::form");

  // BC-027: no model / thinking-depth selector.
  await expect(form.getByLabel(/model/i)).toHaveCount(0);
  await expect(form.getByText(/thinking depth|reasoning effort/i)).toHaveCount(0);
  // BC-028: no context-scope selector or same-origin-independence prompt.
  await expect(form.getByLabel(/context scope/i)).toHaveCount(0);
  await expect(form.getByText(/same-origin|独立性/i)).toHaveCount(0);
  // BC-040: the agent selector shows a routing preview label, but no
  // eligibility-rationale explainer (hard rule vs override).
  await expect(form.getByRole("button", { name: /why|explain|原因/i })).toHaveCount(0);
  await expect(form.getByText(/hard rule|override|硬规则|覆盖项/i)).toHaveCount(0);
  // BC-058: no undo/revocation window after dispatch.
  await expect(page.getByText(/undo|revoke|撤销/i)).toHaveCount(0);
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
  await page.getByRole("radio", { name: "Alpha Platform" }).click();
  await page.getByTestId("runtime-health-panel").waitFor({ state: "visible" });

  // BC-054: no "pause all dispatch" control.
  await expect(page.getByRole("button", { name: /pause all|暂停全部/i })).toHaveCount(0);
  // BC-082: no quota configuration.
  await expect(page.getByText(/quota|额度/i)).toHaveCount(0);
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

test("BC-102/107/112: a project's workspace binding has no remote-repo recognition, Skills reference, or primary/reference repo distinction", async ({
  page,
}) => {
  await page.goto("/projects/prj_v02_alpha");
  await expect(page.getByRole("heading", { name: "Alpha Platform" })).toBeVisible();

  // BC-102: no remote/machine-authorization affordance — just a raw local path.
  await expect(page.getByText(/remote repository|远端仓库/i)).toHaveCount(0);
  await expect(page.getByLabel(/machine|机器授权/i)).toHaveCount(0);
  // BC-107: no direct Skills reference on the project page.
  await expect(page.getByText(/skills|技能/i)).toHaveCount(0);
  // BC-112: no primary-vs-reference repository distinction.
  await expect(page.getByText(/primary repo|reference repo|主仓|参考仓/i)).toHaveCount(0);
});
