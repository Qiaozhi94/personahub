/* PersonaHub V3 验收
 * 断言直接取自 docs/design.md 的结构判断：某一条被改掉，这里会红。
 */
import fs from "node:fs";
import { chromium } from "playwright";

const baseUrl = process.env.PERSONAHUB_V3_URL ?? "http://127.0.0.1:4179/index.html";
const browserCandidates = [
  process.env.PERSONAHUB_V3_BROWSER,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
].filter(Boolean);
const executablePath = browserCandidates.find((path) => fs.existsSync(path));
const browser = await chromium.launch({ headless: true, executablePath });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() !== "error") return;
  if (m.location()?.url?.includes("favicon")) return;
  consoleErrors.push(m.text());
});
page.on("pageerror", (e) => consoleErrors.push(e.message));

const checks = [];
const failures = [];
async function check(name, action) {
  try {
    await action();
    checks.push(name);
  } catch (error) {
    failures.push(`${name} → ${error.message}`);
  }
}

await page.goto(baseUrl, { waitUntil: "networkidle" });

// §4 布局：舞台是主角 ─────────────────────────────────────
await check("舞台占据主要宽度，Dock 与左栏是配角（design.md §4）", async () => {
  const stage = await page.locator(".editor-area").boundingBox();
  const dock = await page.locator("[data-room-dock]").boundingBox();
  const sidebar = await page.locator(".project-explorer").boundingBox();
  const ratio = stage.width / 1440;
  if (ratio < 0.5) throw new Error(`舞台仅占 ${(ratio * 100).toFixed(1)}%，未成为主角`);
  if (Math.abs(stage.width - dock.width) < 80) throw new Error("舞台与 Dock 接近等宽，回到了 V2 的对半结构");
  if (sidebar.width > 280) throw new Error(`左栏 ${sidebar.width}px 过宽`);
});

await check("已删除 IDE 隐喻：底部执行面板、底部状态栏、图标活动栏（§4.5）", async () => {
  for (const [sel, label] of [[".bottom-panel", "底部执行面板"], [".statusbar", "底部状态栏"], [".activity-rail", "图标活动栏"]]) {
    if (await page.locator(sel).isVisible().catch(() => false)) throw new Error(`${label}仍然可见`);
  }
});

// §4.2.1 任务 tab 条 ──────────────────────────────────────
await check("舞台顶部是任务 tab，不是文件 tab（§4.2.1）", async () => {
  const strip = page.locator("[data-task-tabs]:visible");
  if (!(await strip.isVisible())) throw new Error("任务 tab 条不可见");
  const opens = await strip.locator(".editor-tab").evaluateAll((els) => els.map((e) => e.dataset.open));
  if (!opens.length) throw new Error("tab 条为空");
  const nonTask = opens.filter((id) => !/^(issue-|room-|project-overview)/.test(id));
  if (nonTask.length) throw new Error(`tab 应只承载任务，出现文件 tab ${JSON.stringify(nonTask)}`);
  if (await page.locator(".stage-bar").isVisible()) {
    throw new Error("未进入子文档时 stage-bar 不应占一行（会和 tab 条叠成两行 chrome）");
  }
});

await check("子文档在所属任务的 tab 内切换，不新开 tab（§4.2.1）", async () => {
  await page.locator('.work-item[data-open="issue-done"]').click();
  const before = await page.locator("[data-task-tabs] .editor-tab").count();
  await page.locator('[data-document="issue-done"] .outcome-file').first().click();
  const after = await page.locator("[data-task-tabs] .editor-tab").count();
  if (after !== before) throw new Error(`子文档新开了 tab（${before} → ${after}）`);
  if (!(await page.locator(".stage-bar:visible").isVisible())) throw new Error("子文档缺少返回条");
  if (!(await page.locator('[data-task-tabs] .editor-tab.active[data-open="issue-done"]').isVisible())) {
    throw new Error("子文档期间所属任务的 tab 未保持选中");
  }
  await page.locator("[data-stage-back]").click();
});

// §4.1 左栏 ───────────────────────────────────────────────
await check("预览 tab：连点多个任务不攒 tab（§4.2.1）", async () => {
  const before = await page.locator("[data-task-tabs] .editor-tab").count();
  for (const id of ["issue-new", "issue-validation", "issue-permission"]) {
    await page.locator(`.work-item[data-open="${id}"]`).click();
  }
  const after = await page.locator("[data-task-tabs] .editor-tab").count();
  if (after !== before + 1) throw new Error(`连点 3 个任务应只多出 1 个预览 tab，实际 ${before} → ${after}`);
  const preview = page.locator("[data-task-tabs] .editor-tab.preview");
  if ((await preview.count()) !== 1) throw new Error("预览 tab 不唯一");
  await preview.click();
  if (await page.locator("[data-task-tabs] .editor-tab.preview").count()) throw new Error("点 tab 未钉住");
});

