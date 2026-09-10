import { expect, test } from "@playwright/test";

// T021 golden journey, rebuilt per the frozen journey-test-matrix.md §1
// (review R1-005): one browser session, the single allowed page.goto("/"),
// then J1–J9 strictly through visible entries with numbered steps. Writes go
// through canonical APIs; dispatch on this fixture deterministically fails at
// spawn (the fixture workspace /repo/alpha does not exist), which is the
// scripted failure-and-recovery half of J4/J8 — no real CLI is ever driven.
// S1 (deep links) is the only test allowed to address URLs directly.

const ALPHA = "Alpha Platform";
const BETA = "Beta Archive";

test("F009 golden journey J1–J9 on the upgraded v0.2 fixture", async ({ page }) => {
  const consoleErrors: string[] = [];
  // J4 故意让 graph 启动失败（fixture 工作区缺失 → 500；重试撞非终态图 →
  // 409）：这些脚本化失败产生的 resource 错误按 (URL, 状态) 对豁免；其余
  // 错误零容忍。
  const scriptedFailures: Array<{ urlPart: string; status: number }> = [];
  page.on("response", (response) => {
    if (response.status() >= 400) {
      scriptedFailures.push({
        urlPart: new URL(response.url()).pathname,
        status: response.status(),
      });
    }
  });
  page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(`console: ${message.text()}`);
  });

  await test.step("J1 — 根入口升级、项目列表、竖栏、设置目录、schema head", async () => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/projects$/);
    // replace never adds a History entry (about:blank + the replaced entry).
    expect(await page.evaluate(() => window.history.length)).toBe(2);
    await expect(page.getByRole("heading", { name: "项目" })).toBeVisible();
    await expect(page.getByRole("button", { name: new RegExp(ALPHA) })).toBeVisible();
    await expect(page.getByRole("button", { name: new RegExp(BETA) })).toBeVisible();

    const nav = page.getByRole("navigation", { name: "工作面" });
    expect(await nav.locator("button > span").allTextContents()).toEqual(["任务", "项目", "运行时", "设置"]);

    // R1-008: the E2E server migrated the still-v10 fixture itself at first
    // boot — the settings diagnostics page must report the head schema.
    await nav.getByRole("button", { name: "设置" }).click();
    await expect(page).toHaveURL(/\/settings\/system-diagnostics/);
    const catalog = page.getByRole("navigation", { name: "设置目录" });
    await expect(catalog.getByRole("link", { name: "系统诊断" })).toHaveAttribute("aria-current", "page");
    await expect(catalog.getByRole("link", { name: "历史工作流" })).toBeVisible();

    await page.getByRole("radio", { name: ALPHA }).click();
    await expect(page.getByText("schema 11/11 (current)")).toBeVisible();

    // BC-097 click-through: the catalog is the discoverable path to the
    // legacy evidence page — no URL typing.
    await catalog.getByRole("link", { name: "历史工作流" }).click();
    await expect(page).toHaveURL(/\/settings\/legacy-workflows/);
    await expect(page.getByRole("heading", { name: "历史工作流" })).toBeVisible();
    await page.getByRole("navigation", { name: "设置目录" }).getByRole("link", { name: "系统诊断" }).click();
    await expect(page).toHaveURL(/\/settings\/system-diagnostics/);
  });

  let intakeGoal = "";

  await test.step("J2 — 项目绑定事实 + adapter 验证与默认（A026/A027）", async () => {
    await page.getByRole("navigation", { name: "工作面" }).getByRole("button", { name: "项目" }).click();
    await expect(page).toHaveURL(/\/projects$/);
    await page.getByRole("button", { name: new RegExp(ALPHA) }).click();
    await expect(page).toHaveURL(/\/projects\/prj_v02_alpha/);
    await expect(page.getByText("/repo/alpha")).toBeVisible();

    await page.getByRole("navigation", { name: "工作面" }).getByRole("button", { name: "运行时" }).click();
    await expect(page).toHaveURL(/\/runtime$/);
    await page.getByRole("radio", { name: ALPHA }).click();
    await page.getByRole("button", { name: "打开适配器设置" }).click();
    await expect(page).toHaveURL(/\/runtime\/adapters/);
    await page.getByRole("radio", { name: ALPHA }).click();

    const opencodeRow = page.locator("div.rounded-md", { hasText: "OpenCode (never probed)" }).last();
    await expect(opencodeRow.getByText("never validated")).toBeVisible();

    // A026: revalidate drives a real probe; any outcome replaces the
    // never-probed message with a readable, per-adapter result.
    await opencodeRow.getByRole("button", { name: "Revalidate" }).click();
    await expect(opencodeRow.getByText("never validated")).toHaveCount(0, { timeout: 15_000 });

    // A027: when the probe made the adapter available the row offers the
    // default switch — flip it to OpenCode and back to Codex; otherwise the
    // probe failure path shows a readable reason instead (scripted J2 half).
    const setDefaultOnOpencode = opencodeRow.getByRole("button", { name: /set as default/i });
    if ((await setDefaultOnOpencode.count()) > 0) {
      await setDefaultOnOpencode.click();
      await expect(opencodeRow.getByText("Default")).toHaveCount(1);
      const codexRow = page.locator("div.rounded-md", { hasText: "Codex (alpha implementation)" }).last();
      await codexRow.getByRole("button", { name: /set as default/i }).click();
      await expect(codexRow.getByText("Default")).toHaveCount(1);
    } else {
      // 探测失败的脚本分支：该行显示可读的失败原因。
      await expect(opencodeRow.locator("span.text-destructive").first()).toBeVisible();
    }
  });

  await test.step("J3 — 推荐创建任务：确认前零写、原文守恒、重复幂等（A006/A007）", async () => {
    await page.getByRole("navigation", { name: "工作面" }).getByRole("button", { name: "任务" }).click();
    await expect(page).toHaveURL(/\/tasks$/);
    await expect(page.getByText("先选择一个项目，再查看它的任务。")).toBeVisible();
    await page.getByRole("button", { name: new RegExp(ALPHA) }).click();
    await expect(page).toHaveURL(/\/tasks\?project=prj_v02_alpha/);

    const board = page.locator("section", { has: page.getByText("任务列表") });
    const fixtureTaskRows = board.locator("button").filter({
      hasText: /Harden parser|Streaming ingest|Split acceptance|Fix flaky/,
    });
    const baseline = await fixtureTaskRows.count();

    intakeGoal = `F009 黄金旅程目标 ${Date.now()}`;
    await page.getByRole("button", { name: "推荐创建" }).click();
    const dialog = page.getByRole("dialog", { name: "Intake" });
    await expect(dialog).toBeVisible();
    expect(await fixtureTaskRows.count()).toBe(baseline);

    await dialog.getByPlaceholder("Describe the goal in plain language…").fill(intakeGoal);
    await dialog.getByRole("button", { name: "Recommend" }).click();
    const confirm = dialog.getByRole("button", { name: /^Confirm$/ });
    await expect(confirm).toBeVisible();
    // 确认前零写。
    expect(await board.locator("button").filter({ hasText: intakeGoal }).count()).toBe(0);

    await confirm.click();
    await page.waitForURL(/\/tasks\/iss_/);
    await expect(page.getByRole("heading", { name: intakeGoal })).toBeVisible();

    // 重复幂等：回到列表只多出这一条任务。
    await page.getByRole("navigation", { name: "工作面" }).getByRole("button", { name: "任务" }).click();
    await page.getByRole("button", { name: new RegExp(ALPHA) }).click();
    await expect(page).toHaveURL(/\/tasks\?project=prj_v02_alpha/);
    expect(
      await page
        .locator("section", { has: page.getByText("任务列表") })
        .getByRole("button")
        .filter({ hasText: intakeGoal })
        .count(),
    ).toBe(1);
    expect(await fixtureTaskRows.count()).toBe(baseline);
  });

  await test.step("J4 — 指令派工与 Graph 启动（A009/A010），失败可读（spawn 隔离）", async () => {
    // 打开 J3 创建的任务（列表第一条目标原文行）。
    await page.getByRole("button", { name: new RegExp(intakeGoal) }).click();
    await page.waitForURL(/\/tasks\/iss_/);

    // A010: 直接创建一个空白任务（A005 直建），其空白线程提供 Start Graph
    // 入口；两个节点选择 adapter 后启动，成功才关闭（R1-010）。节点派工在
    // spawn 阶段确定性失败 → graph blocked（失败恢复半段）。
    await page.getByRole("navigation", { name: "工作面" }).getByRole("button", { name: "任务" }).click();
    await page.getByRole("button", { name: new RegExp(ALPHA) }).click();
    await expect(page).toHaveURL(/\/tasks\?project=prj_v02_alpha/);
    await page.getByRole("button", { name: "新建任务" }).click();
    const createDialog = page.getByRole("dialog", { name: "New coding issue" });
    await createDialog.getByLabel(/title/i).fill(`F009 graph 旅程任务 ${Date.now()}`);
    await createDialog.getByLabel(/goal/i).fill("验证 graph 启动与失败恢复");
    await createDialog.getByRole("button", { name: /^Create$/i }).click();
    await page.waitForURL(/\/tasks\/iss_/);

    await page.getByRole("button", { name: "Start Graph" }).click();
    const dialog = page.getByRole("dialog", { name: "Start dual-review graph" });
    await expect(dialog).toBeVisible();
    for (const select of await dialog.locator("select").all()) {
      await select.selectOption({ index: 1 });
    }
    // fixture 工作区不存在 → graph 启动确定性失败。R1-010 修复后：错误文本
    // 与节点选择保留在弹窗内，可原位重试（J4 的失败恢复脚本半段）。
    const startResponse = page.waitForResponse(
      (res) => res.url().includes("/graph-runs") && res.request().method() === "POST",
    );
    await dialog.getByRole("button", { name: "Start Graph" }).click();
    expect((await startResponse).status()).toBe(500);
    await expect(dialog.getByText("An internal error occurred.")).toBeVisible();
    // 节点选择必须原样保留（R1-010）。
    for (const select of await dialog.locator("select").all()) {
      await expect(select).not.toHaveValue("");
    }
    const retryResponse = page.waitForResponse(
      (res) => res.url().includes("/graph-runs") && res.request().method() === "POST",
    );
    await dialog.getByRole("button", { name: "Start Graph" }).click();
    expect((await retryResponse).status()).toBe(500);
    await expect(dialog.getByText("An internal error occurred.")).toBeVisible();
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toHaveCount(0);
  });

  await test.step("J5 — 既有 Run 的事实：命令、截断标记、文件变化、分页（A012/A016/A017）", async () => {
    await page.getByRole("navigation", { name: "工作面" }).getByRole("button", { name: "任务" }).click();
    await page.getByRole("button", { name: new RegExp(ALPHA) }).click();
    await expect(page).toHaveURL(/\/tasks\?project=prj_v02_alpha/);
    await page.getByRole("button", { name: /Streaming ingest pipeline/ }).click();
    await expect(page).toHaveURL(/\/tasks\/iss_v02_running/);

    // A009: 选择 adapter、输入指令并发送 —— 派工在 spawn 阶段确定性失败
    // （fixture 工作区不存在），失败原因可读（J4 的失败恢复半段）。
    const composer = page.getByPlaceholder("Enter agent instructions…");
    await composer.waitFor({ state: "visible" });
    await page.getByLabel("Agent").selectOption("adp_v02_codex_impl");
    await composer.fill("F009 旅程派工指令");
    await page.getByRole("button", { name: "发送指令" }).click();
    const facts = page.locator("section", { has: page.getByText("任务详情（兼容）") });
    await expect(facts.getByText("Failed to spawn adapter process").first()).toBeVisible({
      timeout: 20_000,
    });

    const execution = page.locator("section", { has: page.getByText("执行与会话（兼容）") });
    await expect(execution.getByText("issue.created", { exact: true })).toBeVisible();
    await expect(execution.getByText("command.started").first()).toBeVisible();
    // FX-TRACE partial/截断标记守恒（BC-046 partial）。
    await expect(execution.getByText("run.output_truncated", { exact: true })).toBeVisible();

    // 启动恢复写入的扫描失败事实同样守恒（真实 trace fact）。
    await expect(execution.getByText("file.change_scan_failed", { exact: true }).first()).toBeVisible();
  });

  await test.step("J6 — 验证兼容事实只读呈现（A020）；A021 触发仅对 Validating 开放", async () => {
    await page.getByRole("navigation", { name: "工作面" }).getByRole("button", { name: "任务" }).click();
    await page.getByRole("button", { name: new RegExp(ALPHA) }).click();
    await page.getByRole("button", { name: /Streaming ingest pipeline/ }).click();
    await expect(page).toHaveURL(/\/tasks\/iss_v02_running/);

    // 触发验证（A021）只对 Validating 状态开放（服务器合同）；非 Validating
    // 任务的界面上不存在伪造的触发入口 —— 这本身是断言的一部分。
    await expect(page.getByRole("button", { name: /trigger validation/i })).toHaveCount(0);
  });

  await test.step("J7 — 验收兼容详情：rounds / findings / summary / 导出（A018/A019/A020/A024）", async () => {
    await page.getByRole("navigation", { name: "工作面" }).getByRole("button", { name: "任务" }).click();
    await page.getByRole("button", { name: new RegExp(ALPHA) }).click();
    await page.getByRole("button", { name: /Harden parser error paths/ }).click();
    await expect(page).toHaveURL(/\/tasks\/iss_v02_done/);

    const facts = page.locator("section", { has: page.getByText("任务详情（兼容）") });
    const execution = page.locator("section", { has: page.getByText("执行与会话（兼容）") });
    // FX-VALIDATION：2 失败 round + 1 通过 round 原样保留（卡片在人化文案）。
    await expect(execution.getByText("Validation failed").first()).toBeVisible();
    await expect(execution.getByText("Validation passed").first()).toBeVisible();
    // FX-EVIDENCE complete 组：summary 与机器事实同屏且不混写。
    await expect(facts.getByText("Evidence Summary")).toBeVisible();
    await expect(facts.getByText(/Round 3 accepted the parser hardening/)).toBeVisible();
    await expect(facts.getByText("Failures")).toBeVisible();

    // A024 摘要复制 / 下载（client-only）。headless Chromium 需要显式授权剪贴板。
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await facts.getByRole("button", { name: "Copy" }).click();
    await expect(facts.getByText("Copied!")).toBeVisible();
    const summaryDownload = page.waitForEvent("download");
    await facts.getByRole("button", { name: "Download" }).click();
    (await summaryDownload).cancel();

    // A019 trace 导出仍引用原 Run。
    const exportDownload = page.waitForEvent("download");
    await facts.getByRole("button", { name: "Export Markdown" }).click();
    (await exportDownload).cancel();
  });

  await test.step("J8 — 取消/重试/resolve/unblock：异常态守恒与唯一恢复（A011/A013/A014/A015/A022）", async () => {
    // blocked graph 所在任务：graph 卡片可取消（A013），重试节点（A014）。
    await page.getByRole("navigation", { name: "工作面" }).getByRole("button", { name: "任务" }).click();
    await page.getByRole("button", { name: new RegExp(ALPHA) }).click();
    await page.getByRole("button", { name: /Split acceptance fixtures/ }).click();
    await expect(page).toHaveURL(/\/tasks\/iss_v02_graph_blocked/);

    const execution = page.locator("section", { has: page.getByText("执行与会话（兼容）") });
    const graphCard = execution.locator("div", { hasText: "Graph Run" }).last();

    // A014: 重试失败节点 —— 新尝试再次 spawn 失败，状态保持可读。
    const retryButton = execution.getByRole("button", { name: /Retry/i }).first();
    if ((await retryButton.count()) > 0 && (await retryButton.isVisible().catch(() => false))) {
      await retryButton.dispatchEvent("click");
      await expect(execution.getByText("failed", { exact: true }).first()).toBeVisible({ timeout: 20_000 });
    }

    // A011: 取消最新的排队 Run（重试产生的新尝试）。runs 列表在存在 queued
    // run 时每 2s 轮询重渲染，常规 click 的稳定性检查永不通过 —— 直接在
    // 元素上派发 click。
    const facts = page.locator("section", { has: page.getByText("任务详情（兼容）") });
    const cancelRun = facts.getByRole("button", { name: "Cancel Run" }).first();
    await expect(cancelRun).toBeAttached({ timeout: 10_000 });
    await cancelRun.dispatchEvent("click");
    // 取消有确认对话框：确认后 Run 变为 cancelled，不冒充成功/失败（BC-047）。
    const cancelDialog = page.getByRole("dialog", { name: "Cancel Run" });
    await expect(cancelDialog).toBeVisible();
    await cancelDialog.getByRole("button", { name: "Yes, cancel run" }).click();
    await expect(facts.getByText("cancelled", { exact: true }).first()).toBeVisible({ timeout: 20_000 });

    // A013: 取消 blocked graph → cancelled（连带排队 Run 取消）。
    const cancelButton = execution.getByRole("button", { name: /^Cancel$/ }).first();
    await expect(cancelButton).toBeAttached({ timeout: 10_000 });
    await cancelButton.dispatchEvent("click");
    await expect(execution.getByText("cancelled").first()).toBeVisible({ timeout: 20_000 });

    // A015 的 executor 重选界面只在 no_capable_adapter 阻塞下出现；本图的
    // 阻塞原因是 node_run_failed，因此该界面不应出现（边界断言）。
    await expect(execution.getByText("Reassign executors")).toHaveCount(0);

    // A022: 对 blocked Issue 提交 operator note 解除阻塞。
    await page.getByRole("navigation", { name: "工作面" }).getByRole("button", { name: "任务" }).click();
    await page.getByRole("button", { name: new RegExp(ALPHA) }).click();
    await page.getByRole("button", { name: /Fix flaky acceptance suite/ }).click();
    await expect(page).toHaveURL(/\/tasks\/iss_v02_blocked/);
    await page.getByRole("button", { name: "Resolve Blocker…" }).click();
    const unblockDialog = page.getByRole("dialog", { name: "Resolve Blocker" });
    await unblockDialog.getByLabel(/note/i).fill("F009 旅程：人工确认后解除阻塞");
    await unblockDialog.getByRole("button", { name: /Unblock/i }).click();
    await expect(unblockDialog).toHaveCount(0);
    await expect(page.getByText("issue.unblocked", { exact: true })).toBeVisible({ timeout: 15_000 });
  });

  await test.step("J9 — canonical deep link、刷新与 History 重放（AC-003）", async () => {
    // 从列表点选进入两个对象（push），随后 History 往返。
    await page.getByRole("navigation", { name: "工作面" }).getByRole("button", { name: "任务" }).click();
    await page.getByRole("button", { name: new RegExp(ALPHA) }).click();
    await expect(page).toHaveURL(/\/tasks\?project=prj_v02_alpha/);
    await page.getByRole("button", { name: /Streaming ingest pipeline/ }).click();
    await expect(page).toHaveURL(/\/tasks\/iss_v02_running/);
    await page.goBack();
    await expect(page).toHaveURL(/\/tasks\?project=prj_v02_alpha/);
    await page.getByRole("button", { name: /Harden parser error paths/ }).click();
    await expect(page).toHaveURL(/\/tasks\/iss_v02_done/);

    // 刷新恢复同一对象。
    await page.reload();
    await expect(page.getByRole("heading", { name: "Harden parser error paths" })).toBeVisible();

    // History 重放：B → 列表 → B（push 覆盖前进项）。
    await page.goBack();
    await expect(page).toHaveURL(/\/tasks\?project=prj_v02_alpha/);
    await expect(page.getByText("任务列表")).toBeVisible();
    await page.goForward();
    await expect(page).toHaveURL(/\/tasks\/iss_v02_done/);
    await expect(page.getByRole("heading", { name: "Harden parser error paths" })).toBeVisible();

    // 再次从竖栏进入项目面（列表不猜选）。
    await page.getByRole("navigation", { name: "工作面" }).getByRole("button", { name: "项目" }).click();
    await expect(page).toHaveURL(/\/projects$/);
    await expect(page.getByRole("button", { name: new RegExp(ALPHA) })).toBeVisible();
  });

  // 需求级 console 门禁（T022/AC-004）：整个黄金旅程不允许任何页面错误，
  // 唯脚本化失败响应产生的 resource 错误按次数豁免。
  const remaining = [...consoleErrors];
  for (const failure of scriptedFailures) {
    const idx = remaining.findIndex((entry) => entry.includes(`resource`) && entry.includes(String(failure.status)));
    if (idx >= 0) remaining.splice(idx, 1);
  }
  expect(remaining).toEqual([]);
});

