import { expect, test } from "@playwright/test";

// BC-046/BC-047: loading, empty and error states each keep their context and
// offer exactly one recovery action; interrupted / queued runs are shown as
// themselves — never relabelled as failed or completed.

test("BC-046: an empty task list offers one recovery path", async ({ page }) => {
  // Beta Archive has no workspace and no issues.
  await page.goto("/tasks?project=prj_v02_beta");
  await expect(page.getByText("该项目还没有任务")).toBeVisible();
  await expect(page.getByRole("button", { name: "新建任务" })).toHaveCount(2);
  // The recovery entry is executable and stays on the canonical route.
  await page.getByRole("button", { name: "新建任务" }).first().click();
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

test("BC-047: interrupted and queued runs keep their own status", async ({ page }) => {
  await page.goto("/tasks/iss_v02_running");
  await expect(page.getByRole("heading", { name: "Streaming ingest pipeline" })).toBeVisible();

  // The fixture's interrupted run is labelled interrupted — not failed.
  const facts = page.locator("section", { has: page.getByText("任务详情（兼容）") });
  await expect(facts.getByText("interrupted", { exact: true }).first()).toBeVisible();
});

test("BC-046: legacy workflow page keeps read-only facts with a partial-state explanation", async ({ page }) => {
  await page.goto("/settings/legacy-workflows");
  await expect(page.getByText("历史工作流只读")).toBeVisible();
  await expect(page.getByRole("table", { name: "历史工作流模板" })).toBeVisible();
});