await check("左栏是单一列表，没有第二层 tab（§4.1）", async () => {
  if (await page.locator(".explorer-mode-tabs").count()) {
    throw new Error("「任务 | 资源库」二级 tab 仍在（V3.1 已改为可折叠分节）");
  }
  const groups = await page.locator(".nav-group .group-head > span:not(.twisty)").allInnerTexts();
  for (const want of ["需要你处理", "正在进行", "最近完成", "文档与素材", "产出", "知识"]) {
    if (!groups.some((g) => g.trim() === want)) throw new Error(`左栏缺少「${want}」分节`);
  }
});

await check("一级入口与搜索同行，设置单独留在底部（§4.1）", async () => {
  const icons = page.locator(".explorer-toolbar:visible .nav-icons");
  const navCount = await icons.locator("> button").count();
  if (navCount !== 3) throw new Error(`顶部一级入口应为 3 个，实际 ${navCount}`);
  for (const surface of ["project", "library", "automation"]) {
    if (!(await icons.locator(`[data-surface="${surface}"]`).isVisible())) {
      throw new Error(`顶部缺少 ${surface} 入口`);
    }
  }
  // 纯图标必须有 tooltip 与无障碍名，否则 V2 的辨识度问题会原样搬回来
  const lib = icons.locator('[data-surface="library"]');
  if (!((await lib.getAttribute("title")) || "").includes("能力库")) throw new Error("图标入口缺少 title 说明");
  if (!(await lib.getAttribute("aria-label"))) throw new Error("图标入口缺少 aria-label");

  const iconBox = await icons.boundingBox();
  const search = await page.locator(".explorer-toolbar:visible label").boundingBox();
  if (Math.abs(iconBox.y - search.y) > 6) throw new Error("一级入口未与搜索框同行");

  const foot = page.locator(".sidebar-foot:visible");
  if ((await foot.locator("> button").count()) !== 1) throw new Error("底部应只剩设置一个入口");
  const footBox = await foot.boundingBox();
  if (!footBox || footBox.y <= iconBox.y) throw new Error("设置未在底部");
});

await check("分节可折叠，资源库默认收起（§4.1 / §7.3）", async () => {
  const docs = page.locator('[data-nav-group="docs"]');
  if (!(await docs.getAttribute("class")).includes("collapsed")) throw new Error("资源库分节默认应收起");
  await docs.locator(".group-head").click();
  if (!(await docs.locator(".group-body").isVisible())) throw new Error("展开无效");
  const attention = page.locator('[data-nav-group="attention"]');
  await attention.locator(".group-head").click();
  if (await attention.locator(".group-body").isVisible()) throw new Error("折叠无效");
  await attention.locator(".group-head").click();
  await docs.locator(".group-head").click();
});

await check("跨项目注意力降级为范围切换，不占独立工作面（§7.1）", async () => {
  await page.locator('[data-task-scope="all"]').click();
  await page.locator("[data-toast]").filter({ hasText: "全部项目" }).waitFor({ state: "visible" });
  await page.locator('[data-task-scope="project"]').click();
});

// §4.2 成果面 ─────────────────────────────────────────────
await check("成果面首屏回答「做成什么样、可不可信」（§4.2）", async () => {
  await page.locator('[data-explorer-panel="work"] [data-open="issue-view"]').first().click();
  const stage = page.locator('[data-document="issue-view"]');
  await stage.locator("h1").filter({ hasText: "协作现场支持暂停" }).waitFor();

  const cards = await stage.locator(".outcome-state > button.state-card").allInnerTexts();
  if (cards.length !== 3) throw new Error(`成果状态条应为三卡，实际 ${cards.length}`);
  const joined = cards.join(" ");
  for (const want of ["覆盖", "对齐", "时序"]) {
    if (!joined.includes(want)) throw new Error(`成果状态条缺少「${want}」`);
  }
  if (/\d+%/.test(joined)) throw new Error("出现百分比信任评分（design.md §4.2 明确禁止）");

  const rows = await stage.locator(".claim").count();
  if (rows !== 3) throw new Error(`完成要求应逐条挂依据，实际 ${rows} 条`);
  if (!(await stage.locator(".claim.unproven-claim").isVisible())) {
    throw new Error("未验证项没有显式标记，用户会误以为全部已验证");
  }

  const steps = await stage.locator(".pp-step").count();
  if (steps !== 5) throw new Error(`实现/验证双列应在成果面上，实际 ${steps} 步`);
  await page.screenshot({ path: "shots/outcome-waiting.png", fullPage: true });
});

// §4.2.4 可信度表达 ───────────────────────────────────────
// 信任不来自更好的摘要（摘要恰好是 agent 最容易凭空写出来的东西），
// 只来自：信源分层 + 抽查成本接近零 + 主动暴露没有被证明的部分。
await check("每条陈述标明信源：机器事实与 Agent 的说法不混同（§4.2.4）", async () => {
  const stage = page.locator('[data-document="issue-view"]');
  if (!(await stage.locator(".source-legend").isVisible())) throw new Error("成果面没有信源图例，用户学不会哪些像素可能骗人");
  if ((await stage.locator(".src-badge.machine").count()) < 3) throw new Error("机器事实没有被标出来");
  if ((await stage.locator(".src-badge.agent").count()) < 2) throw new Error("Agent 的说法没有被标出来，它正长成事实的样子");

  // 文件说明是 agent 写的，必须带 agent 标记而不是裸文本
  const note = stage.locator(".outcome-file .agent-note").first();
  if (!(await note.isVisible())) throw new Error("成员写的文件说明没有和机器事实拉开距离");
});

