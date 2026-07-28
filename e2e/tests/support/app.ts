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

/**
 * useThreadEvents() opens an EventSource to `/api/threads/:id/events/stream`
 * as soon as an Issue is selected (see web/src/hooks/use-thread.ts) and only
 * skips it when `typeof EventSource === "undefined"`. Layout tests use
 * mocked REST responses and do not cover live SSE, so EventSource is
 * disabled to keep this suite scoped to layout geometry. Must be installed
 * via addInitScript before `page.goto()`, since the hook runs on first
 * render.
 */
export async function disableEventSource(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(window, "EventSource", {
      configurable: true,
      value: undefined,
    });
  });
}
