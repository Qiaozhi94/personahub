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

// 断言失败时不该干等 30 秒：这是静态页面，元素在就是在。
page.setDefaultTimeout(4000);

const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() !== "error") return;
  if (m.location()?.url?.includes("favicon")) return;
  consoleErrors.push(m.text());
});
page.on("pageerror", (e) => consoleErrors.push(e.message));

// V3.21：运行时不再是一级面，它是设置里的一组。进这一组 = 切设置面 + 选一个 adapter。
async function gotoRuntime(adapter = "codex") {
  await page.locator('.main-rail [data-surface="settings"]').click();
  await page.locator(`[data-surface-view="settings"] .sp-list [data-runtime-pick="${adapter}"]`).click();
}

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
/** 轨迹并入会话面：放大副栏就得到原来那个全宽轨迹视图。 */
async function openTrace(id = "issue-view") {
  await openTask(id, "thread");
  if ((await page.locator('[data-split="thread"]').getAttribute("data-layout")) !== "aside") {
    await page.locator('[data-aside-zoom="thread"]').click();
  }
}

async function openTask(id, pane = "overview") {
  // 轨迹放大后会话主栏是隐藏的，后面每一条依赖主栏的断言都会失败
  await page.evaluate(() => {
    const split = document.querySelector('[data-split="thread"]');
    if (split) split.dataset.layout = "both";
    document.querySelectorAll("[data-aside-open]").forEach((b) => (b.hidden = true));
  });
  // 浮层没关会挡住左栏，让后面每一条断言都失败，真正的那条错就被淹没了
  await page.evaluate(() => document.querySelectorAll(".command-overlay").forEach((el) => (el.hidden = true)));
  // 前置条件自己保证：任何一条断言把页面停在别的面或留着筛选，
  // 后面每一条都会连锁失败，真正的那条错就被淹没了。
  if (!(await page.locator('[data-surface-view="project"]').isVisible())) {
    await page.locator('.main-rail [data-surface="project"]').click();
  }
  if (!(await page.locator(`.work-item[data-open="${id}"]`).first().isVisible())) {
    await page.locator('[data-issue-label="全部"]').click();
    await page.locator('[data-issue-tab="recent"]').click();
  }
  await page.locator(`.work-item[data-open="${id}"]`).first().click();
  await page.locator(`[data-pane-tabs] [data-pane-tab="${pane}"]`).click();
  await page.locator(`[data-pane="${pane}"]`).waitFor({ state: "visible" });
}


