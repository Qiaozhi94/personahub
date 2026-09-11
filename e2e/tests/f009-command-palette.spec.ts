import { expect, test } from "@playwright/test";

// BC-030: the command palette opens with the trigger or Ctrl/Cmd+K, lists
// only registered targets with real data, supports full keyboard operation,
// and closes with Escape returning focus.

test("opens with Ctrl+K, filters with real data, and navigates with Enter", async ({ page }) => {
  await page.goto("/projects");
  await expect(page.getByRole("heading", { name: "项目" })).toBeVisible();

  await page.keyboard.press("ControlOrMeta+k");
  const dialog = page.getByRole("dialog", { name: "跳转" });
  await expect(dialog).toBeVisible();

  const input = page.getByRole("combobox", { name: "跳转目标" });
  await expect(input).toBeFocused();

  // Fixture data appears; unregistered surfaces do not.
  await expect(page.getByRole("option", { name: /Alpha Platform/ })).toBeVisible();
  await expect(page.getByRole("option", { name: /会话/ })).toHaveCount(0);

  await input.fill("Beta");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/projects\/prj_v02_beta/);
  await expect(page.getByRole("dialog", { name: "跳转" })).toHaveCount(0);
});

test("supports arrow keys and closes on Escape without navigating", async ({ page }) => {
  await page.goto("/projects");
  await page.getByRole("button", { name: /跳转/ }).click();
  const dialog = page.getByRole("dialog", { name: "跳转" });
  await expect(dialog).toBeVisible();

  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("option").nth(1)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Home");
  await expect(page.getByRole("option").nth(0)).toHaveAttribute("aria-selected", "true");

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/\/projects$/);
});