await check("三张卡是用例视角的抽屉：就地展开，不跳页（§4.2.4）", async () => {
  const stage = page.locator('[data-document="issue-view"]');
  await stage.locator('[data-drawer-toggle="view-cover"]').click();
  const cover = stage.locator('[data-drawer-body="view-cover"]');
  await cover.waitFor({ state: "visible" });
  if ((await cover.locator(".cover-row").count()) !== 3) throw new Error("覆盖表没有逐条列出完成要求");
  if (!(await cover.locator(".cover-row.gap").isVisible())) throw new Error("没有标出覆盖缺口");
  if (!(await stage.isVisible())) throw new Error("展开把用户带离了成果面");

  // 三卡互斥，不能同时撑开
  await stage.locator('[data-drawer-toggle="view-align"]').click();
  if (await cover.isVisible()) throw new Error("三个抽屉可同时展开，下文会被推到屏幕外");

  // 对齐是整条链上唯一需要人看的断点：用例必须能追到设计稿
  const align = stage.locator('[data-drawer-body="view-align"]');
  const alignText = await align.innerText();
  if (!alignText.includes("设计稿")) throw new Error("对齐抽屉没有把用例追回设计文档");
  if (!(await align.locator(".cover-row.gap").isVisible())) throw new Error("没有标出对齐缺口");
  await stage.locator('[data-drawer-toggle="view-align"]').click();
});

await check("用例必须先于实现固定，破线要顶到首屏（§4.2.4 / ADR 0009）", async () => {
  const stage = page.locator('[data-document="issue-view"]');
  const alert = stage.locator("[data-fence-alert]");
  if (!(await alert.isVisible())) throw new Error("实现期间改过用例，但首屏没有提示");
  if (!(await alert.innerText()).includes("实现开始后")) throw new Error("破线提示没有说清是时序问题");

  await stage.locator('[data-drawer-toggle="view-order"]').click();
  const order = stage.locator('[data-drawer-body="view-order"]');
  await order.waitFor({ state: "visible" });
  const timeline = await order.locator(".raw-block pre").innerText();
  for (const want of ["用例集 r1 冻结", "实现 Run #2 开始"]) {
    if (!timeline.includes(want)) throw new Error(`时间轴缺少「${want}」`);
  }
  if ((await order.locator(".raw-block pre .del").count()) < 2) throw new Error("破线的两次未被标红");
  await stage.locator('[data-drawer-toggle="view-order"]').click();
});

await check("实现与验证双列等重，中间是上下文围栏（ADR 0009）", async () => {
  const stage = page.locator('[data-document="issue-view"]');
  const plan = stage.locator(".pair-plan");
  await plan.scrollIntoViewIfNeeded();
  if (!(await plan.isVisible())) throw new Error("执行计划没有改成实现/验证双列");

  const cols = plan.locator(".pp-col");
  if ((await cols.count()) !== 2) throw new Error("双列结构不完整");
  const left = await cols.nth(0).boundingBox();
  const right = await cols.nth(1).boundingBox();
  if (Math.abs(left.width - right.width) > 4) throw new Error("实现与验证两列不等宽——验证被做轻了");

  const fence = plan.locator("[data-pp-fence]");
  if (!(await fence.isVisible())) throw new Error("缺少上下文围栏");
  if (!(await fence.innerText()).includes("看不到")) throw new Error("围栏没有说明它隔离了什么");

  // 围栏右侧的步骤必须标明是冷启动
  const cold = cols.nth(1).locator(".pp-mode.cold");
  if (!(await cold.isVisible())) throw new Error("验证步骤没有标明冷启动");
  if (!(await cold.innerText()).includes("自述")) throw new Error("没有说明冷启动隔离掉了什么");
});

await check("完成要求就地展开可证伪切片（§4.2.4）", async () => {
  const stage = page.locator('[data-document="issue-view"]');
  const head = stage.locator(".claim .claim-head").first();
  await head.click();
  const body = stage.locator(".claim .claim-body").first();
  await body.waitFor({ state: "visible" });
  if (!(await body.locator(".proof-test > code").first().isVisible())) throw new Error("展开后没有测试名，无法核对这条要求靠什么成立");
  if (!(await body.locator(".raw-block pre").first().isVisible())) throw new Error("展开后没有断言的实际输出");
  if (!(await body.locator(".proof-author").first().isVisible())) throw new Error("没有说明这个测试是谁写的");
  await head.click();
  if (await body.isVisible()) throw new Error("依据无法收起");
});