// §4 布局：舞台是主角 ─────────────────────────────────────
await check("任务面是主角，左栏是配角（design.md §4 / ADR 0012）", async () => {
  const area = await page.locator('[data-surface-view="project"] .editor-area').boundingBox();
  const sidebar = await page.locator('[data-surface-view="project"] .project-explorer').boundingBox();
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
await check("任务标识与元信息独立成第一行，视图 tab 在第二行", async () => {
  // 标题和 tab 挤在同一行时标题被压成一小截，元信息只能塞进正文里重复七遍。
  await openTask("issue-view", "overview");
  if (await page.locator("[data-task-tabs]").count()) throw new Error("任务 tab 条仍在——两行 chrome 太重");

  const head = page.locator('[data-surface-view="project"] .task-head');
  if (!(await head.isVisible())) throw new Error("没有任务标识行");
  if (!(await head.innerText()).includes("artifact 引用不漂移")) throw new Error("标识行没写当前是哪个任务");

  // 元信息只有一份，在标识行里，不再逐个概览重复
  const meta = await page.locator("[data-task-meta]").innerText();
  for (const want of ["项目", "创建", "创建人"]) {
    if (!meta.includes(want)) throw new Error(`元信息缺少「${want}」`);
  }
  if (await page.locator(".ov-meta").count()) throw new Error("概览里还留着重复的那份元信息");

  // 标识行在 tab 行上面
  const headBox = await head.boundingBox();
  const tabBox = await page.locator('[data-surface-view="project"] .pane-bar').boundingBox();
  if (headBox.y >= tabBox.y) throw new Error("视图 tab 应该在标识行下面");

  // 切任务，标识和元信息跟着换
  await openTask("issue-done", "overview");
  const now = await page.locator('[data-surface-view="project"] .task-head').innerText();
  if (!now.includes("Graph 启动恢复")) throw new Error("切任务后标识没跟着换");
  if (!now.includes("已完成")) throw new Error("切任务后状态没跟着换");
  await openTask("issue-view", "overview");
});

await check("子文档就地打开，靠返回条回到任务（§4.2）", async () => {
  await openTask("issue-done", "acceptance");
  const before = await page.locator("[data-pane-task-name]").innerText();
  await page.locator('[data-pane="acceptance"] .outcome-file[data-open="file-code"]:visible').first().click();
  await page.locator('[data-document="file-code"]').waitFor({ state: "visible" });
  if (!(await page.locator(".stage-bar:visible").isVisible())) throw new Error("子文档缺少返回条");
  if ((await page.locator("[data-pane-task-name]").innerText()) !== before) {
    throw new Error("子文档期间任务标识变了");
  }
  await page.locator("[data-stage-back]").click();
  if (await page.locator(".stage-bar").isVisible()) throw new Error("返回后仍显示返回条");
});

await check("左栏按组织维度分类，不按状态分组（照 clowder ThreadSidebar）", async () => {
  // 状态天天在变，按状态分组同一个任务的位置就记不住。
  // 换成置顶/最近/项目/收藏：位置由你决定，状态退回条目里的圆点。
  if (await page.locator("[data-nav-group]").count()) throw new Error("还留着「需要你处理/正在进行/最近完成」状态分组");
  if (await page.locator(".project-thread-entry").count()) throw new Error("项目会话入口应已删除");
  if (await page.locator('[data-surface-view="project"] .project-explorer input[type=search]').count()) throw new Error("左栏不该有搜索框");

  const tabs = await page.locator("[data-issue-tab]").evaluateAll((els) => els.map((e) => e.dataset.issueTab));
  if (tabs.join(",") !== "pinned,recent,project,favorites") throw new Error(`左栏分类应是 置顶/最近/项目/收藏，实际 ${tabs}`);

  // 新建任务要显眼：主按钮样式且在顶部工具条里，不藏在图标里
  const nu = page.locator('[data-surface-view="project"] .explorer-new');
  if (!(await nu.isVisible())) throw new Error("新建任务不在显眼位置");
  if (!(await nu.getAttribute("class")).includes("primary-button")) throw new Error("新建任务不是主按钮样式");

  // 切分类真的换一批任务
  const at = async () => page.locator("[data-issue-tabs]:visible").count();
  await page.locator('[data-issue-tab="recent"]').click();
  const recent = await at();
  await page.locator('[data-issue-tab="pinned"]').click();
  const pinned = await at();
  if (!(pinned > 0 && pinned < recent)) throw new Error(`置顶应是最近的子集，实际 ${pinned}/${recent}`);
  await page.locator('[data-issue-tab="favorites"]').click();
  if (!(await at())) throw new Error("收藏分类是空的");

  // 「项目」分类下才按项目分段，其余分类里项目名是噪声
  await page.locator('[data-issue-tab="project"]').click();
  if (!(await page.locator("[data-project-head]").isVisible())) throw new Error("项目分类下没有按项目分段");
  await page.locator('[data-issue-tab="recent"]').click();
  if (await page.locator("[data-project-head]").isVisible()) throw new Error("非项目分类不该显示项目分段头");
});

await check("标签收进下拉，不横排成 chip 条", async () => {
  // chip 条的问题是标签一多就折行，左栏高度跟着标签数量变。
  await openTask("issue-view", "overview");
  if (await page.locator(".el-scroll").count()) throw new Error("还留着横排 chip 条");
  if (!(await page.locator(".work-item .wi-tags em").count())) throw new Error("任务条目上看不到标签");

  const all = await page.locator("[data-issue-tabs]:visible").count();
  await page.locator("[data-label-menu-toggle]").click();
  const menu = page.locator("[data-label-menu]");
  if (!(await menu.isVisible())) throw new Error("标签下拉打不开");
  if ((await menu.locator("[data-issue-label]").count()) < 6) throw new Error("下拉里标签太少，看不出为什么要收起来");

  await menu.locator('[data-issue-label="F009"]').click();
  if (await menu.isVisible()) throw new Error("选完标签下拉没有收起");
  if (!(await page.locator("[data-label-current]").innerText()).includes("F009")) throw new Error("按钮没有回显当前标签");

  const tagged = await page.locator("[data-issue-tabs]:visible").count();
  if (!(tagged > 0 && tagged < all)) throw new Error(`标签没有起到筛选作用 ${tagged}/${all}`);
  for (const el of await page.locator("[data-issue-tabs]:visible").all()) {
    if (!(await el.getAttribute("data-issue-tags")).includes("F009")) throw new Error("筛出了不带该标签的任务");
  }

  // 分类 × 标签取交集
  await page.locator('[data-issue-tab="favorites"]').click();
  for (const el of await page.locator("[data-issue-tabs]:visible").all()) {
    const tags = await el.getAttribute("data-issue-tags");
    if (!tags.includes("F009")) throw new Error("分类与标签没有取交集");
  }

  await page.locator("[data-label-menu-toggle]").click();
  await page.locator('[data-issue-label="全部"]').click();
  await page.locator('[data-issue-tab="recent"]').click();
});

await check("主切换竖栏：日常的在上，配置类的沉到底部一排（照 clowder）", async () => {
  const rail = page.locator(".main-rail");
  if (!(await rail.isVisible())) throw new Error("没有主切换竖栏");
  const items = rail.locator("> button");
  if ((await items.count()) < 7) throw new Error("竖栏项过少");
  for (const surface of ["project", "threads", "projects", "automation", "memory", "library", "stats", "settings"]) {
    if (!(await rail.locator(`[data-surface="${surface}"]`).isVisible())) throw new Error(`竖栏缺少 ${surface}`);
  }
  // V3.1 删掉图标活动栏的理由是「无文字，辨识度低」——这次必须带文字
  for (const el of await items.all()) {
    if (!(await el.locator("small").count())) throw new Error("竖栏图标没有文字标签，会重演 V3.1 删掉它的那个问题");
    if (!(await el.getAttribute("title"))) throw new Error("竖栏图标缺少 tooltip");
  }
  // 记忆 / 能力 / 设置 是低频的配置类，和上面的日常入口分开
  const y = async (k) => (await rail.locator(`[data-surface="${k}"]`).boundingBox()).y;
  if ((await y("memory")) - (await y("automation")) < 200) throw new Error("记忆与能力没有和设置一起沉到底部");
  if ((await y("settings")) < (await y("library"))) throw new Error("设置应在最下面");
  // V3.21：运行时不再是一级入口，它并进了设置（到达它的主路径本来就是跳转，不是左栏点击）
  if (await rail.locator('[data-surface="runtime"]').count()) {
    throw new Error("运行时又变回一级入口了——V3.21 已把它并进设置，一级入口应为两组八个");
  }
  if ((await items.count()) !== 8) throw new Error(`一级入口应为 8 个，实际 ${await items.count()} 个`);

  // 顶栏不再有项目选择器：Issue 是工作区维度的
  if (await page.locator(".project-scope").count()) throw new Error("顶栏仍有项目选择器");
});

await check("会话面与任务面同一个骨架，tab 切独立/项目（复用而不是另造一套）", async () => {
  await page.locator('.main-rail [data-surface="threads"]').click();
  const surface = page.locator('[data-surface-view="threads"]');
  if (!(await surface.isVisible())) throw new Error("没有会话面");

  // 骨架和任务面一致：左列表 + 上 tab + 消息流 + 底部输入框
  if (!(await surface.locator(".project-explorer").isVisible())) throw new Error("会话面没有左列表");
  if (!(await surface.locator("[data-thread-composer]").isVisible())) throw new Error("会话面缺少输入框");

  // 分类属于「在这一堆里挑一个」的维度，和任务左框的置顶/最近同一位置；
  // 放在右侧视图行上会让人先看右边再回左边找，动线是拧的。
  if (await surface.locator(".pane-bar [data-thread-tab]").count()) throw new Error("会话分类不该在右侧视图行上");
  if (!(await surface.locator(".project-explorer .explorer-tabs [data-thread-tab]").first().isVisible())) {
    throw new Error("会话分类没有放进左框");
  }

  // tab 切的是「哪一类会话」，左列表跟着只显示这一类
  const kinds = await surface.locator("[data-thread-tab]").evaluateAll((els) => els.map((e) => e.dataset.threadTab));
  if (kinds.join(",") !== "solo,project") throw new Error(`会话分类应是 独立/项目，实际 ${kinds}`);
  const solo = await surface.locator("[data-thread-kind]:visible").count();
  await surface.locator('[data-thread-tab="project"]').click();
  const proj = await surface.locator("[data-thread-kind]:visible").count();
  if (!(solo > 0 && proj > 0)) throw new Error("切分类后列表没有内容");
  for (const el of await surface.locator("[data-thread-kind]:visible").all()) {
    if ((await el.getAttribute("data-thread-kind")) !== "project") throw new Error("切到项目会话后仍混着独立会话");
  }
  // 切类别要顺带换掉标题，否则标题还停在上一类的会话上
  if (!(await surface.locator("[data-thread-name]").innerText()).includes("PersonaHub")) {
    throw new Error("切分类后标题没跟着换");
  }
  await surface.locator('[data-thread-tab="solo"]').click();

  // 独立会话不产生验收、不写记忆——否则它就是个没有目标的任务
  if (!(await surface.locator('[data-thread-pane="solo"]').innerText()).includes("不产生验收")) {
    throw new Error("没有说明独立会话与任务的边界");
  }
  if (!(await surface.locator(".th-meta").innerText()).includes("转成任务")) {
    throw new Error("没有从会话升级成任务的出口");
  }

  // 发出去的消息在右侧：扫一眼边界就知道谁说的
  const mine = surface.locator(".message.user-message").first();
  const theirs = surface.locator(".message:not(.user-message)").first();
  const [a, b] = [await mine.boundingBox(), await theirs.boundingBox()];
  if (a.x + a.width <= b.x + b.width - 20) throw new Error("我发的消息没有靠右");

  await surface.locator("[data-thread-input]").fill("那就加 trial 这个 type");
  await surface.locator('[data-thread-composer] button[type="submit"]').click();
  // 只看当前可见的那一面：另一面的消息也在 DOM 里，last() 会取错
  const sent = surface.locator('[data-thread-pane]:not([hidden]) .message.user-message').last();
  if (!(await sent.innerText()).includes("trial")) throw new Error("会话面发不出消息");
  await page.locator('.main-rail [data-surface="project"]').click();
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
  const nums = (await page.locator('[data-document="issue-view"] [data-claim-filter-btn]').allInnerTexts()).join(" ").match(/\d+/g).map(Number);
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

await check("舞台是单例：验收里点入文件可返回；资源里点文件不跳走", async () => {
  // 两种打开方式并存是有理由的：验收正文里的引用是「顺着读下去」，
  // 该占满舞台；资源清单是「挨个看」，跳走反而打断。
  await openTask("issue-view", "acceptance");
  await page.locator('[data-pane="acceptance"] .outcome-file[data-open="file-code"]:visible').first().click();
  await page.locator('[data-document="file-code"]').waitFor({ state: "visible" });
  const back = page.locator("[data-stage-back]");
  if (!(await back.isVisible())) throw new Error("从验收面点入后没有返回入口");
  await page.screenshot({ path: "shots/stage-child-file.png", fullPage: true });
  await back.click();
  await page.locator('[data-document="issue-view"]').waitFor({ state: "visible" });
  if (await back.isVisible()) throw new Error("返回后仍显示返回按钮");

  // 资源面就地预览：清单留在原位，方便连着看好几个文件
  await openTask("issue-view", "resource");
  const listed = await page.locator(".res-item:visible").count();
  await page.locator('[data-res-open="resolver"]').click();
  if (!(await page.locator('[data-res-view="resolver"]').isVisible())) throw new Error("点资源没有换预览");
  if (await page.locator("[data-stage-back]").isVisible()) throw new Error("资源面点文件不该跳到子文档");
  if ((await page.locator(".res-item:visible").count()) !== listed) throw new Error("点文件后清单被换掉了");
  await page.locator('[data-res-open="artifact"]').click();
});

await check("任务面四个视图；每个视图 = 主栏 + 可折叠副栏（右侧留白的统一解法）", async () => {
  await openTask("issue-view", "overview");
  const names = (await page.locator("[data-pane-tab]").allInnerTexts()).map((t) => t.replace(/\d+$/, "").trim());
  if (names.join("/") !== "概览/会话/验收/资源") throw new Error(`视图应是 概览/会话/验收/资源，实际 ${names}`);
  // 轨迹并入会话：同一份数据留两个入口只会让人犹豫该点哪个
  if (names.includes("轨迹")) throw new Error("轨迹仍是独立 tab");
  if (await page.locator(".collaboration-dock").count()) throw new Error("Dock 仍在");

  // 每个视图都有副栏，放「看主栏时最想同时看到的那一份」
  for (const [pane, key, want] of [["overview", "overview", "活动"], ["thread", "thread", "轨迹"],
                                   ["acceptance", "acceptance", "大纲"]]) {
    await page.locator(`[data-pane-tabs] [data-pane-tab="${pane}"]`).click();
    const aside = page.locator(`[data-aside="${key}"]`);
    if (!(await aside.isVisible())) throw new Error(`${pane} 没有副栏`);
    if (!(await aside.locator("header").first().innerText()).includes(want)) throw new Error(`${pane} 的副栏应是「${want}」`);
  }
  // 资源是清单 + 预览，本身就是两栏
  await page.locator('[data-pane-tabs] [data-pane-tab="resource"]').click();
  if (!(await page.locator(".res-preview").isVisible())) throw new Error("资源面没有预览栏");

  // 收起副栏后主栏拉满，留一个把手叫回来
  await page.locator('[data-pane-tabs] [data-pane-tab="overview"]').click();
  const split = page.locator('[data-split="overview"]');
  const wide = (await page.locator('[data-split="overview"] .pane-main').boundingBox()).width;
  await page.locator('[data-aside-toggle="overview"]').click();
  if ((await split.getAttribute("data-layout")) !== "main") throw new Error("收起后没有切到主栏模式");
  if ((await page.locator('[data-split="overview"] .pane-main').boundingBox()).width <= wide) {
    throw new Error("收起副栏后主栏没有拉满");
  }
  const handle = page.locator('[data-aside-open="overview"]');
  if (!(await handle.isVisible())) throw new Error("收起后没有把手可以叫回来");
  await handle.click();
  if ((await split.getAttribute("data-layout")) !== "both") throw new Error("把手没有把副栏叫回来");
});

await check("概览副栏是活动：任务级事件，比轨迹粗一层", async () => {
  await openTask("issue-view", "overview");
  const aside = page.locator('[data-aside="overview"]');
  const items = aside.locator(".activity > li");
  if ((await items.count()) < 5) throw new Error("活动条目太少");
  const text = await aside.innerText();
  // 状态迁移 / 基线变更 / 派工 / 记忆写入 —— 这四类是别处答不了的
  for (const want of ["批准验收基线", "降级", "派工", "记忆"]) {
    if (!text.includes(want)) throw new Error(`活动里缺少「${want}」这类事件`);
  }
  if (!text.includes("只记状态变化")) throw new Error("没有说明它与轨迹的粒度差别");
  // 降级那条要说明为什么：基线变了，原有证据验的是旧断言
  if (!text.includes("原有证据验的是旧断言")) throw new Error("降级事件没有写原因");
});

await check("验收副栏是大纲：主张目录 + 用例 + 未被覆盖的要求", async () => {
  await openTask("issue-view", "acceptance");
  const aside = page.locator('[data-aside="acceptance"]');
  const claims = aside.locator(".ol-claim");
  if ((await claims.count()) < 3) throw new Error("大纲里主张太少");
  // 大纲编号必须和正文对得上，否则等于两份互相矛盾的目录
  const main = await page.locator('[data-split="acceptance"] .pane-main').innerText();
  for (const el of await aside.locator(".ol-claim b").allInnerTexts()) {
    if (el.startsWith("AC-") && !main.includes(el)) throw new Error(`大纲里的 ${el} 在正文里不存在`);
  }
  // 每条主张下挂它自己的用例
  if ((await aside.locator(".ol-cases > li").count()) < 4) throw new Error("大纲没有列出用例");
  // 单列「未被覆盖的要求」：长文里最容易划过去的就是它（GSN UndevelopedGoal）
  if (!(await aside.innerText()).includes("未被覆盖的要求")) throw new Error("没有单列未被覆盖的要求");
  if (!(await aside.innerText()).includes("UndevelopedGoal")) throw new Error("没有点出这是 GSN 的哪一类");
});

await check("资源是清单 + 预览：点文件右侧出内容（和项目面同构）", async () => {
  await openTask("issue-view", "resource");
  const list = page.locator(".res-list");
  const preview = page.locator(".res-preview");
  if (!(await list.isVisible()) || !(await preview.isVisible())) throw new Error("资源面不是清单 + 预览");
  if ((await list.boundingBox()).x >= (await preview.boundingBox()).x) throw new Error("清单应在左");

  // 代码预览带行号与增删标记，md 直接渲染 —— 和项目面同一套
  const code = page.locator('[data-res-view="artifact"]');
  if (!(await code.isVisible())) throw new Error("默认没有预览第一项");
  if (!(await code.locator(".cl .ln").count())) throw new Error("代码预览没有行号");
  if (!(await code.locator(".cl.add").count())) throw new Error("代码预览没有增删标记");

  await page.locator('[data-res-dir="in"]').click();
  await page.locator('[data-res-open="prd"]').click();
  const md = page.locator('[data-res-view="prd"]');
  if (!(await md.isVisible())) throw new Error("点输入侧的文件没有换预览");
  if (!(await md.locator(".fv-body").getAttribute("class")).includes("md")) throw new Error("markdown 没有按 markdown 渲染");
  await page.locator('[data-res-dir="out"]').click();
});

await check("tab 上的数字是需要人工介入的件数，不是内容总数（提案 §10）", async () => {
  await openTask("issue-view", "overview");
  const overview = page.locator('[data-pane-count="overview"]');
  if (!(await overview.isVisible())) throw new Error("概览没有标出待处理件数");
  if ((await overview.innerText()) !== "1") throw new Error("概览有一条基线变更待决，应计 1");

  await page.locator('[data-baseline-decide="reject"]').click();
  if (await overview.isVisible()) throw new Error("处理完之后概览仍在计数");

  if (await page.locator('[data-pane-count="resource"]').count()) throw new Error("只读视图不该有计数位");
  await page.reload({ waitUntil: "networkidle" });
  await openTask("issue-view", "overview");
});

await check("概览是决策面，与验收零重叠（提案 §10）", async () => {
  await openTask("issue-view", "overview");
  const ov = page.locator('[data-overview="issue-view"]');

  // 只放别处答不了的四段
  for (const [sel, label] of [[".ov-goal", "目标"], [".ov-now", "现在"], [".ov-next", "下一步"], [".ov-brief", "简况"]]) {
    if (!(await ov.locator(sel).isVisible())) throw new Error(`概览缺少「${label}」`);
  }

  // 验收面的东西不许出现在概览——否则又是子集，必然重复
  if (await ov.locator("[data-claim-filter-btn]").count()) throw new Error("三张卡属于验收，不该在概览重复一遍");
  if (await ov.locator(".claim-item").count()) throw new Error("主张树属于验收，不该在概览重复一遍");

  // 现在：一句话状态 + 卡在哪
  const now = await ov.locator(".ov-now").innerText();
  if (!now.includes("第 2 / 3 步")) throw new Error("「现在」没说进行到哪一步");
  if (!(await ov.locator(".ov-now-block").isVisible())) throw new Error("卡在哪没有单独一行");

  // 下一步：建议可以一键写进输入框
  await ov.locator("[data-adopt-next]").click();
  const input = page.locator("[data-pane-input]");
  if (!(await input.inputValue()).includes("scope")) throw new Error("采用建议后没有写进输入框");

  // 简况是指针不是内容：点了去对应视图
  await ov.locator('[data-goto-pane="acceptance"]').click();
  if (!(await page.locator('[data-pane="acceptance"]').isVisible())) throw new Error("简况没有跳到验收");
  await page.locator('[data-pane-tabs] [data-pane-tab="overview"]').click();
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
  if (/@(实现者|独立验证员|架构研究员|安全研究员|综合员)/.test(label)) {
    throw new Error("仍在用固定角色名——PRD 明确「界面按能力项呈现成员，不写成它是 reviewer」");
  }
  if (!/^(codex|claude|opencode)-/.test(label)) throw new Error(`发给应只是执行组合，实际 ${label}`);

  await page.locator("[data-recipient-open]").click();
  const pop = page.locator("[data-recipient-popover]");
  await pop.waitFor({ state: "visible" });

  // adapter × 模型 是运行时的真实清单，不是三个打包好的组合
  const models = pop.locator("[data-pick-model]");
  if ((await models.count()) < 4) throw new Error("模型清单过少，看不出是运行时的真实清单");
  if (!(await pop.innerText()).includes("额度")) throw new Error("没有显示剩余额度");
  // 会话由「你在哪个任务下」隐式决定，不用再选一次
  if (await pop.locator("[data-pick-room]").count()) throw new Error("不该再让用户选会话");
  if (!(await pop.locator("[data-room-implicit]").isVisible())) throw new Error("没有说明会发到哪个会话");

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
    for (const [sel, label] of [[".ov-goal", "目标"], [".ov-now", "现在"], [".ov-next", "下一步"], [".ov-brief", "简况"]]) {
      if (!(await ov.locator(sel).isVisible())) throw new Error(`${id} 概览缺少「${label}」`);
    }
    if (await ov.locator("[data-claim-filter-btn]").count()) throw new Error(`${id} 概览重复了验收的三张卡`);

    await page.locator('[data-pane-tabs] [data-pane-tab="acceptance"]').click();
    const doc = page.locator(`[data-document="${id}"]`);
    if ((await doc.locator("[data-claim-filter-btn]").count()) !== 3) throw new Error(`${id} 验收面的状态卡不是三张`);
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
  if ((await lead.boundingBox()).y >= (await ov.locator(".ov-now").boundingBox()).y) {
    throw new Error("执行中态：当前动作没有排在「现在」段前面");
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

await check("轨迹并入会话：默认陪着会话，按 ⤢ 放大成全宽复盘", async () => {
  await openTask("issue-view", "thread");
  const split = page.locator('[data-split="thread"]');
  if ((await split.getAttribute("data-layout")) !== "both") throw new Error("会话面默认不是「会话 + 轨迹」");

  // 副栏尺寸下只留泳道 + 事件流；复盘工具栏收起来
  if (await page.locator(".trace-toolbar").isVisible()) throw new Error("副栏尺寸下不该显示复盘工具栏");
  if (!(await page.locator("[data-waterfall]").isVisible())) throw new Error("副栏里没有泳道");
  if (!(await page.locator("[data-trace-rows]").isVisible())) throw new Error("副栏里没有事件流");

  // 副栏这么窄也要点得开：详情长在行下面，不需要第二栏
  const asideRow = page.locator('[data-aside="thread"] .tr-row.req').first();
  await asideRow.click();
  const asidePanel = page.locator('[data-aside="thread"] [data-tr-panel]:visible').first();
  if (!(await asidePanel.isVisible())) throw new Error("副栏里点行没有展开详情");
  if (!(await asidePanel.locator('[data-td-tab="timing"]').isVisible()))
    throw new Error("副栏里的详情缺了分页");
  await page.screenshot({ path: "shots/task-trace-inline.png" });
  await asideRow.click();

  // 放大后功能要和原来那个独立 tab 完全一样
  await page.locator('[data-aside-zoom="thread"]').click();
  if ((await split.getAttribute("data-layout")) !== "aside") throw new Error("放大没有生效");
  if (!(await page.locator(".trace-toolbar").isVisible())) throw new Error("放大后工具栏没有回来");
  if (!(await page.locator("[data-tr-search]").isVisible())) throw new Error("放大后搜索没有回来");
  // 详情不再是独立栏，它长在行下面——放大与否都点得开
  await page.locator('[data-aside="thread"] .tr-row.tool').first().click();
  if (!(await page.locator("[data-tr-panel]:visible").count())) throw new Error("放大后点行没有展开详情");
  await page.locator('[data-aside="thread"] .tr-row.tool').first().click();
  if (await page.locator("[data-tr-panel]:visible").count()) throw new Error("再点一次没有收起详情");
  if (await page.locator('[data-split="thread"] .pane-main').isVisible()) throw new Error("放大后会话应该让位");

  await page.locator('[data-aside-zoom="thread"]').click();
  if ((await split.getAttribute("data-layout")) !== "both") throw new Error("再按一次没有还原");
});

await check("轨迹概览是一条占比分段条：时间花在哪，未计入的单独成段", async () => {
  await openTrace();
  const tl = page.locator("[data-waterfall]");
  if (!(await tl.isVisible())) throw new Error("轨迹上方没有概览条");
  if (await tl.locator(".tl-labels").count()) throw new Error("还留着三泳道的标签列");
  if (await tl.locator(".wf-row").count()) throw new Error("还留着逐行甘特图");

  // 四段：输入 / 模型 / 工具 / 未计入
  const segs = await tl.locator(".tl-seg").evaluateAll((els) =>
    els.map((e) => ({ kind: e.dataset.tlSeg, w: e.getBoundingClientRect().width })),
  );
  if (segs.map((s) => s.kind).join("/") !== "input/model/tool/unmeasured") {
    throw new Error(`分段应是 input/model/tool/unmeasured，实际 ${segs.map((s) => s.kind)}`);
  }

  // 宽度按真实占比，不是等宽装饰
  if (new Set(segs.map((s) => Math.round(s.w))).size < 3) throw new Error("四段等宽——不是按真实计时画的");
  const bar = await tl.locator(".tl-bar").boundingBox();
  const covered = segs.reduce((a, s) => a + s.w, 0);
  if (covered < bar.width * 0.9) throw new Error("分段没有铺满整条：剩下的时间去哪了没有交代");

  // 计时不可信的时间单独成段，不摊进前三段——沿用「不伪造 0ms」
  const un = tl.locator('.tl-seg[data-tl-seg="unmeasured"]');
  const bg = await un.evaluate((el) => getComputedStyle(el).backgroundImage);
  if (!bg.includes("repeating-linear-gradient")) throw new Error("未计入段被画成了实心色，看着像实测出来的");
  const title = await un.getAttribute("title");
  if (!title.includes("仍在执行") || !title.includes("计时未知")) {
    throw new Error("未计入段没说清它是由什么构成的");
  }

  // 高度恒定：固定两行（条形 + 图例），都不换行，所以不随栏宽或字号漂移。
  // 上限留出余量——这条断言要拦的是「又变回三泳道」那一类回退（94px），
  // 不是把某个字号锁死。
  const h = (await tl.boundingBox()).height;
  if (h > 72) throw new Error(`概览条 ${h}px 太高：应该只有一条分段条 + 一行图例`);
  if ((await tl.locator(".tl-legend").boundingBox()).height > 24) {
    throw new Error("图例换行了——高度又跟栏宽绑上了");
  }

  // 点一段 = 表格筛到这一类
  const before = await page.locator("[data-tr-event]:visible").count();
  await tl.locator('.tl-seg[data-tl-seg="tool"]').click();
  const after = await page.locator("[data-tr-event]:visible").count();
  if (after >= before) throw new Error("点分段没有把表格筛到这一类");
  if (await page.locator("[data-tr-event]:visible:not(.tool)").count()) {
    throw new Error("筛完还留着别的类型的事件");
  }
  await tl.locator('.tl-seg[data-tl-seg="tool"]').click();
  if ((await page.locator("[data-tr-event]:visible").count()) !== before) throw new Error("再点一次没有取消筛选");
});

await check("轨迹是 adapter 的详细交互过程，不是会话总结（照 deepseek-harness）", async () => {
  await openTrace();
  const trace = page.locator('[data-aside="thread"]');
  if (!(await page.locator("[data-pane-task-name]").innerText()).includes("artifact 引用不漂移")) {
    throw new Error("轨迹期间任务标识变了");
  }

  // 事件粒度：模型调用与工具调用逐条，不是「Run #2 · 3m18s」这种汇总
  const kinds = await trace.locator(".tr-kind").allInnerTexts();
  for (const want of ["SYSTEM", "USER", "ASSISTANT", "TOOL"]) {
    if (!kinds.some((k) => k.trim() === want)) throw new Error(`轨迹缺少 ${want} 事件`);
  }
  if (!kinds.some((k) => k.includes("Request"))) throw new Error("没有按模型调用（Request #N）分段");
  if ((await trace.locator("[data-tr-event]").count()) < 12) throw new Error("事件过少，仍是汇总视图");

  // 工具调用要带入参与结果，否则看不出「实际做了什么」
  const toolText = await trace.locator(".tr-row.tool .tr-main").first().innerText();
  if (!/\{.*\}/.test(toolText)) throw new Error("工具调用没有显示入参");

  // 按回合分组
  if ((await trace.locator(".tr-turn").count()) < 2) throw new Error("没有按 Turn 分组");

  // 截图带上一条展开的详情：行内展开是这一版轨迹的主交互
  const shotRow = trace.locator(".tr-row.tool").first();
  await shotRow.click();
  await page.screenshot({ path: "shots/task-trace.png" });
  await shotRow.click();
});

await check("每次模型调用标出执行组合与上下文血统（ADR 0009）", async () => {
  const trace = page.locator('[data-aside="thread"]');
  const reqs = trace.locator(".tr-row.req");
  if ((await reqs.count()) < 3) throw new Error("模型调用记录过少");

  // 同一个 Issue 里会换执行组合，所以每次调用都要标明是谁跑的
  const first = await reqs.first().innerText();
  if (!/(codex|claude|opencode)-/.test(first)) throw new Error("Request 没有标出执行组合");

  const cold = trace.locator(".tr-lineage.cold").first();
  if (!(await cold.isVisible())) throw new Error("跨围栏的调用没有标冷启动");
  if (!(await cold.innerText()).includes("冷启动")) throw new Error("冷启动标记看不出是冷启动");
  const resume = trace.locator(".tr-lineage.resume").first();
  if (!(await resume.isVisible())) throw new Error("续跑的调用没有标出来");

  // TOOL 的五页照 harness：Summary / Payload / Result / Schema / Timing
  const toolRow = trace.locator(".tr-row.tool").first();
  await toolRow.click();
  const detail = trace.locator("[data-tr-panel]:visible").first();
  if (!(await detail.isVisible())) throw new Error("点行后没有在行下面展开详情");
  if (!(await detail.locator('[data-td-pane="summary"]').innerText()).length) throw new Error("详情为空");
  await detail.locator('[data-td-tab="timing"]').click();
  if (!(await detail.locator('[data-td-pane="timing"]').innerText()).includes("ms"))
    throw new Error("Timing 页没有耗时");
  await detail.locator('[data-td-tab="summary"]').click();
  await toolRow.click();

  // 原始 session 在 Request 的 Source 页——它是诊断层，不该混进 Summary
  const reqRow = trace.locator(".tr-row.req").first();
  await reqRow.click();
  const reqDetail = trace.locator("[data-tr-panel]:visible").first();
  await reqDetail.locator('[data-td-tab="source"]').click();
  if (!(await reqDetail.locator('[data-td-pane="source"]').innerText()).includes("session"))
    throw new Error("Source 页没有 session");
  await reqDetail.locator('[data-td-tab="summary"]').click();
  await reqRow.click();
});

await check("展开详情的分页照 harness 按事件类型给，不是一套固定 tab", async () => {
  const trace = page.locator('[data-aside="thread"]');
  const tabsOf = async (row) => {
    await row.click();
    const panel = trace.locator("[data-tr-panel]:visible").first();
    const tabs = await panel.locator("[data-td-tab]").allInnerTexts();
    await row.click();
    return tabs.map((t) => t.trim()).join(" / ");
  };

  const tool = await tabsOf(trace.locator(".tr-row.tool").first());
  const req = await tabsOf(trace.locator(".tr-row.req").first());
  const system = await tabsOf(trace.locator(".tr-row.system").first());
  const assistant = await tabsOf(trace.locator(".tr-row.assistant").first());
  const user = await tabsOf(trace.locator(".tr-row.user").first());
  if (new Set([tool, req, system, assistant, user]).size !== 5)
    throw new Error("不同类型的事件用了同一套 tab");

  // 与 deepseek-harness 实测的 tab 组逐字对齐（探针 probe-dsh-detail5.mjs）
  if (tool !== "Summary / Payload / Result / Schema / Timing") throw new Error(`TOOL 的 tab 组不对：${tool}`);
  if (system !== "System Prompt / Tools") throw new Error(`SYSTEM 的 tab 组不对：${system}`);
  if (assistant !== "Summary / Preview / Raw") throw new Error(`ASSISTANT 的 tab 组不对：${assistant}`);
  if (user !== "Summary / Preview / Raw / Source") throw new Error(`USER 的 tab 组不对：${user}`);
  if (req !== "Summary / Timing / Source") throw new Error(`Request 的 tab 组不对：${req}`);

  // 头部：kind 徽标 ＋ Turn·Step 定位（harness 的 detailsHeader）
  const toolRow = trace.locator(".tr-row.tool").first();
  await toolRow.click();
  const head = trace.locator("[data-tr-panel]:visible .td-head").first();
  if ((await head.locator(".td-chip").innerText()) !== "TOOL") throw new Error("详情头部没有 kind 徽标");
  if (!/Turn \d+ · Step \d+/.test(await head.locator(".td-where").innerText()))
    throw new Error("详情头部没有 Turn · Step 定位");
  await toolRow.click();

  // 一次只开一条：展开另一行，前一行自动收起
  await trace.locator(".tr-row.tool").first().click();
  await trace.locator(".tr-row.req").first().click();
  if ((await trace.locator("[data-tr-panel]:visible").count()) !== 1)
    throw new Error("同时展开了多条详情");
  await trace.locator(".tr-row.req").first().click();
});

await check("轨迹可折叠与搜索（照 deepseek-harness 的工具栏）", async () => {
  const trace = page.locator('[data-aside="thread"]');
  const total = await trace.locator("[data-tr-event]").count();

  await trace.locator('[data-tr-toggle="calls"]').click();
  const afterFold = await trace.locator("[data-tr-event]:visible").count();
  if (afterFold >= total) throw new Error("折叠调用没有生效");
  await trace.locator('[data-tr-toggle="calls"]').click();

  await trace.locator("[data-tr-search]").fill("archivePath");
  const hits = await trace.locator("[data-tr-event]:visible").count();
  if (hits === 0 || hits >= total) throw new Error("搜索没有生效");
  await trace.locator("[data-tr-search]").fill("");
  if ((await trace.locator("[data-tr-event]:visible").count()) !== total) throw new Error("清空搜索没有复原");
});

await check("执行组合选择器把判断依据摊开，不建议的不隐藏（§4.6）", async () => {
  await openTask("issue-research", "thread");
  await page.locator('[data-pane="thread"] [data-open="room-view"]').first().click();
  await page.locator('[data-pane-tabs] [data-pane-tab="acceptance"]').click();
  await page.locator('[data-pick-combo="synthesizer"]').click();
  const picker = page.locator("[data-combo-picker]:visible");
  if (!(await picker.isVisible())) throw new Error("成员选择器未打开");
  if (!(await picker.locator(".picker-rule").innerText()).includes("兼任")) {
    throw new Error("硬规则应在名单之前说明");
  }
  const rows = picker.locator(".picker-row");
  if ((await rows.count()) !== 7) throw new Error(`应列出设置里检查出的全部 7 个执行组合，实际 ${await rows.count()}`);
  const blocked = picker.locator(".picker-row.blocked");
  if ((await blocked.count()) < 1) throw new Error("不可选的组合应保留在列表里，而不是被藏掉");
  if (!(await blocked.first().isDisabled())) throw new Error("硬约束挡住的组合应不可选");
  // V3.18：三档的分界是「能不能」不是「好不好」。硬禁止那一档不能再叫「不建议」——
  // 读到「不建议」的人会以为自己能坚持选，实际点不动
  if ((await blocked.first().innerText()).includes("不建议")) {
    throw new Error("硬禁止那一档仍标着「不建议」，措辞与行为对不上（§4.6 第 4 条）");
  }
  // 不满足要求是质量判断，归使用者：必须可选，不能被挡
  const weak = picker.locator(".picker-row.weak");
  if ((await weak.count()) < 1) throw new Error("没有「可选」档——不满足要求的组合被错误地挡掉了");
  if (await weak.first().isDisabled()) {
    throw new Error("不满足要求的组合被禁用了；§3.5 已裁定「更换组合会改变结果质量，属于使用者的质量判断」");
  }
  if (!(await weak.first().innerText()).includes("不满足要求")) {
    throw new Error("「可选」档没有写出缺哪一项要求");
  }
  // 这里没有「成员」这种常驻角色，最小可派单位是 adapter × 模型 × 深度
  const listText = await picker.locator(".picker-list").innerText();
  if (!listText.includes("codex-gpt5.6-high")) throw new Error("行标题不是执行组合 id");
  if ((await picker.innerText()).includes("成员")) throw new Error("弹层里还留着「成员」这个不存在的概念");
  // 额度不够也是不能选的理由之一，且要指回额度的所在地（ADR 0017：
  // 额度是 Runtime 的实时状态，归设置 · 运行时，不在统计面）
  const quota = picker.locator('.picker-row[data-pick-combo-id="claude-opus5-high"]');
  if (!(await quota.getAttribute("class")).includes("blocked")) throw new Error("额度不够跑完一次 high 的组合仍可选");
  if (!(await quota.locator(".pr-why").innerText()).includes("运行时")) throw new Error("额度挡下时没有指回设置 · 运行时");
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

await check("「这一步需要什么」由 Skill 与步骤两处贡献并取并集，每个 tag 标来源（V3.18 §4.6 第 2 条）", async () => {
  await openTask("issue-research", "thread");
  await page.locator('[data-pane="thread"] [data-open="room-view"]').first().click();
  await page.locator('[data-pane-tabs] [data-pane-tab="acceptance"]').click();
  await page.locator('[data-pick-combo="synthesizer"]').click();
  const picker = page.locator("[data-combo-picker]:visible");
  if (!(await picker.isVisible())) throw new Error("执行组合选择器未打开");
  const needs = picker.locator("[data-picker-needs]");
  if (!(await needs.isVisible())) throw new Error("弹层顶部没有「这一步需要什么」");
  const text = await needs.innerText();
  if (!text.includes("这一步需要什么")) throw new Error("要求排缺标题");
  // 没有来源标记的行不允许出现在决定上下文的视图里（同 §3.2.4）
  const tags = needs.locator(".cap-tag");
  if ((await tags.count()) < 1) throw new Error("要求排里一个 tag 都没有");
  for (const t of await tags.all()) {
    if (!(await t.locator(".ct-src").count())) throw new Error("要求 tag 没有标出它从哪来（Skill 还是步骤）");
  }
  // 取并集而非定优先级：并集只会更严，因此没有「冲突时听谁的」
  if (!text.includes("并集")) throw new Error("没有说清两处贡献是取并集，会被当成谁覆盖谁");
  const src = await tags.first().locator(".ct-src").first().innerText();
  if (!["来自 Skill", "来自步骤"].includes(src.trim())) throw new Error(`来源标记异常：${src}`);
  await picker.locator("[data-picker-close]").first().click();
});

await check("实现与验证不能同源是硬约束（PRD 第 7.5 节）", async () => {
  // 落点有两处：派工时的选择器，和编组里那一步的上下文范围。
  await openTask("issue-research", "thread");
  await page.locator('[data-pane="thread"] [data-open="room-view"]').first().click();
  await page.locator('[data-pane-tabs] [data-pane-tab="acceptance"]').click();
  await page.locator('[data-pick-combo="validator"]').first().click();
  const picker = page.locator("[data-combo-picker]:visible");
  const impl = picker.locator('.picker-row[data-pick-combo-id="codex-gpt5.6-high"]');
  if (!(await impl.getAttribute("class")).includes("blocked")) {
    throw new Error("本次实现用的组合仍可被选为验证——实现与验证不能同源没有落到界面上");
  }
  if (!(await impl.isDisabled())) throw new Error("同源组合应不可选，而不是只加个标签");
  if (!(await impl.locator(".pr-why").innerText()).includes("自己验自己")) throw new Error("未说明为什么不能选");
  // 同源看模型不看深度：换个深度还是同一个模型
  const shallower = picker.locator('.picker-row[data-pick-combo-id="codex-gpt5.6-medium"]');
  if (!(await shallower.getAttribute("class")).includes("blocked")) {
    throw new Error("同一个模型换深度就绕过了同源约束");
  }
  await picker.locator("[data-picker-close]").first().click();

  await page.locator('.main-rail [data-surface="library"]').click();
  const squad = await page.locator('[data-library-body="skill"]').innerText();
  if (!squad.includes("只给结果")) throw new Error("编组没有把验证步的上下文范围写成字段");
  if (!squad.includes("独立")) throw new Error("编组没有说明为什么要限制上下文");
  await page.locator('.main-rail [data-surface="project"]').click();
});

await check("新建任务照 multica：描述 + 属性 chip，标题由执行结果总结", async () => {
  await page.locator('.main-rail [data-surface="project"]').click();
  await page.locator("[data-new-object]").click();
  const dlg = page.locator(".task-create-dialog");
  if (!(await dlg.isVisible())) throw new Error("新建任务弹窗打不开");
  if ((await dlg.boundingBox()).x < 100) throw new Error("弹窗没有居中");

  // 不要标题：让人先想「叫什么」是在浪费他刚起来的那点动力
  if (await dlg.locator("[data-task-title]").count()) throw new Error("不该再让用户填标题");
  if (!(await dlg.innerText()).includes("标题由第一轮执行")) throw new Error("没有说明标题从哪来");

  if (!(await dlg.locator(".tc-desc").isVisible())) throw new Error("缺少描述输入");
  if ((await dlg.locator(".tc-chip").count()) < 3) throw new Error("属性没有做成 chip");
  if (await dlg.locator("select").count()) throw new Error("属性应是 chip，不是下拉控件行");
  if ((await dlg.innerText()).includes("工作流")) throw new Error("工作流这一轮先不加");

  // 执行模型现在就要定：因为建完立刻开跑
  await dlg.locator("[data-task-model-toggle]").click();
  const menu = dlg.locator("[data-task-model-menu]");
  if ((await menu.locator("[data-task-model-pick]").count()) < 4) throw new Error("可选模型太少");
  await menu.locator('[data-task-model-pick="claude-opus5-high"]').click();
  if (!(await dlg.locator("[data-task-model]").innerText()).includes("opus5")) throw new Error("选完没有回显");

  await dlg.locator('button[type="submit"]').click();
  if (await dlg.isVisible()) throw new Error("提交后弹窗没关");
  if ((await page.locator("[data-pane-tab].active").innerText()) !== "会话") throw new Error("创建后没有直接进入会话");
});

await check("指派有撤销窗口，不立刻判定「已指派」（§6）", async () => {
  await openTask("issue-research", "thread");
  await page.locator('[data-pane="thread"] [data-open="room-view"]').first().click();
  await page.locator('[data-pane-tabs] [data-pane-tab="acceptance"]').click();
  await page.locator('[data-pick-combo="synthesizer"]').click();
  await page.locator('[data-combo-picker]:visible .picker-row:not([disabled])').first().click();
  const bar = page.locator("[data-dispatch-undo]");
  if (!(await bar.isVisible())) throw new Error("指派后没有可取消的启动窗口");
  if (!(await bar.innerText()).includes("正在启动")) throw new Error("指派后立刻判定为已指派");
  if (!(await bar.locator("[data-undo-cancel]").isVisible())) throw new Error("启动窗口内没有取消入口");
  await bar.locator("[data-undo-cancel]").click();
  if (await bar.isVisible()) throw new Error("取消后启动窗口未收起");
});

await check("成果与资料合并为「资源」，按方向分而不是按 tab 分", async () => {
  const names = await page.locator("[data-pane-tab]").allInnerTexts();
  if (names.some((n) => n.includes("成果") || n.includes("资料"))) throw new Error("还留着成果/资料两个 tab");
  if (!names.some((n) => n.includes("资源"))) throw new Error("没有资源 tab");

  await openTask("issue-view", "resource");
  const out = page.locator('[data-res-body="out"]');
  const inn = page.locator('[data-res-body="in"]');
  if (!(await out.isVisible()) || (await inn.isVisible())) throw new Error("默认应只显示产出");
  if (!(await out.innerText()).includes("git")) throw new Error("产出里缺少 git 段");

  await page.locator('[data-res-dir="in"]').click();
  if ((await out.isVisible()) || !(await inn.isVisible())) throw new Error("切到输入没有换内容");
  if (!(await inn.innerText()).includes("spec.md")) throw new Error("输入里缺少引用的材料");
  await page.locator('[data-res-dir="out"]').click();
});

await check("项目面：左栏是项目列表，右侧上方四个 tab", async () => {
  await page.locator('.main-rail [data-surface="projects"]').click();
  const surface = page.locator('[data-surface-view="projects"]');
  if (!(await surface.isVisible())) throw new Error("项目面打不开");

  // 左栏专心列项目；四类内容是并列的，用 tab 比塞进左框第二层更直接
  if ((await surface.locator("[data-project-pick]").count()) < 2) throw new Error("左栏不是项目列表");
  const tabs = await surface.locator("[data-project-tabs] button").allInnerTexts();
  if (tabs.join("/") !== "文件/知识/工作流/设置") throw new Error(`项目 tab 应是 文件/知识/工作流/设置，实际 ${tabs}`);
  const listBox = await surface.locator(".sp-list").boundingBox();
  const tabBox = await surface.locator("[data-project-tabs]").boundingBox();
  if (listBox.x >= tabBox.x) throw new Error("项目列表应在左");

  // 文件 tab 内是 GitHub 式：左树右预览，点文件不跳走
  const tree = surface.locator("[data-tree]");
  if (!(await tree.isVisible())) throw new Error("没有文件树");
  if (!(await surface.locator(".file-view:not([hidden])").isVisible())) throw new Error("右侧没有文件预览");
  const depths = await surface.locator("[data-tree-node]").evaluateAll((els) =>
    els.map((e) => Number(e.style.getPropertyValue("--tn-depth"))));
  if (Math.max(...depths) < 2) throw new Error("目录树没有两层以上的深度");

  const before = await surface.locator(".tree-node:visible").count();
  await surface.locator('[data-tree-open="adr12"]').click();
  if (!(await surface.locator('[data-file-view="adr12"]').isVisible())) throw new Error("点文件没有换右侧预览");
  if ((await surface.locator(".tree-node:visible").count()) !== before) throw new Error("点文件后树被换掉了");

  // 代码预览要有行号和增删标记，否则等于贴了一段纯文本
  await surface.locator('[data-tree-open="code"]').click();
  const code = surface.locator('[data-file-view="code"]');
  if (!(await code.locator(".cl .ln").count())) throw new Error("代码预览没有行号");
  if (!(await code.locator(".cl.add").count()) || !(await code.locator(".cl.del").count())) {
    throw new Error("代码预览没有增删标记");
  }

  await surface.locator("[data-tree-filter]").fill("personahub");
  const hits = await surface.locator(".tree-node:visible").count();
  if (!(hits > 0 && hits < before)) throw new Error(`过滤没有生效 ${hits}/${before}`);
  await surface.locator("[data-tree-filter]").fill("");

  await surface.locator('[data-project-tab="workflow"]').click();
  if (!(await surface.locator('[data-project-body="workflow"]').isVisible())) throw new Error("项目 tab 切不动");
  await surface.locator('[data-project-tab="files"]').click();
  await page.locator('.main-rail [data-surface="project"]').click();
});

await check("记忆面是纯 tab 切换：待确认 / 知识库（左框对它是多余的一层）", async () => {
  await page.locator('.main-rail [data-surface="memory"]').click();
  const surface = page.locator('[data-surface-view="memory"]');
  if (await surface.locator(".sp-list").count()) throw new Error("记忆面不该有左框——内容本来就是两组并列的东西");

  const inbox = surface.locator('[data-memory-body="inbox"]');
  if (!(await inbox.isVisible())) throw new Error("默认不是待确认");
  if ((await inbox.locator(".dl-row").count()) < 2) throw new Error("待确认里没有候选条目");
  if (!(await inbox.innerText()).includes("唯一")) throw new Error("没有说明这是唯一能升为 confirmed 的地方");
  if (!(await inbox.locator(".dl-act .primary-button").first().isVisible())) {
    throw new Error("候选条目没有确认动作");
  }
  // claimed 必须自己标出「只是它说过」
  if (!(await inbox.locator(".dl-warn").first().innerText()).includes("不会进入验证类派工的上下文")) {
    throw new Error("claimed 候选没有说明它不进验证上下文");
  }

  await surface.locator('[data-memory-tab="library"]').click();
  const lib = surface.locator('[data-memory-body="library"]');
  if (!(await lib.locator("[data-memory-search]").isVisible())) throw new Error("知识库没有搜索框");
  if ((await lib.locator("[data-memory-filter]").count()) < 4) throw new Error("知识库不能按 stance 过滤");
  for (const st of ["confirmed", "verified", "claimed"]) {
    if (!(await lib.locator(`.mem-stance.${st}`).count())) throw new Error(`知识库看不到 ${st}`);
  }
  await surface.locator('[data-memory-tab="inbox"]').click();
});

// §4.7 记忆：状态、三轴、健康度 ─────────────────────────────
await check("知识库把三根轴摆成三列，不合成一个「可信度」（ADR 0016 第 4 条）", async () => {
  await page.locator('.main-rail [data-surface="memory"]').click();
  const surface = page.locator('[data-surface-view="memory"]');
  await surface.locator('[data-memory-tab="library"]').click();
  const lib = surface.locator('[data-memory-body="library"]');

  const head = await lib.locator(".dl-head").innerText();
  for (const col of ["强度", "状态", "验证于", "引用"]) {
    if (!head.includes(col)) throw new Error(`知识库表头缺少「${col}」列`);
  }
  // 三轴必须是三列，不能被压成一个分数
  if (/可信度|信任分|置信度/.test(head)) throw new Error("三根轴被合成了一个分数");
  if (!(await lib.innerText()).includes("互不替代")) throw new Error("没有说明三根轴互不替代");
  if (!(await lib.innerText()).includes("引用次数永远不会自己")) {
    throw new Error("没有写明引用次数不会提升强度或写进验证时间");
  }

  // claimed 的「验证于」必须是空的——它就是没被验证过
  const claimedRow = lib.locator('.dl-row[data-stance="claimed"]').first();
  if (!(await claimedRow.innerText()).includes("未验证")) throw new Error("claimed 行的验证时间不该有值");

  await surface.locator('[data-memory-tab="inbox"]').click();
});

await check("状态是一列：待复核退出召回、退役可逆、遗忘留墓碑（ADR 0016 第 1 条）", async () => {
  const surface = page.locator('[data-surface-view="memory"]');
  await surface.locator('[data-memory-tab="library"]').click();
  const lib = surface.locator('[data-memory-body="library"]');

  for (const st of ["在库", "待复核", "已退役", "已遗忘"]) {
    if (!(await lib.locator(`.dl-row[data-state="${st}"]`).count())) throw new Error(`知识库看不到「${st}」`);
  }
  if ((await lib.locator("[data-memory-state]").count()) < 3) throw new Error("不能按状态过滤");

  const suspect = lib.locator('.dl-row[data-state="待复核"]').first();
  const sText = await suspect.innerText();
  if (!sText.includes("退出召回")) throw new Error("待复核没说明它已经不进上下文了");
  if (!sText.includes("@2") || !sText.includes("@4")) throw new Error("没说清是哪一版证据失效了");
  if (!sText.includes("引用 9 次不能替它续命")) throw new Error("没堵住「用得多所以还能信」这条路");

  const retired = lib.locator('.dl-row[data-state="已退役"]').first();
  if (!(await retired.getAttribute("class")).includes("off")) throw new Error("退役条目没有压暗");
  if (!(await retired.innerText()).includes("退役不是删除")) throw new Error("退役没说明来源仍然保留");

  const forgotten = lib.locator('.dl-row[data-state="已遗忘"]').first();
  const fText = await forgotten.innerText();
  if (!fText.includes("内容已按授权清除")) throw new Error("遗忘条目仍显示正文");
  if (!fText.includes("墓碑")) throw new Error("遗忘没留下「它曾存在过」的最小事实");
  if (!fText.includes("必须先退役")) throw new Error("没说明遗忘是两步，不能从在库一步删除");

  await surface.locator('[data-memory-tab="inbox"]').click();
});

await check("健康度每项都配可执行动作，写入侧本身可观测（ADR 0016 第 9 条）", async () => {
  const surface = page.locator('[data-surface-view="memory"]');
  await surface.locator('[data-memory-tab="health"]').click();
  const health = surface.locator('[data-memory-body="health"]');
  if (!(await health.isVisible())) throw new Error("健康度打不开");

  const rows = health.locator(".data-list").first().locator(".dl-row");
  if ((await rows.count()) < 5) throw new Error("五项债务没列全");
  for (const row of await rows.all()) {
    const label = (await row.locator(".dl-title").innerText()).trim();
    if (!(await row.locator(".dl-act button").first().isVisible())) {
      throw new Error(`「${label}」只报了数字没给动作`);
    }
  }

  const body = await health.innerText();
  if (!body.includes("债务展览馆")) throw new Error("没写明只报数字不给动作不算数");
  if (!body.includes("先试运行")) throw new Error("批量操作没有先试运行");
  if (!body.includes("写入被拒绝")) throw new Error("看不到写入被拒绝了几次，失败会静默");
  if (!body.includes("长期为 0 不一定是好事")) throw new Error("没提醒零拒绝可能是写入路径根本没被走过");

  await surface.locator('[data-memory-tab="inbox"]').click();
});

await check("资料面显示这次过滤掉了哪些记忆（ADR 0013 §1.2.1）", async () => {
  await page.locator('.main-rail [data-surface="project"]').click();
  await openTask("issue-view", "resource");
  const pane = page.locator('[data-pane="resource"]');
  await pane.locator('[data-res-dir="in"]').click();
  const body = await pane.locator('[data-res-body="in"]').innerText();

  if (!body.includes("本次未进入上下文")) throw new Error("没区分「用了」和「没用」");
  if (!body.includes("过滤掉了")) throw new Error("过滤条数没显示，等于静默丢弃");
  if (!body.includes("待复核")) throw new Error("看不出哪条是因为待复核被挡的");
  if (!body.includes("claimed")) throw new Error("看不出哪条是因为只是说法被挡的");
  if (!(await pane.locator('[data-res-body="in"] .res-item.off').count()))
    throw new Error("被过滤的条目没有压暗——它必须在场，只是不可用");
});

await check("记忆详情行内展开，来源包能走回；一次只开一条（记忆设计 §3.6.2）", async () => {
  await page.locator('.main-rail [data-surface="memory"]').click();
  const surface = page.locator('[data-surface-view="memory"]');
  await surface.locator('[data-memory-tab="library"]').click();
  const lib = surface.locator('[data-memory-body="library"]');

  if (await lib.locator(".pane-aside").count()) throw new Error("记忆面不该有副栏——它是纯 tab 切换");

  const row = lib.locator('[data-memory-row][data-state="在库"]').first();
  await row.click();
  const detail = row.locator(".dl-detail");
  if (!(await detail.isVisible())) throw new Error("点行没有展开详情");

  const text = await detail.innerText();
  for (const field of ["来源包", "怎么进来的", "来源任务", "支撑证据", "使用边界"]) {
    if (!text.includes(field)) throw new Error(`详情缺少来源包字段「${field}」`);
  }
  if (!text.includes("只显示一跳")) throw new Error("关系没有限定为一跳");
  if (!text.includes("变更记录")) throw new Error("没有状态与背书的变更记录");

  // 一次只开一条：同时开多条就又变回卡片了
  await lib.locator('[data-memory-row][data-state="待复核"]').first().click();
  if ((await lib.locator("[data-memory-row].open").count()) !== 1) throw new Error("同时展开了多条");

  // 遗忘必须两步：在库状态下入口可见但不可用
  await row.click();
  const forget = row.locator('.dd-acts button:text-is("遗忘")');
  if (!(await forget.isVisible())) throw new Error("遗忘入口被藏起来了——不可逆操作要在场");
  if (!(await forget.isDisabled())) throw new Error("在库状态下遗忘不该可用（必须先退役）");

  // 已退役的那条则可以直接遗忘：两步里的第一步已经走过
  const retired = lib.locator('[data-memory-row][data-state="已退役"]').first();
  await retired.click();
  if (await retired.locator('.dd-acts button:text-is("遗忘")').isDisabled()) {
    throw new Error("已退役的条目应当可以授权遗忘");
  }
  await retired.click();
  await surface.locator('[data-memory-tab="inbox"]').click();
});

await check("检索三档全可用，自动入库是策略区不是免责声明（记忆设计 §3.6）", async () => {
  const surface = page.locator('[data-surface-view="memory"]');

  // 自动入库：一块能看清「替你省了什么、又绝不替你做什么」的策略区
  const inbox = surface.locator('[data-memory-body="inbox"]');
  const auto = inbox.locator(".auto-save");
  if (!(await auto.isVisible())) throw new Error("没有自动入库策略区");
  if (!(await auto.locator("[data-auto-save]").isEnabled())) throw new Error("自动入库开关不可用");
  if (!(await auto.locator('.linklike:text-is("调整策略")').isVisible())) throw new Error("策略不可调整");
  const note = await auto.innerText();
  if (!note.includes("自动入库不等于自动确认")) throw new Error("没把「入库」和「确认」分开");
  if (!note.includes("永远需要人")) throw new Error("没堵住「机器伪造用户确认」");

  // 检索三档：关键词 / 语义 / 混合，全部可点——设计稿画完整形态，分期不体现为置灰
  await surface.locator('[data-memory-tab="library"]').click();
  for (const mode of ["keyword", "semantic", "hybrid"]) {
    const btn = surface.locator(`[data-memory-mode="${mode}"]`);
    if (!(await btn.isVisible())) throw new Error(`检索模式缺少 ${mode}`);
    if (await btn.isDisabled()) throw new Error(`检索模式 ${mode} 不该不可用`);
  }
  await surface.locator('[data-memory-tab="inbox"]').click();
});

await check("服务活着不等于记忆能用：索引探针与顶栏降级标（记忆设计 §10.4）", async () => {
  // 顶栏：绿点只管服务存活，记忆降级必须在它旁边显式说出来
  const dot = page.locator(".local-state");
  const degraded = page.locator(".local-degraded");
  if (!(await dot.isVisible())) throw new Error("顶栏没有服务状态");
  if (!(await degraded.isVisible())) throw new Error("记忆降级时顶栏没有降级标——绿点会撒谎");
  const dotBox = await dot.boundingBox();
  const degBox = await degraded.boundingBox();
  if (Math.abs(dotBox.y - degBox.y) > 6) throw new Error("降级标没有和绿点并排，读不出它在修正绿点");

  await page.locator('.main-rail [data-surface="memory"]').click();
  const surface = page.locator('[data-surface-view="memory"]');
  await surface.locator('[data-memory-tab="health"]').click();
  const health = surface.locator('[data-memory-body="health"]');
  const body = await health.innerText();

  if (!body.includes("不等于「记忆能用」")) throw new Error("没有把服务存活与记忆可用分开");
  if (!body.includes("静默返回空")) throw new Error("没说明索引坏掉时的表现是静默返回空");

  // 探针：同步 / 分词回退 / 关系；语义那条置灰
  for (const probe of ["索引与记忆同步", "unicode61", "关系已建立"]) {
    if (!body.includes(probe)) throw new Error(`缺少探针「${probe}」`);
  }
  if (!body.includes("组合条件")) throw new Error("没说明探针是组合条件而不是裸计数");
  if (!body.includes("空库不报警")) throw new Error("没说明为什么空库不报警");

  const semanticProbe = health.locator('.dl-row.not-yet:has-text("语义召回")');
  if (!(await semanticProbe.isVisible())) throw new Error("语义召回探针应置灰可见，不隐藏");

  // 每条降级都要能点
  const fallback = health.locator('.dl-row:has-text("unicode61")');
  if (!(await fallback.locator(".dl-act button").first().isVisible())) {
    throw new Error("分词回退没有给可点的修复动作");
  }
  await surface.locator('[data-memory-tab="inbox"]').click();
});

await check("效用四层不可互相代证；helped 给证据链而不是分数（记忆设计 §10.5）", async () => {
  const surface = page.locator('[data-surface-view="memory"]');
  await surface.locator('[data-memory-tab="health"]').click();
  const health = surface.locator('[data-memory-body="health"]');
  const body = await health.innerText();

  for (const layer of ["被展示", "被引用", "被采纳", "帮到了"]) {
    if (!body.includes(layer)) throw new Error(`效用观测缺少「${layer}」层`);
  }
  if (!body.includes("不可互相代证")) throw new Error("没说明四层不可互相代证");

  // helped 不给分数，但要给可下钻的证据链——不是占位，是设计好的诚实表达
  const helped = health.locator('.dl-row:has-text("帮到了")');
  const ht = await helped.innerText();
  if (!ht.includes("不给分")) throw new Error("helped 给了一个分数");
  if (!ht.includes("加权本身就是把不知道的当成知道的")) throw new Error("没说明为什么不给分数");
  if (!(await helped.locator(".linklike").isVisible())) throw new Error("helped 没有给可下钻的证据链");
  await surface.locator('[data-memory-tab="inbox"]').click();
});

await check("关系页：以锚点为中心的一跳图 + 同源边表（记忆设计 §8.3）", async () => {
  const surface = page.locator('[data-surface-view="memory"]');
  await surface.locator('[data-memory-tab="graph"]').click();
  const graph = surface.locator('[data-memory-body="graph"]');
  if (!(await graph.isVisible())) throw new Error("关系页打不开");

  const body = await graph.innerText();
  if (!body.includes("改这条会影响谁")) throw new Error("没说清关系页回答什么问题");
  if (!body.includes("毛球")) throw new Error("没说明为什么不铺全局节点云");

  const svg = graph.locator(".ego-graph");
  if (!(await svg.isVisible())) throw new Error("没有图");
  if ((await svg.locator(".eg-node").count()) < 5) throw new Error("邻居太少，看不出这是一跳图");
  if (!(await svg.locator(".eg-node.anchor").isVisible())) throw new Error("看不出哪个是锚点");
  if (!body.includes("同一份数据的两种画法")) throw new Error("没说明图与表同源");

  // 图上的文字必须只填不描：全局线性图标规则会把 stroke 继承给 <text>，小字会糊
  const stroke = await svg.locator("text").first().evaluate((el) => getComputedStyle(el).stroke);
  if (stroke !== "none") throw new Error(`图上文字被描边（stroke=${stroke}），小字会糊`);

  if ((await graph.locator("[data-graph-depth]").count()) < 2) throw new Error("不能切换深度");
  if ((await graph.locator("[data-graph-rel]").count()) < 4) throw new Error("不能按关系类型筛选");
  if (!body.includes("不会自动消解")) throw new Error("没说明冲突边由人判断");
  if (!body.includes("指不到的关系建不出来")) throw new Error("没说明写入时防悬空");
  await surface.locator('[data-memory-tab="inbox"]').click();
});

await check("能力面：无左框、无成员卡、执行组合不在这里（ADR 0012）", async () => {
  await page.locator('.main-rail [data-surface="library"]').click();
  const lib = page.locator('[data-surface-view="library"]');
  if (await lib.locator(".sp-list").count()) throw new Error("能力面不该有左框");
  if (await lib.locator(".member-cards").count()) throw new Error("还在用「AI 成员」卡片——ADR 0012 已取消这一层");
  if (await lib.locator(".runtime-table").count()) throw new Error("执行组合表还留在能力面");
  if ((await lib.innerText()).includes("做法：")) throw new Error("「做法」和 Skill 是同一个东西，不该有两个名字");

  // 编组是带 steps 的 skill，和普通 skill 在同一张表里（V3.21 §3.2.3）
  const skill = lib.locator('[data-library-body="skill"]');
  if (!(await skill.isVisible())) throw new Error("默认不是 Skills tab");
  const text = await skill.innerText();
  if (!text.includes("只给结果")) throw new Error("编组没有写明每一步的上下文范围");
  if (!text.includes("触碰")) throw new Error("Skill 看不出什么时候注入");
  if (!text.includes("次命中")) throw new Error("Skill 看不出命中过多少次");
  if (!text.includes("不注入验证类派工")) {
    throw new Error("没有写明 Skill 不注入验证类派工——被喂做法的验证不独立");
  }
  if (!(await skill.locator(".dl-row.off").count())) throw new Error("看不到已停用的行");
});

await check("执行组合是运行时的检查结果，不是每天要挑的配置（V3.15）", async () => {
  await gotoRuntime();
  const st = page.locator('[data-surface-view="settings"]');
  // V3.17：没有「全部」总览行，主面永远是某一个 adapter 的详情
  if (await st.locator('.sp-list [data-runtime-pick="all"]').count()) {
    throw new Error("「全部」总览行又回来了——它的原始理由（能力矩阵要横着比）已随矩阵一起删除");
  }
  await st.locator('.sp-list [data-runtime-pick="codex"]').click();
  await st.locator('.mem-tabs [data-runtime-tab="config"]').click();
  const table = st.locator('[data-runtime-body="config"] [data-runtime-view="codex"] .runtime-table').first();
  if (!(await table.isVisible())) throw new Error("运行时组没有执行组合表");
  const head = await table.locator(".rt-head").innerText();
  for (const col of ["模型", "深度", "额度", "项目可用性"]) {
    if (!head.includes(col)) throw new Error(`执行组合表缺少「${col}」列`);
  }
  await st.locator('.mem-tabs [data-runtime-tab="diagnostic"]').click();
  await st.locator('.sp-list [data-runtime-pick="opencode"]').click();
  if (!(await st.innerText()).includes("原生记忆关不掉")) throw new Error("没有说明原生记忆关不掉时的降级（ADR 0011）");
  await st.locator('.sp-list [data-runtime-pick="codex"]').click();
});

await check("自动化：规则、触发、运行与投递分层，所有结果回到普通任务", async () => {
  await page.locator('.main-rail [data-surface="automation"]').click();
  const surface = page.locator('[data-surface-view="automation"]');

  if ((await surface.locator("[data-automation-pick]").count()) < 3) throw new Error("左框规则太少");
  if ((await surface.locator(".automation-tabs > button").count()) !== 4) throw new Error("自动化详情没有分成四个信息层");
  if ((await surface.locator(".automation-list").innerText()).includes("执行历史")) throw new Error("运行历史仍混在规则清单里");

  const main = await surface.locator('[data-automation-body="overview"]').innerText();
  if (!(await surface.locator(".ar-step").count())) throw new Error("没有摊开执行链路");
  for (const want of ["触发", "准入检查", "在项目建任务", "工作流", "派给", "任务验收面"]) {
    if (!main.includes(want)) throw new Error(`执行链路缺少「${want}」`);
  }
  if (!main.includes("不提供「仅运行、不建任务」模式")) throw new Error("没有裁掉会形成第二套结果体系的静默运行模式");
  // 自动化最危险的是权限，所以能力边界必须写在脸上
  if (!main.includes("能力边界")) throw new Error("没有写明能力边界");
  if (!main.includes("不会自己降级去跑")) throw new Error("没有说明缺权限时是停下来问，而不是降权限硬跑");

  await surface.locator('[data-automation-tab="triggers"]').click();
  const triggers = await surface.locator('[data-automation-body="triggers"]').innerText();
  for (const want of ["接下来", "Asia/Singapore", "Webhook URL", "HMAC-SHA256", "Idempotency-Key"]) {
    if (!triggers.includes(want)) throw new Error(`触发器设计缺少「${want}」`);
  }

  await surface.locator('[data-automation-tab="runs"]').click();
  const runs = await surface.locator('[data-automation-body="runs"]').innerText();
  for (const want of ["未触发", "失败", "重复", "关联任务", "Attempt"]) {
    if (!runs.includes(want)) throw new Error(`运行记录没有讲清「${want}」`);
  }

  await surface.locator('[data-automation-tab="deliveries"]').click();
  const deliveries = await surface.locator('[data-automation-body="deliveries"]').innerText();
  for (const want of ["签名", "去重键", "已拒绝", "重放为新投递", "replayed_from"]) {
    if (!deliveries.includes(want)) throw new Error(`Webhook 投递审计缺少「${want}」`);
  }

  await surface.locator("[data-automation-create]").click();
  const dialog = page.locator("[data-automation-dialog]");
  if (!(await dialog.isVisible())) throw new Error("新建自动化入口没有打开创建器");
  const dialogText = await dialog.innerText();
  for (const want of ["Runbook", "第一个触发器", "接下来", "保存为暂停", "保存前预检"]) {
    if (!dialogText.includes(want)) throw new Error(`自动化创建器缺少「${want}」`);
  }
  await dialog.locator("[data-automation-close]").first().click();

  // 离开前归位，后续截图与测试都从概览开始。
  await surface.locator('[data-automation-tab="overview"]').click();

  await page.locator('.main-rail [data-surface="project"]').click();
});

await check("竖栏是唯一的一级导航，各面里不再有重复的旧导航", async () => {
  // 加竖栏时 library/automation/settings 里的 primary-nav 没删干净，
  // 结果同一组入口在页面上出现两次。
  if (await page.locator(".surface .primary-nav").count()) throw new Error("面里还留着加竖栏之前的一级导航");
  const rail = await page.locator(".main-rail [data-surface]").count();
  if (rail < 5) throw new Error("竖栏入口不全");
});

await check("四个视图的正文宽度与左边界一致，切 tab 不跳", async () => {
  // 逐个类名地限宽总会漏掉一个：验收的 .document 用的是 width（会盖过
  // max-width），于是它比其他三个窄 22px，切 tab 时正文左边界跳一下。
  await openTask("issue-view", "overview");
  const left = [];
  for (const [pane, sel] of [["overview", '[data-overview="issue-view"]'],
                             ["acceptance", '[data-document="issue-view"]']]) {
    await page.locator(`[data-pane-tabs] [data-pane-tab="${pane}"]`).click();
    const b = await page.locator(sel).first().boundingBox();
    left.push([pane, Math.round(b.x), Math.round(b.width)]);
  }
  const [a, c] = left;
  if (Math.abs(a[1] - c[1]) > 2) throw new Error(`左边界不一致：${a} vs ${c}`);
  if (Math.abs(a[2] - c[2]) > 2) throw new Error(`正文宽度不一致：${a} vs ${c}`);
});

await check("顶栏不再有布局三档：Dock 取消后它没有可调的东西了", async () => {
  if (await page.locator(".layout-switcher").count()) throw new Error("布局三档仍在");
  if (await page.locator("[data-layout-mode]").count()) throw new Error("布局切换的钩子仍在");
});

await check("项目面工具条是小图标；目录状态标记靠右对齐（照 multica）", async () => {
  await page.locator('.main-rail [data-surface="projects"]').click();
  const surface = page.locator('[data-surface-view="projects"]');
  const icons = surface.locator(".tree-toolbar .tt-icon");
  if ((await icons.count()) < 3) throw new Error("工具条不是图标按钮");
  for (const el of await icons.all()) {
    if (!(await el.locator("svg").count())) throw new Error("图标按钮里没有 svg");
    if (!(await el.getAttribute("aria-label"))) throw new Error("图标按钮缺少 aria-label");
    const box = await el.boundingBox();
    if (box.width > 34 || box.height > 34) throw new Error(`图标按钮过大 ${box.width}×${box.height}`);
  }

  // 标记跟在文件名后面时每行位置都不同，扫不出「哪些改过」
  // 前面的断言可能把树折叠或过滤过；先复位，否则量到的全是 0
  await surface.locator('[data-project-tab="files"]').click();
  await surface.locator("[data-tree-filter]").fill("");
  for (let i = 0; i < 6; i++) {
    const closed = surface.locator('.tree-node.dir:not(.open):visible');
    if (!(await closed.count())) break;
    await closed.first().click();
  }
  const rights = await surface.locator(".tn-badge").evaluateAll((els) =>
    els.map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0).map((r) => Math.round(r.right)));
  if (rights.length < 2) throw new Error("看不到状态标记");
  if (new Set(rights).size !== 1) throw new Error(`状态标记没有右对齐：${rights}`);
  // 用 git 那套字母，不用中文
  for (const t of await surface.locator(".tn-badge").allInnerTexts()) {
    if (!/^[MAD]$/.test(t.trim())) throw new Error(`状态标记应是 M/A/D，实际「${t}」`);
  }
});

await check("项目面的知识 / 工作流 / 设置三个视图都有像样的内容", async () => {
  await page.locator('.main-rail [data-surface="projects"]').click();
  const surface = page.locator('[data-surface-view="projects"]');

  await surface.locator('[data-project-tab="knowledge"]').click();
  const know = surface.locator('[data-project-body="knowledge"]');
  if ((await know.locator(".pj-row").count()) < 2) throw new Error("知识里没有条目");
  if (!(await know.locator(".mem-stance").count())) throw new Error("知识条目没有标 stance");
  if (!(await know.innerText()).includes("不从对话自动摘取")) throw new Error("没有交代知识从哪来");

  await surface.locator('[data-project-tab="workflow"]').click();
  const flow = surface.locator('[data-project-body="workflow"]');
  if ((await flow.locator(".pj-row").count()) < 2) throw new Error("工作流里没有条目");
  if (!(await flow.locator(".pj-step").count())) throw new Error("工作流没有画出步骤链");
  if (!(await flow.innerText()).includes("什么算 Done")) throw new Error("工作流没有写 Done 的判据");

  await surface.locator('[data-project-tab="settings"]').click();
  const st = surface.locator('[data-project-body="settings"]');
  if ((await st.locator(".git-block").count()) < 2) throw new Error("设置内容过少");
  if (!(await st.innerText()).includes("需逐次授权")) throw new Error("能力边界没有写清 push 的限制");
  if (!(await st.innerText()).includes("只能更严不能更松")) throw new Error("没有说明项目边界与派工的关系");

  await surface.locator('[data-project-tab="files"]').click();
  await page.locator('.main-rail [data-surface="project"]').click();
});

await check("七个工作区面都挂在 surface-host 里，不越界盖住竖栏", async () => {
  // 一次标签失衡（工作流卡片改版时正则少吃了一层）会把 <main> 提前关掉，
  // 后面所有面被挤到 app-shell 底下，absolute inset:0 直接盖住整条竖栏，
  // 页面看着没事、就是点不动。这条断言把它变成一眼可见的红。
  for (const v of ["project", "threads", "projects", "memory", "library", "stats", "automation", "settings"]) {
    await page.locator(`.main-rail [data-surface="${v}"]`).click();
    const el = page.locator(`[data-surface-view="${v}"]`);
    const box = await el.boundingBox();
    if (box.x < 50) throw new Error(`${v} 面越界到 x=${box.x}，盖住了竖栏——多半是标签失衡`);
    const parent = await el.evaluate((e) => e.parentElement.className);
    if (!parent.includes("surface-host")) throw new Error(`${v} 面的父级是 ${parent}，不在 surface-host 里`);
  }
  await page.locator('.main-rail [data-surface="project"]').click();
});

await check("[hidden] 一定生效：视图之间不叠加", async () => {
  // 在裸类名上写 display 会盖掉 [hidden]（.trace-item / .baseline-gate /
  // .claim-state / .project-manage / .project-pane.files 都栽过），
  // 表现是切 tab 时上一个视图的内容还留在页面上。
  const leaked = await page.evaluate(
    () => [...document.querySelectorAll("[hidden]")].filter((e) => e.getBoundingClientRect().width > 0).length,
  );
  if (leaked) throw new Error(`${leaked} 个带 hidden 的元素仍然占位`);
});

await check("统计独立成面，夹在能力和设置之间；无左列表、两个 tab（ADR 0017）", async () => {
  const rail = page.locator(".main-rail");
  const y = async (k) => (await rail.locator(`[data-surface="${k}"]`).boundingBox()).y;
  if ((await y("stats")) < (await y("library"))) throw new Error("统计应排在能力下面");
  if ((await y("stats")) > (await y("settings"))) throw new Error("统计应排在设置上面");
  await rail.locator('[data-surface="stats"]').click();
  const surface = page.locator('[data-surface-view="stats"]');
  if (!(await surface.isVisible())) throw new Error("没有统计面");
  // 与记忆面同构：统计没有实体可列，进来就是 tab 页，不是左列表
  if (await surface.locator(".sp-list").count()) throw new Error("统计面不该有左列表——它没有一条条实体可列");
  if ((await surface.locator("[data-stat-tab]").count()) !== 2) throw new Error("统计面应当只有「用量」「失败」两个 tab");
  // 控件位置即作用域：tab 在左、页级筛选（周期 / 项目）在右
  const tabsBox = await surface.locator(".stat-tabs").boundingBox();
  const filterBox = await surface.locator(".stat-filters").boundingBox();
  if (filterBox.x <= tabsBox.x) throw new Error("页级筛选应在 tab 行右侧");
  // 全屏不出现实时余量：统计只回顾，额度归运行时
  const usageText = await surface.locator('[data-stat-body="usage"]').innerText();
  if (usageText.includes("可派次数")) throw new Error("统计面出现了实时额度，回顾与前瞻的口径混了");
  // 实付与订阅等价必须是两个数字，且等价要写明不是账单
  if (!usageText.includes("实付")) throw new Error("费用卡没有区分实付");
  if (!usageText.includes("非实际账单")) throw new Error("订阅等价没有标注它不是账单");
});

await check("趋势卡：形态由周期决定，热力图只在近一年可用（ADR 0017 第 7 条）", async () => {
  const surface = page.locator('[data-surface-view="stats"]');
  await page.locator('.main-rail [data-surface="stats"]').click();
  const heat = surface.locator('[data-statshape-tab="year"]');
  if (!(await heat.isDisabled())) throw new Error("近 30 天下热力图仍可选——365 个格子只有 5 列");
  if (!(await heat.isVisible())) throw new Error("不可用的形态应置灰而不是隐藏");
  await surface.locator('[data-stat-range="365"]').click();
  if (await heat.isDisabled()) throw new Error("切到近一年后热力图仍不可用");
  if ((await surface.locator('[data-statshape-body="year"]').isVisible()) === false) throw new Error("近一年应默认落在热力图");
  if (!(await surface.locator('[data-statshape-tab="day"]').isDisabled())) throw new Error("近一年下「按天」应不可用");
  const cells = await surface.locator(".hm-cell:not(.hm-void)").count();
  if (cells < 360) throw new Error(`热力图只有 ${cells} 个格子，画不满一年`);
  // KPI 跟着周期走，且分布表也跟着换——数字对不上账是评审第一个抓的
  if (!(await surface.locator('[data-kpi="runs"]').first().innerText()).includes("1,707")) throw new Error("切周期后 KPI 没有跟着变");
  const firstRow = surface.locator('[data-statdim-body="task"] .dl-row').first();
  if ((await firstRow.locator(".dl-num").first().innerText()) === "41") throw new Error("切周期后分布表还停在 30 天的数字");
  await surface.locator('[data-stat-range="30"]').click();
});

await check("统计的第三级明细不在统计面里造，回任务的轨迹（ADR 0017 第 6 条）", async () => {
  const surface = page.locator('[data-surface-view="stats"]');
  await page.locator('.main-rail [data-surface="stats"]').click();
  // 合计行按设计不带页码、不随翻页变化，也不该跳转——取第一条真正的任务行
  const row = surface.locator('[data-statdim-body="task"] .dl-row:not(.dl-total)').first();
  if ((await row.getAttribute("data-surface")) !== "project") throw new Error("任务行没有跳回任务模块");
  // 四个维度共用一张表，不新开页
  if ((await surface.locator("[data-statdim-tab]").count()) !== 4) throw new Error("「详情」应当是一张表切四个维度");
  await surface.locator('[data-statdim-tab="combo"]').click();
  const combo = await surface.locator('[data-statdim-body="combo"]').innerText();
  if (!combo.includes("计价来源")) throw new Error("组合表没有写明计价来源，权威值与估算值混在一个数字里");
  await surface.locator('[data-statdim-tab="step"]').click();
  const step = await surface.locator('[data-statdim-body="step"]').innerText();
  if (!step.includes("返工重试")) throw new Error("用途维度缺少「返工重试」——这是本项目相对参考项目的增量");
  await surface.locator('[data-statdim-tab="task"]').click();
});

await check("详情表按页翻，每页 10 条；合计行置顶且不随翻页变化", async () => {
  const surface = page.locator('[data-surface-view="stats"]');
  await page.locator('.main-rail [data-surface="stats"]').click();
  const body = surface.locator('[data-statdim-body="task"]');
  const shown = body.locator(".dl-row:not(.dl-total):not([hidden])");
  if ((await shown.count()) !== 10) throw new Error(`首页应显示 10 行明细，实际 ${await shown.count()}`);
  // 合计置顶：紧贴表头的第一行，不带页码，翻页后仍在
  const total = body.locator(".dl-total");
  if (!(await total.isVisible())) throw new Error("没有合计行");
  if (await total.getAttribute("data-page")) throw new Error("合计行带了页码，翻页时会被藏掉");
  const firstRowIsTotal = await body.evaluate((el) => {
    const rows = [...el.querySelectorAll(".data-list > *")];
    return rows[1]?.classList.contains("dl-total");
  });
  if (!firstRowIsTotal) throw new Error("合计行不在表头下面第一行");
  const kpiRuns = await surface.locator('[data-kpi="runs"]').first().innerText();
  if ((await total.locator(".dl-num").first().innerText()) !== kpiRuns) throw new Error("合计行与 KPI 的派工数对不上");
  await surface.locator('[data-stat-page="next"]').click();
  if ((await shown.count()) !== 7) throw new Error("第二页应显示剩余 7 行");
  if ((await total.locator(".dl-num").first().innerText()) !== kpiRuns) throw new Error("翻页后合计行变了——它应该始终是整个周期的数");
  if (!(await surface.locator('[data-stat-page="next"]').isDisabled())) throw new Error("最后一页的下一页仍可点");
  await surface.locator('[data-stat-page="prev"]').click();
  // 返工占比是指标，必须独立成列并写明口径——不能混进状态列
  const head = await body.locator(".dl-head").innerText();
  if (!head.includes("返工占比")) throw new Error("返工占比没有独立成列");
  if (!head.includes("状态")) throw new Error("状态列被指标顶掉了");
  // Token 拆成命中 / 未命中，且必须说明输出算在哪一边
  if (!head.includes("缓存命中") || !head.includes("未命中")) throw new Error("Token 没有拆成缓存命中与未命中");
  const note = await body.locator(".sc-note").innerText();
  if (!note.includes("step_kind")) throw new Error("返工占比没有写明口径，读者无法核对它怎么来的");
  if (!note.includes("命中 + 未命中")) throw new Error("返工占比没有写明分母是拆分前的总量");
  if (!note.includes("输出永远不进缓存")) throw new Error("没有说明输出计入未命中——两列相加为什么等于总量就说不通了");
  // 行数少的维度不分页，但同样要有置顶合计
  // 四个维度是同一批 token 的四种切法，命中 / 未命中的合计必须完全一致
  const taskTotal = await body.locator(".dl-total").innerText();
  const taskCache = taskTotal.match(/(\d+\.\d+M)\s+(\d+\.\d+M)/);
  for (const dim of ["project", "combo", "step"]) {
    await surface.locator(`[data-statdim-tab="${dim}"]`).click();
    const dimTotal = surface.locator(`[data-statdim-body="${dim}"] .dl-total`);
    if (!(await dimTotal.isVisible())) throw new Error(`${dim} 维度缺少合计行`);
    const text = await dimTotal.innerText();
    if (taskCache && !(text.includes(taskCache[1]) && text.includes(taskCache[2]))) {
      throw new Error(`${dim} 维度的命中 / 未命中合计与任务维度对不上——同一批 token 切出了两个总量`);
    }
  }
  await surface.locator('[data-statdim-tab="task"]').click();
});

await check("失败页只收真故障：验证未通过与额度不足不进失败率", async () => {
  const surface = page.locator('[data-surface-view="stats"]');
  await page.locator('.main-rail [data-surface="stats"]').click();
  await surface.locator('[data-stat-tab="errors"]').click();
  const body = await surface.locator('[data-stat-body="errors"]').innerText();
  if (!body.includes("不计入本页")) throw new Error("没有写明验证未通过与额度不足不算失败");
  if (!body.includes("样本不足")) throw new Error("小样本的失败率没有标注，会被当成结论读");
  await surface.locator('[data-stat-tab="usage"]').click();
});

await check("额度在设置 · 运行时的配置 tab，不在统计也不单开入口（ADR 0017 第 5 条）", async () => {
  await page.locator('.main-rail [data-surface="settings"]').click();
  const list = await page.locator('[data-surface-view="settings"] .sp-list').innerText();
  if (list.includes("额度与用量")) throw new Error("设置左列表里又出现了独立的额度入口——额度的消费点只有三个，总览是第四份");
  // V3.21：adapter 与凭据现在正是设置的一组，左栏必须能看见运行时与插件两组
  for (const group of ["运行时", "插件"]) {
    if (!list.includes(group)) throw new Error(`设置左栏缺少「${group}」组——V3.21 把它们拆成两组，不合并`);
  }

  await gotoRuntime();
  await page.locator('[data-surface-view="settings"] .mem-tabs [data-runtime-tab="config"]').click();
  const runtime = await page.locator('[data-surface-view="settings"] [data-runtime-body="config"]').innerText();
  if (!runtime.includes("额度池")) throw new Error("运行时组没有额度池——额度是 Runtime 的字段（ADR 0012 第 3 条）");
  if (!runtime.includes("可派次数")) throw new Error("额度没有按可派次数记，退回成 token 账单了");
  // V3.15 正名：额度按 adapter 配置分池，不按「账号」——凭据只是配置的一个字段
  if (!runtime.includes("按 adapter 配置")) throw new Error("额度池没有按 adapter 配置分，同配置下多个模型共用一个池这件事说不清");
  if (runtime.includes("按账号分池")) throw new Error("「账号」这个词回来了，与 ADR 0012 第 8 条命名纪律冲突");
  if (!runtime.includes("不自动降级")) throw new Error("丢了「额度不足不自动降级」这条");
});

await check("设置里有任务前缀与标签，且前缀改动被当成要确认的操作", async () => {
  await page.locator('.main-rail [data-surface="settings"]').click();
  const surface = page.locator('[data-surface-view="settings"]');
  const pick = surface.locator('[data-settings-pick="labels"]');
  if (!(await pick.isVisible())) throw new Error("设置左栏缺少「任务前缀与标签」");
  await pick.click();
  const body = surface.locator('.sp-body[data-settings-view="labels"]');
  if (!(await body.isVisible())) throw new Error("点了没有切到标签面");
  // V3.21 反了过来：运行时并进设置，这个面板现在必须在
  if (!(await surface.locator('.sp-body[data-settings-view="runtime"]').count())) {
    throw new Error("设置面里没有运行时组——V3.21 已把原 §3.7 整体并进设置");
  }
  if (!(await surface.locator('.sp-body[data-settings-view="plugins"]').count())) {
    throw new Error("设置面里没有插件组——装 CLI 与导入方法包必须分成两组");
  }
  const text = await body.innerText();
  if (!text.includes("重命名")) throw new Error("改前缀没有说清会重命名已有任务");
  if (!text.includes("不参与派工判断")) throw new Error("没有说清标签只是筛选层，会被误当成路由信号");
  if ((await body.locator(".label-table .rt-row").count()) < 5) throw new Error("标签列表太短，看不出这是个要维护的表");
});

await check("能力面与记忆面用同一套列表排版", async () => {
  const read = async (sel) =>
    page.locator(sel).first().evaluate((e) => {
      const c = getComputedStyle(e);
      return { fs: c.fontSize, fw: c.fontWeight, pad: c.padding };
    });

  await page.locator('.main-rail [data-surface="memory"]').click();
  const memRow = await read('[data-memory-body="inbox"] .dl-row');
  const memTitle = await read('[data-memory-body="inbox"] .dl-title');

  await page.locator('.main-rail [data-surface="library"]').click();
  await page.locator('[data-library-tab="skill"]').click();
  const skillRow = await read('[data-library-body="skill"] .dl-row');
  const skillTitle = await read('[data-library-body="skill"] .dl-title');

  if (skillRow.pad !== memRow.pad) throw new Error(`行内边距 ${skillRow.pad} ≠ 记忆 ${memRow.pad}`);
  if (skillTitle.fs !== memTitle.fs) throw new Error(`标题字号 ${skillTitle.fs} ≠ 记忆 ${memTitle.fs}`);
  if (skillTitle.fw !== memTitle.fw) throw new Error(`标题字重 ${skillTitle.fw} ≠ 记忆 ${memTitle.fw}`);

  // 页面级的头部也要一致：记忆被缩排规则改小过（h1 20px、small 10px 灰），
  // 能力却还在吃 .surface-content 的默认（29px、9px 蓝色大写），
  // 于是两面的 tab 行差了 15px，来回切会看到整页往下掉一截。
  const chrome = async (view) => {
    await page.locator(`.main-rail [data-surface="${view}"]`).click();
    return page.evaluate((v) => {
      const root = document.querySelector(`[data-surface-view="${v}"]`);
      const g = (sel) => {
        const e = root.querySelector(sel);
        const c = getComputedStyle(e);
        const r = e.getBoundingClientRect();
        return `${c.fontSize}/${c.fontWeight}/${c.color}/${Math.round(r.y)}/${Math.round(r.height)}`;
      };
      return { small: g("header small"), h1: g("h1"), tabs: g(".mem-tabs") };
    }, view);
  };
  const memChrome = await chrome("memory");
  const libChrome = await chrome("library");
  for (const k of ["small", "h1", "tabs"]) {
    if (memChrome[k] !== libChrome[k]) {
      throw new Error(`${k} 不一致：记忆 ${memChrome[k]} ≠ 能力 ${libChrome[k]}`);
    }
  }
  await page.locator('[data-library-tab="skill"]').click();
  await page.locator('.main-rail [data-surface="project"]').click();
});

await check("记忆与能力用列表而不是卡片，列表铺满、段落限宽", async () => {
  // 卡片的问题不是好不好看，是管不动：每张卡自带边框和内边距，同一个字段
  // 在不同卡里的位置对不齐，扫十几条就得逐张读；上百条之后更没法比较。
  const measure = async (view, bodySel) => {
    await page.locator(`.main-rail [data-surface="${view}"]`).click();
    return page.evaluate((sel) => {
      const body = document.querySelector(sel);
      const list = body.querySelector(".data-list");
      const content = body.closest(".surface-content");
      const note = body.querySelector(".pane-note");
      const head = list.querySelector(".dl-head");
      const row = list.querySelector(".dl-row");
      const cells = (el) => [...el.children].map((c) => Math.round(c.getBoundingClientRect().x));
      return {
        listW: Math.round(list.getBoundingClientRect().width),
        contentW: Math.round(content.getBoundingClientRect().width),
        noteW: note ? Math.round(note.getBoundingClientRect().width) : 0,
        cols: getComputedStyle(head).gridTemplateColumns.split(" ").length,
        headX: cells(head),
        rowX: cells(row).slice(0, cells(head).length),
      };
    }, bodySel);
  };

  await page.locator('.main-rail [data-surface="library"]').click();
  await page.locator('[data-library-tab="skill"]').click();
  const lib = await measure("library", '[data-library-body="skill"]');
  const mem = await measure("memory", '[data-memory-body="inbox"]');

  for (const [name, m] of [["记忆", mem], ["能力", lib]]) {
    if (m.cols < 4) throw new Error(`${name}的列表只有 ${m.cols} 列，看不出是表`);
    // 差的 64px 是内容区左右各 32 的内边距，不算没铺满
    if (m.listW < m.contentW - 80) throw new Error(`${name}的列表只有 ${m.listW}，内容区有 ${m.contentW}`);
    // 段落不跟着铺满：一行 40 字左右才读得动
    if (m.noteW > 900) throw new Error(`${name}的说明段 ${m.noteW}px 太宽，读不动`);
    // 列表的意义就在于同一字段纵向对齐；表头和数据行必须落在同一列上
    for (let i = 0; i < m.headX.length; i++) {
      if (Math.abs(m.headX[i] - m.rowX[i]) > 2) {
        throw new Error(`${name}的第 ${i + 1} 列表头与数据没对齐（${m.headX[i]} vs ${m.rowX[i]}）`);
      }
    }
  }
  if (await page.locator(".memory-row, .skill-card, .squad-list > article").count()) {
    throw new Error("还留着卡片式的条目");
  }
  // measure 会把页面停在记忆面，先切回去再复位 tab
  await page.locator('.main-rail [data-surface="library"]').click();
  await page.locator('[data-library-tab="skill"]').click();
  await page.locator('.main-rail [data-surface="project"]').click();
});

await check("凭据在运行时面的配置 tab：登录态不代管，API Key 才是 PersonaHub 自己存的", async () => {
  await gotoRuntime();
  const surface = page.locator('[data-surface-view="settings"]');
  await surface.locator('.mem-tabs [data-runtime-tab="config"]').click();
  // V3.17：每个 adapter 的配置视图必须自足——登录态在 OAuth 的 adapter 下，
  // API Key 在 opencode 下，不再有一张跨 adapter 的汇总表
  for (const a of ["codex", "claude"]) {
    await surface.locator(`.sp-list [data-runtime-pick="${a}"]`).click();
    const one = surface.locator(`[data-runtime-body="config"] [data-runtime-view="${a}"]`);
    if (!(await one.locator(".account-row").count())) throw new Error(`${a} 的配置视图里没有它自己的登录态`);
    // 两组必须分开：OAuth 由 CLI 自管，混在一起会让人以为登录态也要填 key
  }
  // 「PersonaHub 不代管登录态」是一条全局策略，不是某个 adapter 的事实，放在 tab 的共用页首
  {
    const cfg = await surface.locator('[data-runtime-body="config"]').innerText();
    if (!cfg.includes("只做只读检查")) throw new Error("没有说清登录态不由 PersonaHub 代管");
  }
  await surface.locator('.sp-list [data-runtime-pick="opencode"]').click();
  const body = surface.locator('[data-runtime-body="config"] [data-runtime-view="opencode"]');
  if ((await body.locator(".label-table .rt-row").count()) < 2) throw new Error("API Key 配置应单独成表，且 opencode 的两份要都在");

  // 弹层：登录态那一支不应出现任何 key 输入框
  await surface.locator("[data-account-new]").first().click();
  const dialog = page.locator("[data-account-dialog]:visible");
  if (!(await dialog.isVisible())) throw new Error("新增账号弹层没打开");
  const oauthPane = dialog.locator('[data-account-body="oauth"]');
  if (!(await oauthPane.isVisible())) throw new Error("默认应停在 CLI 登录态");
  if (await oauthPane.locator('input[type="text"]').count()) {
    throw new Error("登录态这一支出现了输入框——PersonaHub 不代管 token，不该要求填任何凭据");
  }
  await dialog.locator('[data-account-mode="api_key"]').click();
  const keyPane = dialog.locator('[data-account-body="api_key"]');
  if ((await keyPane.locator("input[type=\"text\"]").count()) < 3) throw new Error("API Key 这一支字段不全（账号名 / Base URL / key）");
  if (!(await keyPane.locator("select").count())) throw new Error("API Key 这一支没有选 adapter");
  if (await oauthPane.isVisible()) throw new Error("切换后登录态面板还留在页面上");
  await dialog.locator("[data-account-close]").first().click();
});

await check("运行时面：左框是 adapter 列表，灯不能只有颜色（V3.15 §3.7.1）", async () => {
  await gotoRuntime();
  const surface = page.locator('[data-surface-view="settings"]');
  if (!(await surface.locator(".sp-list").count())) {
    throw new Error("运行时面没有左框——adapter 是一条条实体，有实体就有列表（§3.4 的规则）");
  }
  // V3.17：左框只列 adapter，没有「全部」——聚合视图的价值随 adapter 数量增长，N=3 时它只是三次点击的替代品
  if (await surface.locator('.sp-list [data-runtime-pick="all"]').count()) throw new Error("「全部」总览行又回来了");
  for (const a of ["codex", "claude", "opencode"]) {
    const row = surface.locator(`.sp-list [data-runtime-pick="${a}"]`);
    if (!(await row.isVisible())) throw new Error(`左框缺少 adapter ${a}`);
    if (!(await row.locator(".signal").count())) throw new Error(`${a} 那一行没有状态灯`);
    // 纯色块既过不了无障碍，也不满足「能力缺失提前标注」
    const sub = (await row.locator("small").innerText()).trim();
    if (!sub) throw new Error(`${a} 的灯旁没有文字说明，只剩一个颜色`);
  }
  // 防护条款：这一面不出现任何「偏好」字段
  const all = await surface.innerText();
  for (const word of ["设为默认", "优先级", "置顶", "重命名"]) {
    if (all.includes(word)) throw new Error(`设置 · 运行时出现了「${word}」——偏好字段会让 adapter 长成「AI 成员」（ADR 0012 第 2 条）`);
  }
});

await check("设置 · 运行时只有两个 tab：能力位降为诊断里的「做不到什么」，写后果不写能力位名（V3.16 §3.7.2）", async () => {
  const surface = page.locator('[data-surface-view="settings"]');
  // 能力 tab 已删：一张全是不可点格子的矩阵就是它自己批判过的债务展览馆
  if (await surface.locator('.mem-tabs [data-runtime-tab="capability"]').count()) {
    throw new Error("能力 tab 又回来了——V3.16 已把它删掉，能力位归各 adapter 的诊断");
  }
  if ((await surface.locator(".mem-tabs > button").count()) !== 2) throw new Error("运行时面应当只有配置 / 诊断两个 tab");

  await surface.locator('.mem-tabs [data-runtime-tab="diagnostic"]').click();
  await surface.locator('.sp-list [data-runtime-pick="opencode"]').click();
  const one = surface.locator('[data-runtime-body="diagnostic"] [data-runtime-view="opencode"]');
  if (!(await one.isVisible())) throw new Error("选中 opencode 后没有它的诊断视图");
  const text = await one.innerText();
  if (!text.includes("这个 adapter 做不到什么")) throw new Error("诊断里没有「做不到什么」这一块——§4.6 第 5 条的落点没了");
  // 写后果，不写能力位名字
  if (!text.includes("不能当独立验证员")) throw new Error("原生记忆关不掉这条没有写出它对独立验证的后果");
  if (!text.includes("等待权限确认")) throw new Error("没写清不支持权限拦截会导致哪个任务态不会发生");
  // 能力边界不是故障，不能混进失败率
  if (!text.includes("不进失败率")) throw new Error("没有把「能力边界」和「故障」分开，失败率会被污染");
  // 三个 adapter 都要有这一块，否则「没有做不到的」也是一条信息
  for (const a of ["codex", "claude"]) {
    await surface.locator(`.sp-list [data-runtime-pick="${a}"]`).click();
    const t = await surface.locator(`[data-runtime-body="diagnostic"] [data-runtime-view="${a}"]`).innerText();
    if (!t.includes("这个 adapter 做不到什么")) throw new Error(`${a} 的诊断缺少「做不到什么」——空着和没有这一块不是一回事`);
  }
  await surface.locator('.sp-list [data-runtime-pick="codex"]').click();
});

await check("设置 · 运行时：同一模型两条路必须是两个执行组合（ADR 0012 第 2 条四元组）", async () => {
  const surface = page.locator('[data-surface-view="settings"]');
  await surface.locator('.sp-list [data-runtime-pick="opencode"]').click();
  await surface.locator('.mem-tabs [data-runtime-tab="config"]').click();
  const body = surface.locator('[data-runtime-body="config"] [data-runtime-view="opencode"]');
  if (!(await body.isVisible())) throw new Error("没有 opencode 的配置视图");
  const text = await body.innerText();
  if ((await body.locator(".label-table .rt-row").count()) < 2) throw new Error("opencode 应有两份配置——这是四元组存在的那个真实场景");
  if (!text.includes("Base URL")) throw new Error("配置表没有 Base URL 列，两条路就分不开了");
  if (!text.includes("两条路")) throw new Error("没有说清同一个模型两条路为什么必须是两个组合");
  await surface.locator('.sp-list [data-runtime-pick="codex"]').click();
});

await check("密钥存放在设置 · 数据，不在运行时组（V3.17）", async () => {
  // 它讲的是数据目录与明文列，是数据风险声明，不是某个 adapter 的属性——
  // 放在任何一个 adapter 下面都是错的
  await gotoRuntime();
  const rt = page.locator('.sp-body[data-settings-view="runtime"]');
  if ((await rt.innerText()).includes("没有加密")) throw new Error("密钥风险声明又回到运行时组了");

  await page.locator('.main-rail [data-surface="settings"]').click();
  const st = page.locator('[data-surface-view="settings"]');
  await st.locator('.sp-list [data-settings-pick="data"]').click();
  const body = st.locator('.sp-body[data-settings-view="data"]');
  if (!(await body.isVisible())) throw new Error("设置里没有「数据与备份」面板");
  const text = await body.innerText();
  if (!text.includes("不回原值")) throw new Error("没有说明 key 不回显");
  if (!text.includes("没有加密")) throw new Error("数据库明文存 key 这条风险没有摊开");
  if (!text.includes("同步盘")) throw new Error("没有写出「数据目录进同步盘等于把 key 同步出去」");
  await page.locator('.main-rail [data-surface="project"]').click();
});

await check("页面无横向溢出", async () => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 1) throw new Error(`横向溢出 ${overflow}px`);
});

// 收尾截图前先收拾现场：断言可能留下开着的浮层，或把页面停在别的面
await page.keyboard.press("Escape");
await page.evaluate(() => document.querySelectorAll(".command-overlay").forEach((el) => (el.hidden = true)));
await page.locator('.main-rail [data-surface="project"]').click();
await page.locator('.work-item[data-open="issue-view"]').first().click();
await page.screenshot({ path: "shots/workbench.png", fullPage: true });
await check("能力面是可选能力的容器：tab 由插件贡献，缺了也能跑（V3.21 §3.2）", async () => {
  await page.locator('.main-rail [data-surface="library"]').click();
  const lib = page.locator('[data-surface-view="library"]');

  // 判据必须写在面上，否则下一版又会有人把 adapter 塞进来
  const head = await lib.locator("header").innerText();
  if (!head.includes("缺了也照样能干活")) throw new Error("能力面没有写出准入判据——它是这一面存在的理由");

  // 三个 tab（编组 / Skill / 来源）已收成一张表；来源不再是 tab
  if (await lib.locator('[data-library-tab="source"]').count()) {
    throw new Error("「来源」tab 又回来了——来源是治理维度不是查找维度，它归设置 · 插件");
  }
  if (await lib.locator('[data-library-body="squad"]').count()) {
    throw new Error("编组又变回独立类型了——它应该只是带 steps 的 skill（#编组 tag）");
  }

  // tab 栏末尾的「＋」是入口，不是 tab：tab 由插件装出来
  if (!(await lib.locator(".mem-tabs .lib-tab-add").count())) {
    throw new Error("tab 栏没有「装更多」的入口，看不出这一面是个容器");
  }
});

await check("Skills 是一张表 + tag 筛选，编组只是带 steps 的行（V3.21 §3.2.3）", async () => {
  await page.locator('.main-rail [data-surface="library"]').click();
  const pane = page.locator('[data-library-body="skill"]');
  await page.locator('[data-library-tab="skill"]').click();

  const head = await pane.locator(".dl-head").innerText();
  for (const col of ["名称", "tags", "要求", "步骤", "来源", "状态"]) {
    if (!head.includes(col)) throw new Error(`Skills 表缺少「${col}」列`);
  }
  if (head.includes("表现") || head.includes("评分")) {
    throw new Error("表里出现了表现列——Squad 不产生持久身份（ADR 0012 第 5 条），表现是展开后现算的一句");
  }

  const total = await pane.locator(".dl-row").count();
  if (total < 8) throw new Error("Skills 表行数太少，看不出编组与普通 skill 混在同一张表里");

  // tag 筛选：#编组 应该只留下带 steps 的那几行
  await pane.locator('[data-lib-filter="编组"]').click();
  const shown = await pane.locator(".dl-row:not([hidden])").count();
  if (shown === total) throw new Error("按 #编组 筛选没有过滤掉任何行——筛选是假的");
  if (shown === 0) throw new Error("按 #编组 筛选之后一行都不剩");
  for (const row of await pane.locator(".dl-row:not([hidden])").all()) {
    if (!(await row.innerText()).includes("步")) throw new Error("#编组 里出现了没有步骤的行");
  }
  await pane.locator('[data-lib-filter="all"]').click();
  if ((await pane.locator(".dl-row:not([hidden])").count()) !== total) throw new Error("切回「全部」没有恢复所有行");
});

await check("插件的 tab 是声明出来的，动作走宿主白名单（V3.21 §3.2.6）", async () => {
  await page.locator('.main-rail [data-surface="library"]').click();
  await page.locator('[data-library-tab="inbox"]').click();
  const pane = page.locator('[data-library-body="inbox"]');
  const text = await pane.innerText();

  if (!text.includes("不是插件画的")) throw new Error("没有说清界面由宿主渲染——这是允许插件开 tab 的前提");
  if (!text.includes("host.issue.createWithRoom")) throw new Error("没有写出动作走的是宿主白名单，来源链就可能被绕开");
  if (!text.includes("不能新增交互范式")) throw new Error("丢了「插件能新增数据、不能新增交互范式」这条代价");
  if (!text.includes("还不属于任何项目")) throw new Error("没有交代抓来的东西归属哪个项目——资源库挂在 Project 下");

  // 两个动作都必须在行上，否则这个 tab 只是个只读列表
  const acts = await pane.locator(".dl-row .dl-act").first().innerText();
  if (!acts.includes("归档") || !acts.includes("深入拆解")) throw new Error("订阅行缺少归档 / 深入拆解动作");

  // 停用它 tab 就消失：这一条写在设置 · 插件里
  await page.locator('.main-rail [data-surface="settings"]').click();
  await page.locator('[data-surface-view="settings"] .sp-list [data-settings-pick="plugins"]').click();
  const body = page.locator('.sp-body[data-settings-view="plugins"]');
  if (!(await body.isVisible())) throw new Error("设置里打不开插件组");
  const ptext = await body.innerText();
  if (!ptext.includes("能力包") || !ptext.includes("插件")) throw new Error("插件组没有分成能力包与插件两个子区——风险差一个数量级的东西不能长得一样");
  if (!ptext.includes("没有沙箱")) throw new Error("代码准入没有写出「本机没有沙箱」");
  if (!ptext.includes("不得声明 surface")) throw new Error("没有写出 adapter 不能开 tab 的准入判据");
});

await browser.close();

const result = { passed: checks.length, failed: failures.length, checks, failures, consoleErrors };
fs.writeFileSync("shots/browser-check.json", `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
if (failures.length || consoleErrors.length) process.exitCode = 1;
