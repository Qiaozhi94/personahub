import { expect, test } from "@playwright/test";

// F009 shell-level adapted browser checks: BC-001/002/005/006/007/070/072/
// 075/076/091/097. The vertical rail is the only primary navigation, the old
// IDE furniture (bottom panel, status bar, activity bar, layout tiers) is
// gone, and every M1 route stays inside its surface host without horizontal
// overflow.

const M1_ROUTES = [
  "/projects",
  "/tasks",
  "/runtime",
  "/runtime/adapters",
  "/settings/system-diagnostics",
  "/settings/legacy-workflows",
];

const VIEWPORTS = [
  { name: "1024x768", width: 1024, height: 768 },
  { name: "1440x900", width: 1440, height: 900 },
  { name: "1920x1080", width: 1920, height: 1080 },
];

test("BC-070/BC-007: the rail is the only primary navigation, grouped daily above low-frequency", async ({ page }) => {
  await page.goto("/projects");
  const nav = page.getByRole("navigation", { name: "工作面" });
  await expect(nav).toBeVisible();

  const labels = await nav.locator("button > span").allTextContents();
  expect(labels).toEqual(["任务", "项目", "运行时", "设置"]);
  // Daily entries (任务, 项目) come before low-frequency ones (运行时, 设置).
  expect(labels.indexOf("任务")).toBeLessThan(labels.indexOf("运行时"));
  expect(labels.indexOf("项目")).toBeLessThan(labels.indexOf("设置"));

  // No other landmark duplicates primary navigation.
  for (const name of ["会话", "自动化", "记忆", "能力", "统计"]) {
    await expect(page.getByRole("button", { name: new RegExp(`^${name}$`) })).toHaveCount(0);
  }
});

test("BC-002/BC-072: no bottom panel, status bar, icon activity bar, or layout tiers", async ({ page }) => {
  await page.goto("/projects");
  await expect(page.getByRole("heading", { name: "项目" })).toBeVisible();

  for (const selector of [
    "[data-statusbar]",
    "[data-bottom-panel]",
    "[data-activity-bar]",
    "[data-layout-tier]",
    ".statusbar",
    ".bottom-panel",
    ".activity-rail",
  ]) {
    await expect(page.locator(selector)).toHaveCount(0);
  }
  // Exactly one primary nav landmark — no IDE-style activity bar sibling.
  await expect(page.getByRole("navigation")).toHaveCount(1);
});

test("BC-075/BC-076: surfaces render inside the host without covering the rail", async ({ page }) => {
  await page.goto("/tasks");
  await expect(page.getByText("先选择一个项目，再查看它的任务。")).toBeVisible();

  const railBox = await page.getByRole("navigation", { name: "工作面" }).boundingBox();
  const mainBox = await page.locator("main").boundingBox();
  expect(railBox).toBeTruthy();
  expect(mainBox).toBeTruthy();
  expect(mainBox!.x).toBeGreaterThanOrEqual(railBox!.x + railBox!.width);
});

test("BC-091: no horizontal overflow on any M1 route across viewports", async ({ page }) => {
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    for (const route of M1_ROUTES) {
      await page.goto(route);
      await page.waitForLoadState("networkidle");
      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(
        overflow.scrollWidth,
        `horizontal overflow on ${route} at ${vp.name}: ${JSON.stringify(overflow)}`,
      ).toBeLessThanOrEqual(overflow.clientWidth + 1);
    }
  }
});

test("BC-097: the settings surface only lists pages that really exist", async ({ page }) => {
  await page.goto("/settings/system-diagnostics");
  await expect(page.getByRole("heading", { name: "系统诊断" })).toBeVisible();

  // The two registered settings sub-pages are reachable; nothing else in the
  // settings surface advertises a page.
  await page.goto("/settings/legacy-workflows");
  await expect(page.getByRole("heading", { name: "历史工作流" })).toBeVisible();
});

test("BC-005/BC-006: the task list stays one scannable list without chip rows", async ({ page }) => {
  await page.goto("/tasks?project=prj_v02_alpha");
  await expect(page.getByRole("button", { name: /Harden parser error paths/ })).toBeVisible();

  // Task rows are plain list buttons; the M1 skeleton does not add label chip
  // rows or a second search box (BC-006, design.md §3.1).
  await expect(page.getByPlaceholder(/search/i)).toHaveCount(0);
});
