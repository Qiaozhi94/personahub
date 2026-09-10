import { expect, test } from "@playwright/test";

// BC-048/049/050: one dialog semantic across the app — role="dialog" with an
// accessible name, focus entering on open, Escape closing, focus returning to
// the trigger. The batch (BC-050) covers EVERY production dialog reachable on
// the M1 fixture: create project, create issue, intake, start graph, cancel
// run, unblock, adapter, command palette. (Reset Rounds only appears for
// round-limit blockers — not reachable on this fixture; boundary noted.)
// BC-051/BC-125: data tables carry accessible names and full columnheader/
// cell semantics. BC-052: the legacy list/detail pair is the M1's real tab
// instance and must satisfy the shared keyboard contract.

test("BC-048/049: the create-project dialog has semantics and takes focus", async ({ page }) => {
  await page.goto("/projects");
  await expect(page.getByRole("heading", { name: "项目" })).toBeVisible();

  await page.getByRole("button", { name: "新建项目" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "true");

  const focusInside = await page.evaluate(() => {
    const dialogEl = document.querySelector('[role="dialog"]');
    return dialogEl ? dialogEl.contains(document.activeElement) : false;
  });
  expect(focusInside).toBe(true);
});

test("BC-050: every production dialog closes on Escape (batch over all M1 dialogs)", async ({ page }) => {
  const openAndEscape = async (title: string): Promise<void> => {
    const dialog = page.getByRole("dialog", { name: title });
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  };

  // 1. Create project.
  await page.goto("/projects");
  await page.getByRole("button", { name: "新建项目" }).first().click();
  await openAndEscape("Create project");

  // 2. Create issue + 3. Intake.
  await page.goto("/tasks?project=prj_v02_alpha");
  await expect(page.getByRole("button", { name: /Harden parser error paths/ })).toBeVisible();
  await page.getByRole("button", { name: "新建任务" }).click();
  await openAndEscape("New coding issue");
  await page.getByRole("button", { name: "推荐创建" }).click();
  await openAndEscape("Intake");

  // 4. Command palette.
  await page.keyboard.press("ControlOrMeta+k");
  await openAndEscape("跳转");

  // 5. Start Graph (on a freshly created empty task).
  await page.getByRole("button", { name: "新建任务" }).click();
  const createDialog = page.getByRole("dialog", { name: "New coding issue" });
  await createDialog.getByLabel(/title/i).fill(`BC-050 graph dialog ${Date.now()}`);
  await createDialog.getByLabel(/goal/i).fill("dialog batch");
  await createDialog.getByRole("button", { name: /^Create$/i }).click();
  await page.waitForURL(/\/tasks\/iss_/);
  await page.getByRole("button", { name: "Start Graph" }).click();
  await openAndEscape("Start dual-review graph");

  // 6. Cancel Run confirmation.
  await page.goto("/tasks/iss_v02_graph_blocked");
  await expect(page.getByText("queued", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Cancel Run" }).first().click();
  await openAndEscape("Cancel Run");

  // 7. Unblock.
  await page.goto("/tasks/iss_v02_blocked");
  await page.getByRole("button", { name: "Resolve Blocker…" }).click();
  await openAndEscape("Resolve Blocker");

  // 8. Adapter.
  await page.goto("/runtime/adapters");
  await page.getByRole("radio", { name: "Alpha Platform" }).click();
  await page.getByRole("button", { name: "Configure adapter" }).click();
  await openAndEscape("Configure adapter");
});

test("BC-052: the legacy list/detail tabs satisfy the keyboard contract", async ({ page }) => {
  await page.goto("/settings/legacy-workflows");
  const tablist = page.getByRole("tablist", { name: "历史工作流视图" });
  await expect(tablist).toBeVisible();

  const listTab = page.getByRole("tab", { name: "模板列表" });
  const detailTab = page.getByRole("tab", { name: "模板详情" });
  await expect(listTab).toHaveAttribute("aria-selected", "true");

  // Select a template so the detail tab becomes reachable, then switch tabs
  // with the keyboard: ArrowRight, Home.
  await page.getByRole("button", { name: /Coding Workflow v1/ }).click();
  await expect(detailTab).toBeEnabled();

  await listTab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(detailTab).toHaveAttribute("aria-selected", "true");
  await expect(detailTab).toBeFocused();

  await page.keyboard.press("Home");
  await expect(listTab).toHaveAttribute("aria-selected", "true");
});

test("BC-051/BC-125: the legacy workflow table has full table semantics", async ({ page }) => {
  await page.goto("/settings/legacy-workflows");
  const table = page.getByRole("table", { name: "历史工作流模板" });
  await expect(table).toBeVisible();

  const headers = await table.locator("thead th").allTextContents();
  expect(headers).toEqual(["名称", "任务类型", "版本", "状态", "验证", "更新时间"]);
  for (const header of headers) {
    expect(header.trim().length).toBeGreaterThan(0);
    expect(header).not.toBe("—");
  }
  const cellTexts = await table.locator("tbody td").allTextContents();
  expect(cellTexts.length).toBeGreaterThan(0);
  for (const text of cellTexts) {
    expect(text.trim().length).toBeGreaterThan(0);
    expect(text.trim()).not.toBe("—");
  }
});

const A11Y_ROUTES = [
  "/projects",
  "/tasks",
  "/tasks/iss_v02_done",
  "/tasks/iss_v02_graph_blocked",
  "/runtime",
  "/runtime/adapters",
  "/settings/system-diagnostics",
  "/settings/legacy-workflows",
];

test("NFR-002: zero console errors and page errors across all M1 routes", async ({ page }) => {
  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`console: ${message.text()}`);
  });

  for (const route of A11Y_ROUTES) {
    await page.goto(route);
    await page.waitForLoadState("networkidle");
  }
  expect(problems, `console/page errors: ${problems.join(" | ")}`).toEqual([]);
});
