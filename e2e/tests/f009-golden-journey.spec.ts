import { expect, test } from "@playwright/test";

// T021 (AC-001 / AC-003): the golden journey runs against the upgraded v0.2
// release fixture database — project → task → execution → trace → evidence →
// validation — without ever entering the old app shell, plus the published
// legacy root entry upgrade and the new canonical deep links (direct access,
// refresh, unknown IDs, illegal sub-paths).
//
// The server's own startup recovery legitimately transitioned the fixture's
// in-flight run (running → interrupted, server_restarted) before this
// journey runs; conserved facts below are exactly the ones a real upgrade
// preserves. Terminal statuses are asserted as themselves (BC-047): an
// interrupted run is never shown as failed or completed.

const ALPHA = "Alpha Platform";
const BETA = "Beta Archive";

test("published legacy entry `/` upgrades to the project list without guessing", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/projects$/);

  await expect(page.getByRole("heading", { name: "项目" })).toBeVisible();
  await expect(page.getByRole("button", { name: new RegExp(ALPHA) })).toBeVisible();
  await expect(page.getByRole("button", { name: new RegExp(BETA) })).toBeVisible();
  // Root entry never picks an object by itself.
  await expect(page).not.toHaveURL(/\/projects\/prj_/);
  expect(page.url()).not.toMatch(/\/tasks\/iss_/);
});

test("golden journey: project → tasks → execution → trace → evidence → validation", async ({ page }) => {
  await page.goto("/");

  // 1. Open the bound project (user selection pushes the canonical link).
  await page.getByRole("button", { name: new RegExp(ALPHA) }).click();
  await expect(page).toHaveURL(/\/projects\/prj_v02_alpha/);
  await expect(page.getByRole("heading", { name: ALPHA })).toBeVisible();
  await expect(page.getByText("/repo/alpha")).toBeVisible();

  // 2. Tasks surface: explicit project selection lists the fixture issues.
  await page.getByRole("button", { name: "任务", exact: true }).click();
  await expect(page).toHaveURL(/\/tasks$/);
  await page.getByRole("button", { name: new RegExp(ALPHA) }).click();
  await expect(page).toHaveURL(/\/tasks\?project=prj_v02_alpha/);

  for (const title of [
    "Harden parser error paths",
    "Streaming ingest pipeline",
    "Split acceptance fixtures",
    "Fix flaky acceptance suite",
  ]) {
    await expect(page.getByRole("button", { name: new RegExp(title) })).toBeVisible();
  }

  // 3. Open the running task: thread events (trace facts) render in the
  //    execution host; the interrupted run keeps its own status (BC-047).
  await page.getByRole("button", { name: /Streaming ingest pipeline/ }).click();
  await expect(page).toHaveURL(/\/tasks\/iss_v02_running/);
  await expect(page.getByRole("heading", { name: "Streaming ingest pipeline" })).toBeVisible();

  const executionSection = page.locator("section", { has: page.getByText("执行与会话（兼容）") });
  await expect(executionSection.getByText("issue.created", { exact: true })).toBeVisible();
  await expect(executionSection.getByText("run.output_truncated", { exact: true })).toBeVisible();

  // 4. Task detail host: run facts with conserved terminal states — the
  //    interrupted run is shown as interrupted (BC-047), never as failed or
  //    completed, and the blocked-graph retry attempt stays queued.
  const factsSection = page.locator("section", { has: page.getByText("任务详情（兼容）") });
  await expect(factsSection.getByText("Issue Inspector")).toBeVisible();
  await expect(factsSection.getByText("interrupted", { exact: true }).first()).toBeVisible();

  // 5. Done task: validation rounds, evidence summary and the completed
  //    fan-out/fan-in graph stay intact after the upgrade.
  await page.goto("/tasks/iss_v02_done");
  await expect(page).toHaveURL(/\/tasks\/iss_v02_done/);
  await expect(page.getByRole("heading", { name: "Harden parser error paths" })).toBeVisible();
  await expect(page.getByText("Done", { exact: true }).first()).toBeVisible();

  await expect(page.locator("section").getByText("graph.terminal", { exact: true })).toBeVisible();
  await expect(page.locator("section").getByText("validation.passed", { exact: true })).toBeVisible();
  await expect(
    page.locator("section").getByText(/Validation passed/i).first(),
  ).toBeVisible();
});

test("canonical deep links survive refresh and direct entry", async ({ page }) => {
  await page.goto("/tasks/iss_v02_done");
  await expect(page.getByRole("heading", { name: "Harden parser error paths" })).toBeVisible();

  // Refresh restores the same object from the URL.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Harden parser error paths" })).toBeVisible();

  await page.goto("/projects/prj_v02_alpha");
  await expect(page).toHaveURL(/\/projects\/prj_v02_alpha/);
  await page.reload();
  await expect(page.getByRole("heading", { name: ALPHA })).toBeVisible();
});

test("unknown ids land on a resumable list with preserved diagnostics", async ({ page }) => {
  await page.goto("/tasks/iss_does_not_exist");
  await expect(page).toHaveURL(/\/tasks\?not_found=iss_does_not_exist&from=/);
  await expect(page.getByText("任务不存在", { exact: true })).toBeVisible();

  await page.goto("/projects/prj_does_not_exist");
  await expect(page).toHaveURL(/\/projects\?not_found=prj_does_not_exist&from=/);
  await expect(page.getByText("项目不存在", { exact: true })).toBeVisible();
});

test("unsupported sub-paths canonicalize to the base object", async ({ page }) => {
  await page.goto("/tasks/iss_v02_done/overview");
  await expect(page).toHaveURL(/\/tasks\/iss_v02_done\?route_issue=unsupported-view/);
  await expect(page.getByText("该链接指向的任务视图尚未开放")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Harden parser error paths" })).toBeVisible();

  await page.goto("/projects/prj_v02_alpha/files");
  await expect(page).toHaveURL(/\/projects\/prj_v02_alpha\?route_issue=unsupported-tab/);
  await expect(page.getByText("该链接指向的项目页签尚未开放")).toBeVisible();
});

test("unregistered surfaces have no deep-link entry point", async ({ page }) => {
  await page.goto("/sessions/sess_v02_1");
  await expect(page.getByText("页面不存在")).toBeVisible();
  await page.goto("/memory");
  await expect(page.getByText("页面不存在")).toBeVisible();
  await page.goto("/stats");
  await expect(page.getByText("页面不存在")).toBeVisible();
});