await check("「还没有被证明」常驻，成功态也要认怂（§4.2.4）", async () => {
  const stage = page.locator('[data-document="issue-view"]');
  const section = stage.locator(".outcome-section.unproven-section");
  if (!(await section.isVisible())) throw new Error("成果面只报喜，没有固定的缺口段");
  const items = await section.locator(".unproven-list > li").count();
  if (items < 1) throw new Error("缺口段是空的，但这份成果显然还没有独立验证");
  if (!(await section.innerText()).includes("独立验证")) throw new Error("最大的一个缺口（没有独立验证）没有写在缺口段里");
  // 舞台自己滚动，fullPage 截不到下半屏，先把缺口段滚进视口
  await section.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "shots/outcome-unproven.png" });
  await page.locator('[data-document="issue-view"] .task-heading').scrollIntoViewIfNeeded();
});

await check("舞台是单例：点进文件后可返回任务（§4.2）", async () => {
  await page.locator('[data-document="issue-view"] .outcome-file[data-open="file-code"]').first().click();
  await page.locator('[data-document="file-code"]').waitFor({ state: "visible" });
  const back = page.locator("[data-stage-back]");
  if (!(await back.isVisible())) throw new Error("从成果面点入后没有返回入口");
  await page.screenshot({ path: "shots/stage-child-file.png", fullPage: true });
  await back.click();
  await page.locator('[data-document="issue-view"]').waitFor({ state: "visible" });
  if (await back.isVisible()) throw new Error("返回后仍显示返回按钮");
});

// §4.3 协作 Dock ──────────────────────────────────────────
await check("执行状态常驻，不需要切 tab 才能看到（§4.3）", async () => {
  const status = page.locator("[data-dock-status]");
  if (!(await status.isVisible())) throw new Error("Dock 缺少常驻执行状态");
  const text = await status.innerText();
  if (!text.includes("实现者") || !text.includes("2 / 3 步")) throw new Error(`执行状态内容不完整：${text}`);
  if (!text.includes("卡在")) throw new Error("阻塞原因未常驻显示");
  if ((await status.locator(".dock-status-line").count()) !== 1) throw new Error("执行状态应收敛为一行");
  if (await page.locator("[data-room-tab]").count()) throw new Error("Dock 不应再有会话 tab");

  // Dock 不重复舞台已经说过的话：任务名归舞台标题
  // 任务名归舞台标题；Dock 只在收件人被固定到别的任务时才写任务名
  const chrome = await page.locator("[data-room-dock]").innerText();
  const beforeStream = chrome.split("我")[0];
  if (beforeStream.includes("协作现场支持暂停")) throw new Error("Dock 顶部重复了舞台标题里的任务名");
});

await check("收件人跟随任务切换，可显式固定（§4.3）", async () => {
  await page.locator('[data-open="issue-validation"]').first().click();
  await page.locator("[data-dock-target]").filter({ hasText: "@架构研究员" }).waitFor();
  await page.locator("[data-dock-pin]").click();

  // 固定后切任务：收件人不跟随，且必须持续说明它属于哪个任务
  await page.locator('[data-open="issue-running"]').first().click();
  await page.locator("[data-dock-target]").filter({ hasText: "@架构研究员" }).waitFor();
  const note = page.locator("[data-dock-parent]");
  if (!(await note.isVisible())) throw new Error("固定后没有持续提示收件人属于哪个任务");
  if (!(await note.innerText()).includes("修复验证循环恢复")) throw new Error("固定提示未写明所属任务");

  await page.locator("[data-dock-pin]").click();
  await page.locator("[data-dock-target]").filter({ hasText: "@Claude" }).waitFor();
  if (await note.isVisible()) throw new Error("取消固定后仍显示固定提示");
});

await check("Dock 只有一个输入框，收件人是显式的一件事（§4.3.2）", async () => {
  await page.locator('.work-item[data-open="issue-view"]').click();
  const composers = await page.locator('[data-room-panel].active textarea').count();
  if (composers !== 1) throw new Error(`当前面板应只有 1 个输入框，实际 ${composers}`);

  // 输入框上方复述收件人，打字时看得见发给谁
  const to = page.locator('[data-room-panel].active [data-composer-to]');
  if (!(await to.isVisible())) throw new Error("输入框上方没有复述收件人");
  if ((await to.innerText()) !== (await page.locator("[data-dock-target]").innerText())) {
    throw new Error("顶部收件人与输入框上方不一致");
  }

  // 选择器把「发给任务」和「发给成员」两类摊开
  await page.locator("[data-recipient-open]").click();
  const popover = page.locator("[data-recipient-popover]");
  await popover.waitFor({ state: "visible" });
  if (!(await popover.locator('[data-recipient="task"]').isVisible())) throw new Error("收件人里没有「这个任务」");
  if ((await popover.locator('[data-recipient="member"]').count()) < 2) throw new Error("收件人里没有列出成员");
  await popover.locator('[data-recipient-label="@实现者"]').click();
  await page.locator("[data-dock-target]").filter({ hasText: "@实现者" }).waitFor();
  if (!(await to.innerText()).includes("@实现者")) throw new Error("切换收件人后输入框上方未同步");
});

