import { expect, test } from "@playwright/test";

// BC-046/BC-047: loading, empty and error states each keep their context and
// offer exactly one recovery action; interrupted / queued runs are shown as
// themselves — never relabelled as failed or completed.

test("BC-046: an empty task list offers one recovery path", async ({ page }) => {
  // Beta Archive has no workspace and no issues.
  await page.goto("/tasks?project=prj_v02_beta");
  await expect(page.getByText("该项目还没有任务")).toBeVisible();
  // R1-007: exactly one executable recovery action.
  await expect(page.getByRole("button", { name: "新建任务" })).toHaveCount(1);
  await page.getByRole("button", { name: "新建任务" }).click();
  await expect(page.getByRole("dialog", { name: "New coding issue" })).toBeVisible();
  await page.keyboard.press("Escape");
});

test("BC-046: an unknown project keeps its diagnostics and one recovery action", async ({ page }) => {
  await page.goto("/tasks?project=prj_missing");
  await expect(page.getByText("项目不存在", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "重新选择项目" }).click();
  await expect(page).toHaveURL(/\/tasks$/);
});

test("BC-046: not-found surfaces offer exactly one recovery action", async ({ page }) => {
  await page.goto("/memory");
  await expect(page.getByText("页面不存在", { exact: true })).toBeVisible();
  const buttons = page.getByRole("button");
  await expect(buttons.filter({ hasText: "回到项目列表" })).toHaveCount(1);
  await page.getByRole("button", { name: "回到项目列表" }).click();
  await expect(page).toHaveURL(/\/projects$/);
});

test("BC-047: terminal run states keep their own status, never relabelled", async ({ page }) => {
  // iss_v02_blocked's failed validator run (output_parse_failed) is conserved
  // by every journey step — its failure reason stays readable and distinct.
  await page.goto("/tasks/iss_v02_blocked");
  await expect(page.getByRole("heading", { name: "Fix flaky acceptance suite" })).toBeVisible();
  const facts = page.locator("section", { has: page.getByText("任务详情（兼容）") });
  await expect(facts.getByText("Failed to parse adapter output")).toBeVisible();

  // The graph retry attempt stays queued or cancelled (per journey order) —
  // never silently shown as failed or completed.
  await page.goto("/tasks/iss_v02_graph_blocked");
  const graphTask = page.locator("section", { has: page.getByText("执行与会话（兼容）") });
  await expect(graphTask.getByText(/^(queued|cancelled)$/).first()).toBeVisible();
});

test("BC-046: legacy workflow page keeps read-only facts with a partial-state explanation", async ({ page }) => {
  await page.goto("/settings/legacy-workflows");
  await expect(page.getByText("历史工作流只读")).toBeVisible();
  await expect(page.getByRole("table", { name: "历史工作流模板" })).toBeVisible();
});
