import type { Page } from "@playwright/test";

/**
 * The app auto-selects `projects[0]` (oldest project) on load. Since this
 * suite seeds a fresh Project per test but the server/db persist across
 * tests in one run, later tests would otherwise land on an earlier test's
 * project. Explicitly switching via the ProjectSwitcher dropdown makes each
 * test deterministic regardless of run order or accumulated state.
 */
export async function selectProject(page: Page, projectName: string): Promise<void> {
  const trigger = page.locator("aside").first().locator("button").first();
  await trigger.click();
  await page.getByRole("menuitem", { name: projectName }).click();
}