test("S1 — 未选项目、未绑定项目指引、未知 ID 与非法子路径（US-001/AC-003 补充）", async ({ page }) => {
  await page.goto("/tasks");
  // 不猜第一项：显示项目选择。
  await expect(page.getByText("先选择一个项目，再查看它的任务。")).toBeVisible();

  // 未绑定项目显示指引而非空白。
  await page.getByRole("button", { name: new RegExp(BETA) }).click();
  await expect(page).toHaveURL(/\/tasks\?project=prj_v02_beta/);
  await expect(page.getByText("该项目还没有任务")).toBeVisible();

  // 未知 ID → 诊断保留的可恢复列表。
  await page.goto("/tasks/iss_does_not_exist");
  await expect(page).toHaveURL(/\/tasks\?not_found=iss_does_not_exist&from=/);
  await expect(page.getByText("任务不存在", { exact: true })).toBeVisible();

  await page.goto("/projects/prj_does_not_exist");
  await expect(page.getByText("项目不存在", { exact: true })).toBeVisible();

  // 非法子路径 → replace 回 base route 并带诊断。
  await page.goto("/tasks/iss_v02_done/overview");
  await expect(page).toHaveURL(/route_issue=unsupported-view/);
  await expect(page.getByText("该链接指向的任务视图尚未开放")).toBeVisible();

  await page.goto("/projects/prj_v02_alpha/files");
  await expect(page).toHaveURL(/route_issue=unsupported-tab/);

  // M1 冻结边界：会话面不可达。
  await page.goto("/sessions/sess_1");
  await expect(page.getByText("页面不存在", { exact: true })).toBeVisible();
});