await check("暂停是持久状态，不只是一条会消失的 toast（§6）", async () => {
  await page.locator('[data-open="issue-view"]').first().click(); // 暂停属于协作现场
  await page.locator("[data-room-pause]:visible").first().click();
  const banner = page.locator(".dock-paused-banner");
  await banner.waitFor({ state: "visible" });
  await page.waitForTimeout(2600); // toast 已消失，横幅必须还在
  if (!(await banner.isVisible())) throw new Error("toast 消失后暂停状态不再可见");
  await banner.locator("button").click();
  await banner.waitFor({ state: "hidden" });
});

await check("没有选中任务时 Dock 仍有意义：项目级会话（§4.3.1）", async () => {
  await page.locator(".project-thread-entry").click();
  await page.locator('[data-room-panel="project"].active').waitFor({ state: "visible" });
  await page.locator("[data-dock-target]").filter({ hasText: "这个项目" }).waitFor();
  if (await page.locator(".room-tabs").count()) throw new Error("Dock 不应再有会话 tab");
  if (await page.locator('[data-room-panel="project"] [data-inline-room]').count()) {
    throw new Error("项目会话不该出现协作现场段");
  }
  await page.locator('[data-document="project-overview"]').waitFor({ state: "visible" });
  await page.screenshot({ path: "shots/project-thread.png", fullPage: true });
});

await check("阅读模式把 Dock 收成竖条，且能点回来（§4.4）", async () => {
  await page.locator('[data-open="issue-view"]').first().click();
  await page.locator('[data-layout-mode="reading"]').click();
  await page.locator("[data-dock-rail]").waitFor({ state: "visible" });
  const stage = await page.locator(".editor-area").boundingBox();
  if (stage.width / 1440 < 0.75) throw new Error(`阅读模式舞台仅 ${(stage.width / 1440 * 100).toFixed(1)}%`);
  await page.screenshot({ path: "shots/layout-reading.png", fullPage: true });
  await page.locator("[data-dock-rail]").click();
  await page.locator("[data-dock-status]").waitFor({ state: "visible" });
});

await check("命令面板可开可关", async () => {
  await page.locator("[data-command-open]").click();
  await page.locator("[data-command-overlay]").waitFor({ state: "visible" });
  await page.keyboard.press("Escape");
  await page.locator("[data-command-overlay]").waitFor({ state: "hidden" });
});

await check("四个任务态共用同一套成果面结构（§4.2.2）", async () => {
  for (const [id, label] of [["issue-new", "刚创建"], ["issue-view", "等待指派"], ["issue-running", "执行中"], ["issue-done", "已完成"]]) {
    await page.locator(`.work-item[data-open="${id}"]`).click();
    const doc = page.locator(`[data-document="${id}"]`);
    const cls = await doc.getAttribute("class");
    if (!cls.includes("outcome-surface")) throw new Error(`${label}态不是成果面`);
    const cards = await doc.locator(".outcome-state > div").count();
    if (cards !== 3) throw new Error(`${label}态首屏状态卡应为 3 张，实际 ${cards}`);
    const sections = await doc.locator(".outcome-section").count();
    if (sections < 4) throw new Error(`${label}态段落不足（${sections} < 4）`);
  }
});

await check("刚创建态用空态表达「还没发生」，不填占位数字（§4.2.2 / §6）", async () => {
  await page.locator('.work-item[data-open="issue-new"]').click();
  const doc = page.locator('[data-document="issue-new"]');
  if ((await doc.locator(".outcome-empty").count()) !== 2) throw new Error("成果与执行计划应各有一处空态");
  if (await doc.locator(".outcome-file").count()) throw new Error("尚未执行却列出了产出文件");
  if ((await doc.locator(".evidence-row .ok").count()) !== 0) throw new Error("尚未执行却有已达成的依据");
});

await check("执行中态：活动常驻正文，计划标出正在跑的那一步（§4.2.2）", async () => {
  await page.locator('.work-item[data-open="issue-running"]').click();
  const doc = page.locator('[data-document="issue-running"]');
  if (!(await doc.locator(".outcome-live").isVisible())) throw new Error("缺少常驻活动条");
  if ((await doc.locator(".plan-step.doing").count()) !== 1) throw new Error("执行计划未标出正在跑的步骤");
  if ((await doc.locator(".evidence-row.inflight").count()) < 1) throw new Error("未区分「还没拿到依据」的要求");
});

await check("已完成态：依据全部可点，后续建议不被吞掉（§4.2.2）", async () => {
  await page.locator('.work-item[data-open="issue-done"]').click();
  const doc = page.locator('[data-document="issue-done"]');
  if ((await doc.locator(".claim .ok").count()) !== 3) throw new Error("完成要求未全部拿到依据");
  if (await doc.locator(".claim.unproven-claim").count()) throw new Error("已完成却仍有未验证项");
  if (!(await doc.locator(".outcome-followup").isVisible())) throw new Error("验证员的后续建议消失了");
  // 成功态照样要认怂：三张全绿不等于什么都验过了（§4.2.4）
  const gaps = doc.locator(".outcome-section.unproven-section");
  if (!(await gaps.isVisible())) throw new Error("已完成态没有「还没有被证明」段，绿卡会被读成全部验过");
  if ((await gaps.locator(".unproven-list > li").count()) < 1) throw new Error("已完成态的缺口段是空的");
});

