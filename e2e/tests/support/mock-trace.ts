import type { Page } from "@playwright/test";

/**
 * Forces EvidenceSection into its worst-case layout: all four completeness
 * dimensions Unavailable, so all four badges render at once. This is the
 * exact shape that produced the 1024px Evidence-card clipping the recheck
 * report found (`EvidenceSection.tsx:84`'s fixed `grid-cols-2`) — the
 * overflow tests need it selected, not just an empty "Select an issue"
 * pane, or they miss the defect the same way the first version of this
 * suite did.
 */
export async function mockUnavailableEvidence(page: Page, issueId: string): Promise<void> {
  const completeness = {
    commands: "unavailable",
    verification: "unavailable",
    file_changes: "unavailable",
    refs: "unavailable",
    reasons: ["e2e fixture: no runs recorded"],
  };

  await page.route(`**/api/issues/${issueId}/trace*`, (route) =>
    route.fulfill({
      json: {
        issue: null,
        runs: [],
        events: [],
        evidence: [],
        issue_completeness: completeness,
        next_after_event_id: null,
      },
    }),
  );
}
