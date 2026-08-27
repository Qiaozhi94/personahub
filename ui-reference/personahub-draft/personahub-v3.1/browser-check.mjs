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
  await stage.locator("h1").filter({ hasText: "artifact 引用不漂移" }).waitFor();

  // 三张卡是同一条「验证进度」轴上的三段，因此可以并列
  const cards = await stage.locator("[data-claim-filter-btn]").allInnerTexts();
  if (cards.length !== 3) throw new Error(`状态卡应为三张，实际 ${cards.length}`);
  const joined = cards.join(" ");
  for (const want of ["已独立验证", "有证据待验证", "需要你处理"]) {
    if (!joined.includes(want)) throw new Error(`状态卡缺少「${want}」`);
  }
  if (/\d+%/.test(joined)) throw new Error("出现百分比信任评分（design.md §4.2 明确禁止）");

  // 三个数字之和必须等于主张总数——这是它们能并列的前提
  const nums = joined.match(/\d+/g).map(Number);
  const total = await stage.locator("[data-claim-state]").count();
  const verified = nums[0];
  const pending = nums[2];
  const attention = nums[3];
  if (verified + pending + attention !== total) {
    throw new Error(`三张卡之和 ${verified}+${pending}+${attention} 不等于主张总数 ${total}`);
  }

  // 变更是历史事件，不在验证进度轴上，必须拆出独立一行
  const changeLine = stage.locator(".claim-change-line");
  if (!(await changeLine.isVisible())) throw new Error("缺少「上次查看后」变更行");
  if ((await stage.locator("[data-claim-filter-btn]").filter({ hasText: "变更" }).count())) {
    throw new Error("变更被混进了状态卡——它不在验证进度轴上");
  }

  await page.screenshot({ path: "shots/outcome-waiting.png", fullPage: true });
});

await check("每条陈述标明信源：机器事实与 Agent 的说法不混同（§4.2.4）", async () => {
  const stage = page.locator('[data-document="issue-view"]');
  if (!(await stage.locator(".source-legend").isVisible())) throw new Error("成果面没有信源图例，用户学不会哪些像素可能骗人");
  if ((await stage.locator(".src-badge.machine").count()) < 3) throw new Error("机器事实没有被标出来");
  if ((await stage.locator(".src-badge.agent").count()) < 2) throw new Error("Agent 的说法没有被标出来，它正长成事实的样子");

  // 文件说明是 agent 写的，必须带 agent 标记而不是裸文本
  const note = stage.locator(".outcome-file .agent-note").first();
  if (!(await note.isVisible())) throw new Error("成员写的文件说明没有和机器事实拉开距离");
});

await check("主张与证据之间有显式的「论证」（ADR 0010 / GSN Strategy）", async () => {
  const stage = page.locator('[data-document="issue-view"]');
  const claims = stage.locator("[data-claim-state]");
  if ((await claims.count()) < 3) throw new Error("主张树内容过少");

  // 有证据的主张必须写明「凭什么」——缺了它，主张与证据的联系只能靠读者脑补
  const withEvidence = stage.locator("[data-claim-state]").filter({ has: page.locator(".evidence-list") });
  const n = await withEvidence.count();
  if (n === 0) throw new Error("没有任何主张挂了证据");
  for (let i = 0; i < n; i += 1) {
    const item = withEvidence.nth(i);
    if (!(await item.locator(".claim-why").isVisible())) throw new Error("有证据的主张缺少「凭什么」");
    const why = await item.locator(".claim-why").innerText();
    if (why.length < 12) throw new Error(`论证过短，等于没说：${why}`);
    if (/^凭什么\s*(因为)?(测试)?通过了?$/.test(why.replace(/\s/g, ""))) {
      throw new Error("论证退化成同义反复");
    }
    // 每条有证据的主张都要给出结论，精确状态由文字承担
    if (!(await item.locator(".claim-verdict").isVisible())) throw new Error("有证据的主张缺少「结论」行");
  }
});

await check("只用三个符号，同源验证不冒充独立验证（提案 §3 / ADR 0010）", async () => {
  const stage = page.locator('[data-document="issue-view"]');
  const marks = await stage.locator(".claim-mark").allInnerTexts();
  const uniq = [...new Set(marks.map((m) => m.trim()))];
  if (uniq.some((m) => !["✓", "◐", "⚠"].includes(m))) {
    throw new Error(`出现三个符号之外的记号：${uniq.join(" ")}——使用者已反馈界面太复杂`);
  }

  // 同源验证必须落在 ◐，不能拿到绿勾；这正是 ADR 0009 上下文围栏的界面兑现
  const pending = stage.locator('[data-claim-state="pending"]').first();
  const verdict = await pending.locator(".claim-verdict").innerText();
  if (!verdict.includes("同源")) throw new Error("同源验证没有在结论里说明");
  if ((await pending.locator(".claim-mark").innerText()).trim() === "✓") {
    throw new Error("同源验证拿到了独立验证的绿勾");
  }

  // 独立验证过的主张要写明验证者拿不到实现者的自述
  const ok = stage.locator('[data-claim-state="verified"]').first();
  if (!(await ok.locator(".claim-verdict").innerText()).includes("独立验证通过")) {
    throw new Error("已验证主张的结论没有写明独立性");
  }
  if (!(await ok.locator(".evidence-list").innerText()).includes("冷启动")) {
    throw new Error("独立验证的证据没有标出冷启动");
  }
});