await check("七个任务态的可信度表达同构（§4.2.4）", async () => {
  const ids = ["issue-new", "issue-view", "issue-running", "issue-research", "issue-validation", "issue-permission", "issue-done"];
  for (const id of ids) {
    await page.locator(`.work-item[data-open="${id}"]`).click();
    const doc = page.locator(`[data-document="${id}"]`);
    if (!(await doc.locator(".source-legend").isVisible())) throw new Error(`${id} 缺少信源图例`);
    const cards = await doc.locator(".outcome-state > button.state-card").count();
    if (cards !== 3) throw new Error(`${id} 的状态卡不是三个可展开的证据抽屉（实际 ${cards}）`);
    const drawers = await doc.locator(".state-drawer").count();
    if (drawers !== 3) throw new Error(`${id} 的抽屉数量不对（实际 ${drawers}）`);
    if (!(await doc.locator(".outcome-section.unproven-section").isVisible())) {
      throw new Error(`${id} 没有「还没有被证明」段——七态必须同构，否则重演「只有几个态是成果面」`);
    }
  }
});

await check("七个任务态全部是成果面，无 V2 遗留版式（§4.2.2）", async () => {
  const ids = ["issue-new", "issue-view", "issue-running", "issue-research", "issue-validation", "issue-permission", "issue-done"];
  for (const id of ids) {
    await page.locator(`.work-item[data-open="${id}"]`).click();
    const doc = page.locator(`[data-document="${id}"]`);
    if (!(await doc.getAttribute("class")).includes("outcome-surface")) throw new Error(`${id} 不是成果面`);
    if ((await doc.locator(".outcome-state > div").count()) !== 3) throw new Error(`${id} 状态卡不是 3 张`);
    if ((await doc.locator(".outcome-section").count()) < 4) throw new Error(`${id} 段落不足`);
    for (const legacy of [".room-summary", ".task-toolbar", ".task-grid", ".finding-compare"]) {
      if (await doc.locator(legacy).count()) throw new Error(`${id} 仍有 V2 版式 ${legacy}`);
    }
  }
});

await check("阻塞态自带动作，不只是一条说明（§4.2.2 / §6）", async () => {
  await page.locator('.work-item[data-open="issue-permission"]').click();
  const block = page.locator('[data-document="issue-permission"] .outcome-block');
  if (!(await block.isVisible())) throw new Error("权限确认缺少阻塞条");
  if ((await block.locator("button").count()) !== 2) throw new Error("允许 / 拒绝两个动作应就在阻塞条上");
  if ((await page.locator('[data-document="issue-permission"] .permission-scope > div').count()) !== 4) {
    throw new Error("「你在批准什么」应逐条列出，含拒绝后果");
  }
  if ((await page.locator('[data-document="issue-permission"] .plan-step.blocked').count()) !== 1) {
    throw new Error("执行计划未标出被阻塞的那一步");
  }
});

await check("验证未收敛：打回的要求展开两轮结论（§4.2.2）", async () => {
  await page.locator('.work-item[data-open="issue-validation"]').click();
  const doc = page.locator('[data-document="issue-validation"]');
  const failed = doc.locator(".evidence-row.failed");
  if ((await failed.count()) !== 1) throw new Error("缺少「未通过」的完成要求");
  if ((await failed.locator(".round-compare .linklike").count()) !== 2) {
    throw new Error("未通过的要求应能同时点开两轮各自的结论，否则看不出是不是同一个问题");
  }
  if ((await doc.locator(".plan-step.failed").count()) !== 2) throw new Error("两轮失败应各占一个步骤，不能合并");
  if ((await doc.locator(".outcome-file").count()) !== 2) throw new Error("验证不通过不应回滚已有改动");
});

// §4.2.5 轨迹视图 ─────────────────────────────────────────
// 三个正交维度：舞台成果面按结构，Dock 会话按对话，轨迹按时间。
await check("轨迹在任务 tab 内切换，不新开 tab（§4.2.5 / §4.2.1）", async () => {
  await page.locator('.work-item[data-open="issue-view"]').click();
  const before = await page.locator("[data-task-tabs] .editor-tab").count();
  const stage = page.locator('[data-document="issue-view"]');
  await stage.locator('[data-stage-view="trace"]').click();

  const trace = stage.locator('[data-stage-pane="trace"]');
  await trace.waitFor({ state: "visible" });
  if (await stage.locator('[data-stage-pane="outcome"]').isVisible()) throw new Error("成果面与轨迹同时可见");
  if ((await page.locator("[data-task-tabs] .editor-tab").count()) !== before) throw new Error("轨迹新开了 tab");
  if (!(await page.locator('[data-task-tabs] .editor-tab.active[data-open="issue-view"]').isVisible())) {
    throw new Error("轨迹期间所属任务的 tab 未保持选中");
  }
  if ((await trace.locator(".trace-item").count()) < 6) throw new Error("轨迹内容过少，看不出一路发生了什么");
  await page.screenshot({ path: "shots/task-trace.png" });
});

