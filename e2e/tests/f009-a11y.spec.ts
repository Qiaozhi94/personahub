import { expect, test } from "@playwright/test";

// BC-048/049/050: one dialog semantic across the app — role="dialog" with an
// accessible name, focus entering on open, Tab contained, Escape closing, and
// focus returning to the trigger. BC-051/BC-125: data tables carry accessible
// names and full columnheader/cell semantics. BC-052: M1 registers no tab
// surfaces yet (task views are F011) — any future tablist must satisfy the
// shared keyboard contract before it ships.

test("BC-048/049: the create-project dialog has semantics and takes focus", async ({ page }) => {
  await page.goto("/projects");
  await expect(page.getByRole("heading", { name: "项目" })).toBeVisible();

  await page.getByRole("button", { name: "新建项目" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "true");

  // Focus enters the dialog on open (first focusable field).
  const focused = await page.evaluate(() => document.activeElement?.tagName);
  expect(["INPUT", "BUTTON", "DIALOG"]).toContain(focused);
  const focusInside = await page.evaluate(() => {
    const dialogEl = document.querySelector('[role="dialog"]');
    return dialogEl ? dialogEl.contains(document.activeElement) : false;
  });
  expect(focusInside).toBe(true);
});

test("BC-050: Escape closes the dialog and focus returns to the trigger", async ({ page }) => {
  await page.goto("/projects");
  const trigger = page.getByRole("button", { name: "新建项目" }).first();
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  const focusReturned = await page.evaluate(() => {
    const active = document.activeElement;
    return active instanceof HTMLElement && active.textContent?.includes("新建项目");
  });
  expect(focusReturned).toBe(true);
});

test("BC-051/BC-125: the legacy workflow table has full table semantics", async ({ page }) => {
  await page.goto("/settings/legacy-workflows");
  const table = page.getByRole("table", { name: "历史工作流模板" });
  await expect(table).toBeVisible();

  const headers = await table.locator('thead th').allTextContents();
  expect(headers).toEqual(["名称", "任务类型", "版本", "状态", "验证", "更新时间"]);
  for (const header of headers) {
    expect(header.trim().length).toBeGreaterThan(0);
    expect(header).not.toBe("—");
  }
  // Every body cell carries explicit content — no empty cells.
  const cellTexts = await table.locator("tbody td").allTextContents();
  for (const text of cellTexts) {
    expect(text.trim().length).toBeGreaterThan(0);
    expect(text.trim()).not.toBe("—");
  }
});

test("BC-052: no tab surface is registered in M1", async ({ page }) => {
  for (const route of ["/projects", "/tasks", "/runtime", "/settings/system-diagnostics", "/settings/legacy-workflows"]) {
    await page.goto(route);
    await page.waitForLoadState("networkidle");
    // Task views / project tabs arrive with F011 / F013; until then no
    // tablist may appear in production (deferred BC rows stay unreached).
    await expect(page.locator('[role="tablist"]')).toHaveCount(0);
  }
});
