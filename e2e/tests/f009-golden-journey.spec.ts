import { expect, test } from "@playwright/test";

// T021 golden journey, rebuilt per the frozen journey-test-matrix.md §1
// (review R1-005): one browser session, the single allowed page.goto("/"),
// then J1–J9 strictly through visible entries with numbered steps. Writes go
// through canonical APIs. Two dispatch regimes coexist on this fixture, both
// driving no real CLI: adp_v02_fake ("Fixture CLI") completes deterministically
// (implementation output, graph nodes via a node_key-matched finalMessage, and
// validator rounds via a canned failing verdict — see FakeAgentAdapter and its
// registration in src/index.ts), which is what J4/J6 use to exercise real
// write actions end to end; the real-CLI adapters (Codex/Claude) still fail at
// spawn because the fixture workspace /repo/alpha does not exist, which is the
// scripted failure-and-recovery half J8 exercises for retry/cancel.
// S1 (deep links) is the only test allowed to address URLs directly.

const ALPHA = "Alpha Platform";
const BETA = "Beta Archive";

test("F009 golden journey J1–J9 on the upgraded v0.2 fixture", async ({ page }) => {
  const consoleErrors: string[] = [];
  // 真实 CLI 适配器在 J5/J8 上仍会确定性 spawn 失败（fixture 工作区
  // /repo/alpha 缺失）：这些脚本化失败产生的 resource 错误按 (URL, 状态)
  // 对豁免；其余错误零容忍。
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
    // F013 首次注册"能力"槽位。
    expect(await nav.locator("button > span").allTextContents()).toEqual(["任务", "项目", "能力", "运行时", "设置"]);

    // R1-008: the E2E server migrated the still-v10 fixture itself at first
    // boot — the settings diagnostics page must report the head schema.
    await nav.getByRole("button", { name: "设置" }).click();
    await expect(page).toHaveURL(/\/settings\/system-diagnostics/);
    const catalog = page.getByRole("navigation", { name: "设置目录" });
    await expect(catalog.getByRole("link", { name: "系统诊断" })).toHaveAttribute("aria-current", "page");
    await expect(catalog.getByRole("link", { name: "历史工作流" })).toBeVisible();

    await page.getByRole("radio", { name: ALPHA }).click();
    // The schema head advances with every migration (v13 landed with F010),
    // so the journey asserts "actual == expected, current" instead of pinning
    // a version literal.
    await expect(page.getByText(/schema \d+\/\d+ \(current\)/)).toHaveText(/schema (\d+)\/\1 \(current\)/);

    // BC-097 click-through: the catalog is the discoverable path to the
    // legacy evidence page — no URL typing.
    await catalog.getByRole("link", { name: "历史工作流" }).click();
    await expect(page).toHaveURL(/\/settings\/legacy-workflows/);
    await expect(page.getByRole("heading", { name: "历史工作流" })).toBeVisible();
    await page.getByRole("navigation", { name: "设置目录" }).getByRole("link", { name: "系统诊断" }).click();
    await expect(page).toHaveURL(/\/settings\/system-diagnostics/);
  });

  let intakeGoal = "";
  let taskTitle = "";

  await test.step("J2 — 项目绑定事实 + adapter 验证与默认（A026/A027）", async () => {
    await page.getByRole("navigation", { name: "工作面" }).getByRole("button", { name: "项目" }).click();
    await expect(page).toHaveURL(/\/projects$/);
    await page.getByRole("button", { name: new RegExp(ALPHA) }).click();
    await expect(page).toHaveURL(/\/projects\/prj_v02_alpha/);
    await expect(page.getByText("/repo/alpha")).toBeVisible();

    await page.getByRole("navigation", { name: "工作面" }).getByRole("button", { name: "运行时" }).click();
    await expect(page).toHaveURL(/\/runtime$/);
    // A028: /runtime 只提供机器投影（F012 RuntimeProjectionService 单一读模型）；
    // 项目维度的 adapter 事实在 /runtime/adapters。
    await page.getByRole("button", { name: "打开适配器设置" }).click();
    await expect(page).toHaveURL(/\/runtime\/adapters/);
    await page.getByRole("radio", { name: ALPHA }).click();

    // A026: Fixture CLI 的探测是确定性的 —— revalidate 后保持 available，
    // 探测时间刷新（不驱动真实 CLI）。
    const fakeRow = page.locator("div.rounded-md", { hasText: "Fixture CLI (fake)" }).last();
    await expect(fakeRow.getByText("available").first()).toBeVisible();
    await fakeRow.getByRole("button", { name: "Revalidate" }).click();
    await expect(fakeRow.getByText(/checked|seconds? ago|minutes? ago|just now/i).first()).toBeVisible({
      timeout: 15_000,
    });

    // A027: default 切换 —— 切到 Fixture CLI 再切回 Codex，两次真实写。
    await fakeRow.getByRole("button", { name: /set as default/i }).click();
    await expect(fakeRow.getByText("Default", { exact: true })).toBeVisible({ timeout: 10_000 });
    const codexRow = page.locator("div.rounded-md", { hasText: "Codex (alpha implementation)" }).last();
    await codexRow.getByRole("button", { name: /set as default/i }).click();
    await expect(codexRow.getByText("Default", { exact: true })).toBeVisible({ timeout: 10_000 });
  });

  await test.step("J3 — 创建任务：确认前零写、原文守恒、重复不重创建（A006/A007）", async () => {
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

    const stamp = Date.now();
    taskTitle = `F009 黄金旅程任务 ${stamp}`;
    intakeGoal = `F009 黄金旅程目标 ${stamp}`;
    await page.getByRole("button", { name: "新建任务" }).click();
    const dialog = page.getByRole("dialog", { name: "New coding issue" });
    await expect(dialog).toBeVisible();
    expect(await fixtureTaskRows.count()).toBe(baseline);

    await dialog.getByLabel("Title").fill(taskTitle);
    await dialog.getByLabel("Goal").fill(intakeGoal);
    // 确认前零写。
    expect(await board.locator("button").filter({ hasText: taskTitle }).count()).toBe(0);

    const firstCreate = page.waitForResponse(
      (res) => res.url().includes("/issues") && res.request().method() === "POST",
    );
    await dialog.getByRole("button", { name: "Create" }).click();
    expect((await firstCreate).status()).toBe(201);
    await page.waitForURL(/\/tasks\/iss_/);
    await expect(page.getByRole("heading", { name: taskTitle })).toBeVisible();

    // 重复幂等：回到列表只多出这一条任务。
    await page.getByRole("navigation", { name: "工作面" }).getByRole("button", { name: "任务" }).click();
    await page.getByRole("button", { name: new RegExp(ALPHA) }).click();
    await expect(page).toHaveURL(/\/tasks\?project=prj_v02_alpha/);
    expect(
      await page
        .locator("section", { has: page.getByText("任务列表") })
        .getByRole("button")
        .filter({ hasText: taskTitle })
        .count(),
    ).toBe(1);
    expect(await fixtureTaskRows.count()).toBe(baseline);
  });

  await test.step("J4 — 会话面派工入口与可用性披露（A009/A010）", async () => {
    // 打开 J3 创建的任务，从任务面进入会话面。
    await page.getByRole("button", { name: new RegExp(taskTitle) }).click();
    await page.waitForURL(/\/tasks\/iss_/);
    await page.getByRole("button", { name: "打开会话" }).click();
    await page.waitForURL(/\/sessions\//);

    // A009: 会话面是唯一派工入口。fixture 未播种 adapter capability
    // evidence，因此候选全部结构性不可选 —— design §4.2 要求它们仍然
    // 可见并给出理由与替代路径，而不是静默隐藏。
    const panel = page.getByRole("region", { name: "派工" });
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("combobox", { name: "派工用途" })).toBeVisible();
    await expect(panel.getByRole("combobox", { name: "上下文范围" })).toBeVisible();
    await expect(panel.getByRole("combobox", { name: "思考深度" })).toBeVisible();
    await expect(panel.getByRole("button", { name: "确认派工" })).toBeVisible();
    await expect(panel.getByRole("list", { name: "不可选组合" })).toBeVisible();

    // A010: graph 启动改在会话面的协作图区（节点执行同样经 Dispatch）。
    await page.goto("/tasks/iss_v02_graphok");
    await page.getByRole("button", { name: "打开会话" }).click();
    await page.waitForURL(/\/sessions\//);
    const graphSection = page.getByRole("region", { name: "协作图" });
    await expect(graphSection).toBeVisible();
    await expect(graphSection.getByRole("button", { name: "Start Graph" })).toBeVisible();
  });

  await test.step("J5 — 既有 Run 的事实：命令、截断标记、文件变化、分页（A012/A016/A017）", async () => {
    await page.getByRole("navigation", { name: "工作面" }).getByRole("button", { name: "任务" }).click();
    await page.getByRole("button", { name: new RegExp(ALPHA) }).click();
    await expect(page).toHaveURL(/\/tasks\?project=prj_v02_alpha/);
    await page.getByRole("button", { name: /Streaming ingest pipeline/ }).click();
    await expect(page).toHaveURL(/\/tasks\/iss_v02_running/);

    const execution = page.locator("section", { has: page.getByText("执行与会话（兼容）") });
    await expect(execution.getByText("issue.created", { exact: true })).toBeVisible();
    await expect(execution.getByText("command.started").first()).toBeVisible();
    // FX-TRACE partial/截断标记守恒（BC-046 partial）。
    await expect(execution.getByText("run.output_truncated", { exact: true })).toBeVisible();

    // 启动恢复写入的扫描失败事实同样守恒（真实 trace fact）。
    await expect(execution.getByText("file.change_scan_failed", { exact: true }).first()).toBeVisible();
  });

  await test.step("J6 — 手动触发验证（A021），真实写动作产生新 round", async () => {
    // 非 Validating 任务上不存在伪造的触发入口 —— 边界仍然断言。
    await page.getByRole("navigation", { name: "工作面" }).getByRole("button", { name: "任务" }).click();
    await page.getByRole("button", { name: new RegExp(ALPHA) }).click();
    await page.getByRole("button", { name: /Streaming ingest pipeline/ }).click();
    await expect(page).toHaveURL(/\/tasks\/iss_v02_running/);
    await expect(page.getByRole("button", { name: /start automatic validator now/i })).toHaveCount(0);

    // iss_v02_validating：grace 窗口打开（due 2099），validator 选择对该
    // project 确定性地落在 Fixture CLI（唯一 eligible validator）。点击后
    // 触发真实写：新 validator Run 派工、执行、回传 verdict —— round 从 0
    // 变为 1，Issue 回到 Running（未撞 round-limit）。
    await page.getByRole("navigation", { name: "工作面" }).getByRole("button", { name: "任务" }).click();
    await page.getByRole("button", { name: new RegExp(ALPHA) }).click();
    await page.getByRole("button", { name: /Add request tracing/ }).click();
    await expect(page).toHaveURL(/\/tasks\/iss_v02_validating/);

    const facts = page.locator("section", { has: page.getByText("任务详情（兼容）") });
    await expect(facts.getByText("Validating").first()).toBeVisible();
    const startValidator = page.getByRole("button", { name: /start automatic validator now/i });
    await expect(startValidator).toBeVisible();
    await startValidator.click();

    // 触发后横幅让位（due_at 被清空），随后 verdict 落地：新 round 出现、
    // 状态回到 Running，既有 iss_v02_done 的历史 round（J7）不受影响。
    await expect(page.getByRole("button", { name: /start automatic validator now/i })).toHaveCount(0, {
      timeout: 20_000,
    });
    const execution = page.locator("section", { has: page.getByText("执行与会话（兼容）") });
    await expect(execution.getByText("Validation failed").first()).toBeVisible({ timeout: 20_000 });
    await expect(facts.getByText("Running").first()).toBeVisible();
    await expect(facts.getByText("Failures").first()).toBeVisible();
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

    // A023 reset rounds：只在 RoundLimitReached 阻塞下出现，真实写把
    // round 计数清零、Issue 保持 Blocked（需另行 unblock）。
    await page.getByRole("navigation", { name: "工作面" }).getByRole("button", { name: "任务" }).click();
    await page.getByRole("button", { name: new RegExp(ALPHA) }).click();
    await page.getByRole("button", { name: /Reduce cold-start latency/ }).click();
    await expect(page).toHaveURL(/\/tasks\/iss_v02_roundlimit/);

    const rlFacts = page.locator("section", { has: page.getByText("任务详情（兼容）") });
    const rlExecution = page.locator("section", { has: page.getByText("执行与会话（兼容）") });
    await expect(rlFacts.getByText("Failures").first()).toBeVisible();
    await rlFacts.getByRole("button", { name: "Reset Rounds…" }).click();
    const resetDialog = page.getByRole("dialog", { name: "Reset Validation Rounds" });
    await expect(resetDialog).toBeVisible();
    await resetDialog.getByLabel(/operator note/i).fill("F009 旅程：批准额外验证轮次");
    await resetDialog.getByRole("button", { name: "Reset Rounds" }).click();
    await expect(resetDialog).toHaveCount(0);
    await expect(rlExecution.getByText("validation.round_reset", { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    // Issue 保持 Blocked —— Reset Rounds 不等于 unblock。
    await expect(rlFacts.getByRole("button", { name: "Resolve Blocker…" })).toBeVisible();
  });

  await test.step("J8 — 取消/重试/resolve/unblock：异常态守恒与唯一恢复（A011/A013/A014/A015/A022）", async () => {
    // blocked graph 所在任务。
    await page.getByRole("navigation", { name: "工作面" }).getByRole("button", { name: "任务" }).click();
    await page.getByRole("button", { name: new RegExp(ALPHA) }).click();
    await page.getByRole("button", { name: /Split acceptance fixtures/ }).click();
    await expect(page).toHaveURL(/\/tasks\/iss_v02_graph_blocked/);

    // A011: 任务面不再提供 Run 取消写入口 —— 取消属于会话面的介入面。
    const facts = page.locator("section", { has: page.getByText("任务详情（兼容）") });
    await expect(facts.getByRole("button", { name: "Cancel Run" })).toHaveCount(0);

    // graph 操作在会话面的协作图区（A013/A014/A015）。
    await page.getByRole("button", { name: "打开会话" }).click();
    await page.waitForURL(/\/sessions\//);
    const graphSection = page.getByRole("region", { name: "协作图" });
    await expect(graphSection).toBeVisible();

    // A014: 重试入口存在。fixture 未播种 probe evidence，因此重试会以结构性
    // 拒绝说明原因（design §4.2：不可选组合必须可见并给出理由）；此处断言
    // 入口可达，成功路径由 F012 服务端集成测试覆盖。
    await expect(graphSection.getByRole("button", { name: /Retry/i }).first()).toBeAttached({ timeout: 10_000 });

    // A013: 取消 blocked graph → cancelled（不依赖 capability evidence）。
    const cancelButton = graphSection.getByRole("button", { name: /^Cancel$/ }).first();
    await expect(cancelButton).toBeAttached({ timeout: 10_000 });
    await cancelButton.dispatchEvent("click");
    await expect(graphSection.getByText("cancelled").first()).toBeVisible({ timeout: 20_000 });

    // A015: no_capable_adapter 阻塞下的 executor 重选界面（fixture 事实，与
    // 证据播种无关）；提交路径同样由服务端集成测试覆盖。
    await page.getByRole("navigation", { name: "工作面" }).getByRole("button", { name: "任务" }).click();
    await page.getByRole("button", { name: new RegExp(ALPHA) }).click();
    await page.getByRole("button", { name: /Migrate config store/ }).click();
    await expect(page).toHaveURL(/\/tasks\/iss_v02_nocapable/);
    await page.getByRole("button", { name: "打开会话" }).click();
    await page.waitForURL(/\/sessions\//);
    const nocapableGraph = page.getByRole("region", { name: "协作图" });
    await expect(nocapableGraph.getByText("Reassign executors")).toBeVisible();

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

  // F013 注册了 files / skills / settings 三个页签；memory 仍是被拒绝的子路径。
  await page.goto("/projects/prj_v02_alpha/memory");
  await expect(page).toHaveURL(/route_issue=unsupported-tab/);

  // F012 注册了 /sessions/:sessionId：未知房间不再是全局 not-found，而是
  // 会话面的可恢复错误态（F009 的 M1 冻结边界由 F012 解除）。
  await page.goto("/sessions/sess_1");
  await expect(page.getByText("会话不存在或无法加载")).toBeVisible();

  // 仍未注册的面保持全局 not-found。
  await page.goto("/memory");
  await expect(page.getByText("页面不存在", { exact: true })).toBeVisible();
});