await check("轨迹里每个 Run 标出上下文血统（ADR 0009）", async () => {
  const trace = page.locator('[data-document="issue-view"] [data-stage-pane="trace"]');

  const resume = trace.locator(".tr-lineage.resume");
  if (!(await resume.isVisible())) throw new Error("续跑的 Run 没有标出它继承了上下文");
  if (!(await resume.innerText()).includes("续跑")) throw new Error("续跑标记看不出是续跑");

  const cold = trace.locator(".tr-lineage.cold");
  if (!(await cold.isVisible())) throw new Error("跨围栏的步骤没有标出冷启动");
  if (!(await cold.innerText()).includes("自述")) throw new Error("冷启动没有说明它隔离掉了什么");

  // 原始 session 只能出现在诊断层（渐进披露，§5 原则 5）
  const diag = trace.locator(".tr-diag");
  if (!(await diag.count())) throw new Error("缺少诊断层");
  if ((await trace.innerText()).includes("~/.codex/sessions")) {
    throw new Error("原始 session 路径不该默认展开——它不是复盘真相源");
  }
});

await check("轨迹可按事件类型筛选，用例变更醒目（§4.2.5）", async () => {
  const trace = page.locator('[data-document="issue-view"] [data-stage-pane="trace"]');
  const total = await trace.locator(".trace-item").count();
  await trace.locator('[data-trace-filter="case"]').click();
  const shown = await trace.locator(".trace-item:visible").count();
  if (shown === 0) throw new Error("筛用例变更后一条都不剩");
  if (shown >= total) throw new Error("筛选没有生效");
  if ((await trace.locator(".trace-item.case:visible").count()) !== shown) throw new Error("筛选结果混入了其他类型");
  await trace.locator('[data-trace-filter="all"]').click();
  if ((await trace.locator(".trace-item:visible").count()) !== total) throw new Error("恢复全部失败");
  await page.locator('[data-document="issue-view"] [data-stage-view="outcome"]').click();
});

await check("协作现场是流里的一段，不是第二个阅读入口（§4.3.2）", async () => {
  await page.locator('.work-item[data-open="issue-view"]').click();
  const panel = page.locator('[data-room-panel].active');

  // 任务会话仍要说明自己贯穿全程
  const primaryOrigin = panel.locator(".room-origin");
  if (!(await primaryOrigin.isVisible())) throw new Error("任务会话缺少来源行");
  if (!(await primaryOrigin.innerText()).includes("全程")) throw new Error("任务会话未说明贯穿全程");

  // Room 作为可折叠段内嵌在同一条流里
  const room = panel.locator("[data-inline-room]");
  if (!(await room.isVisible())) throw new Error("协作现场没有内嵌进任务会话流");
  const meta = await room.locator(".ir-head").innerText();
  if (!meta.includes("现场")) throw new Error("内嵌段没有标明是协作现场");
  if (!meta.includes("名成员")) throw new Error("内嵌段没有说明成员规模");
  if (!(await room.locator(".ir-go").isVisible())) throw new Error("内嵌段没有指向舞台的结构视图");

  // 可折叠：Room 是组织单位，读不读由用户决定
  await room.locator("[data-inline-room-toggle]").click();
  if (await room.locator(".ir-body").isVisible()) throw new Error("协作现场段无法折叠");
  await room.locator("[data-inline-room-toggle]").click();
  if (!(await room.locator(".ir-body").isVisible())) throw new Error("协作现场段无法展开");
});

await check("协作现场舞台：前四段沿用，末段换成并行成员泳道（§4.2.3）", async () => {
  await page.locator('[data-open="room-view"]').first().click();
  const doc = page.locator('[data-document="room-view"]');
  if (!(await doc.getAttribute("class")).includes("outcome-surface")) throw new Error("协作现场不是成果面骨架");
  if ((await doc.locator(".outcome-state > div").count()) !== 3) throw new Error("状态卡不是 3 张");
  if (await doc.locator(".plan-list").count()) throw new Error("Room 的来历是并行成员，不该用线性 plan-list");
  const lanes = doc.locator(".member-lane");
  if ((await lanes.count()) !== 3) throw new Error("成员泳道应为 3 条");
  for (const state of ["done", "running", "queued"]) {
    if (!(await doc.locator(`.member-lane.${state}`).count())) throw new Error(`缺少 ${state} 态泳道`);
  }
  for (const legacy of [".room-summary", ".task-toolbar", ".task-grid"]) {
    if (await doc.locator(legacy).count()) throw new Error(`仍有 V2 版式 ${legacy}`);
  }
});

await check("介入动作挂在成员身上，不是全局工具条（§4.2.3）", async () => {
  const doc = page.locator('[data-document="room-view"]');
  for (const lane of await doc.locator(".member-lane").all()) {
    if ((await lane.locator(".lane-actions button").count()) < 2) throw new Error("每条泳道至少要有两个成员级动作");
  }
  const queued = doc.locator(".member-lane.queued");
  if (!(await queued.locator(".lane-block").isVisible())) throw new Error("排队中的成员未说明前置为什么没满足");
});

