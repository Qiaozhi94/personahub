import { test, expect } from "@playwright/test";
import { seedProjectWithAdapters } from "./support/seed.js";
import { mockCompletedRunWithLogs } from "./support/mock-run.js";
import { mockUnavailableEvidence } from "./support/mock-trace.js";
import { selectProject, disableEventSource } from "./support/app.js";

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

// This suite only asserts static layout geometry against mocked REST
// responses — never the live event stream — so the SSE connection
// useThreadEvents() opens on Issue-select is pure overhead here, and left
// the process unable to exit on its own (see frontend-ui-visual-review-
// final-closure.md).
test.beforeEach(async ({ page }) => {
  await disableEventSource(page);
});

for (const vp of VIEWPORTS) {
  test(`no horizontal overflow in either sidebar at ${vp.name} with an Issue selected`, async ({ page }) => {
    const seeded = await seedProjectWithAdapters("e2e overflow check");
    // Evidence (all-Unavailable badges) and Run Logs are exactly the
    // content that only renders once an Issue is selected — an empty
    // "Select an issue" pane can't reproduce the clipping this suite is
    // meant to catch (see the 1024px EvidenceSection finding this test
    // was rewritten for).
    await mockUnavailableEvidence(page, seeded.issueId);
    await mockCompletedRunWithLogs(page, {
      issueId: seeded.issueId,
      threadId: seeded.threadId,
      workspaceId: seeded.workspaceId,
      adapterId: seeded.adapterIds[0]!,
    });

    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto("/");
    await page.waitForSelector("text=Agent Adapters");
    await selectProject(page, seeded.projectName);
    await page.waitForSelector(`text=${seeded.adapterIds.length}`);
    await page.getByRole("button", { name: /Fix add function/ }).click();
    await page.waitForSelector("text=Run Logs");
    await page.getByText("Unavailable").first().waitFor();

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

    // Each Evidence badge individually — the failure mode the recheck
    // report caught was a badge's right edge crossing the viewport while
    // overflow-x-hidden hid the resulting scrollbar, so the aside-level
    // check above could in principle stay green while a badge is clipped.
    const badgeEdges = await page.evaluate(() =>
      // Badge (components/ui/badge.tsx) renders a <div>, not a <span>.
      Array.from(document.querySelectorAll("aside")[1]?.querySelectorAll("div") ?? [])
        .filter((el) => el.textContent === "Unavailable" && el.children.length === 0)
        .map((el) => el.getBoundingClientRect().right),
    );
    expect(badgeEdges.length).toBeGreaterThan(0);
    for (const right of badgeEdges) {
      expect(right).toBeLessThanOrEqual(vp.width);
    }
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
