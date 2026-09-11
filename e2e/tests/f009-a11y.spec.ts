import { expect, test, type Locator, type Page } from "@playwright/test";

// BC-048, BC-049, BC-050: one dialog semantic across the app — role="dialog" with an
// accessible name, focus entering on open, Escape closing, focus returning to
// the trigger. BC-051/BC-125: data tables carry accessible names and full
// columnheader/cell semantics. BC-052: the legacy list/detail pair is the
// M1's real tab instance and must satisfy the shared keyboard contract.
//
// review R1-006 (non-convergence escalation, round 4): three consecutive
// rounds each added the "missing" trigger as a one-off assertion, and each
// time an independent variation-check found a different production trigger
// still unproven (most recently: AdapterSettings.openEdit() captured focus
// in production code but no test ever clicked an adapter row to exercise
// it). Per the reviewer's explicit instruction, this stops being spot
// patches: DIALOG_INSTANCES below is the executable denominator — every
// known production dialog *and* every distinct way to open it, each its own
// array entry — and a single generic test body is parameterized over it.
// Adding a new dialog, or a second trigger for an existing one, means adding
// a row here; there is no other place BC-048, BC-049, BC-050 coverage can silently
// stop tracking the real inventory.
interface DialogInstance {
  /** Unique, human-readable id — becomes part of the generated test name. */
  name: string;
  /** The dialog's accessible name (role="dialog", name via aria-labelledby). */
  dialogTitle: string;
  /** Navigates to the right place and clicks/triggers the dialog open, returning the trigger element focus should return to. */
  open: (page: Page) => Promise<Locator>;
}

const DIALOG_INSTANCES: DialogInstance[] = [
  {
    name: "create project",
    dialogTitle: "Create project",
    open: async (page) => {
      await page.goto("/projects");
      const trigger = page.getByRole("button", { name: "新建项目" }).first();
      await trigger.click();
      return trigger;
    },
  },
  {
    name: "create issue",
    dialogTitle: "New coding issue",
    open: async (page) => {
      await page.goto("/tasks?project=prj_v02_alpha");
      await expect(page.getByRole("button", { name: /Harden parser error paths/ })).toBeVisible();
      const trigger = page.getByRole("button", { name: "新建任务" });
      await trigger.click();
      return trigger;
    },
  },
  {
    name: "intake",
    dialogTitle: "Intake",
    open: async (page) => {
      await page.goto("/tasks?project=prj_v02_alpha");
      const trigger = page.getByRole("button", { name: "推荐创建" });
      await trigger.click();
      return trigger;
    },
  },
  {
    name: "command palette",
    dialogTitle: "跳转",
    open: async (page) => {
      // No click-trigger to return focus to (opened via keyboard shortcut) —
      // the "trigger" is whatever had focus beforehand; a stable, harmless
      // (non-navigating, non-mutating) target is the rail's own "任务" entry.
      await page.goto("/tasks?project=prj_v02_alpha");
      const trigger = page.getByRole("navigation", { name: "工作面" }).getByRole("button", { name: "任务" });
      await trigger.focus();
      await page.keyboard.press("ControlOrMeta+k");
      return trigger;
    },
  },
  {
    name: "start graph",
    dialogTitle: "Start dual-review graph",
    open: async (page) => {
      await page.goto("/tasks?project=prj_v02_alpha");
      await page.getByRole("button", { name: "新建任务" }).click();
      const createDialog = page.getByRole("dialog", { name: "New coding issue" });
      await createDialog.getByLabel(/title/i).fill(`BC-049 start-graph dialog ${Date.now()}`);
      await createDialog.getByLabel(/goal/i).fill("dialog inventory");
      await createDialog.getByRole("button", { name: /^Create$/i }).click();
      await page.waitForURL(/\/tasks\/iss_/);
      const trigger = page.getByRole("button", { name: "Start Graph" });
      await trigger.click();
      return trigger;
    },
  },
  {
    name: "cancel run",
    dialogTitle: "Cancel Run",
    open: async (page) => {
      await page.goto("/tasks/iss_v02_graph_blocked");
      await expect(page.getByText("queued", { exact: true }).first()).toBeVisible();
      const trigger = page.getByRole("button", { name: "Cancel Run" }).first();
      await trigger.click();
      return trigger;
    },
  },
  {
    name: "unblock",
    dialogTitle: "Resolve Blocker",
    open: async (page) => {
      await page.goto("/tasks/iss_v02_blocked");
      const trigger = page.getByRole("button", { name: "Resolve Blocker…" });
      await trigger.click();
      return trigger;
    },
  },
  {
    name: "reset rounds",
    dialogTitle: "Reset Validation Rounds",
    open: async (page) => {
      // Only reachable on the round-limit blocker fixture.
      await page.goto("/tasks/iss_v02_roundlimit");
      const trigger = page.getByRole("button", { name: "Reset Rounds…" });
      await trigger.click();
      return trigger;
    },
  },
  {
    name: "adapter — create branch",
    dialogTitle: "Configure adapter",
    open: async (page) => {
      await page.goto("/runtime/adapters");
      await page.getByRole("radio", { name: "Alpha Platform" }).click();
      const trigger = page.getByRole("button", { name: "Configure adapter" });
      await trigger.click();
      return trigger;
    },
  },
  {
    name: "adapter — edit branch",
    dialogTitle: "Edit adapter",
    open: async (page) => {
      // A distinct trigger and code path (AdapterSettings.openEdit(), not
      // openCreate()) — the exact instance three prior rounds' variation
      // checks found unproven despite the finding being marked resolved.
      await page.goto("/runtime/adapters");
      await page.getByRole("radio", { name: "Alpha Platform" }).click();
      const trigger = page.getByRole("button", { name: "Codex (alpha implementation)" });
      await trigger.click();
      return trigger;
    },
  },
];