await check("协作现场说明来源与选人理由（§4.2.3 / PRD 第 5 节）", async () => {
  const doc = page.locator('[data-document="room-view"]');
  const origin = doc.locator(".stage-origin");
  if (!(await origin.isVisible())) throw new Error("缺少来源行");
  if (!(await origin.locator(".linklike").isVisible())) throw new Error("来源行未指回所属任务");
  const why = doc.locator(".room-rationale");
  if (!(await why.isVisible())) throw new Error("缺少「为什么是这些人」——PRD 要求可查看 Coordinator 的选人依据");
  if ((await why.innerText()).length < 60) throw new Error("选人理由过短，等于没说");
});

await check("内嵌的协作现场跟随当前任务，不是永远同一个（§5 原则 1）", async () => {
  await page.locator('.work-item[data-open="issue-view"]').click();
  const first = await page.locator('[data-room-panel].active [data-inline-room] .ir-head').innerText();
  if (!first.includes("Implementation")) throw new Error(`任务「协作现场支持暂停」应配 Implementation 现场，实际 ${first}`);

  await page.locator('[data-open="room-view"]').first().click();
  const second = await page.locator('[data-room-panel].active [data-inline-room] .ir-head').innerText();
  if (!second.includes("Research")) throw new Error(`打开 Research 现场后内嵌段仍是 ${second}`);
  if ((await page.locator('[data-room-panel].active').count()) !== 1) throw new Error("同时有多个 Dock 面板可见");
});

await check("成员选择器把选人依据摊开，不建议的不隐藏（§4.6）", async () => {
  await page.locator('[data-open="room-view"]').first().click();
  await page.locator('[data-pick-member="synthesizer"]').click();
  const picker = page.locator("[data-member-picker]:visible");
  if (!(await picker.isVisible())) throw new Error("成员选择器未打开");
  if (!(await picker.locator(".picker-rule").innerText()).includes("兼任")) {
    throw new Error("硬规则应在名单之前说明");
  }
  const rows = picker.locator(".picker-row");
  if ((await rows.count()) !== 4) throw new Error(`应列出能力库全部 4 名成员，实际 ${await rows.count()}`);
  const blocked = picker.locator(".picker-row.blocked");
  if ((await blocked.count()) < 1) throw new Error("不建议的成员应保留在列表里，而不是被藏掉");
  if (!(await blocked.first().isDisabled())) throw new Error("不建议的成员应不可选");
  for (const row of await rows.all()) {
    if (!(await row.locator(".pr-why").innerText()).trim()) throw new Error("每一行都必须写明理由");
  }
  const levels = await rows.evaluateAll((els) => els.map((e) => e.className.split(" ")[1]));
  const rank = { good: 0, weak: 1, blocked: 2 };
  for (let i = 1; i < levels.length; i += 1) {
    if (rank[levels[i]] < rank[levels[i - 1]]) throw new Error("建议的应排在不建议的前面");
  }
  await picker.locator("[data-picker-close]").first().click();
});

await check("实现与验证不能同源是硬约束（PRD 第 7.5 节）", async () => {
  await page.locator("[data-new-object]").click();
  await page.locator('[data-task-create-overlay] [data-pick-member="validator"]').click();
  const picker = page.locator("[data-member-picker]:visible");
  const impl = picker.locator('.picker-row[data-pick-member-id="implementer"]');
  if (!(await impl.getAttribute("class")).includes("blocked")) {
    throw new Error("本次实现者仍可被选为验证者——实现与验证不能同源没有落到界面上");
  }
  if (!(await impl.isDisabled())) throw new Error("同源成员应不可选，而不是只加个标签");
  if (!(await impl.locator(".pr-why").innerText()).includes("自己验自己")) throw new Error("未说明为什么不能选");
  await picker.locator("[data-picker-close]").first().click();
  await page.locator("[data-task-create-close]").first().click();
});

await check("指派有撤销窗口，不立刻判定「已指派」（§6）", async () => {
  await page.locator('[data-open="room-view"]').first().click();
  await page.locator('[data-pick-member="synthesizer"]').click();
  await page.locator('[data-member-picker]:visible .picker-row:not([disabled])').first().click();
  const bar = page.locator("[data-dispatch-undo]");
  if (!(await bar.isVisible())) throw new Error("指派后没有可取消的启动窗口");
  if (!(await bar.innerText()).includes("正在启动")) throw new Error("指派后立刻判定为已指派");
  if (!(await bar.locator("[data-undo-cancel]").isVisible())) throw new Error("启动窗口内没有取消入口");
  await bar.locator("[data-undo-cancel]").click();
  if (await bar.isVisible()) throw new Error("取消后启动窗口未收起");
});

await check("页面无横向溢出", async () => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 1) throw new Error(`横向溢出 ${overflow}px`);
});

await page.locator('[data-open="issue-view"]').first().click();
await page.screenshot({ path: "shots/workbench.png", fullPage: true });
await browser.close();

const result = { passed: checks.length, failed: failures.length, checks, failures, consoleErrors };
fs.writeFileSync("shots/browser-check.json", `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
if (failures.length || consoleErrors.length) process.exitCode = 1;