await check("证据用仓库里的天然标识，不新造编号体系（提案 §2）", async () => {
  const stage = page.locator('[data-document="issue-view"]');
  const text = await stage.locator(".evidence-list").first().innerText();
  if (!/\.test\.ts|\.tsx|\.md|\//.test(text)) throw new Error("证据没有使用测试名或文件路径这类天然标识");
  const all = await stage.locator("[data-claim-list]").innerText();
  if (/\b(TEST|SRC|FILE|REVIEW|COUNTER|VALIDATION)-\d+/.test(all)) {
    throw new Error("出现新造的 ID 前缀——证据对象本来就各自可寻址");
  }
});

await check("点状态卡筛主张树，可再次点击取消（提案 §6）", async () => {
  const stage = page.locator('[data-document="issue-view"]');
  const total = await stage.locator("[data-claim-state]").count();
  const btn = stage.locator('[data-claim-filter-btn="attention"]');
  await btn.click();
  const shown = await stage.locator("[data-claim-state]:visible").count();
  if (shown === 0) throw new Error("筛「需要你处理」后一条都不剩");
  if (shown >= total) throw new Error("筛选没有生效");
  if ((await stage.locator('[data-claim-state="attention"]:visible').count()) !== shown) {
    throw new Error("筛选结果混入了其他状态");
  }
  await btn.click();
  if ((await stage.locator("[data-claim-state]:visible").count()) !== total) throw new Error("再次点击未取消筛选");
});

await check("验收基线变更事前阻塞，新增证据不拦截（提案 §5）", async () => {
  const stage = page.locator('[data-document="issue-view"]');
  const gate = stage.locator("[data-baseline-gate]");
  if (!(await gate.isVisible())) throw new Error("验收基线被申请修改，但首屏没有拦住");
  const text = await gate.innerText();
  if (!text.includes("验收基线")) throw new Error("阻塞条没有说清拦的是验收基线");
  if (text.includes("修改主张的证据")) throw new Error("证据是已发生的记录，不存在修改");
  if (!text.includes("可能把主张改弱")) throw new Error("没有提示这次改动会削弱断言");
  if (!text.includes("已有证据保持不变")) throw new Error("没有说明新增证据不受影响");
  if ((await gate.locator(".bg-actions > button").count()) < 3) throw new Error("缺少批准 / 拒绝 / 看差异三个动作");
});

await check("范围血统默认收起，按需展开（提案 §9.2）", async () => {
  const stage = page.locator('[data-document="issue-view"]');
  const scope = stage.locator(".scope-line");
  if (!(await scope.innerText()).includes("US-002")) throw new Error("没有显示当前范围");
  const full = stage.locator("[data-scope-full]");
  if (await full.isVisible()) throw new Error("完整血统不该默认占首屏");
  await scope.locator("[data-scope-toggle]").click();
  await full.waitFor({ state: "visible" });
  if (!(await full.innerText()).includes("F009")) throw new Error("展开后没有完整路径");
  await scope.locator("[data-scope-toggle]").click();
  if (await full.isVisible()) throw new Error("血统无法收起");
});

await check("实现回归单独成段，不与端到端验收混算（ADR 0010 决策 3）", async () => {
  const stage = page.locator('[data-document="issue-view"]');
  const band = stage.locator(".regression-band");
  if (!(await band.isVisible())) throw new Error("实现回归没有单独成段");
  const text = await band.innerText();
  if (!text.includes("15 / 15")) throw new Error("回归数量未显示");
  if (!text.includes("不计入")) throw new Error("没有说明它不计入三张卡");
  // 主张树里不能出现把两者合计的数字
  if ((await stage.locator("[data-claim-list]").innerText()).includes("18 / 18")) {
    throw new Error("端到端与单元又被合计成一个数字");
  }
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
  if (beforeStream.includes("artifact 引用不漂移")) throw new Error("Dock 顶部重复了舞台标题里的任务名");
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
  if (!(await note.innerText()).includes("修复图重启的并发认领")) throw new Error("固定提示未写明所属任务");

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

await check("七个任务态共用同一套数据骨架（提案 §10）", async () => {
  const ids = ["issue-new", "issue-view", "issue-running", "issue-research", "issue-validation", "issue-permission", "issue-done"];
  for (const id of ids) {
    await page.locator(`.work-item[data-open="${id}"]`).click();
    const doc = page.locator(`[data-document="${id}"]`);

    // 骨架同构：三张卡 + 主张树 + 范围血统，在每个状态下都在
    if ((await doc.locator("[data-claim-filter-btn]").count()) !== 3) {
      throw new Error(`${id} 的状态卡不是三张`);
    }
    const claims = await doc.locator("[data-claim-state]").count();
    if (claims < 2) throw new Error(`${id} 的主张树内容过少（${claims}）`);
    if (!(await doc.locator(".scope-line").isVisible())) throw new Error(`${id} 缺少当前范围`);
    if (await doc.locator("[data-scope-full]").isVisible()) throw new Error(`${id} 的完整血统不该默认展开`);

    // 三张卡之和必须等于主张总数
    const nums = (await doc.locator("[data-claim-filter-btn]").allInnerTexts()).join(" ").match(/\d+/g).map(Number);
    if (nums[0] + nums[2] + nums[3] !== claims) {
      throw new Error(`${id} 三张卡之和 ${nums[0]}+${nums[2]}+${nums[3]} 不等于主张总数 ${claims}`);
    }

    // 符号只有三个
    const marks = [...new Set((await doc.locator(".claim-mark").allInnerTexts()).map((m) => m.trim()))];
    if (marks.some((m) => !["✓", "◐", "⚠"].includes(m))) {
      throw new Error(`${id} 出现三个符号之外的记号：${marks.join(" ")}`);
    }

    // 目标不再占首屏，收进折叠详情
    const detail = doc.locator(".outcome-detail");
    if (!(await detail.count())) throw new Error(`${id} 缺少「目标与完整执行计划」折叠段`);
  }
});

await check("首屏顺序按状态变化，不是七态照抄同一套（提案 §10）", async () => {
  // 执行中：当前动作优先——正在做什么必须排在主张树前面
  await page.locator('.work-item[data-open="issue-running"]').click();
  let doc = page.locator('[data-document="issue-running"]');
  let lead = doc.locator(".state-lead");
  if (!(await lead.isVisible())) throw new Error("执行中态没有把当前动作放首屏");
  if (!(await lead.innerText()).includes("第 2 / 4 步")) throw new Error("执行中态首屏没说进行到哪一步");
  let leadY = (await lead.boundingBox()).y;
  let listY = (await doc.locator("[data-claim-list]").boundingBox()).y;
  if (leadY >= listY) throw new Error("执行中态：当前动作没有排在主张树前面");

  // 验证未收敛：差异与换策略优先，且必须给出动作
  await page.locator('.work-item[data-open="issue-validation"]').click();
  doc = page.locator('[data-document="issue-validation"]');
  lead = doc.locator(".state-lead.attention");
  if (!(await lead.isVisible())) throw new Error("验证未收敛态没有把差异放首屏");
  const vText = await lead.innerText();
  if (!vText.includes("同一 finding")) throw new Error("没有说明两轮是同一个根因");
  if ((await lead.locator(".sl-actions > button").count()) < 3) throw new Error("换策略的动作不足三个");
  leadY = (await lead.boundingBox()).y;
  listY = (await doc.locator("[data-claim-list]").boundingBox()).y;
  if (leadY >= listY) throw new Error("验证未收敛态：差异没有排在主张树前面");

  // 两轮失败必须各占一条证据，不合并成「重试 2 次」
  const failed = doc.locator('[data-claim-state="attention"]').first();
  const evidence = await failed.locator(".evidence-item").count();
  if (evidence < 2) throw new Error("两轮验证失败被合并了，看不出是同一个执行者同一个结论");

  // 已完成：交付与结论优先
  await page.locator('.work-item[data-open="issue-done"]').click();
  doc = page.locator('[data-document="issue-done"]');
  lead = doc.locator(".state-lead");
  if (!(await lead.innerText()).includes("结论")) throw new Error("已完成态首屏不是结论");
  leadY = (await lead.boundingBox()).y;
  listY = (await doc.locator("[data-claim-list]").boundingBox()).y;
  if (leadY >= listY) throw new Error("已完成态：结论没有排在主张树前面");
  // 成功态照样要认怂
  if (!(await doc.locator(".claim-na-line").isVisible())) throw new Error("已完成态没有写仍未证明的部分");
  await page.screenshot({ path: "shots/task-done.png", fullPage: true });
});

await check("非代码任务同骨架，证据换成引用与反证（ADR 0010 决策 4）", async () => {
  await page.locator('.work-item[data-open="issue-research"]').click();
  const doc = page.locator('[data-document="issue-research"]');

  const text = await doc.locator("[data-claim-list]").innerText();
  if (!text.includes("跳回原文")) throw new Error("研究任务的证据没有提供回原文的入口");
  if (!text.includes("反证")) throw new Error("研究任务没有表达反证——不能强压成二元通过/失败");

  // 有争议的结论落在 ◐，不是 ✓ 也不是新符号
  const disputed = doc.locator('[data-claim-state="pending"]').first();
  if ((await disputed.locator(".claim-mark").innerText()).trim() !== "◐") throw new Error("有争议的结论没有落在 ◐");
  if (!(await disputed.locator(".claim-verdict").innerText()).includes("争议")) {
    throw new Error("结论行没有写明仍有争议");
  }

  // 研究任务不该出现代码任务才有的实现回归段
  if (await doc.locator(".regression-band").count()) throw new Error("研究任务出现了实现回归段");
});

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
  if (!first.includes("Implementation")) throw new Error(`任务「artifact 引用不漂移」应配 Implementation 现场，实际 ${first}`);

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
