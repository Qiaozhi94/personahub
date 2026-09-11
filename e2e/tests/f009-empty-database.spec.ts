import { expect, test } from "@playwright/test";

// T031 residual "干净数据库首屏" (docs/reviews/journey-test-matrix.md §5.1):
// review R1-011/R1-006 flagged this as a manual-only gap because the shared
// v0.2 fixture (every other F009 e2e spec) is never actually empty. Runs
// under playwright.empty-db.config.ts against a fresh database the real
// server creates and migrates itself on boot — only the schema-baked
// baseline rows exist (wft_coding_default/vpl_coding_default), every
// projects/issues/workspaces table starts at zero rows. This does not
// replace human judgment of whether the copy reads well (that's still a
// genuinely subjective call), only proves the right empty-state component
// and its one recovery action actually render instead of a blank/broken
// page when there is truly nothing in the database yet.

test("clean database: / and /projects show the zero-projects empty state with one recovery action", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(`console: ${message.text()}`);
  });

  await page.goto("/");
  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByRole("heading", { name: "项目" })).toBeVisible();

  await expect(page.getByText("还没有项目")).toBeVisible();
  await expect(page.getByText("创建第一个项目，绑定代码目录后即可开始派工。")).toBeVisible();
  const action = page.getByRole("button", { name: "新建项目" });
  await expect(action).toBeVisible();

  // The recovery action is real, not decorative: it opens the actual
  // create-project dialog, not a dead end.
  await action.click();
  await expect(page.getByRole("dialog")).toBeVisible();

  expect(consoleErrors).toEqual([]);
});

test("clean database: /tasks guides to the projects page instead of an empty list or blank screen", async ({
  page,
}) => {
  await page.goto("/tasks");
  await expect(page.getByRole("heading", { name: "任务" })).toBeVisible();
  await expect(page.getByText("先选择一个项目，再查看它的任务。")).toBeVisible();

  await expect(page.getByText("还没有项目")).toBeVisible();
  await expect(page.getByText("在项目页创建项目后，即可在这里查看任务。")).toBeVisible();
  const action = page.getByRole("button", { name: "前往项目页" });
  await expect(action).toBeVisible();

  await action.click();
  await expect(page).toHaveURL(/\/projects$/);
});

test("clean database: /runtime's project picker guides to the projects page (shared by /runtime, /runtime/adapters, /settings/system-diagnostics)", async ({
  page,
}) => {
  await page.goto("/runtime");
  await expect(page.getByText("还没有项目")).toBeVisible();
  await expect(page.getByText("先创建项目，这里才会出现可执行资源。")).toBeVisible();
  const action = page.getByRole("button", { name: "前往项目页" });
  await expect(action).toBeVisible();

  await action.click();
  await expect(page).toHaveURL(/\/projects$/);
});

test("clean database: /settings/legacy-workflows shows only the schema-baked baseline template, not a broken empty table", async ({
  page,
}) => {
  // wft_coding_default is created by the schema migration itself (schema-v1.ts),
  // independent of any seed — a genuinely empty database still has exactly
  // this one active template, never zero.
  await page.goto("/settings/legacy-workflows");
  await expect(page.getByRole("heading", { name: "历史工作流" })).toBeVisible();
  await expect(page.getByRole("table")).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "Coding Workflow" })).toHaveCount(1);
});
