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

/** 打开任务并切到指定视图。V3.3 后内容分散在六个面里，查之前必须先切过去。 */
async function openTask(id, pane = "overview") {
  await page.locator(`.work-item[data-open="${id}"]`).first().click();
  await page.locator(`[data-pane-tabs] [data-pane-tab="${pane}"]`).click();
  await page.locator(`[data-pane="${pane}"]`).waitFor({ state: "visible" });
}


// §4 布局：舞台是主角 ─────────────────────────────────────
await check("任务面是主角，左栏是配角（design.md §4 / ADR 0012）", async () => {
  const area = await page.locator(".editor-area").boundingBox();
  const sidebar = await page.locator(".project-explorer").boundingBox();
  const ratio = area.width / 1440;
  if (ratio < 0.6) throw new Error(`任务面仅占 ${(ratio * 100).toFixed(1)}%，未成为主角`);
  if (sidebar.width > 280) throw new Error(`左栏 ${sidebar.width}px 过宽`);
  if (await page.locator("[data-room-dock]").count()) throw new Error("Dock 未取消");
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
  await openTask("issue-done", "overview");
  const before = await page.locator("[data-task-tabs] .editor-tab").count();
  await page.locator('[data-overview="issue-done"] .outcome-file').first().click();
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

await check("一级入口四个，项目照 multica 进左栏（ADR 0012）", async () => {
  const icons = page.locator(".explorer-toolbar:visible .nav-icons");
  if ((await icons.locator("> button").count()) !== 4) throw new Error("顶部一级入口应为 4 个");
  for (const surface of ["project", "projects", "automation", "library"]) {
    if (!(await icons.locator(`[data-surface="${surface}"]`).isVisible())) throw new Error(`顶部缺少 ${surface} 入口`);
  }
  const lib = icons.locator('[data-surface="library"]');
  if (!((await lib.getAttribute("title")) || "").includes("能力库")) throw new Error("图标入口缺少 title 说明");
  if (!(await lib.getAttribute("aria-label"))) throw new Error("图标入口缺少 aria-label");

  // 搜索只有一处：顶栏主搜索框，左栏不再有第二个入口
  if (await page.locator(".explorer-toolbar:visible input[type=\"search\"]").count()) {
    throw new Error("左栏仍有搜索框——搜索应只保留顶栏一处");
  }

  // 项目在列表里只作筛选；管理项目本身走 ▦ 入口
  const filter = page.locator("[data-project-filter]");
  if (!(await filter.isVisible())) throw new Error("任务列表缺少项目筛选器");
  await filter.click();
  const menu = page.locator("[data-project-filter-menu]");
  await menu.waitFor({ state: "visible" });
  if (!(await menu.innerText()).includes("未归类")) throw new Error("筛选器没有游离态任务分组");
  await menu.locator('[data-project-pick="PersonaHub"]').click();
  if (!(await filter.innerText()).includes("PersonaHub")) throw new Error("筛选未生效");
  await filter.click();
  await menu.locator('[data-project-pick="全部"]').click();

  const foot = page.locator(".sidebar-foot:visible");
  if ((await foot.locator("> button").count()) !== 1) throw new Error("底部应只剩设置一个入口");
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

await check("成果面首屏回答「做成什么样、可不可信」（§4.2）", async () => {
  await openTask("issue-view", "acceptance");
  const stage = page.locator('[data-document="issue-view"]');

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
  await openTask("issue-view", "acceptance");
  const stage = page.locator('[data-document="issue-view"]');
  if (!(await stage.locator(".source-legend").isVisible())) throw new Error("成果面没有信源图例，用户学不会哪些像素可能骗人");
  if ((await stage.locator(".src-badge.machine").count()) < 3) throw new Error("机器事实没有被标出来");
  if ((await stage.locator(".src-badge.agent").count()) < 2) throw new Error("Agent 的说法没有被标出来，它正长成事实的样子");

  // 文件说明是 agent 写的，必须带 agent 标记而不是裸文本
  const note = stage.locator(".outcome-file .agent-note").first();
  if (!(await note.isVisible())) throw new Error("成员写的文件说明没有和机器事实拉开距离");
});

await check("主张与证据之间有显式的「论证」（ADR 0010 / GSN Strategy）", async () => {
  await openTask("issue-view", "acceptance");
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
  await openTask("issue-view", "acceptance");
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
  await openTask("issue-view", "acceptance");
  const stage = page.locator('[data-document="issue-view"]');
  const text = await stage.locator(".evidence-list").first().innerText();
  if (!/\.test\.ts|\.tsx|\.md|\//.test(text)) throw new Error("证据没有使用测试名或文件路径这类天然标识");
  const all = await stage.locator("[data-claim-list]").innerText();
  if (/\b(TEST|SRC|FILE|REVIEW|COUNTER|VALIDATION)-\d+/.test(all)) {
    throw new Error("出现新造的 ID 前缀——证据对象本来就各自可寻址");
  }
});

await check("点状态卡筛主张树，可再次点击取消（提案 §6）", async () => {
  await openTask("issue-view", "acceptance");
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
  await openTask("issue-view", "overview");
  const gate = page.locator("[data-baseline-gate]");
  if (!(await gate.isVisible())) throw new Error("验收基线被申请修改，但首屏没有拦住");
  const text = await gate.innerText();
  if (!text.includes("验收基线")) throw new Error("阻塞条没有说清拦的是验收基线");
  if (text.includes("修改主张的证据")) throw new Error("证据是已发生的记录，不存在修改");
  if (!text.includes("可能把主张改弱")) throw new Error("没有提示这次改动会削弱断言");
  if (!text.includes("已有证据保持不变")) throw new Error("没有说明新增证据不受影响");
  if ((await gate.locator(".bg-actions > button").count()) < 3) throw new Error("缺少批准 / 拒绝 / 看差异三个动作");
});

await check("决定产生状态变更，不产生消息气泡（概览给结构 / 会话给原文）", async () => {
  await openTask("issue-view", "overview");
  const gate = page.locator("[data-baseline-gate]");
  await gate.waitFor({ state: "visible" });

  // 舞台不复述对话，只留回链
  const reason = await gate.locator(".bg-reason").innerText();
  if (reason.includes("源文件被删")) throw new Error("实现者的理由全文跑到舞台上了——那是对话，不是结构");
  if (!(await gate.locator("[data-reveal-request]").isVisible())) throw new Error("舞台没有回链到会话原文");

  // 原文在会话面里
  await page.locator('[data-pane-tabs] [data-pane-tab="thread"]').click();
  const request = page.locator("[data-baseline-request]");
  if (!(await request.isVisible())) throw new Error("会话面里没有实现者的申请原文");
  if (!(await request.innerText()).includes("源文件被删")) throw new Error("会话面的原文内容不对");

  await page.locator('[data-pane-tabs] [data-pane-tab="overview"]').click();
  const before = await page.locator("[data-room-panel].active .message").count();
  await gate.locator('[data-baseline-decide="approve"]').click();

  // 决定不产生消息气泡——实现者不在线，收不到消息（ADR 0009）
  const after = await page.locator("[data-room-panel].active .message").count();
  if (after !== before) throw new Error("批准产生了一条消息气泡；它是状态变更，不是你说的话");
  await page.locator('[data-pane-tabs] [data-pane-tab="thread"]').click();
  const event = page.locator("[data-baseline-event]");
  if (!(await event.isVisible())) throw new Error("会话面里没有留下状态变更事件行");
  if (!(await event.innerText()).includes("r2")) throw new Error("事件行没写明新的基线版本");

  // 概览：阻塞条解除；验收面：主张标上 revision
  await page.locator('[data-pane-tabs] [data-pane-tab="overview"]').click();
  if (await gate.isVisible()) throw new Error("批准后阻塞条仍在");
  await page.locator('[data-pane-tabs] [data-pane-tab="acceptance"]').click();
  const claim = page.locator('[data-claim="AC-002"]');
  if (!(await claim.locator("[data-claim-rev]").innerText()).includes("r2")) throw new Error("主张没有标上新 revision");

  // 关键：改了基线，原来的绿勾就不成立——已有证据验的是 r1
  if ((await claim.locator(".claim-mark").innerText()).trim() !== "◐") {
    throw new Error("批准改基线后主张仍是绿勾，但已有证据验的是旧断言");
  }
  const verdict = await claim.locator("[data-claim-verdict]").innerText();
  if (!verdict.includes("r1")) throw new Error("结论没有说明已有证据指向旧基线");

  // 三卡跟着变，且总数仍然守恒
  await page.locator('[data-pane-tabs] [data-pane-tab="overview"]').click();
  const ovDoc = page.locator('[data-overview="issue-view"]');
  const nums = (await ovDoc.locator("[data-claim-filter-btn]").allInnerTexts()).join(" ").match(/\d+/g).map(Number);
  if (nums[0] !== 0) throw new Error("批准后已独立验证数没有下调");

  await page.screenshot({ path: "shots/baseline-approved.png", fullPage: true });

  // 这条 check 会真的改变舞台状态，收尾时复位，避免污染后续断言
  await page.reload({ waitUntil: "networkidle" });
  await openTask("issue-view", "overview");
  await page.locator("[data-baseline-gate]").waitFor({ state: "visible" });
});

await check("范围血统默认收起，按需展开（提案 §9.2）", async () => {
  await openTask("issue-view", "acceptance");
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
  await openTask("issue-view", "acceptance");
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
  await openTask("issue-view", "overview");
  await page.locator('[data-overview="issue-view"] .outcome-file[data-open="file-code"]').first().click();
  await page.locator('[data-pane="acceptance"]').waitFor({ state: "visible" });
  await page.locator('[data-document="file-code"]').waitFor({ state: "visible" });
  const back = page.locator("[data-stage-back]");
  if (!(await back.isVisible())) throw new Error("从成果面点入后没有返回入口");
  await page.screenshot({ path: "shots/stage-child-file.png", fullPage: true });
  await back.click();
  await page.locator('[data-document="issue-view"]').waitFor({ state: "visible" });
  if (await back.isVisible()) throw new Error("返回后仍显示返回按钮");
});

// §4.3 任务面 ────────────────────────────────────────────
await check("任务面六个视图，Dock 已取消（ADR 0012 / 提案 §10）", async () => {
  await openTask("issue-view", "overview");
  if (await page.locator("[data-room-dock]").count()) throw new Error("协作 Dock 仍在");

  const tabs = page.locator("[data-pane-tabs] > button");
  const names = await tabs.allInnerTexts();
  if (names.length !== 6) throw new Error(`任务面应为 6 个视图，实际 ${names.length}`);
  for (const want of ["概览", "会话", "验收", "成果", "轨迹", "资料"]) {
    if (!names.join(" ").includes(want)) throw new Error(`任务面缺少「${want}」`);
  }

  // 默认落在概览，且只有一个面可见
  if (!(await page.locator('[data-pane="overview"]').isVisible())) throw new Error("默认视图不是概览");
  const visible = await page.locator("[data-pane]:visible").count();
  if (visible !== 1) throw new Error(`同时有 ${visible} 个面可见`);

  // 主区两栏：左栏 + 任务面
  const shell = await page.locator(".project-surface").boundingBox();
  const sidebar = await page.locator(".project-explorer").boundingBox();
  const area = await page.locator(".editor-area").boundingBox();
  if (Math.abs(sidebar.width + area.width - shell.width) > 4) throw new Error("主区不是两栏");
});

await check("tab 上的数字是需要人工介入的件数，不是内容总数（提案 §10）", async () => {
  await openTask("issue-view", "overview");
  const overview = page.locator('[data-pane-count="overview"]');
  if (!(await overview.isVisible())) throw new Error("概览没有标出待处理件数");
  if ((await overview.innerText()) !== "1") throw new Error("概览有一条基线变更待决，应计 1");

  // 去重：基线变更的按钮在概览，不在会话里重复计一次
  await page.locator('[data-baseline-decide="reject"]').click();
  if (await overview.isVisible()) throw new Error("处理完之后概览仍在计数");

  // 没有待办的视图不显示数字
  const artifactCount = await page.locator('[data-pane-count="artifact"]').count();
  if (artifactCount) throw new Error("只读视图不该有计数位");
  await page.reload({ waitUntil: "networkidle" });
  await page.locator('[data-explorer-panel="work"] [data-open="issue-view"]').first().click();
});

await check("一个输入框，切 tab 保留草稿（提案 §10 / 你选 A）", async () => {
  const composer = page.locator("[data-pane-composer]");
  if (!(await composer.isVisible())) throw new Error("任务面底部没有常驻输入框");
  if ((await page.locator("[data-pane-input]").count()) !== 1) throw new Error("输入框不止一个");

  const input = page.locator("[data-pane-input]");
  await input.fill("这是一段草稿");
  await page.locator('[data-pane-tabs] [data-pane-tab="acceptance"]').click();
  if (!(await page.locator('[data-pane="acceptance"]').isVisible())) throw new Error("切到验收失败");
  if ((await input.inputValue()) !== "这是一段草稿") throw new Error("切 tab 后草稿丢了");
  await page.locator('[data-pane-tabs] [data-pane-tab="overview"]').click();
  if ((await input.inputValue()) !== "这是一段草稿") throw new Error("切回后草稿丢了");
  await input.fill("");
});

await check("执行组合不是预设：选模型 + 深度滑条（ADR 0012 第 2 条）", async () => {
  await openTask("issue-view", "overview");
  const label = await page.locator("[data-dock-target]").innerText();
  if (!label.includes("·")) throw new Error("发给没有分成「会话 · 执行组合」两段");
  if (/@(实现者|独立验证员|架构研究员|安全研究员|综合员)/.test(label)) {
    throw new Error("仍在用固定角色名——PRD 明确「界面按能力项呈现成员，不写成它是 reviewer」");
  }

  await page.locator("[data-recipient-open]").click();
  const pop = page.locator("[data-recipient-popover]");
  await pop.waitFor({ state: "visible" });

  // adapter × 模型 是运行时的真实清单，不是三个打包好的组合
  const models = pop.locator("[data-pick-model]");
  if ((await models.count()) < 4) throw new Error("模型清单过少，看不出是运行时的真实清单");
  if (!(await pop.innerText()).includes("额度")) throw new Error("没有显示剩余额度");

  // 深度独立可调：同一个模型能配出不同深度
  const range = pop.locator("[data-depth-range]");
  const before = await pop.locator("[data-combo-preview]").innerText();
  if (!before.endsWith("-high")) throw new Error(`默认深度不是 high，实际 ${before}`);
  await range.fill("1");
  await range.dispatchEvent("input");
  const after = await pop.locator("[data-combo-preview]").innerText();
  if (after === before) throw new Error("拖动滑条后组合没变");
  if (!after.endsWith("-medium")) throw new Error(`滑到 medium 后组合是 ${after}`);
  if (after.split("-").slice(0, -1).join("-") !== before.split("-").slice(0, -1).join("-")) {
    throw new Error("换深度不该换模型");
  }

  // 额度估算跟着深度走——这才是选深度时真正要权衡的
  const est = await pop.locator("[data-depth-est]").innerText();
  if (!est.includes("medium")) throw new Error("深度变了但估算没跟上");
  if (!/\d+ 次调用/.test(est)) throw new Error("没有把深度折算成可用次数");

  // 档位由模型决定，不是我们规定的三档
  await pop.locator('[data-pick-model="opencode-deepseekv4flash"]').click();
  if (!(await range.isDisabled())) throw new Error("只支持一档的模型，滑条应禁用");
  if (!(await pop.locator("[data-depth-note]").innerText()).includes("一档")) {
    throw new Error("没有说明为什么滑条不可用");
  }
  await pop.locator('[data-pick-model="codex-gpt5.6"]').click();
  await range.fill("2");
  await range.dispatchEvent("input");
  await page.locator("[data-recipient-open]").click();
  await pop.waitFor({ state: "hidden" });
});

await check("上下文范围可选，改回「全部」会触发降级提示（ADR 0012 第 4 条）", async () => {
  await openTask("issue-view", "overview");
  await page.locator("[data-scope-open]").click();
  const pop = page.locator("[data-scope-popover]");
  await pop.waitFor({ state: "visible" });
  for (const want of ["全部", "只给结果", "只给目标"]) {
    if (!(await pop.locator(`[data-scope-pick="${want}"]`).count())) throw new Error(`缺少「${want}」档`);
  }
  if (!(await pop.locator('[data-scope-pick="只给结果"]').getAttribute("class")).includes("active")) {
    throw new Error("验证类没有预选「只给结果」");
  }
  // 记忆相关的排除项本版不露出（提案登记为已决定、本版不做）
  if ((await pop.innerText()).includes("claimed")) throw new Error("本版不应露出记忆过滤细节");

  await pop.locator('[data-scope-pick="全部"]').click();
  const warn = page.locator("[data-scope-warn]");
  if (!(await warn.getAttribute("class")).includes("firing")) throw new Error("改成全部后没有触发降级提示");
  if (!(await warn.innerText()).includes("不算独立")) throw new Error("降级提示没说清后果");

  await page.locator("[data-scope-open]").click();
  await page.locator('[data-scope-pick="只给结果"]').click();
  await page.locator("[data-scope-popover]").waitFor({ state: "hidden" });
  if ((await page.locator("[data-scope-label]").innerText()) !== "只给结果") throw new Error("上下文未复位");
});

await check("会话是一个视图，Room 在里面切（ADR 0012）", async () => {
  await page.locator('[data-pane-tabs] [data-pane-tab="thread"]').click();
  const pane = page.locator('[data-pane="thread"]');
  await pane.waitFor({ state: "visible" });

  const rooms = pane.locator("[data-room-pick]");
  if ((await rooms.count()) < 2) throw new Error("会话视图里不能切 Room");
  if (!(await pane.innerText()).includes("已结束")) throw new Error("没有区分活跃与已结束的会话");
  if (await pane.locator("form.room-composer").count()) throw new Error("会话面不该再有自己的输入框");

  await rooms.nth(1).click();
  if ((await pane.locator("[data-room-panel].active").count()) !== 1) throw new Error("同时有多个会话可见");
  await rooms.nth(0).click();
  await page.locator('[data-pane-tabs] [data-pane-tab="overview"]').click();
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
    await openTask(id, "overview");
    const ov = page.locator(`[data-overview="${id}"]`);
    if (!(await ov.isVisible())) throw new Error(`${id} 没有概览`);
    if ((await ov.locator("[data-claim-filter-btn]").count()) !== 3) throw new Error(`${id} 概览的状态卡不是三张`);

    await page.locator('[data-pane-tabs] [data-pane-tab="acceptance"]').click();
    const doc = page.locator(`[data-document="${id}"]`);
    const claims = await doc.locator("[data-claim-state]").count();
    if (claims < 2) throw new Error(`${id} 的主张树内容过少（${claims}）`);
    if (!(await doc.locator(".scope-line").isVisible())) throw new Error(`${id} 验收面缺少当前范围`);

    const marks = [...new Set((await doc.locator(".claim-mark").allInnerTexts()).map((m) => m.trim()))];
    if (marks.some((m) => !["✓", "◐", "⚠"].includes(m))) throw new Error(`${id} 出现三个符号之外的记号：${marks.join(" ")}`);
  }
});

await check("首屏顺序按状态变化，不是七态照抄同一套（提案 §10）", async () => {
  // 执行中：当前动作优先
  await openTask("issue-running", "overview");
  let ov = page.locator('[data-overview="issue-running"]');
  let lead = ov.locator(".state-lead");
  if (!(await lead.isVisible())) throw new Error("执行中态没有把当前动作放首屏");
  if (!(await lead.innerText()).includes("第 2 / 4 步")) throw new Error("执行中态首屏没说进行到哪一步");
  if ((await lead.boundingBox()).y >= (await ov.locator(".claim-state").boundingBox()).y) {
    throw new Error("执行中态：当前动作没有排在状态卡前面");
  }

  // 验证未收敛：差异与换策略优先
  await openTask("issue-validation", "overview");
  ov = page.locator('[data-overview="issue-validation"]');
  lead = ov.locator(".state-lead.attention");
  if (!(await lead.isVisible())) throw new Error("验证未收敛态没有把差异放首屏");
  if (!(await lead.innerText()).includes("同一 finding")) throw new Error("没有说明两轮是同一个根因");
  if ((await lead.locator(".sl-actions > button").count()) < 3) throw new Error("换策略的动作不足三个");

  // 两轮失败各占一条证据，不合并成「重试 2 次」
  await page.locator('[data-pane-tabs] [data-pane-tab="acceptance"]').click();
  const failed = page.locator('[data-document="issue-validation"] [data-claim-state="attention"]').first();
  if ((await failed.locator(".evidence-item").count()) < 2) throw new Error("两轮验证失败被合并了");

  // 已完成：结论优先，且成功态照样认怂
  await openTask("issue-done", "overview");
  ov = page.locator('[data-overview="issue-done"]');
  if (!(await ov.locator(".state-lead").innerText()).includes("结论")) throw new Error("已完成态首屏不是结论");
  await page.locator('[data-pane-tabs] [data-pane-tab="acceptance"]').click();
  if (!(await page.locator('[data-document="issue-done"] .claim-na-line').isVisible())) {
    throw new Error("已完成态没有写仍未证明的部分");
  }
  await page.screenshot({ path: "shots/task-done.png", fullPage: true });
});

await check("非代码任务同骨架，证据换成引用与反证（ADR 0010 决策 4）", async () => {
  await openTask("issue-research", "acceptance");
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
  await page.locator('[data-pane-tabs] [data-pane-tab="trace"]').click();

  const trace = page.locator('[data-pane="trace"]');
  await trace.waitFor({ state: "visible" });
  if (await page.locator('[data-pane="overview"]').isVisible()) throw new Error("概览与轨迹同时可见");
  if ((await page.locator("[data-task-tabs] .editor-tab").count()) !== before) throw new Error("轨迹新开了 tab");
  if (!(await page.locator('[data-task-tabs] .editor-tab.active[data-open="issue-view"]').isVisible())) {
    throw new Error("轨迹期间所属任务的 tab 未保持选中");
  }
  if ((await trace.locator(".trace-item").count()) < 6) throw new Error("轨迹内容过少，看不出一路发生了什么");
  await page.screenshot({ path: "shots/task-trace.png" });
});

await check("轨迹里每个 Run 标出上下文血统（ADR 0009）", async () => {
  const trace = page.locator('[data-pane="trace"]');

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
  await openTask("issue-view", "trace");
  const trace = page.locator('[data-pane="trace"]');
  const total = await trace.locator(".trace-item").count();
  await trace.locator('[data-trace-filter="case"]').click();
  const shown = await trace.locator(".trace-item:visible").count();
  if (shown === 0) throw new Error("筛用例变更后一条都不剩");
  if (shown >= total) throw new Error("筛选没有生效");
  if ((await trace.locator(".trace-item.case:visible").count()) !== shown) throw new Error("筛选结果混入了其他类型");
  await trace.locator('[data-trace-filter="all"]').click();
  if ((await trace.locator(".trace-item:visible").count()) !== total) throw new Error("恢复全部失败");
  await page.locator('[data-pane-tabs] [data-pane-tab="overview"]').click();
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
  await page.locator('[data-open="room-view"]').first().click();
  await page.locator('[data-pane-tabs] [data-pane-tab="acceptance"]').click();
  const doc = page.locator('[data-document="room-view"]');
  for (const lane of await doc.locator(".member-lane").all()) {
    if ((await lane.locator(".lane-actions button").count()) < 2) throw new Error("每条泳道至少要有两个成员级动作");
  }
  const queued = doc.locator(".member-lane.queued");
  if (!(await queued.locator(".lane-block").isVisible())) throw new Error("排队中的成员未说明前置为什么没满足");
});

await check("协作现场说明来源与选人理由（§4.2.3 / PRD 第 5 节）", async () => {
  await page.locator('[data-open="room-view"]').first().click();
  await page.locator('[data-pane-tabs] [data-pane-tab="acceptance"]').click();
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
  await page.locator('[data-pane-tabs] [data-pane-tab="acceptance"]').click();
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
  await page.locator('[data-pane-tabs] [data-pane-tab="acceptance"]').click();
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
