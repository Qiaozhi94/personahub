import { test, expect } from "@playwright/test";
import { seedProjectWithAdapters } from "./support/seed.js";
import { mockCompletedRunWithLogs } from "./support/mock-run.js";
import { selectProject } from "./support/app.js";

/**
 * Real-browser regression coverage for the F005 desktop layout review
 * (docs/features/0.1/F005-multi-agent-manual-routing/frontend-ui-visual-review.md):
 * jsdom can't compute scrollWidth/scrollHeight, so the overflow-clipping and
 * auto-scroll-hijack findings from that review were invisible to the
 * existing web/ vitest suite. These tests only check real layout geometry —
 * they intentionally don't assert on visual appearance.
 */

const VIEWPORTS = [
  { name: "1024x768", width: 1024, height: 768 },
  { name: "1440x900", width: 1440, height: 900 },
  { name: "1920x1080", width: 1920, height: 1080 },
];

for (const vp of VIEWPORTS) {
  test(`no horizontal overflow in either sidebar at ${vp.name}`, async ({ page }) => {
    const seeded = await seedProjectWithAdapters("e2e overflow check");
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto("/");
    await page.waitForSelector("text=Agent Adapters");
    await selectProject(page, seeded.projectName);
    await page.waitForSelector(`text=${seeded.adapterIds.length}`);

    const asideMetrics = await page.evaluate(() =>
      Array.from(document.querySelectorAll("aside")).map((aside) => ({
        clientWidth: aside.clientWidth,
        scrollWidth: aside.scrollWidth,
        right: aside.getBoundingClientRect().right,
      })),
    );

    expect(asideMetrics).toHaveLength(2);
    for (const metrics of asideMetrics) {
      // +1px tolerance for sub-pixel layout rounding, not for real overflow.
      expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
    }

    const [, inspectorAside] = asideMetrics;
    expect(inspectorAside!.right).toBeLessThanOrEqual(vp.width);
  });
}

test("selecting an Issue with Run logs keeps the Inspector scrolled to the top", async ({ page }) => {
  const seeded = await seedProjectWithAdapters("e2e scroll check");
  await mockCompletedRunWithLogs(page, {
    issueId: seeded.issueId,
    threadId: seeded.threadId,
    workspaceId: seeded.workspaceId,
    adapterId: seeded.adapterIds[0]!,
  });

  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/");
  await page.waitForSelector("text=Agent Adapters");
  await selectProject(page, seeded.projectName);
  await page.getByRole("button", { name: /Fix add function/ }).click();
  await page.waitForSelector("text=Run Logs");
  // let the auto-scroll effect (if any) settle before asserting.
  await page.waitForTimeout(500);

  const state = await page.evaluate(() => {
    const inspector = document.querySelectorAll("aside")[1] as HTMLElement;
    const logBox = Array.from(document.querySelectorAll("div")).find(
      (d) => d.className.includes("max-h-48") && d.className.includes("overflow-y-auto"),
    ) as HTMLElement | undefined;
    return {
      inspectorScrollTop: inspector.scrollTop,
      inspectorScrollHeight: inspector.scrollHeight,
      inspectorClientHeight: inspector.clientHeight,
      logBoxScrollTop: logBox?.scrollTop ?? null,
      logBoxScrollHeight: logBox?.scrollHeight ?? null,
      logBoxClientHeight: logBox?.clientHeight ?? null,
    };
  });

  // Sanity check the fixture actually produced a scrollable page — otherwise
  // "scrollTop stayed 0" would be true trivially.
  expect(state.inspectorScrollHeight).toBeGreaterThan(state.inspectorClientHeight);

  expect(state.inspectorScrollTop).toBe(0);

  // The log viewport itself should still auto-follow new output.
  expect(state.logBoxScrollTop).not.toBeNull();
  expect(state.logBoxScrollTop! + state.logBoxClientHeight!).toBeGreaterThanOrEqual(
    state.logBoxScrollHeight! - 1,
  );
});