for (const { name, dialogTitle, open } of DIALOG_INSTANCES) {
  test(`BC-048, BC-049, BC-050: ${name} — semantics, takes focus, closes on Escape, returns focus`, async ({
    page,
  }) => {
    const trigger = await open(page);
    const dialog = page.getByRole("dialog", { name: dialogTitle });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("aria-modal", "true");

    const focusInside = await page.evaluate(() => {
      const dialogEl = document.querySelector('[role="dialog"]');
      return dialogEl ? dialogEl.contains(document.activeElement) : false;
    });
    expect(focusInside).toBe(true);

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });
}

test("BC-052: the legacy list/detail tabs satisfy the keyboard contract", async ({ page }) => {
  await page.goto("/settings/legacy-workflows");
  const tablist = page.getByRole("tablist", { name: "历史工作流视图" });
  await expect(tablist).toBeVisible();

  const listTab = page.getByRole("tab", { name: "模板列表" });
  const detailTab = page.getByRole("tab", { name: "模板详情" });
  const listPanel = page.getByRole("tabpanel", { name: /模板列表/ });
  const detailPanel = page.getByRole("tabpanel", { name: /模板详情/ });

  // Initial state: list selected, exactly one visible panel.
  await expect(listTab).toHaveAttribute("aria-selected", "true");
  await expect(listPanel).toBeVisible();
  await expect(detailPanel).toHaveCount(0);

  // Selecting a template switches to the detail panel (R2-014: control state
  // bound to content).
  await page.getByRole("button", { name: /Coding Workflow v1/ }).click();
  await expect(detailTab).toHaveAttribute("aria-selected", "true");
  await expect(detailPanel).toBeVisible();
  await expect(page.getByRole("region", { name: "模板详情" })).toBeVisible();
  await expect(listPanel).toHaveCount(0);

  // Keyboard: ArrowRight/Home drive selection with focus following.
  await listTab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(detailTab).toHaveAttribute("aria-selected", "true");
  await expect(detailTab).toBeFocused();
  await expect(detailPanel).toBeVisible();
  await expect(listPanel).toHaveCount(0);

  await detailTab.focus();
  await page.keyboard.press("Home");
  await expect(listTab).toHaveAttribute("aria-selected", "true");
  await expect(listPanel).toBeVisible();
  await expect(detailPanel).toHaveCount(0);
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
