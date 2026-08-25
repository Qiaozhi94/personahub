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
  await page.locator('[data-document="issue-done"] .evidence-row').first().click();
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

await check("一级入口钉在左栏底部，与列表控件分开（§4.1）", async () => {
  const foot = page.locator(".sidebar-foot:visible");
  const navCount = await foot.locator("> button").count();
  if (navCount !== 4) throw new Error(`一级入口应为 4 个，实际 ${navCount}`);
  if (!(await foot.locator('[data-surface="library"]').innerText()).includes("能力库")) {
    throw new Error("AI 成员入口未带文字（PRD §10 要求一级可见）");
  }
  const footBox = await foot.boundingBox();
  const toolbar = await page.locator(".explorer-toolbar:visible").boundingBox();
  if (!footBox || !toolbar || footBox.y <= toolbar.y) throw new Error("一级入口未在列表下方");
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

  const cards = await stage.locator(".outcome-state > div").allInnerTexts();
  if (cards.length !== 3) throw new Error(`成果状态条应为三卡，实际 ${cards.length}`);
  const joined = cards.join(" ");
  for (const want of ["系统记录", "实际变化", "验证独立性"]) {
    if (!joined.includes(want)) throw new Error(`成果状态条缺少「${want}」`);
  }
  if (/\d+%/.test(joined)) throw new Error("出现百分比信任评分（design.md §4.2 明确禁止）");

  const rows = await stage.locator(".evidence-row").count();
  if (rows !== 3) throw new Error(`完成要求应逐条挂依据，实际 ${rows} 条`);
  if (!(await stage.locator(".evidence-row.pending").isVisible())) {
    throw new Error("未验证项没有显式标记，用户会误以为全部已验证");
  }

  const steps = await stage.locator(".plan-step").count();
  if (steps !== 3) throw new Error(`执行计划应在成果面上（从 V2 概览搬入），实际 ${steps} 步`);
  await page.screenshot({ path: "shots/outcome-waiting.png", fullPage: true });
});

await check("舞台是单例：点进文件后可返回任务（§4.2）", async () => {
  await page.locator('[data-document="issue-view"] .evidence-row[data-open="file-code"]').click();
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
  if (await page.locator('[data-room-tab="overview"]').count()) {
    throw new Error("概览 tab 应已拆解（高频上提常驻，执行计划下沉成果面）");
  }
});

await check("Dock 跟随任务切换，可显式固定（§4.3）", async () => {
  await page.locator('[data-open="issue-validation"]').first().click();
  await page.locator("[data-dock-target]").filter({ hasText: "验证未收敛" }).waitFor();
  await page.locator("[data-dock-pin]").click();
  await page.locator('[data-open="issue-running"]').first().click();
  await page.locator("[data-dock-target]").filter({ hasText: "验证未收敛" }).waitFor();
  await page.locator("[data-dock-pin]").click();
  await page.locator("[data-dock-target]").filter({ hasText: "运行中" }).waitFor();
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
  await page.locator("[data-dock-target]").filter({ hasText: "项目会话" }).waitFor();
  if (await page.locator(".room-tabs").isVisible()) throw new Error("项目会话不该显示任务阶段 tab");
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
  if ((await doc.locator(".evidence-row .ok").count()) !== 3) throw new Error("完成要求未全部拿到依据");
  if (await doc.locator(".evidence-row.pending").count()) throw new Error("已完成却仍有未验证项");
  if (!(await doc.locator(".outcome-followup").isVisible())) throw new Error("验证员的后续建议消失了");
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

await check("Dock 两个会话各自说明「我是谁的、覆盖多久」（§4.3.2）", async () => {
  await page.locator('.work-item[data-open="issue-view"]').click();
  await page.locator('[data-room-tab="room"]').click();
  const roomOrigin = page.locator('[data-room-panel="room"] .room-origin');
  if (!(await roomOrigin.isVisible())) throw new Error("协作现场缺少来源行");
  const roomText = await roomOrigin.innerText();
  if (!roomText.includes("阶段")) throw new Error("协作现场未说明只覆盖一个阶段");
  if (!(await roomOrigin.locator(".linklike").isVisible())) throw new Error("协作现场未指向所属任务");
  await page.locator('[data-room-tab="primary"]').click();
  const primaryOrigin = page.locator('[data-room-panel="primary"] .room-origin');
  if (!(await primaryOrigin.isVisible())) throw new Error("任务会话缺少来源行");
  if (!(await primaryOrigin.innerText()).includes("全程")) throw new Error("任务会话未说明贯穿全程");
  for (const tab of ["primary", "room"]) {
    const title = await page.locator(`[data-room-tab="${tab}"]`).getAttribute("title");
    if (!title) throw new Error(`${tab} tab 缺少悬停说明`);
  }
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

await check("Dock 显示当前这个协作现场，不是永远同一个（§5 原则 1）", async () => {
  await page.locator('.work-item[data-open="issue-view"]').click();
  await page.locator('[data-room-tab="room"]').click();
  const first = await page.locator('[data-room-panel]:visible .room-thread-heading strong').innerText();
  if (!first.includes("Implementation")) throw new Error(`任务「协作现场支持暂停」应配 Implementation 现场，实际 ${first}`);
  await page.locator('[data-open="room-view"]').first().click();
  await page.locator('[data-room-tab="room"]').click();
  const second = await page.locator('[data-room-panel]:visible .room-thread-heading strong').innerText();
  if (!second.includes("Research")) throw new Error(`打开 Research 现场后 Dock 仍显示 ${second}`);
  if ((await page.locator('[data-room-panel]:visible').count()) !== 1) throw new Error("同时有多个协作现场面板可见");
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
