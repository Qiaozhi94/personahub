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

// V3.21：运行时不再是一级面，它是设置里的一组。
// V3.32：机器在左栏，右侧是「概览 + 每个 adapter 一个 tab」。
// 进一个 adapter 的详情：切运行时 → 选机器 → 点它的 tab。
async function gotoRuntime(adapter = "lt-codex", machine = "lt") {
  await page.locator('.main-rail [data-surface="runtime"]').click();
  await page.locator(`[data-machine-pick="${machine}"]`).click();
  const stage = page.locator(`.rt-stage[data-machine-view="${machine}"]`);
  await stage.locator(`[data-rt-tab="${adapter}"]`).click();
  await stage.locator(`[data-rt-body="${adapter}"]`).waitFor({ state: "visible" });
  return stage;
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

  // 五个实体左栏共用同一标题栏：新增入口只显示加号，通过可访问名称区分用途。
  const sidebarHeaders = [
    ["project", ".project-explorer > .sp-head", "任务", "新建任务"],
    ["threads", ".project-explorer > .sp-head", "会话", "新建会话"],
    ["projects", ".sp-list > .sp-head", "项目", "新建项目"],
    ["automation", ".sp-list > .sp-head", "自动化", "新建自动化"],
    ["runtime", ".sp-list > .sp-head", "远程", "添加执行机器"],
  ];
  const headerMetrics = [];
  for (const [surface, selector, heading, action] of sidebarHeaders) {
    await page.locator(`.main-rail [data-surface="${surface}"]`).click();
    const head = page.locator(`[data-surface-view="${surface}"] ${selector}`);
    if ((await head.count()) !== 1) throw new Error(`${heading}左栏没有使用统一标题栏`);
    const button = head.locator(`:scope > button[aria-label="${action}"]`);
    if ((await button.count()) !== 1 || (await button.innerText()).trim() !== "＋") {
      throw new Error(`${heading}左栏的新增入口不是独立加号按钮`);
    }
    const headBox = await head.boundingBox();
    const buttonBox = await button.boundingBox();
    const buttonStyle = await button.evaluate((el) => {
      const style = getComputedStyle(el);
      return [style.borderRadius, style.fontSize, style.backgroundColor].join("|");
    });
    headerMetrics.push(`${Math.round(headBox?.height ?? 0)}|${Math.round(buttonBox?.width ?? 0)}|${Math.round(buttonBox?.height ?? 0)}|${buttonStyle}`);
  }
  if (new Set(headerMetrics).size !== 1) throw new Error(`五个左栏标题区样式不一致：${headerMetrics.join(", ")}`);
  await page.locator('.main-rail [data-surface="project"]').click();
  for (const surface of ["project", "threads"]) {
    if (await page.locator(`[data-surface-view="${surface}"] .project-explorer > .sp-head small`).count()) {
      throw new Error(`${surface === "project" ? "任务" : "会话"}标题仍有解释文字`);
    }
  }

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
  if ((await items.count()) < 9) throw new Error("竖栏项过少");
  for (const surface of ["project", "threads", "projects", "automation", "memory", "library", "runtime", "stats", "settings"]) {
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
  // V3.28：运行时重新成为一级入口，口径从排障改为盘点；组内按依赖顺序排——
  // 能力面的执行组合由运行时的检查决定，所以运行时紧跟在能力之后、统计之前。
  if ((await y("runtime")) < (await y("library"))) {
    throw new Error("运行时应排在能力之后——它是能力面的上游（依赖顺序）");
  }
  if ((await items.count()) !== 9) throw new Error(`一级入口应为 9 个，实际 ${await items.count()} 个`);

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

  // V3.25：只报上游给的两个口径与哪个更紧，不折算成「还能派几次」——
  // 那要靠一个固定系数换算，而真实消耗按任务差异极大，折出来的数字
  // 看起来像事实其实是估算。
  const est = await pop.locator("[data-depth-est]").innerText();
  if (!est.includes("medium")) throw new Error("深度变了但估算没跟上");
  if (!est.includes("时限额") || !est.includes("周限额")) throw new Error("没有同时报时限额与周限额");
  if (!est.includes("更紧的那一个")) throw new Error("没有指出两个口径里哪一个是绑住这次派工的那一个");
  if (/\d+ 次调用/.test(est)) throw new Error("又把额度折算成「还能派几次」了——那是估算，不是事实");

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

  // 展开一条详情：行内展开是这一版轨迹的主交互
  const shotRow = trace.locator(".tr-row.tool").first();
  await shotRow.click();
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
  if ((await picker.innerText()).includes("成员")) throw new Error("弹窗里还留着「成员」这个不存在的概念");
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
  if (!(await needs.isVisible())) throw new Error("弹窗顶部没有「这一步需要什么」");
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
  await page.locator('[data-library-tab="skill"]').click();
  const skillPane = page.locator('[data-library-body="skill"]');
  await skillPane.locator('[data-skill-open="verify-pair"]').click();
  const squad = await skillPane.locator('[data-skill-scope="detail"]').innerText();
  if (!squad.includes("result_only")) throw new Error("编组源文件没有保留验证步的上下文范围");
  if (!squad.includes("独立")) throw new Error("编组详情没有说明为什么要限制上下文");
  await skillPane.locator('[data-skill-back]').last().click();
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

  await dlg.locator("[data-task-next]").click();
  await dlg.locator("[data-task-confirm]").click();
  if (await dlg.isVisible()) throw new Error("提交后弹窗没关");
  if ((await page.locator("[data-pane-tab].active").innerText()) !== "会话") throw new Error("创建后没有直接进入会话");
});

// UX-BL-R1-002：首次设置必须从界面上真的走得到，且三步连续可点。
// 曾经 setup 面存在但入口写的是 start，页面上没有任何一个按钮进得去。
await check("首次设置：入口可达，J1.1-J1.6 连续走通且检查有失败与重试", async () => {
  if (await page.locator('[data-surface="start"]').count()) throw new Error("start 这个已废弃的路由标识又回来了");
  await page.locator('.main-rail [data-surface="projects"]').click();
  const entry = page.locator('.sp-head [data-surface="setup"]');
  if (!(await entry.isVisible())) throw new Error("首次设置没有可见入口");
  await entry.click();
  const setup = page.locator('[data-surface-view="setup"]');
  if (!(await setup.isVisible())) throw new Error("点了入口没有进入首次设置");

  // J1.2 代码目录：能改、能重新检查，且明确说明读不到时会怎样
  if (!(await setup.locator("[data-setup-path]").isVisible())) throw new Error("第 1 步没有代码目录输入");
  if (!(await setup.locator('[data-setup-probe="repo"]').innerText()).includes("main")) throw new Error("没有回读 Git 信息");
  await setup.locator('[data-setup-body="repo"] [data-setup-go="members"]').click();

  // J1.4 一个成员即可继续，第二个是建议：移除后必须说明同源验证后果
  const members = setup.locator('[data-setup-body="members"]');
  if (!(await members.isVisible())) throw new Error("进不到 AI 成员这一步");
  await members.locator("[data-setup-drop-verify]").click();
  const hint = members.locator("[data-verify-hint]");
  if (!(await hint.isVisible())) throw new Error("移除第二个成员后没有说明后果");
  if (!(await hint.innerText()).includes("同源验证")) throw new Error("没有说明同源验证的后果");
  await hint.locator("[data-setup-add-verify]").click();
  await members.locator('[data-setup-go="check"]').first().click();

  // J1.5 执行检查必须真有 loading → 失败 → 重试 → 成功
  await setup.locator("[data-setup-run]").click();
  const first = setup.locator('[data-check-item="cli"]');
  if ((await first.getAttribute("data-state")) !== "running") throw new Error("检查没有 loading 态，瞬间出结果");
  await first.locator('[data-check-mark]').filter({ hasText: "!" }).waitFor();
  const retry = setup.locator("[data-setup-retry]");
  if (!(await retry.isVisible())) throw new Error("检查失败后没有重试入口");
  if (await setup.locator("[data-setup-first-task]").isVisible()) throw new Error("检查没过就放行了");
  await retry.click();
  const go = setup.locator("[data-setup-first-task]");
  await go.waitFor({ state: "visible" });

  // J1.6 落到唯一的任务创建入口
  await go.click();
  if (!(await page.locator(".task-create-dialog").isVisible())) throw new Error("设置完成后没有落到新建任务");
  await page.keyboard.press("Escape");
});

// UX-BL-R1-001：目标原文是使用者唯一亲手写的东西，创建之后必须还在；
// 确认之前不得产生任何任务，重复确认不得重复创建（J2.1-J2.3）。
await check("新建任务：目标原文端到端保留，确认前不创建，重复提交不重复创建", async () => {
  const goal = `唯一目标探针 ${Date.now()} · 修复重启恢复时的重复认领`;
  await page.locator('.main-rail [data-surface="project"]').click();
  const before = await page.locator(".work-item").count();
  await page.locator("[data-new-object]").click();
  const dlg = page.locator(".task-create-dialog");
  await dlg.locator("[data-task-goal]").fill(goal);

  // 第一步按回车不得直接建任务
  await dlg.locator("[data-task-goal]").press("Enter");
  if (!(await dlg.isVisible())) throw new Error("停在写目标这一步就把任务建掉了");

  // J2.2：确认前必须先看到推荐方案，且能说明为什么是它、谁被排除
  await dlg.locator("[data-task-next]").click();
  const review = dlg.locator('[data-task-step="review"]');
  if (!(await review.isVisible())) throw new Error("缺少推荐方案这一步，直接跳到了创建");
  const planText = await review.innerText();
  if (!planText.includes(goal)) throw new Error("推荐这一步没有回显目标原文");
  if (!planText.includes("验证方式")) throw new Error("推荐方案没有说明验证方式");
  if (!planText.includes("没选谁")) throw new Error("推荐方案没有说明不可用候选的原因");
  if (!planText.includes("不是对目标文本的语义理解")) throw new Error("推荐声称了语义理解");
  if ((await page.locator(".work-item").count()) !== before) throw new Error("确认前就已经创建了任务");

  // J2.2：返回修改目标不得丢草稿
  await dlg.locator("[data-task-back]").click();
  if (!(await dlg.locator("[data-task-goal]").inputValue()).trim().includes(goal)) throw new Error("返回修改目标后草稿丢了");

  await dlg.locator("[data-task-next]").click();
  await dlg.locator("[data-task-confirm]").click();
  if (await dlg.isVisible()) throw new Error("确认后弹窗没关");
  if (!(await page.locator("[data-pane-task-name]").innerText()).includes(goal)) {
    throw new Error("创建后目标原文没有保留在任务上");
  }
  if (!(await page.locator('[data-pane="thread"]').innerText()).includes(goal)) {
    throw new Error("创建后目标原文没有进入会话");
  }
});

// 空目标不得创建任务（J2「目标为空或不可执行」→ 不创建 Issue/Run）
await check("新建任务：空目标不进入推荐，也不创建任务", async () => {
  await page.keyboard.press("Escape");
  await page.locator('.main-rail [data-surface="project"]').click();
  await page.locator("[data-new-object]").click();
  const dlg = page.locator(".task-create-dialog");
  await dlg.locator("[data-task-goal]").fill("   ");
  await dlg.locator("[data-task-next]").click();
  if (await dlg.locator('[data-task-step="review"]').isVisible()) throw new Error("空目标也进了推荐步骤");
  if (!(await dlg.isVisible())) throw new Error("空目标把弹窗关掉了");
  await dlg.locator("[data-task-create-close]").first().click();
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
  if (tabs.join("/") !== "文件/项目记忆/Skills/设置") throw new Error(`项目 tab 应是 文件/项目记忆/Skills/设置，实际 ${tabs}`);
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

  await surface.locator('[role="tab"][data-project-tab="skills"]').click();
  if (!(await surface.locator('[data-project-body="skills"]').isVisible())) throw new Error("项目 tab 切不动");
  await surface.locator('[data-project-tab="files"]').click();
  await page.locator('.main-rail [data-surface="project"]').click();
});

await check("记忆面只有互斥的内容入口：待办 / 知识库 / 知识图谱（V3.44）", async () => {
  await page.locator('.main-rail [data-surface="memory"]').click();
  const surface = page.locator('[data-surface-view="memory"]');
  if (await surface.locator(".sp-list").count()) throw new Error("记忆面不该有配置侧栏");

  const tabs = surface.locator("[data-memory-tab]");
  if ((await tabs.count()) !== 3) throw new Error("记忆面应只有三个内容入口");
  const todo = surface.locator('[data-memory-body="todo"]');
  if ((await todo.count()) !== 2) throw new Error("待办没有把候选与维护动作合并");
  if (!(await todo.first().isVisible()) || !(await todo.last().isVisible())) throw new Error("默认没有完整显示待办");

  const todoText = (await todo.first().innerText()) + (await todo.last().innerText());
  for (const group of ["新候选", "需要复核", "整理建议"]) {
    if (!todoText.includes(group)) throw new Error(`待办缺少「${group}」分组`);
  }
  if (todoText.includes("未裁决积压")) throw new Error("候选又在维护区重复出现");
  for (const listName of ["待确认的记忆", "记忆债务", "记忆整理建议"]) {
    const rows = surface.locator(`[aria-label="${listName}"] .dl-row`);
    if (!(await rows.count())) throw new Error(`${listName} 没有条目`);
    for (const row of await rows.all()) {
      if (!(await row.locator(".dl-act button").count())) throw new Error(`${listName} 有条目没有处理动作`);
    }
  }
});

await check("知识库表达三轴与状态，未开放的召回能力保持禁用（V3.44）", async () => {
  const surface = page.locator('[data-surface-view="memory"]');
  await surface.locator('[data-memory-tab="library"]').click();
  const lib = surface.locator('[data-memory-body="library"]');
  const head = await lib.locator(".dl-head").innerText();
  for (const col of ["可信等级", "生命周期", "验证记录", "引用 / 采纳"]) {
    if (!head.includes(col)) throw new Error(`知识库表头缺少「${col}」列`);
  }
  if (/可信度|信任分|置信度/.test(head)) throw new Error("三根轴被合成了一个分数");
  if (!(await lib.innerText()).includes("可信等级、验证记录和引用次数独立展示")) throw new Error("没有说明三项指标独立展示");

  for (const st of ["在库", "待复核", "已退役", "已遗忘"]) {
    if (!(await lib.locator(`.dl-row[data-state="${st}"]`).count())) throw new Error(`知识库看不到「${st}」`);
  }
  const suspect = lib.locator('.dl-row[data-state="待复核"]');
  if (!(await suspect.innerText()).includes("退出召回")) throw new Error("待复核没说明已退出召回");
  const forgotten = lib.locator('.dl-row[data-state="已遗忘"]');
  const forgottenText = await forgotten.innerText();
  if (!forgottenText.includes("内容已按授权清除") || !forgottenText.includes("墓碑")) throw new Error("遗忘没有清除正文并保留墓碑");

  if (!(await lib.locator('[data-memory-mode="keyword"]').getAttribute("class")).includes("active")) {
    throw new Error("阶段一没有默认使用关键词召回");
  }
  for (const mode of ["semantic", "hybrid"]) {
    if (await lib.locator(`[data-memory-mode="${mode}"]`).isEnabled()) throw new Error(`${mode} 在接入前不应可选`);
  }
});

await check("记忆配置只在设置中出现，硬规则不可编辑（V3.44）", async () => {
  await page.locator('.main-rail [data-surface="settings"]').click();
  const settings = page.locator('[data-surface-view="settings"]');
  await settings.locator('[data-settings-pick="memory"]').click();
  const memory = settings.locator('[data-settings-view="memory"].sp-body');
  if (!(await memory.isVisible())) throw new Error("设置里没有记忆配置");
  const text = await memory.innerText();
  for (const item of ["每次最多带入", "上下文预算上限", "多久未被召回", "配置预览"]) {
    if (!text.includes(item)) throw new Error(`记忆配置缺少「${item}」`);
  }
  if (!(await memory.locator('.fm-toggle input').count()) || (await memory.locator('.fm-toggle input').isEnabled())) {
    throw new Error("自动入库在 Provenance Gate 前必须禁用");
  }
  if (!text.includes("类型仅限 lesson")) throw new Error("自动入库范围错误");
  for (const boundary of ["claimed", "confirmed", "用户偏好", "必须先退役"]) {
    if (!text.includes(boundary)) throw new Error(`系统边界缺少「${boundary}」`);
  }
  if (!(await memory.locator('[aria-label="配置预览结果"]').count())) throw new Error("配置改完不能当场预览");
  if (await page.locator('[data-surface-view="memory"] [data-memory-body="policy"]').count()) {
    throw new Error("记忆工作面仍保留重复的策略页");
  }
});

await check("系统诊断完整覆盖应用与记忆通路，每行都有动作（V3.44）", async () => {
  const degraded = page.locator(".local-degraded");
  await degraded.click();
  const settings = page.locator('[data-surface-view="settings"]');
  const diagnostics = settings.locator('[data-settings-view="diagnostics"].sp-body');
  if (!(await diagnostics.isVisible())) throw new Error("顶栏降级提示没有进入系统诊断");
  const body = await diagnostics.innerText();
  for (const item of ["服务进程", "数据库", "事件流", "记忆写入通路", "记忆索引与关系", "记忆召回", "执行机器", "磁盘与快照"]) {
    if (!body.includes(item)) throw new Error(`系统诊断缺少「${item}」`);
  }
  for (const item of ["数据目录", "配置文件", "快照目录", "日志目录", "诊断包", "导出 Markdown"]) {
    if (!body.includes(item)) throw new Error(`系统诊断缺少「${item}」`);
  }
  const rows = diagnostics.locator('[aria-label="系统诊断项目"] .dl-row');
  const listBox = await diagnostics.locator('[aria-label="系统诊断项目"]').boundingBox();
  if (!listBox || listBox.height < 300) throw new Error("系统诊断表被后续卡片压缩或隐藏");
  for (const row of await rows.all()) {
    if (!(await row.locator(".dl-act button").count())) throw new Error("系统诊断有只报状态不给动作的行");
  }
  if (!body.includes("系统诊断按组件独立检查")) throw new Error("系统诊断没有说明各组件独立检查");
  if ((await diagnostics.locator('input:not([disabled]):not([readonly])').count())) throw new Error("系统诊断里混入了可编辑配置");
  if (!body.includes("没有加密") || !body.includes("同步盘")) throw new Error("数据位置没有带上明文密钥风险");
  const runtimeLink = diagnostics.locator('[data-diagnostic="runtime-machines"] [data-surface="runtime"]');
  if ((await runtimeLink.count()) !== 1) throw new Error("执行机器诊断没有唯一的运行时入口");
  await runtimeLink.click();
  if (!(await page.locator('[data-surface-view="runtime"]').isVisible())) throw new Error("执行机器诊断没有跳到运行时");
});

await check("记忆效用只在统计中，四层不合成分数（V3.44）", async () => {
  await page.locator('.main-rail [data-surface="stats"]').click();
  const stats = page.locator('[data-surface-view="stats"]');
  await stats.locator('[data-stat-tab="memory"]').click();
  const memory = stats.locator('[data-stat-body="memory"]');
  const body = await memory.innerText();
  for (const layer of ["被展示", "被引用", "被采纳", "帮到了"]) {
    if (!body.includes(layer)) throw new Error(`记忆效用缺少「${layer}」`);
  }
  const helped = memory.locator('.dl-row:has-text("帮到了")');
  if (!(await helped.innerText()).includes("不能从使用次数推导")) throw new Error("helped 被伪造为使用分数");
  if (!(await helped.locator(".dl-act button").count())) throw new Error("helped 没有证据下钻");
  if (await page.locator('[data-surface-view="memory"] [aria-label="记忆效用"]').count()) {
    throw new Error("记忆效用在内容面重复出现");
  }
  await stats.locator('[data-stat-tab="usage"]').click();
});

await check("知识图谱具备完整浏览、筛选、下钻与关系明细（V3.44）", async () => {
  await page.locator('.main-rail [data-surface="memory"]').click();
  const surface = page.locator('[data-surface-view="memory"]');
  const graphTab = surface.locator('[data-memory-tab="graph"]');
  if (!(await graphTab.isEnabled())) throw new Error("最终设计稿中的知识图谱仍处于禁用状态");
  if (!(await graphTab.innerText()).includes("96")) throw new Error("知识图谱 tab 没有关系数量");
  await graphTab.click();
  const graph = surface.locator('[data-memory-body="graph"]');
  if (!(await graph.isVisible())) throw new Error("知识图谱页面没有打开");
  if ((await graph.locator(".graph-summary article").count()) !== 4) throw new Error("图谱缺少节点、关系、冲突与孤立记忆概况");
  for (const control of ["一跳", "两跳", "全部关系", "派生", "证据", "引用", "替代", "冲突"]) {
    if (!(await graph.getByRole("button", { name: control, exact: true }).count())) throw new Error(`图谱缺少“${control}”筛选`);
  }
  if ((await graph.locator("[data-graph-node]").count()) < 8) throw new Error("关系图没有完整的节点样例");
  if ((await graph.locator('[data-graph-depth-level="2"]:visible').count()) !== 0) throw new Error("一跳模式提前显示了二跳节点");
  await graph.locator('[data-graph-depth="2"]').click();
  if ((await graph.locator('.graph-node[data-graph-depth-level="2"]:visible').count()) !== 2) throw new Error("两跳模式没有扩展节点");
  await graph.locator('[data-graph-node="boundary"]').click();
  if (!(await graph.locator('[data-graph-detail="title"]').innerText()).includes("代码目录是权限边界")) throw new Error("选择节点没有更新详情");
  await graph.locator('[data-graph-rel="contradicts"]').click();
  if ((await graph.locator('[data-graph-rel-row]:visible').count()) !== 1) throw new Error("关系类型筛选没有同步关系明细");
  const relationHead = await graph.locator('[aria-label="关系明细"] .dl-head').innerText();
  for (const field of ["源对象", "关系类型", "目标对象", "关系状态", "建立依据", "操作"]) {
    if (!relationHead.includes(field)) throw new Error(`关系明细缺少“${field}”字段`);
  }
  const relationStyles = await graph.locator(".graph-relations").evaluate((section) => {
    const heading = getComputedStyle(section.querySelector(".pane-h"));
    const action = getComputedStyle(section.querySelector(".pane-action"));
    const warning = getComputedStyle(section.querySelector(".pill.warn"));
    return {
      headingSize: heading.fontSize,
      actionHeight: action.height,
      actionRadius: action.borderRadius,
      actionSize: action.fontSize,
      warningBackground: warning.backgroundColor,
    };
  });
  if (relationStyles.headingSize !== "14px") throw new Error(`关系明细标题没有沿用分区标题样式：${relationStyles.headingSize}`);
  if (relationStyles.actionHeight !== "25px" || relationStyles.actionRadius !== "6px" || relationStyles.actionSize !== "12px") {
    throw new Error(`导出按钮没有沿用页内次级操作样式：${JSON.stringify(relationStyles)}`);
  }
  if (relationStyles.warningBackground === "rgba(0, 0, 0, 0)") throw new Error("待处理状态缺少警示样式");
  await graph.locator('[data-graph-zoom="in"]').click();
  if ((await graph.locator('[data-graph-zoom="reset"]').innerText()).trim() !== "110%") throw new Error("关系图缩放没有生效");
  await graph.locator('[data-graph-anchor]').fill("push 需要单独授权");
  if (!(await graph.locator('[data-graph-detail="title"]').innerText()).includes("push 需要单独授权")) throw new Error("搜索没有定位到对应节点");
  await graph.locator('[data-memory-goto="library"]').click();
  if (!(await surface.locator('[data-memory-body="library"]').isVisible())) throw new Error("图谱不能返回知识库");
  await surface.locator('[data-memory-tab="library"]').click();
  const row = surface.locator('[data-memory-row][data-state="在库"]');
  if ((await row.count()) < 1) throw new Error("知识库没有在库条目");
  await row.first().click();
  const goto = row.first().locator('[data-memory-goto="graph"]');
  if (!(await goto.isVisible())) throw new Error("记忆详情没有图谱入口");
  await goto.click();
  if (!(await surface.locator('[data-memory-body="graph"]').isVisible())) throw new Error("知识库条目不能进入知识图谱");
  await surface.locator('[data-memory-tab="todo"]').click();
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
  if (!text.includes("生效范围")) throw new Error("看不出这条 Skill 已在哪些适配器中生效");
  if (!(await skill.locator(".skill-list .dl-row.off").count())) throw new Error("看不到已停用的行");
});

await check("执行组合是运行时的检查结果，不是每天要挑的配置（V3.15）", async () => {
  await gotoRuntime();
  const st = page.locator('[data-surface-view="runtime"]');
  // V3.17：没有「全部」总览行，主面永远是某一个 adapter 的详情
  if (await st.locator('.rt-stage[data-machine-view="lt"] [data-rt-tab="all"]').count()) {
    throw new Error("「全部」总览行又回来了——它的原始理由（能力矩阵要横着比）已随矩阵一起删除");
  }
  await st.locator('.rt-stage[data-machine-view="lt"] [data-rt-tab="lt-codex"]').click();
  const detail = st.locator('[data-rt-body="lt-codex"]');
  if (!(await detail.isVisible())) throw new Error("点 adapter 那一行没有弹出它的详情");
  const text = await detail.innerText();
  // V3.24 审视：这四样仍要在，但不再摆成一张「每个模型一行」的表——
  // 额度按配置分池，给模型开一列额度，那一列只能靠「同池」打补丁
  for (const col of ["可用模型", "额度", "接入方式", "并发"]) {
    if (!text.includes(col)) throw new Error(`adapter 概览缺少「${col}」`);
  }
  if (!/5h\s*<?b?>?\s*\d+%/.test(text) && !/5h\s*\d+%/.test(text) && !text.includes("不设上限")) {
    throw new Error("adapter 概览没有结构化的额度");
  }
  // 可用组合是算出来的，数目在列表里；执行位置不进组合名（ADR 0015 第 2 条）
  // 可用组合是算出来的，总数在概览里；执行位置不进组合名
  await st.locator('.rt-stage[data-machine-view="lt"] [data-rt-tab="overview"]').click();
  const list = await st.locator('.rt-stage[data-machine-view="lt"] [data-rt-body="overview"]').innerText();
  if (!list.includes("可用组合")) throw new Error("概览里没有「可用组合」——它是检查结果，挑的时候要看");
  await st.locator('.rt-stage[data-machine-view="lt"] [data-rt-tab="lt-opencode"]').click();
  await st.locator('.rt-stage[data-machine-view="lt"] [data-rt-tab="lt-opencode"]').click();
  if (!(await st.locator('[data-rt-body="lt-opencode"]').innerText()).includes("原生记忆关不掉")) {
    throw new Error("没有说明原生记忆关不掉时的降级");
  }
  await st.locator('.rt-stage[data-machine-view="lt"] [data-rt-tab="lt-codex"]').click();
});

await check("自动化：规则、触发、运行与投递分层，所有结果回到普通任务", async () => {
  await page.locator('.main-rail [data-surface="automation"]').click();
  const surface = page.locator('[data-surface-view="automation"]');

  if ((await surface.locator("[data-automation-pick]").count()) < 3) throw new Error("左框规则太少");
  if ((await surface.locator(".automation-list").innerText()).includes("执行历史")) throw new Error("运行历史仍混在规则清单里");

  // V3.28：只剩概览与运行记录两层。触发条件并进概览——入口和它触发出来的东西
  // 本来就要一起读；Webhook 投递并进运行记录，它是同一件事的入口侧。
  const dep = surface.locator('[data-automation-view="dep"]');
  if ((await dep.locator(".automation-tabs > button").count()) !== 2) throw new Error("自动化详情应只有概览与运行记录两个 tab");

  const main = await dep.locator('[data-automation-body="overview"]').innerText();
  // 四块，名字要让人一眼知道自己在改什么
  // V3.38：简要描述进标题下的灰字，生成的任务改卡片排最上，只剩两个 fm-sec
  // V3.39：简要描述 + 一行 meta 都在标题下；属性 tab 只剩三块
  const desc = await dep.locator(".sp-bar p").first().innerText();
  if (desc.replace(/\s/g, "").length < 8) throw new Error("标题下没有一句简要描述");
  const meta = await dep.locator(".sp-bar .auto-meta").innerText();
  if (!meta.includes("PersonaHub")) throw new Error("标题下的 meta 没写清它归哪个项目");
  // meta 只放不重复的语境事实：标题、工作流、权限都不在这里
  for (const dup of ["工作流", "权限", "{{date}}"]) {
    if (meta.includes(dup)) throw new Error(`meta 里出现了别处已经说过的「${dup}」`);
  }
  if (await dep.locator('[data-automation-body="overview"] .auto-cards').count()) {
    throw new Error("生成的任务那一行卡片还在——它已经收成标题下的一行 meta");
  }
  const order = await dep.locator('[data-automation-body="overview"] .fm-sec > h2').allInnerTexts();
  if (order.length !== 3) throw new Error(`属性应是触发条件 / 执行组合 / 任务内容三块，实际 ${order.length} 块`);
  // 触发条件与执行组合并排：两块都短，竖着排是在浪费横向空间
  if (!(await dep.locator('[data-automation-body="overview"] .attr-row').count())) {
    throw new Error("触发条件与执行组合没有并排");
  }
  if (!order[0].startsWith("触发条件")) throw new Error("第一块应该是触发条件");
  if (!order[order.length - 1].startsWith("任务内容")) throw new Error("任务内容应该排在最后——它最长");
  // tab 叫「属性」：它装的是这条规则是什么，不是一份摘要
  const tabNames = await dep.locator(".automation-tabs > button").allInnerTexts();
  if (!tabNames[0].includes("属性")) throw new Error("第一个 tab 应叫「属性」");
  // 触发条件不摆 cron：普通人读的是「每周 · 周一 09:00」
  if (main.includes("* * ")) throw new Error("触发条件又出现了 cron 表达式");
  if (!main.includes("每周")) throw new Error("触发条件没有用普通人读得懂的频率表达");
  if (!main.includes("下次运行")) throw new Error("没有下次运行的预览");
  // 「执行内容」与「生成的任务」原来是两块，读不出差别，已合成一块任务内容
  if (main.includes("执行内容")) throw new Error("「执行内容」和「生成的任务」又分成两块了");
  // 任务内容是 Markdown：只读态渲染，编辑态给源码
  if (!(await dep.locator('[data-automation-body="overview"] .md-doc').count())) {
    throw new Error("任务内容没有 Markdown 预览");
  }
  if (main.includes("任务说明") || main.includes("能力边界")) {
    throw new Error("还在用「任务说明 / 能力边界」这类看不出是什么的名字");
  }
  // 时间表并进概览之后，这些必须还在
  for (const want of ["接下来", "Asia/Singapore"]) {
    if (!main.includes(want)) throw new Error(`触发条件缺少「${want}」`);
  }
  // 自动化最危险的是权限
  // 执行内容一次性冻结：人写一句话、模型整理一版、人确认一次，之后每次触发读同一版
  if (!main.includes("你写的原话")) throw new Error("执行内容没有留下人写的原话");
  if (!main.includes("不会重新生成")) throw new Error("没有说明执行内容每次触发读同一版");
  if (main.includes("Runbook")) throw new Error("执行内容又退回成 Runbook 行话");

  // 只有触发条件与任务内容可编辑，其余一律只读
  await dep.locator("[data-auto-edit]").click();
  const editable = await dep.locator('[data-automation-body="overview"] .fm-card.auto-edit').count();
  if (editable !== 3) throw new Error(`可编辑的块应是触发条件 / 执行组合 / 任务内容，实际 ${editable} 块`);
  // 时间表照 multica：频率 + 具体日 + 时间，不让人写 cron
  const sched = dep.locator(".auto-edit .sched-row");
  if (!(await sched.count())) throw new Error("时间表没有做成结构化选择器");
  if ((await sched.locator("select").count()) < 2) throw new Error("时间表缺少频率或具体日的选择");
  if (await dep.locator('.auto-edit input[value*="* *"]').count()) throw new Error("编辑态还在让人写 cron");
  // 执行组合拆成模型 × 深度两个下拉：合成一个下拉时，换深度要重选整条组合
  const model = dep.locator("[data-auto-model]");
  const depth = dep.locator("[data-auto-depth]");
  if (!(await model.count()) || !(await depth.count())) throw new Error("执行组合没有拆成模型与深度两个下拉");
  const preview = dep.locator("[data-auto-combo]");
  if (!(await preview.count())) throw new Error("没有现算出来的组合预览");
  if ((await preview.innerText()) !== "claude-sonnet5-low") throw new Error("组合预览与当前选择对不上");
  await depth.selectOption("high");
  if ((await preview.innerText()) !== "claude-sonnet5-high") throw new Error("换深度后组合预览没跟着变");
  // 模型不支持的深度要置灰，不能选了再报错
  await model.selectOption("opencode-kimi-k2");
  const disabled = await dep.locator('[data-auto-depth] option[disabled]').count();
  if (disabled < 2) throw new Error("模型不支持的深度没有置灰");
  if ((await preview.innerText()) !== "opencode-kimi-k2-low") throw new Error("换模型后深度没有回落到它支持的档");
  await model.selectOption("claude-sonnet5");
  await depth.selectOption("low");
  if (!(await dep.locator(".fm-card.auto-edit").first().isVisible())) throw new Error("点了编辑没有进入编辑态");
  if (await dep.locator(".fm-card.auto-view").first().isVisible()) throw new Error("编辑态里只读那一份还在，两份会同时显示");
  if (!(await dep.locator("[data-auto-save-rule]").isVisible())) throw new Error("编辑态没有保存按钮");
  if (!(await dep.locator(".md-edit").first().isVisible())) throw new Error("编辑态没有给出 Markdown 源码");
  if ((await dep.locator("[data-auto-edit]").innerText()) !== "取消") throw new Error("编辑态没有退出的路");
  await dep.locator("[data-auto-edit]").click();
  if (await dep.locator(".fm-card.auto-edit").first().isVisible()) throw new Error("取消之后没有退出编辑态");

  await dep.locator('[data-automation-tab="runs"]').click();
  const runs = await dep.locator('[data-automation-body="runs"]').innerText();
  for (const want of ["未触发", "失败", "关联任务", "Attempt"]) {
    if (!runs.includes(want)) throw new Error(`运行记录没有讲清「${want}」`);
  }

  // Webhook 规则比定时规则多一层：入口审计。切规则要真的换详情，不是只换高亮。
  await surface.locator('[data-automation-pick="gh"]').click();
  const gh = surface.locator('[data-automation-view="gh"]');
  if (!(await gh.isVisible())) throw new Error("切换规则没有换掉右侧详情");
  if (await dep.isVisible()) throw new Error("两份规则详情同时可见");
  if ((await gh.locator(".automation-tabs > button").count()) !== 2) throw new Error("Webhook 规则也只该有两个 tab");

  const ghMain = await gh.locator('[data-automation-body="overview"]').innerText();
  if (!ghMain.includes("不可信输入")) throw new Error("没有写明投递内容来自公网、不能成为提权路径");
  // Webhook 的入口参数并进概览的「触发条件」
  // 入口参数也用普通话：签名必须、按投递 key 去重、只接收新建 issue
  for (const want of ["签名校验", "去重", "只接收"]) {
    if (!ghMain.includes(want)) throw new Error(`触发条件缺少「${want}」`);
  }
  if (/HMAC|Idempotency|issues\.opened/.test(ghMain)) {
    throw new Error("Webhook 的触发条件还在摆协议名——普通人读不出它管什么");
  }

  await gh.locator('[data-automation-tab="runs"]').click();
  const deliveries = await gh.locator(".automation-deliveries").innerText();
  for (const want of ["签名", "幂等键", "已拒绝", "重放为新投递", "replayed_from"]) {
    if (!deliveries.includes(want)) throw new Error(`Webhook 投递审计缺少「${want}」`);
  }

  await surface.locator("[data-automation-create]").click();
  const dialog = page.locator("[data-automation-dialog]");
  if (!(await dialog.isVisible())) throw new Error("新建自动化入口没有打开创建器");
  const dialogText = await dialog.innerText();
  if (/\d \* \* /.test(dialogText)) throw new Error("创建器里还有 cron 表达式");
  for (const want of ["任务说明", "整理成步骤", "第一个触发器", "下次运行", "保存为暂停", "保存前预检"]) {
    if (!dialogText.includes(want)) throw new Error(`自动化创建器缺少「${want}」`);
  }
  if (dialogText.includes("Runbook")) throw new Error("创建器又退回成 Runbook 行话");
  await dialog.locator("[data-automation-close]").first().click();

  // 离开前归位，后续断言都从定时规则的概览开始。
  await surface.locator('[data-automation-pick="dep"]').click();

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

await check("项目记忆支持筛选，并与 Skills / 设置使用统一样式", async () => {
  await page.locator('.main-rail [data-surface="projects"]').click();
  const surface = page.locator('[data-surface-view="projects"]');

  await surface.locator('[data-project-tab="knowledge"]').click();
  const know = surface.locator('[data-project-body="knowledge"]');
  if ((await know.locator(".data-list .dl-row").count()) < 2) throw new Error("知识里没有条目");
  const projectMemoryHeading = await know.locator(".pane-h").innerText();
  if (!projectMemoryHeading.includes("项目记忆") || !projectMemoryHeading.includes("3 条")) throw new Error("项目记忆标题或总数不明确");
  if (!(await know.locator(".mem-stance").count())) throw new Error("知识条目没有标 stance");
  const knowledgeHead = await know.locator(".dl-head").innerText();
  for (const field of ["可信等级", "记忆内容", "记忆类型", "作用域", "生命周期", "验证记录", "最近召回", "引用 / 采纳", "详情"]) {
    if (!knowledgeHead.includes(field)) throw new Error(`项目知识缺少「${field}」字段`);
  }
  await know.locator("[data-project-memory-search]").fill("push");
  if ((await know.locator("[data-project-memory-row]:visible").count()) !== 1) throw new Error("项目记忆关键词筛选没有生效");
  await know.locator("[data-project-memory-stance]").selectOption("verified");
  if ((await know.locator("[data-project-memory-row]:visible").count()) !== 0) throw new Error("项目记忆组合筛选没有生效");
  if (!(await know.locator("[data-project-memory-empty]").isVisible())) throw new Error("项目记忆空结果缺少说明");
  await know.locator("[data-project-memory-search]").fill("");
  if ((await know.locator("[data-project-memory-row]:visible").count()) !== 2) throw new Error("可信等级筛选数量错误");
  await know.locator("[data-project-memory-type]").selectOption("lesson");
  if ((await know.locator("[data-project-memory-row]:visible").count()) !== 1) throw new Error("知识类型筛选没有生效");
  if ((await know.locator("[data-project-memory-count]").innerText()).trim() !== "显示 1 条") throw new Error("筛选结果数量没有更新");
  await know.locator("[data-project-memory-stance]").selectOption("all");
  await know.locator("[data-project-memory-type]").selectOption("all");
  await know.locator("[data-project-memory-state]").selectOption("待复核");
  if ((await know.locator("[data-project-memory-row]:visible").count()) !== 1) throw new Error("生命周期筛选没有生效");
  await know.locator("[data-project-memory-state]").selectOption("all");
  await know.locator('[data-project-knowledge-open="普通 worktree"]').click();
  const openedMemory = page.locator('[data-memory-row].open').filter({ hasText: "普通 worktree" });
  if ((await openedMemory.count()) !== 1) throw new Error("项目记忆详情没有定位到知识库中的同一条记忆");
  await openedMemory.locator(".dl-title").click();
  await page.locator('.main-rail [data-surface="projects"]').click();
  await surface.locator('[data-project-tab="knowledge"]').click();
  await know.locator('[data-project-knowledge-open=""]').click();
  if (!(await page.locator('[data-surface-view="memory"] [data-memory-body="library"]').isVisible())) {
    throw new Error("打开知识库没有进入知识库 tab");
  }
  await page.locator('.main-rail [data-surface="projects"]').click();
  await surface.locator('[role="tab"][data-project-tab="skills"]').click();

  const skills = surface.locator('[data-project-body="skills"]');
  if ((await skills.locator(".project-skill-list .dl-row").count()) < 2) throw new Error("项目 Skills 里没有条目");
  const skillHead = await skills.locator(".dl-head").innerText();
  for (const field of ["Skill 名称", "能力要求", "来源", "项目使用方式", "更新时间", "操作"]) {
    if (!skillHead.includes(field)) throw new Error(`项目 Skills 缺少「${field}」字段`);
  }
  if (await skills.locator(".pj-row, .pj-step, .pj-done").count()) throw new Error("项目 Skills 仍在使用旧工作流卡片");
  await skills.locator('[data-project-default-skill="cross-check"]').click();
  if (!(await skills.locator('[data-project-skill-row="cross-check"] [data-project-skill-state]').innerText()).includes("当前默认")) {
    throw new Error("项目默认 Skill 无法切换");
  }
  await skills.locator("[data-project-skills-open]").click();
  if (!(await page.locator('[data-surface-view="library"] [data-library-body="skill"]').isVisible())) {
    throw new Error("管理全部 Skills 没有进入 Skills tab");
  }
  await page.locator('.main-rail [data-surface="projects"]').click();
  await surface.locator('[role="tab"][data-project-tab="settings"]').click();

  const st = surface.locator('[data-project-body="settings"]');
  // 项目设置只保留项目自身的信息、仓库引用、文件访问与生命周期。
  if ((await st.locator(".fm-sec").count()) !== 4) throw new Error("项目设置应收敛为四个分区");
  if (await st.locator(".git-block").count()) throw new Error("项目 · 设置还在用旧的定义列表，应与设置面一致");
  const stText = await st.innerText();
  const sectionTitles = await st.locator(".fm-sec > h2, .project-settings-section-head > h2").allInnerTexts();
  if (sectionTitles.join("/") !== "项目信息/代码仓/文件访问/项目管理") throw new Error(`项目设置分区错误：${sectionTitles.join("/")}`);
  if (stText.includes("默认工作流") || stText.includes("默认 Skill")) throw new Error("默认 Skill 在项目 Skills 与设置中重复配置");
  if (stText.includes("访问网络") || stText.toLocaleLowerCase().includes("git push")) throw new Error("项目设置仍保留网络或 git push 权限");
  const repoList = st.locator(".project-repo-list");
  if ((await repoList.locator(".dl-row").count()) !== 3) throw new Error("项目代码仓应包含一个主目录和两个参考仓库");
  const repoHead = await repoList.locator(".dl-head").innerText();
  for (const field of ["仓库名称", "远端地址", "目录用途", "默认分支", "访问权限", "当前状态", "操作"]) {
    if (!repoHead.includes(field)) throw new Error(`项目代码仓缺少「${field}」字段`);
  }
  if ((await repoList.locator(".pill").filter({ hasText: "主目录" }).count()) !== 1) throw new Error("项目必须只有一个主目录");
  if ((await repoList.locator(".pill").filter({ hasText: "只读参考" }).count()) !== 2) throw new Error("项目参考仓库数量错误");
  if (!(await st.locator(".fm-card select").count())) throw new Error("项目 · 设置里没有可改的控件");
  for (const field of ["读取范围", "写入范围"]) {
    if (!stText.includes(field)) throw new Error(`项目文件访问缺少「${field}」`);
  }
  await st.getByRole("button", { name: "＋ 添加参考仓库", exact: true }).click();
  const repoDialog = page.locator("[data-repo-dialog]");
  if (!(await repoDialog.isVisible())) throw new Error("添加参考仓库没有打开代码仓配置");
  if (!(await repoDialog.locator('[data-repo-purpose="reference"]').evaluate((button) => button.classList.contains("active")))) {
    throw new Error("从项目添加仓库时没有默认选择只读参考");
  }
  await repoDialog.getByRole("button", { name: "取消", exact: true }).click();

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

await check("统计独立成面，夹在能力和设置之间；无左列表、三个 tab（V3.44）", async () => {
  const rail = page.locator(".main-rail");
  const y = async (k) => (await rail.locator(`[data-surface="${k}"]`).boundingBox()).y;
  if ((await y("stats")) < (await y("library"))) throw new Error("统计应排在能力下面");
  if ((await y("stats")) > (await y("settings"))) throw new Error("统计应排在设置上面");
  await rail.locator('[data-surface="stats"]').click();
  const surface = page.locator('[data-surface-view="stats"]');
  if (!(await surface.isVisible())) throw new Error("没有统计面");
  // 与记忆面同构：统计没有实体可列，进来就是 tab 页，不是左列表
  if (await surface.locator(".sp-list").count()) throw new Error("统计面不该有左列表——它没有一条条实体可列");
  if ((await surface.locator("[data-stat-tab]").count()) !== 3) throw new Error("统计面应有「用量」「监控」「记忆效用」三个 tab");
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
  if (!combo.includes("价格来源")) throw new Error("组合表没有写明价格来源，权威值与估算值混在一个数字里");
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
  // Token 拆成缓存输入 / 非缓存输入，且必须说明输出算在哪一边
  if (!head.includes("缓存输入") || !head.includes("非缓存输入")) throw new Error("Token 没有拆成缓存输入与非缓存输入");
  const note = await body.locator(".sc-note").innerText();
  if (!note.includes("返工占比 =")) throw new Error("返工占比没有写明口径，读者无法核对它怎么来的");
  if (!note.includes("缓存输入 + 非缓存输入")) throw new Error("返工占比没有写明分母是拆分前的总量");
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
  if (!body.includes("验证未通过与额度不足不计入失败率")) throw new Error("没有写明验证未通过与额度不足不算失败");
  if (!body.includes("样本不足")) throw new Error("小样本的失败率没有标注，会被当成结论读");
  await surface.locator('[data-stat-tab="usage"]').click();
});

await check("额度在设置 · 运行时的配置 tab，不在统计也不单开入口（ADR 0017 第 5 条）", async () => {
  await page.locator('.main-rail [data-surface="settings"]').click();
  const list = await page.locator('[data-surface-view="settings"] .sp-list').innerText();
  if (list.includes("额度与用量")) throw new Error("设置左列表里又出现了独立的额度入口——额度的消费点只有三个，总览是第四份");
  // V3.44：设置按作用域分两组九项；运行时仍是一级面
  if (list.includes("运行时")) throw new Error("运行时又被塞回设置里了——V3.28 它是一级面");
  for (const item of ["偏好设置", "插件管理", "通知", "系统诊断", "关于", "通用", "记忆", "标签", "代码仓"]) {
    if (!list.includes(item)) throw new Error(`设置左栏缺少「${item}」`);
  }
  for (const group of ["应用", "工作区"]) {
    if (!list.includes(group)) throw new Error(`设置左栏缺少分组「${group}」——分组按作用域，回答「我改这个会影响谁」`);
  }

  await gotoRuntime();
  const runtime = await page.locator('.rt-adapter-pane:not([hidden])').innerText();
  if (!/5h\s*\d+%/.test(runtime) || !/周\s*\d+%/.test(runtime)) {
    throw new Error("运行时没有滚动窗口与周额度——额度是运行时的字段");
  }
  // V3.25：只报上游自己给的口径，不折算成次数
  // 查的是「有没有真的报出一个折算次数」，不是「有没有提到这件事」——
  // 页面上那句「不折算成『还能派几次』」是解释，不是违规。
  if (runtime.includes("可派次数") || /剩 ?[\d.]+k? 次/.test(runtime) || /[\d.]+ 次 (low|medium|high)/.test(runtime)) {
    throw new Error("额度又被折算成「还能派几次」了——固定系数换算出的数字是估算，不是事实");
  }
  if (!runtime.includes("重置")) throw new Error("额度没写重置时间——只有百分比时「等一会儿就好了」是判断不出来的");
  // 额度按 adapter 配置算，不按「账号」也不按模型——凭据只是配置的一个字段
  if (!runtime.includes("共用同一份额度")) {
    throw new Error("没说清同一份配置下的多个模型共用同一份额度");
  }
  // V3.26：额度、模型、项目可用性都收进各自的配置卡里——归属靠结构表达，
  // 不再靠一句「额度挂在配置上」来说明
  if (!(await page.locator('[data-rt-body="lt-codex"] .rt-cards').innerText()).includes("额度")) {
    throw new Error("额度没有写在这个 adapter 的概览卡片里");
  }
  if (runtime.includes("按账号分池")) throw new Error("「账号」这个词回来了，与 ADR 0012 第 8 条命名纪律冲突");
  // V3.23 把额度告警从 config tab 的页脚提上来；V3.24 机器变成 tab 之后它再提一层——
  // 它跨机器生效，所以归 sp-bar，不归任何一个机器 tab 的内容。
  const bar = page.locator('[data-surface-view="runtime"] .sp-list .sp-foot');
  if (!(await bar.locator("text=额度告警阈值").count())) throw new Error("额度告警阈值不在左栏页脚——它跨机器生效，不属于任何一台机器");
  const rtAll = await page.locator('[data-surface-view="runtime"] .rt-stage').first().innerText();
  if (rtAll.includes("额度告警")) throw new Error("额度告警又落回某台机器的内容里了——它不属于任何一台机器");
});

await check("前缀在工作区 · 通用里，标签独立成项，改前缀要确认（V3.28）", async () => {
  await page.locator('.main-rail [data-surface="settings"]').click();
  const surface = page.locator('[data-surface-view="settings"]');
  // 前缀是工作区的标识属性，和名称、描述同层；标签是一类对象的集合，两者不并排
  await surface.locator('[data-settings-pick="general"]').click();
  const gen = await surface.locator('.sp-body[data-settings-view="general"]').innerText();
  for (const row of ["工作区名称", "描述", "编号前缀", "删除工作区"]) {
    if (!gen.includes(row)) throw new Error(`工作区 · 通用缺少「${row}」`);
  }
  if (!(await surface.locator('.sp-body[data-settings-view="general"] button[disabled]').count())) {
    throw new Error("只剩一个工作区时「删除工作区」应该置灰而不是隐藏——藏起来等于替使用者决定他不需要它");
  }
  const pick = surface.locator('[data-settings-pick="labels"]');
  if (!(await pick.isVisible())) throw new Error("设置左栏缺少「标签」");
  await pick.click();
  const body = surface.locator('.sp-body[data-settings-view="labels"]');
  if (!(await body.isVisible())) throw new Error("点了没有切到标签面");
  // V3.28：运行时不再是设置里的一个面板
  if (await surface.locator('.sp-body[data-settings-view="runtime"]').count()) {
    throw new Error("运行时又变回设置里的一页了——V3.28 它是一级面");
  }
  if (!(await surface.locator('.sp-body[data-settings-view="plugins"]').count())) {
    throw new Error("设置面里没有插件管理");
  }
  if (!gen.includes("重命名全部 412 条任务")) throw new Error("改前缀没有说清会重命名已有任务");
  const text = await body.innerText();
  if (!text.includes("不参与派工判断")) throw new Error("没有说清标签只是筛选层，会被误当成路由信号");
  if ((await body.locator(".label-table .dl-row").count()) < 5) throw new Error("标签列表太短，看不出这是个要维护的表");
  // V3.29：表铺满主舞台宽度，不再限宽到 880
  const fit = await page.evaluate(() => {
    const t = document.querySelector(".label-table");
    const p = t.parentElement;
    return t.getBoundingClientRect().width / (p.clientWidth || 1);
  });
  if (fit < 0.95) throw new Error(`标签表没有铺满：只占内容区的 ${Math.round(fit * 100)}%`);
  const cols = await body.locator(".label-table .dl-head span").allInnerTexts();
  for (const c of ["关联任务", "引用规则"]) {
    if (!cols.includes(c)) throw new Error(`标签表列名不够正式：缺「${c}」`);
  }
  if (cols.some((c) => c === "用在" || c === "被规则引用")) throw new Error("标签表还在用口语列名");
});

await check("能力面与记忆面用同一套列表排版", async () => {
  const read = async (sel) =>
    page.locator(sel).first().evaluate((e) => {
      const c = getComputedStyle(e);
      return { fs: c.fontSize, fw: c.fontWeight, pad: c.padding };
    });

  await page.locator('.main-rail [data-surface="memory"]').click();
  const memRow = await read('[data-memory-body="todo"] .dl-row');
  const memTitle = await read('[data-memory-body="todo"] .dl-title');

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
      return { small: g("header p"), h1: g("h1"), tabs: g(".mem-tabs") };
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
    if (view === "memory") await page.locator('[data-memory-tab="todo"]').click();
    if (view === "library") await page.locator('[data-library-tab="skill"]').click();
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
  const mem = await measure("memory", '[data-memory-body="todo"]');

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
  const surface = page.locator('[data-surface-view="runtime"]');
  // V3.17：每个 adapter 的配置视图必须自足——登录态在 OAuth 的 adapter 下，
  // API Key 在 opencode 下，不再有一张跨 adapter 的汇总表
  for (const a of ["lt-codex", "lt-claude"]) {
    await surface.locator(`.rt-stage[data-machine-view="lt"] [data-rt-tab="${a}"]`).click();
    const one = surface.locator(`[data-rt-body="${a}"]`);
    if (!(await one.innerText()).includes("登录态")) throw new Error(`${a} 的概览里没有登录态信息`);
    // 两组必须分开：OAuth 由 CLI 自管，混在一起会让人以为登录态也要填 key
  }
  // V3.24：「不代管登录态」回答的是「为什么这里没有输入框」，所以贴着那份
  // 配置写，而不是做成一段人人先读一遍的页首。出现输入框就说明抽象漏了。
  for (const a of ["lt-codex", "lt-claude"]) {
    await surface.locator(`.rt-stage[data-machine-view="lt"] [data-rt-tab="${a}"]`).click();
    const one = surface.locator(`[data-rt-body="${a}"]`);
    if (!(await one.innerText()).includes("登录态")) {
      throw new Error(`${a} 没有说清登录态由 CLI 自己保存`);
    }
    if (await one.locator('input[type="password"], input[type="text"]').count()) {
      throw new Error(`${a} 的 OAuth 配置里出现了输入框——出现输入框就说明抽象漏了`);
    }
  }
  await surface.locator('.rt-stage[data-machine-view="lt"] [data-rt-tab="lt-opencode"]').click();
  const body = surface.locator('[data-rt-body="lt-opencode"]');
  const bodyText = await body.innerText();
  if (!bodyText.includes("coding-plan") || !bodyText.includes("official-api")) throw new Error("opencode 的两份 API Key 配置要都在——它们是两条路，不是一份配置的两种写法");

  // 弹窗：登录态那一支不应出现任何 key 输入框
  // 「新增一份配置」现在是 per-adapter 的动作，藏在各自的详情里——
  // 取可见的那一个，否则会点到别的 adapter 那份（它此刻是隐藏的）
  await surface.locator("[data-account-new]:visible").first().click();
  const dialog = page.locator("[data-account-dialog]:visible");
  if (!(await dialog.isVisible())) throw new Error("新增账号弹窗没打开");
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

await check("运行时：机器在左栏，adapter 是 tab，概览排第一（V3.32）", async () => {
  await page.locator('.main-rail [data-surface="runtime"]').click();
  const surface = page.locator('[data-surface-view="runtime"]');

  // 左栏：本机与远程分组，一台机器一行，带状态
  const machines = surface.locator(".sp-list .sp-item[data-machine-pick]");
  if ((await machines.count()) < 2) throw new Error("左栏没有列出执行机器");
  for (let i = 0; i < (await machines.count()); i += 1) {
    if (!(await machines.nth(i).locator(".signal").count())) throw new Error("机器列表项上没有状态");
  }
  // V3.33：不分本地与远程，一律是执行机器
  if (await surface.locator(".sp-list .sp-group").count()) {
    throw new Error("左栏又把机器分成了本地与远程——所有执行机器一视同仁");
  }
  if ((await surface.locator(".sp-list").innerText()).includes("本机")) {
    throw new Error("左栏还留着「本机」——机器一律用主机名");
  }
  if (!(await surface.locator('.sp-head > button[aria-label="添加执行机器"]').count())) throw new Error("没有“添加执行机器”入口");

  // 右侧：概览排第一，之后一个 adapter 一个 tab
  const stage = surface.locator('.rt-stage[data-machine-view="lt"]');
  await stage.locator('[data-rt-tab="overview"]').click();
  const tabs = await stage.locator(".rt-tabs [data-rt-tab]").allInnerTexts();
  if (!tabs[0].includes("概览")) throw new Error("第一个 tab 不是概览");
  if (tabs.length !== 4) throw new Error(`本机应是概览 + 三个 adapter，实际 ${tabs.length} 个 tab`);
  for (const want of ["Codex CLI", "Claude Code", "OpenCode"]) {
    if (!tabs.some((t) => t.includes(want))) throw new Error(`adapter tab 缺少「${want}」`);
  }
  // 状态跟在 tab 上：不用点进去才知道哪个坏了
  if ((await stage.locator(".rt-tabs [data-rt-tab] .signal").count()) !== 3) {
    throw new Error("adapter 的 tab 上没有状态灯");
  }
  // adapter 不再是一张表，也不再有右侧抽屉
  if (await stage.locator('.rt-adapter-pane .rt-adapters').count()) throw new Error("adapter 列表混进了某个 adapter 自己的 tab");
  if (await surface.locator("[data-runtime-drawer]").count()) throw new Error("右侧抽屉又回来了");

  // 概览：机器级读数 + adapter 列表 + 执行组合；机器状态由前两层汇总，不再复制健康区块
  const overview = await stage.locator('[data-rt-body="overview"]').innerText();
  for (const want of ["适配器", "执行组合"]) {
    if (!overview.includes(want)) throw new Error(`概览缺少「${want}」`);
  }
  if (overview.includes("机器健康")) throw new Error("概览仍保留重复的机器健康区块");
  if ((await stage.locator('[data-rt-body="overview"] .rt-kpis article').count()) !== 4) {
    throw new Error("概览没有机器级读数");
  }
  const alist = stage.locator('[data-rt-body="overview"] .rt-adapters');
  const ahead = await alist.locator(".dl-head").innerText();
  for (const col of ["适配器", "状态", "CLI 版本", "计费方式", "额度状态", "活动会话", "执行组合"]) {
    if (!ahead.includes(col)) throw new Error(`adapter 列表缺少「${col}」列`);
  }
  const states = await alist.locator(".dl-row > span:nth-child(2)").allInnerTexts();
  for (const st of states) {
    if (!["在线", "离线"].includes(st.trim())) throw new Error(`adapter 状态只能是在线或离线，出现了「${st.trim()}」`);
  }
  if ((await alist.locator("[data-rt-goto]").count()) !== 3) throw new Error("adapter 列表的行点不动");
  if (!(await stage.locator('[data-rt-body="overview"] .rt-add-inline').count())) {
    throw new Error("适配器列表上方没有“添加适配器”");
  }
  await alist.locator('[data-rt-goto="lt-claude"]').click();
  if (!(await stage.locator('[data-rt-body="lt-claude"]').isVisible())) {
    throw new Error("点 adapter 那一行没有跳到它的 tab");
  }
  await stage.locator('[data-rt-tab="overview"]').click();
  const chead = await stage.locator('[data-rt-body="overview"] [aria-label$="的执行组合"] .dl-head').innerText();
  if (chead.split(/\s+/).includes("状态")) throw new Error("执行组合表里还有独立状态列——健康度已经由 adapter 列表说完了");
  if (!chead.includes("额度")) throw new Error("执行组合表没有额度列");
});

await check("能力位只写成后果，不单独成 tab、不摆成矩阵（V3.16 §3.7.6 / V3.26）", async () => {
  const surface = page.locator('[data-surface-view="runtime"]');
  // 能力 tab 已删：一张全是不可点格子的矩阵就是它自己批判过的债务展览馆。
  // V3.26 连「配置 / 诊断」这两个 tab 也去掉了——右框装的是同一个 adapter
  // 的一串事实，是线性的；诊断那一侧只有两行，撑不起一个 tab。
  if (await surface.locator(".rt-adapter-pane:not([hidden]) .mem-tabs").count()) {
    throw new Error("右框里又套了一层 tab——它装的是一串事实，不是并列的几组东西");
  }
  await gotoRuntime("lt-opencode");
  const one = surface.locator('[data-rt-body="lt-opencode"]');
  if (!(await one.isVisible())) throw new Error("选中 opencode 后没有它的详情");
  const text = await one.innerText();
  if (!text.includes("不支持")) throw new Error("概览里没有「不支持」这一行——能力边界的落点没了");
  // 写后果，不写能力位名字
  if (!text.includes("不能当独立验证员")) throw new Error("原生记忆关不掉这条没有写出它对独立验证的后果");
  // 能力边界不是故障，不能混进失败率
  if (!text.includes("不支持")) throw new Error("没有把能力边界写成「不支持」这一行");
  // 三个 adapter 都要有这一块，否则「没有做不到的」也是一条信息
  // 没有限制的 adapter 不摆一块空的「不支持」；有限制的必须写出后果
  for (const a of ["lt-codex", "lt-claude"]) {
    await surface.locator(`.rt-stage[data-machine-view="lt"] [data-rt-tab="${a}"]`).click();
    const t = await surface.locator(`[data-rt-body="${a}"]`).innerText();
    if (t.includes("不支持")) throw new Error(`${a} 没有限制，却摆了一块空的「不支持」`);
  }
  await surface.locator('.rt-stage[data-machine-view="lt"] [data-rt-tab="lt-codex"]').click();
});

await check("运行时：同一模型两条路必须是两个执行组合（ADR 0012 第 2 条四元组）", async () => {
  await page.locator('.main-rail [data-surface="runtime"]').click();
  const surface = page.locator('[data-surface-view="runtime"]');
  await surface.locator('.rt-stage[data-machine-view="lt"] [data-rt-tab="lt-opencode"]').click();
  const body = surface.locator('[data-rt-body="lt-opencode"]');
  if (!(await body.isVisible())) throw new Error("没有 opencode 的配置视图");
  const text = await body.innerText();
  if (!text.includes("coding-plan") || !text.includes("official-api")) {
    throw new Error("opencode 应有两份配置——这是四元组存在的那个真实场景");
  }
  if (!text.includes("api.deepseek.com") || !text.includes("11434")) {
    throw new Error("两份配置没有各自的 base URL，两条路就分不开了");
  }
  if (!text.includes("两条接入路径")) throw new Error("没有说清同一个模型两条路为什么必须是两个组合");
  await surface.locator('.rt-stage[data-machine-view="lt"] [data-rt-tab="lt-codex"]').click();
});

await check("数据位置与日志导出只在系统诊断，关于只留版本与许可（V3.44）", async () => {
  // 它讲的是数据目录与明文列，是数据风险声明，不是某个 adapter 的属性——
  // 放在任何一个 adapter 下面都是错的
  await page.locator('.main-rail [data-surface="runtime"]').click();
  if ((await page.locator('[data-surface-view="runtime"]').innerText()).includes("没有加密")) {
    throw new Error("密钥风险声明又回到运行时了");
  }

  await page.locator('.main-rail [data-surface="settings"]').click();
  const st = page.locator('[data-surface-view="settings"]');
  await st.locator('.sp-list [data-settings-pick="diagnostics"]').click();
  const diagnostics = st.locator('.sp-body[data-settings-view="diagnostics"]');
  const diagnosticText = await diagnostics.innerText();
  for (const row of ["数据目录", "配置文件", "快照目录", "日志目录", "诊断包"]) {
    if (!diagnosticText.includes(row)) throw new Error(`系统诊断缺少「${row}」`);
  }
  await st.locator('.sp-list [data-settings-pick="about"]').click();
  const about = st.locator('.sp-body[data-settings-view="about"]');
  if (!(await about.isVisible())) throw new Error("设置里没有「关于」面板");
  const aboutText = await about.innerText();
  for (const item of ["当前版本", "更新方式", "许可", "第三方组件"]) {
    if (!aboutText.includes(item)) throw new Error(`关于页缺少「${item}」`);
  }
  for (const duplicate of ["数据目录", "配置文件", "日志目录", "诊断包"]) {
    if (aboutText.includes(duplicate)) throw new Error(`关于页仍重复「${duplicate}」`);
  }
  if (diagnosticText.includes("恢复…")) throw new Error("界面上出现了没有实现的恢复流程——只给快照位置，不承诺一键恢复");
  await page.locator('.main-rail [data-surface="project"]').click();
});

await check("页面无横向溢出", async () => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 1) throw new Error(`横向溢出 ${overflow}px`);
});

await check("能力面是可选能力的容器：tab 由插件贡献，缺了也能跑（V3.21 §3.2）", async () => {
  await page.locator('.main-rail [data-surface="library"]').click();
  const lib = page.locator('[data-surface-view="library"]');

  // 这一面只装可选能力：adapter 缺了派不了工，永远不进这里
  if (await lib.locator('[data-library-tab="adapter"]').count()) {
    throw new Error("adapter 被塞进能力面了——它缺了派不了工，归运行时");
  }

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

  const head = await pane.locator(".dl-head").first().innerText();
  for (const col of ["Skill 名称", "能力要求", "生效范围", "来源", "更新时间", "状态", "操作"]) {
    if (!head.includes(col)) throw new Error(`Skills 表缺少「${col}」列`);
  }
  // V3.22：列表回答「挑哪一条」，这几样属于详情
  if (head.includes("步骤")) throw new Error("步骤链又回到列表里了——它属于详情（design.md §3.2.3）");
  if (head.includes("创建人")) throw new Error("创建人属于详情；「这是我写的还是包带来的」由来源列回答");
  if (head.split(/\s+/).includes("要求")) throw new Error("仍存在含义不完整的「要求」字段");
  if (head.includes("表现") || head.includes("评分")) {
    throw new Error("表里出现了表现列——Squad 不产生持久身份（ADR 0012 第 5 条），表现是展开后现算的一句");
  }

  const total = await pane.locator(".skill-list .dl-row").count();
  if (total < 8) throw new Error("Skills 表行数太少，看不出编组与普通 skill 混在同一张表里");

  // tag 筛选：#编组 应该只留下带 steps 的那几行
  await pane.locator('[data-lib-filter="编组"]').click();
  const shown = await pane.locator(".skill-list .dl-row:not([hidden])").count();
  if (shown === total) throw new Error("按 #编组 筛选没有过滤掉任何行——筛选是假的");
  if (shown === 0) throw new Error("按 #编组 筛选之后一行都不剩");
  for (const row of await pane.locator(".skill-list .dl-row:not([hidden])").all()) {
    if (!(await row.innerText()).includes("#编组")) throw new Error("#编组 筛选里出现了不带该 tag 的行");
  }
  await pane.locator('[data-lib-filter="all"]').click();
  if ((await pane.locator(".skill-list .dl-row:not([hidden])").count()) !== total) throw new Error("切回「全部」没有恢复所有行");
});

await check("插件声明贡献点，界面由宿主渲染，动作走白名单（V3.21 §3.2.6）", async () => {
  await page.locator('.main-rail [data-surface="settings"]').click();
  await page.locator('[data-surface-view="settings"] .sp-list [data-settings-pick="plugins"]').click();
  const body = page.locator('[data-surface-view="settings"] .sp-body[data-settings-view="plugins"]');
  const text = await body.innerText();
  // 允许插件开 tab 的前提：界面不是它画的，动作只能引用宿主白名单
  if (!text.includes("界面由宿主渲染")) throw new Error("没有说清界面由宿主渲染——这是允许插件开 tab 的前提");
  if (!text.includes("读不到任何凭据")) throw new Error("没有写明插件够不着凭据");
  if (!text.includes("不在沙箱里运行")) throw new Error("代码准入没有写出「插件不在沙箱里运行」");
  if (!text.includes("adapter")) throw new Error("插件表没有写出它提供的是什么");
  if (text.includes("能力包")) throw new Error("「能力包」这个自造名词回来了");
  // 每个插件都要写清它提供什么
  const head = await body.locator('[aria-label="已装插件"] .dl-head').innerText();
  if (!head.includes("提供能力")) throw new Error("插件表没有「提供能力」列");
});

await check("Skill 详情整页下钻：面包屑 + 关键信息 + 文件（V3.44）", async () => {
  await page.locator('.main-rail [data-surface="library"]').click();
  await page.locator('[data-library-tab="skill"]').click();
  const pane = page.locator('[data-library-body="skill"]');

  // 点名字下钻
  await pane.locator('[data-skill-open="verify-pair"]').click();
  const detail = pane.locator('[data-skill-scope="detail"]');
  if (!(await detail.isVisible())) throw new Error("点名字没有进详情");
  if (await pane.locator('[data-skill-scope="list"]').isVisible()) throw new Error("进详情后列表还在，两者应该互斥");
  const surface = page.locator('[data-surface-view="library"]');
  if (!(await surface.getAttribute("class")).includes("skill-detail-mode")) throw new Error("Skill 详情没有进入整页模式");
  if (await surface.locator(':scope > .surface-content > header').isVisible()) throw new Error("详情页仍显示能力首页标题");
  if (await surface.locator(':scope > .surface-content > .mem-tabs').isVisible()) throw new Error("详情页仍可直接切换 MCP tab");
  const breadcrumb = detail.locator('[aria-label="面包屑"]');
  for (const item of ["能力", "Skills", "代码实现 + 独立验证"]) {
    if (!(await breadcrumb.innerText()).includes(item)) throw new Error(`面包屑缺少“${item}”`);
  }

  const text = await detail.innerText();
  for (const want of ["标识与版本", "来源", "更新时间", "所需能力", "下发状态"]) {
    if (!text.includes(want)) throw new Error(`详情缺少关键信息“${want}”`);
  }
  if (!text.includes("verify-pair@3")) throw new Error("详情没有标识与版本");
  if (text.includes("什么算 Done") || (await detail.locator(".skill-steps").count()) > 0) throw new Error("详情仍保留冗余步骤或完成要求区块");

  // 左边文件列表 + 右边内容，切文件右边跟着换
  if ((await detail.locator('[data-skill-file]:visible').count()) < 2) throw new Error("详情没有文件列表");
  await detail.locator('[data-skill-file="pair-ref"]').click();
  const shown = detail.locator('[data-skill-file-view="pair-ref"]');
  if (!(await shown.isVisible())) throw new Error("切文件右侧没有跟着换");
  if (await detail.locator('[data-skill-file-view="pair-main"]').isVisible()) throw new Error("旧文件视图没有隐藏");

  // 只读：不提供编辑入口，只提供在编辑器打开
  if (!text.includes("只读")) throw new Error("详情没有声明它是只读的");
  if (!text.includes("在编辑器打开")) throw new Error("没有给出改磁盘文件的出口");

  await detail.locator("[data-skill-back]").first().click();
  if (!(await pane.locator('[data-skill-scope="list"]').isVisible())) throw new Error("返回没有回到列表");
  if ((await surface.getAttribute("class")).includes("skill-detail-mode")) throw new Error("返回后仍停留在详情模式");

  // 所有 Skill 名称都必须能进入详情，不能只为少数示例提供页面。
  const keys = await pane.locator('[data-skill-open]').evaluateAll((items) => items.map((item) => item.dataset.skillOpen));
  for (const key of keys) {
    await pane.locator(`[data-skill-open="${key}"]`).click();
    if (!(await detail.isVisible())) throw new Error(`Skill ${key} 没有详情页`);
    if (!(await detail.locator('[data-skill-field="id"]').innerText()).includes("@")) throw new Error(`Skill ${key} 缺少版本标识`);
    await detail.locator("[data-skill-back]").first().click();
  }
});

await check("Skill 行尾是三点菜单，且没有「编辑」（V3.22 §3.2.3）", async () => {
  await page.locator('.main-rail [data-surface="library"]').click();
  await page.locator('[data-library-tab="skill"]').click();
  const row = page.locator('[data-library-body="skill"] .skill-list .dl-row').first();

  const menu = row.locator(".row-menu");
  if (!(await menu.count())) throw new Error("行尾没有三点菜单");
  // 未悬停时不展开
  if (await menu.locator(".row-menu-pop").isVisible()) throw new Error("下拉默认就是展开的");
  await menu.locator(".row-menu-btn").hover();
  const pop = menu.locator(".row-menu-pop");
  if (!(await pop.isVisible())) throw new Error("鼠标移上去没有展开下拉");

  const items = await pop.locator("button").allInnerTexts();
  if (!items.some((t) => t.includes("停用") || t.includes("启用"))) throw new Error("菜单里没有停用/启用");
  if (!items.some((t) => t.includes("删除"))) throw new Error("菜单里没有删除");
  if (items.some((t) => t.includes("编辑"))) {
    throw new Error("菜单里出现了「编辑」——skill 不该被手改，改一版就是另一段样本（§3.2.4）");
  }
});


/* ─────────────── V3.23：设置一级目录只放类别 ─────────────── */

await check("设置的一级目录只放类别：没有实体、没有动作、每一项都有页（V3.23 §3.5.1）", async () => {
  await page.locator('.main-rail [data-surface="settings"]').click();
  const list = page.locator('[data-surface-view="settings"] .sp-list');

  // 一级目录里三种东西混装，正是「读起来乱」的成因：
  // 类别（换一页）、实体实例（换页并选中）、动作（开一个流程）。
  const items = list.locator(".sp-item");
  const n = await items.count();
  if (!n) throw new Error("设置没有一级目录");
  for (let i = 0; i < n; i += 1) {
    const item = items.nth(i);
    const pick = await item.getAttribute("data-settings-pick");
    const text = (await item.innerText()).replace(/\s+/g, " ").trim();
    if (!pick) throw new Error(`「${text}」不是一个类别——一级目录里不放动作，也不放实体`);
    // 每一项都必须真的有一页。demo 死路比缺项更伤：它承诺了一个不存在的东西。
    await item.click();
    const body = page.locator(`[data-surface-view="settings"] .sp-body[data-settings-view="${pick}"]`);
    if (!(await body.isVisible())) throw new Error(`「${text}」点开没有详情页`);
    if ((await body.innerText()).trim().length < 80) throw new Error(`「${text}」的详情页几乎是空的`);
  }
  // 添加适配器是 T2 代码准入，不能长得像一行普通导航
  if (await list.locator("text=添加适配器").count()) {
    throw new Error("“添加适配器”又回到一级目录了——高风险准入流程不能作为普通导航项");
  }
});

await check("正在执行归统计 · 监控，额度告警归整个产品（V3.28）", async () => {
  await page.locator('.main-rail [data-surface="runtime"]').click();
  const local = page.locator('.rt-stage[data-machine-view="lt"]');
  // 运行中已经挪走：运行时回答「我有哪些执行资源」，不再混进此刻的进程读数
  if ((await local.innerText()).includes("正在运行的执行进程")) {
    throw new Error("「运行中」还留在运行时里——它是此刻的读数，归统计 · 监控");
  }
  const bar0 = await page.locator('.sp-bar[data-machine-view="lt"]').innerText();
  if (!bar0.includes("在线")) throw new Error("机器页头没有这台机器自己的状态");

  const foot = page.locator('[data-surface-view="runtime"] .sp-list .sp-foot');
  if (!(await foot.locator("text=暂停全部派工").count())) throw new Error("没有全局的「暂停全部派工」动作");
});

await check("MCP 有意图与结果两个落点，且带 adapter 同步列（V3.28）", async () => {
  // 结果侧：这个 adapter 实际带着哪些工具
  await gotoRuntime("lt-opencode");
  const surface = page.locator('[data-surface-view="runtime"]');
  const body = surface.locator('[data-rt-body="lt-opencode"]');
  const text = await body.innerText();
  if (!text.includes("工具")) throw new Error("adapter 配置里没有「工具」这一块");
  // 静默缺席是这个产品独有的那处不对称：能力缺失会让一条主张失效
  if (!text.includes("静默")) throw new Error("没有写清 MCP 工具缺席是静默的——两次执行看起来一样，结论却可能不同");
  if (!text.includes("本次生效组合")) throw new Error("缺席没有指向它的落点「本次生效组合」");

  // 意图侧：能力面的 MCP tab，不在设置的一级目录里
  await page.locator('.main-rail [data-surface="settings"]').click();
  if (await page.locator('[data-surface-view="settings"] .sp-list [data-settings-pick="mcp"]').count()) {
    throw new Error("MCP 落到设置里了——它是可选能力，缺一个 server 少一样工具，不影响核心链路");
  }
  await page.locator('.main-rail [data-surface="library"]').click();
  await page.locator('[data-library-tab="mcp"]').click();
  const mcp = page.locator('[data-library-body="mcp"]');
  if (!(await mcp.isVisible())) throw new Error("能力面没有 MCP tab");
  const head = await mcp.locator(".dl-head").innerText();
  if (!head.includes("同步范围")) {
    throw new Error("MCP 表缺少 adapter 同步列——生效是 per-adapter 的，没有这一列就会「我装了但某个 CLI 没同步」");
  }
  if (!(await mcp.innerText()).includes("未同步")) {
    throw new Error("没有把「某个 adapter 上没有这个 server」显示出来——缺席是静默的");
  }
});

await check("通知：渠道可全部关闭，类型名简短，无渠道列（V3.31）", async () => {
  await page.locator('.main-rail [data-surface="settings"]').click();
  await page.locator('[data-surface-view="settings"] .sp-list [data-settings-pick="notify"]').click();
  const body = page.locator('[data-surface-view="settings"] .sp-body[data-settings-view="notify"]');
  const text = await body.innerText();
  // 每一条都对应界面上已经存在的状态，不新造提醒
  for (const want of ["待指派", "待验收", "验证未通过", "自动化结果", "额度预警"]) {
    if (!text.includes(want)) throw new Error(`通知类型缺少「${want}」`);
  }
  // 类型名要短：一眼能扫完，不是一句话
  const names = await body.locator('[aria-label="通知类型"] .dl-title').allInnerTexts();
  const longName = names.find((n) => n.replace(/\s/g, "").length > 8);
  if (longName) throw new Error(`通知类型名过长：「${longName}」`);
  // 渠道与类型是两张表，类型表不再重复渠道
  const head = await body.locator('[aria-label="通知类型"] .dl-head').innerText();
  if (head.includes("渠道")) throw new Error("类型表里还有渠道列——渠道已经由上面那张表管完了");
  // 应用内也可以关：不再有「不可关闭」的例外
  const boxes = body.locator(".fm-toggle input[type=\"checkbox\"]");
  if ((await boxes.count()) < 3) throw new Error("通知渠道少于三个");
  if (await body.locator(".fm-toggle input[disabled]").count()) throw new Error("有渠道不能关——应用内通知也应该可以关掉");
  if (!text.includes("未触发")) throw new Error("没有说明「未触发 · 额度不足」也会通知");
});

await check("机器状态由左栏点灯与 adapter 健康度汇总，不保留机器健康区块（V3.44）", async () => {
  await page.locator('.main-rail [data-surface="runtime"]').click();
  const surface = page.locator('[data-surface-view="runtime"]');
  const machines = surface.locator('.sp-list [data-machine-pick]');
  if ((await machines.count()) !== 2) throw new Error("机器列表数量错误");
  if ((await machines.locator('.signal').count()) !== 2) throw new Error("机器列表没有逐机点灯");
  if (await surface.getByText("机器健康", { exact: true }).count()) throw new Error("运行时仍保留机器健康标题");
  const studioAdapters = surface.locator('.rt-stage[data-machine-view="studio"] .rt-adapters');
  if (!(await studioAdapters.innerText()).includes("离线")) throw new Error("黄色机器没有对应的 adapter 健康度依据");
});

await check("代码仓：支持本地目录，识别到 git 自动绑远端，路径与授权按机器给（V3.31）", async () => {
  await page.locator('.main-rail [data-surface="settings"]').click();
  const st = page.locator('[data-surface-view="settings"]');
  await st.locator('.sp-list [data-settings-pick="repos"]').click();
  const body = st.locator('.sp-body[data-settings-view="repos"]');
  const list = await body.innerText();
  // 本地目录不必先去 GitHub 搜
  // 一个添加入口，本地路径与仓库地址都从这里进，保存时自动判断
  if ((await st.locator("[data-repo-add]").count()) !== 1) {
    throw new Error("添加代码仓应只有一个入口，本地与远端由填的内容自动判断");
  }
  await st.locator("[data-repo-add]").click();
  const addDlg = page.locator("[data-repo-dialog]");
  if (!(await addDlg.innerText()).includes("本地路径或仓库地址")) {
    throw new Error("添加时还在要求先选本地还是远端");
  }
  if (!(await addDlg.innerText()).includes("自动读一次 git 配置")) throw new Error("没有说明会自动读 git 配置");
  if (await addDlg.locator("[data-repo-name]").count()) throw new Error("还在要求手填名称——名称从仓库或目录名读出来就行");
  await addDlg.locator("[data-repo-close]").first().click();
  if (!list.includes("无远端")) throw new Error("没有纯本地、无 git 远端的代码仓样本");

  // 配置弹窗：本地路径 + git 识别 + 各机器上的路径与授权
  const openRepo = async (key) => {
    const menu = body.locator(`.row-menu:has([data-repo-open="${key}"])`);
    await menu.locator(".row-menu-btn").hover();
    await menu.locator(`[data-repo-open="${key}"]`).click();
  };
  await openRepo("personahub");
  const dlg = page.locator("[data-repo-dialog]");
  if (!(await dlg.isVisible())) throw new Error("代码仓没有配置弹窗");
  const text = await dlg.innerText();
  if (!text.includes("本地路径")) throw new Error("配置里不能填本地路径");
  if (!text.includes("已识别为 git 仓库")) throw new Error("没有自动识别 git 远端");
  if (!text.includes("github.com/qzli/personahub")) throw new Error("识别到 git 仓库后没有把远端绑上");
  // 授权从运行时搬来：按机器给，一台一行
  const hosts = dlg.locator(".repo-hosts .dl-row");
  if ((await hosts.count()) < 2) throw new Error("没有逐台机器列出路径与授权");
  if (!(await dlg.locator(".repo-hosts select").count())) throw new Error("授权不可修改");
  if (!text.includes("未 clone")) throw new Error("没有表达「某台机器上没有这份代码」");
  await dlg.locator("[data-repo-close]").first().click();

  // 纯本地目录：识别不到远端时要说清代价
  await openRepo("design");
  if (!(await dlg.innerText()).includes("无 git 远端")) throw new Error("纯本地目录没有标出它没有远端");
  await dlg.locator("[data-repo-close]").first().click();

  // 运行时那边不再重复一份
  await page.locator('.main-rail [data-surface="runtime"]').click();
  if (await page.locator('[aria-label="已授权的代码目录"]').count()) {
    throw new Error("运行时里还留着代码目录授权——它已经并进设置 · 代码仓");
  }
});

await check("概览与 adapter 各成一屏，换机器后由 adapter 列表解释点灯（V3.44）", async () => {
  await page.locator('.main-rail [data-surface="runtime"]').click();
  const local = page.locator('.rt-stage[data-machine-view="lt"]');
  // 概览装机器级的事，adapter tab 装那一个 adapter 的事，互不混装
  const overview = await local.locator('[data-rt-body="overview"]').innerText();
  if (overview.includes("做不到什么")) throw new Error("adapter 的能力边界混进了概览");
  if (overview.includes("机器健康")) throw new Error("概览里仍有独立机器健康区块");
  // 换机器后，adapter 列表解释左栏黄色点灯
  await page.locator('[data-machine-pick="studio"]').click();
  const studio = page.locator('.rt-stage[data-machine-view="studio"]');
  const sOverview = await studio.locator('[data-rt-body="overview"]').innerText();
  if (!sOverview.includes("Claude Code") || !sOverview.includes("离线")) throw new Error("adapter 列表没有解释机器受限原因");
  // 换机器要回到概览，否则会停在一个上一台机器才有的 tab 上
  if (!(await studio.locator('[data-rt-body="overview"]').isVisible())) {
    throw new Error("换机器后没有回到概览");
  }
  await page.locator('[data-machine-pick="lt"]').click();
});

await check("插件可以配置：已装插件有配置入口与配置项（V3.31）", async () => {
  await page.locator('.main-rail [data-surface="settings"]').click();
  const st = page.locator('[data-surface-view="settings"]');
  await st.locator('.sp-list [data-settings-pick="plugins"]').click();
  const menu = page.locator('.row-menu:has([data-plugin-open="web-research"])');
  await menu.locator(".row-menu-btn").hover();
  await menu.locator('[data-plugin-open="web-research"]').click();
  const dlg = page.locator("[data-plugin-dialog]");
  if (!(await dlg.isVisible())) throw new Error("插件没有配置弹窗");
  const text = await dlg.innerText();
  if (!(await dlg.locator("[data-plugin-config] .ad-field").count())) throw new Error("弹窗里没有可填的配置项");
  if (!text.includes("它提供什么")) throw new Error("配置弹窗没有列出这个插件提供了什么");
  if (!text.includes("未生效")) throw new Error("装了一半的项没有单独标出来");
  if (!(await dlg.locator("[data-plugin-submit]").count())) throw new Error("配置没有保存按钮");
  await dlg.locator("[data-plugin-close]").first().click();
});

await check("「权限档」这个名字不再出现：同一件事只留一个名字（V3.23）", async () => {
  const body = await page.evaluate(() => document.body.innerText);
  if (body.includes("权限档")) {
    throw new Error("「权限档」和「能力边界」是同一件事的两个名字，界面上只能留一个");
  }
});

await check("本次生效组合：硬规则与可覆盖分开，被拦掉的压暗但在场（§3.2.7，V3.23 补建）", async () => {
  await openTask("issue-research", "thread");
  await page.locator('[data-pane="thread"] [data-open="room-view"]').first().click();
  await page.locator('[data-pane-tabs] [data-pane-tab="acceptance"]').click();
  await page.locator('[data-pick-combo="synthesizer"]').click();
  const pop = page.locator("[data-combo-picker]:visible");
  await pop.waitFor({ state: "visible" });
  const eff = pop.locator(".eff-combo");
  if (!(await eff.isVisible())) throw new Error("派工弹窗里没有「本次生效组合」——它是能力包加严、MCP 缺席、围栏过滤三件事共同的落点");
  if ((await eff.locator(".eff-sect").count()) < 3) throw new Error("三块少了：底座 / 这次生效的做法 / 被拦掉的");
  const fixed = eff.locator(".eff-sect.fixed");
  if (!(await fixed.count())) throw new Error("没有把不可覆盖的底座单独分出来");
  const fixedText = await fixed.innerText();
  if (!fixedText.includes("加严")) throw new Error("没写清能力包只能加严");
  if (fixedText.includes("放宽")) throw new Error("界面上出现了「放宽」——它不可能发生，所以不该有这个表达");
  const muted = await eff.locator(".eff-sect.muted").innerText();
  if (!muted.includes("未进")) throw new Error("被拦掉的没有列出来——过滤不能是静默的（§3.6.4）");
  // 每一条都要带来源：没有来源标记的行意味着有东西绕过准入进了上下文
  const items = eff.locator(".eff-sect li");
  const m = await items.count();
  for (let i = 0; i < m; i += 1) {
    if (!(await items.nth(i).locator("em").count())) throw new Error(`第 ${i + 1} 条没有来源标记`);
  }
  await pop.locator("[data-picker-close]").first().click();
});

await check("项目直接引用 Skills，不保留第二种工作流对象（V3.44）", async () => {
  await page.locator('.main-rail [data-surface="projects"]').click();
  const surface = page.locator('[data-surface-view="projects"]');
  await surface.locator('[role="tab"][data-project-tab="skills"]').click();
  const body = surface.locator('[data-project-body="skills"]');
  const text = await body.innerText();
  if (!text.includes("当前默认")) throw new Error("项目 Skills 没有表达默认项");
  if (!text.includes("#编组")) throw new Error("没有标出它们就是能力面里带步骤的 Skill");
  if (text.includes("什么算 Done") || text.includes("工作流")) throw new Error("项目页仍在复制 Skill 文件内容或使用旧工作流概念");
  await body.locator('[data-project-skill-open="verify-pair"]').click();
  const library = page.locator('[data-surface-view="library"]');
  if (!(await library.isVisible()) || !(await library.getAttribute("class")).includes("skill-detail-mode")) {
    throw new Error("项目 Skill 无法进入统一的 Skills 详情");
  }
  if (!(await library.locator('[data-skill-scope="detail"]').isVisible())) throw new Error("项目 Skill 没有打开统一详情");
  await library.locator('[data-skill-back]').last().click();
});

await check("adapter 详情只留挑得动、改得动的事实（V3.24 信息审视）", async () => {
  await gotoRuntime("lt-codex");
  const cfg = page.locator('[data-rt-body="lt-codex"]');
  const text = await cfg.innerText();

  // 删掉的四样，每一样都有它自己的理由，回来一样就红一次：
  // ① 模型表的「额度」列——额度按配置分池，给模型开一列只能靠「同池」打补丁
  if (/模型[\s\S]{0,40}额度[\s\S]{0,40}项目可用性/.test(text)) {
    throw new Error("每个模型一行的表又回来了——额度是配置的属性，不是模型的属性");
  }
  if (text.includes("同池")) throw new Error("「同池」这个补丁词回来了，说明额度又被摆成了模型的属性");
  // ② 模型表的「状态」列恒为「可用」——不可用的模型根本不会进可用清单
  // ③ 额度池表的「配置 / 认证」两列在单配置视图里恒等于上面已经说过的
  const dupes = (text.match(/OAuth/g) || []).length;
  if (dupes > 1) throw new Error("认证方式在同一份配置里写了不止一遍");
  // ④ 诊断里的「近 30 天派工 N 次」——那是回顾，口径归统计面（§3.4）
  const diag = await page.locator('[data-rt-body="lt-codex"]').innerText();
  if (/近 ?30 ?天/.test(diag)) {
    throw new Error("运行时的诊断里又出现了 30 天统计——运行时是前瞻，统计是回顾，两个时间口径不能同屏");
  }
  if (!diag.includes("上次检查")) throw new Error("概览里没有「上次检查」——排障先看这个结论是什么时候的");
  // V3.26 右框合并成一列之后，同一个事实只准出现一次
  if ((diag.match(/2026-10-08/g) || []).length > 1) throw new Error("登录态到期写了不止一遍");
});

await check("adapter 详情四块线性分区，顺序固定（V3.26）", async () => {
  const stage = await gotoRuntime("lt-opencode");
  const view = stage.locator('[data-rt-body="lt-opencode"]');
  const secs = await view.locator(".rt-sec .rt-sec-h").allInnerTexts();
  const want = ["概览", "接入方式", "运行中", "工具"];
  want.forEach((w, i) => {
    if (!secs[i] || !secs[i].startsWith(w)) throw new Error(`第 ${i + 1} 块应该是「${w}」，实际是「${secs[i] || "空"}」`);
  });
  // 两份配置各自的 base URL 要能分得开
  const urls = await view.locator("code").allInnerTexts();
  if (!urls.some((u) => u.includes("deepseek.com")) || !urls.some((u) => u.includes("11434"))) {
    throw new Error("两份配置没有各自的 base URL");
  }
  // 论证不进 UI
  const all = await stage.innerText();
  for (const word of ["判据", "债务展览馆", "打补丁"]) {
    if (all.includes(word)) throw new Error(`运行时里出现了「${word}」——那是设计论证，归 design.md`);
  }
});

await check("每个配置对象都有完整的增删改查（V3.27 CRUD 审计）", async () => {
  await page.locator('.main-rail [data-surface="runtime"]').click();
  const st = page.locator('[data-surface-view="runtime"]');

  // ── adapter 配置：漏得最狠的一处。design.md 反复引用「删除一份配置会让
  //    依赖它的执行组合消失，但历史 Run 保留当时的组合名」，而此前界面上
  //    根本没有触发它的地方。
  await page.locator('.rt-stage[data-machine-view="lt"] [data-rt-tab="lt-opencode"]').click();
  // 「配置」这一层只在一个 CLI 真有多套接入方式时才露出来：
  //   codex / claude 一个安装只有一种配法，凭据还在 CLI 自己手里，给不出可增删的东西。
  const access = page.locator('[data-rt-body="lt-opencode"] [aria-label$="的接入方式"]');
  if (!(await access.count())) throw new Error("OpenCode 有两套凭据，却没有接入方式这一块");
  const amenu = page.locator('.row-menu:has([data-remove-open="config"][data-remove-name="official-api"])');
  await amenu.locator(".row-menu-btn").hover();
  for (const act of ["编辑", "停用", "删除"]) {
    if (!(await amenu.locator(`text=${act}`).count())) throw new Error(`接入方式缺少「${act}」`);
  }
  await page.locator('.rt-stage[data-machine-view="lt"] [data-rt-tab="lt-codex"]').click();
  if (await page.locator('[data-rt-body="lt-codex"] [aria-label$="的接入方式"]').count()) {
    throw new Error("Codex 只有一种配法，不该出现可增删的接入方式——它的登录态在 CLI 自己手里");
  }
  await page.locator('.rt-stage[data-machine-view="lt"] [data-rt-tab="lt-opencode"]').click();
  const card = page.locator('[data-rt-body="lt-opencode"] .rt-sec').first();
  // 照 multica 的 skill 详情：引用计数常驻在对象上，不等到点删除才第一次告诉你
  if (!(await page.locator('[data-rt-body="lt-opencode"] [aria-label$="的接入方式"]').innerText()).includes("official-api")) {
    throw new Error("接入方式表没有列出每一份的名字——删除弹窗该是确认你已经看见的东西");
  }
  // 照 multica 的「权限」区：写明能做什么、改动何时生效
  const cfgText = await page.locator('[data-rt-body="lt-opencode"]').innerText();
  if (!cfgText.includes("下一次派工")) throw new Error("没写明改动何时生效——它有正在跑的进程，这件事不能不说");
  if (!(await page.locator('[data-rt-body="lt-opencode"] .row-menu-pop:has-text("停用")').count())) {
    throw new Error("接入方式没有可逆的停用这一档");
  }

  // ── 删除弹窗：影响面与「这不会动到什么」必须并排出现
  const dmenu = page.locator('.row-menu:has([data-remove-open="config"][data-remove-name="coding-plan"])');
  await dmenu.locator(".row-menu-btn").hover();
  await dmenu.locator('[data-remove-open="config"]').click();
  const dlg = page.locator("[data-remove-dialog]");
  if (!(await dlg.isVisible())) throw new Error("删除配置没有确认弹窗");
  if ((await dlg.locator("[data-remove-impact] li").count()) < 2) throw new Error("没有列出影响面");
  const keep = await dlg.locator("[data-remove-keep]").innerText();
  if (!keep.includes("历史")) {
    // 不确定删了会不会把历史一起带走时，真实反应是不删，于是界面上永远
    // 堆着一批不敢动的东西。所以「这不会动到什么」不是安慰，是必需项。
    throw new Error("没写清历史 Run 与证据链不受影响");
  }
  if (!(await dlg.locator("[data-remove-undo]").innerText()).includes("快照")) {
    throw new Error("没给一条能照着做的退路——本机每天有快照，那才是真正的安全网");
  }
  // 两个参考项目都没有「输入名称以确认」这道闸；到处都要抄一遍名字，人会
  // 条件反射地照抄，那道闸就不再拦住任何东西。
  if (await dlg.locator('input[data-remove-input]').count()) {
    throw new Error("又加了「输入名称以确认」——退路比仪式管用");
  }
  await dlg.locator("[data-remove-close]").first().click();

  // ── 机器与 adapter 的移除
  for (const [kind, where] of [["adapter", '[data-rt-body="lt-opencode"]'], ["machine", '.sp-bar[data-machine-view="studio"]']]) {
    if (kind === "machine") await page.locator('[data-machine-pick="studio"]').click();
    if (!(await page.locator(`${where} [data-remove-open="${kind}"]`).count())) {
      throw new Error(`${kind} 没有移除入口`);
    }
  }
  await page.locator('[data-machine-pick="lt"]').click();

  // ── 标签：被自动化规则引用的删不掉，这条设计里写了但此前没有入口
  await page.locator('.main-rail [data-surface="settings"]').click();
  const set = page.locator('[data-surface-view="settings"]');
  await set.locator('.sp-list [data-settings-pick="labels"]').click();
  const menu = page.locator('.row-menu:has([data-remove-open="label"][data-remove-name="bug"])');
  await menu.locator(".row-menu-btn").hover();
  await menu.locator('[data-remove-open="label"]').click();
  if (!(await dlg.locator("[data-remove-lead]").innerText()).includes("先解掉引用")) {
    throw new Error("被规则引用的标签没有被拦下");
  }
  if ((await dlg.locator("[data-remove-submit]").innerText()) === "删除标签") {
    throw new Error("被引用时主按钮仍然是「删除」——它该把人送去改规则");
  }
  await dlg.locator("[data-remove-close]").first().click();

  // ── 插件：停用之外要有卸载，两者不是一件事（V3.28 能力包移交能力面）
  await set.locator('.sp-list [data-settings-pick="plugins"]').click();
  const body = set.locator('.sp-body[data-settings-view="plugins"]');
  const plugText = await body.innerText();
  if (!plugText.includes("停用") || !plugText.includes("卸载")) throw new Error("没有说清停用与卸载的区别");
  if (!(await body.locator('[data-remove-open="plugin"]').count())) throw new Error("插件没有卸载入口");
  if (await body.locator('[data-remove-open="pack"]').count()) {
    throw new Error("还有以「能力包」为对象的入口——已统一为插件");
  }

  // ── 改前缀是要确认的操作（§3.5.4），此前只有一个 demo
  await page.locator('.main-rail [data-surface="settings"]').click();
  await set.locator('.sp-list [data-settings-pick="general"]').click();
  await page.locator("[data-prefix-open]").click();
  const pfx = page.locator("[data-prefix-dialog]");
  if (!(await pfx.isVisible())) throw new Error("改前缀没有确认弹窗");
  const pfxText = await pfx.innerText();
  if (!pfxText.includes("commit")) throw new Error("没写清已经写进 commit 的旧编号不会跟着变");
  if (!pfxText.includes("别名")) throw new Error("没写清留一条别名记录");
  await pfx.locator("[data-prefix-close]").first().click();

  // ── 时区与外部编辑器：此前只有静态文字，没有改的入口
  await set.locator('.sp-list [data-settings-pick="prefs"]').click();
  for (const k of ["timezone", "editor"]) {
    await page.locator(`[data-pick-open="${k}"]`).click();
    if ((await page.locator(".pick-row").count()) < 2) throw new Error(`${k} 没有可选项`);
    await page.locator("[data-pick-close]").first().click();
  }
});

await check("设置按作用域分两组九项，工作区组管当前 Space（V3.44）", async () => {
  await page.locator('.main-rail [data-surface="settings"]').click();
  const st = page.locator('[data-surface-view="settings"]');
  const items = st.locator(".sp-list .sp-item");
  if ((await items.count()) !== 9) throw new Error(`设置一级目录应为 9 项，实际 ${await items.count()} 项`);
  const groups = await st.locator(".sp-list .sp-group").allInnerTexts();
  if (groups.length !== 2) throw new Error("设置分组应为两组——按作用域分，回答「我改这个会影响谁」");
  // 一级目录只放类别：不出现实体实例、动作，也不出现状态灯
  if (await st.locator(".sp-list .sp-item .signal").count()) {
    throw new Error("一级目录出现了状态灯——设置是「去哪改东西」的地图，不是监控面板");
  }
  // 每一项都要有真页面，不能是 demo 死路
  for (const key of ["prefs", "plugins", "notify", "diagnostics", "about", "general", "memory", "labels", "repos"]) {
    if (!(await st.locator(`.sp-body[data-settings-view="${key}"]`).count())) {
      throw new Error(`「${key}」没有对应的详情页——demo 死路比缺项更伤`);
    }
  }
});

await check("代码仓：主目录可写、参考仓库只读，机器路径归运行时（V3.28）", async () => {
  await page.locator('.main-rail [data-surface="settings"]').click();
  const st = page.locator('[data-surface-view="settings"]');
  await st.locator('.sp-list [data-settings-pick="repos"]').click();
  const body = st.locator('.sp-body[data-settings-view="repos"]');
  const text = await body.innerText();
  // 起因：在 A 项目里让 agent 读 B 仓库的代码，此前没有落点
  if (!text.includes("只读参考")) throw new Error("没有「只读参考」——只读引用不该借用执行边界的壳");
  if (!text.includes("主目录")) throw new Error("没有区分主代码目录与参考仓库");
  if (!text.includes("写锁")) throw new Error("没写清参考仓库不带写锁与分支状态——那正是它不能配成 Workspace 的原因");
  // 引用计数常驻，删除弹窗只是确认你已经看见的东西
  if (!(await body.locator('[data-remove-open="repo"]').count())) throw new Error("代码仓没有移除入口");
  // 路径与授权按机器给，不在这一页
  if (text.includes("D:\\Projects")) throw new Error("本机路径出现在工作区级的代码仓表里——同一个仓库在三台机器上有三个路径");
});

await check("运行时是一级面，口径是盘点：组合总览 + 使用方式（V3.28）", async () => {
  await page.locator('.main-rail [data-surface="runtime"]').click();
  const rt = page.locator('[data-surface-view="runtime"]');
  if (!(await rt.isVisible())) throw new Error("运行时不是一级面");
  // 盘点口径下第一个该被答上的问题：我一共有哪些执行组合
  const combos = rt.locator('.rt-stage[data-machine-view="lt"] [aria-label$="的执行组合"]');
  if (!(await combos.count())) throw new Error("没有执行组合总览——散在三个 adapter 里要点开三次才拼得出来");
  const head = await combos.locator(".dl-head").innerText();
  if (!head.includes("计费方式")) throw new Error("组合总览没有「计费方式」列");
  const ctext = await combos.innerText();
  if (!ctext.includes("订阅") || !ctext.includes("按量计费")) {
    throw new Error("组合总览里没有同时出现订阅与按量计费——两者的账不能相加，必须分得开");
  }
  // 列表天然诱导排序 / 置顶 / 默认 / 别名，这四个动作全是偏好
  for (const pref of ["置顶", "设为默认", "别名"]) {
    if (ctext.includes(pref)) throw new Error(`组合总览里出现了「${pref}」——偏好字段会让 adapter 长成「AI 成员」`);
  }
  // 接入方式是配置的字段，摆在配置卡最上面
  await page.locator('.rt-stage[data-machine-view="lt"] [data-rt-tab="lt-opencode"]').click();
  const mode = await page.locator('[data-rt-body="lt-opencode"]').innerText();
  if (!mode.includes("接入方式")) throw new Error("adapter 概览里没有「接入方式」");
  if (!mode.includes("按量计费")) throw new Error("没有一份按量计费的配置——它的额度行与统计归属都不一样");
  if (!mode.includes("订阅")) throw new Error("没有一份订阅的配置");
});

await check("统计 · 监控只收执行层，基础设施归系统诊断（V3.44）", async () => {
  await page.locator('.main-rail [data-surface="stats"]').click();
  const surface = page.locator('[data-surface-view="stats"]');
  const tab = surface.locator('[data-stat-tab="errors"]');
  if (!(await tab.innerText()).includes("监控")) throw new Error("「失败」还没有扩成「监控」");
  // 近实时的前提是读者知道「近」到什么程度
  const fresh = await surface.locator("[data-stat-clock]").innerText();
  if (!fresh.includes("刷新")) throw new Error("没有写出刷新间隔与上次刷新时刻——KPI 是周期口径、后台任务是此刻口径，读者分不清");
  await tab.click();
  const body = surface.locator('[data-stat-body="errors"]');
  const text = await body.innerText();
  if (!text.includes("正在执行")) throw new Error("监控里没有「正在执行」");
  if (!text.includes("排队")) throw new Error("没有排队时长——派不出去也可能是并发已满");
  if (!(await body.locator('[aria-label="正在执行的进程"] .dl-row').count())) {
    throw new Error("没有列出正在跑的进程");
  }
  if (!(await body.locator('[aria-label="正在执行的进程"]').innerText()).includes("执行机器")) {
    throw new Error("正在执行的表里没有「执行机器」列——跨机器合并之后必须说清是哪一台");
  }
  // 基础设施健康归运行时：失败模式与处理动作都不同
  for (const infra of ["SQLite", "事件流", "磁盘"]) {
    if (text.includes(infra)) throw new Error(`基础设施「${infra}」混进统计了——它归运行时的本机 tab`);
  }
  // 额度是资源余量，不是花掉的账
  if (text.includes("时限额") || text.includes("周限额")) throw new Error("额度进统计了——它是运行时的实时状态");
});

await check("工具分内置与 MCP 两类，表格呈现；概览卡片一行铺满（V3.35）", async () => {
  const stage = await gotoRuntime("lt-codex");
  const pane = stage.locator('[data-rt-body="lt-codex"]');
  // adapter tab 的内容要铺满右侧，不另设一条更窄的正文宽度
  const fit = await page.evaluate(() => {
    const p = document.querySelector('[data-rt-body="lt-codex"]');
    return p.getBoundingClientRect().width / (p.closest(".rt-stage").clientWidth - 48);
  });
  if (fit < 0.98) throw new Error(`adapter tab 内容没有铺满：只占 ${Math.round(fit * 100)}%`);
  // 概览四张卡一行
  const cols = await page.evaluate(() =>
    getComputedStyle(document.querySelector('[data-rt-body="lt-codex"] .rt-cards')).gridTemplateColumns.split(" ").length);
  if (cols !== 4) throw new Error(`概览卡片应一行四张，实际一行 ${cols} 张`);

  // 工具不只有 MCP：CLI 自带的读写文件、执行命令、网络也是工具，且它们的状态会变
  const tools = pane.locator('[aria-label="工具"]');
  if (!(await tools.count())) throw new Error("工具没有做成表格");
  const head = await tools.locator(".dl-head").innerText();
  for (const col of ["工具名称", "工具类型", "提供方", "可用状态", "权限与范围"]) {
    if (!head.includes(col)) throw new Error(`工具表缺少「${col}」列`);
  }
  // 类型把「这是哪一类能力」和「谁提供的」分开：MCP / 文件 / 命令 / 网络
  const kinds = await tools.locator(".dl-row .tool-kind").allInnerTexts();
  for (const k of ["MCP", "文件", "命令", "网络"]) {
    if (!kinds.includes(k)) throw new Error(`工具类型缺少「${k}」`);
  }
  const froms = await tools.locator(".dl-row > span:nth-child(3)").allInnerTexts();
  if (!froms.some((f) => f.includes("CLI 内置"))) throw new Error("工具表里没有 CLI 自带的工具——它们也是工具");
  const text = await tools.innerText();
  for (const want of ["读文件", "写文件", "执行命令", "网络请求"]) {
    if (!text.includes(want)) throw new Error(`工具表缺少内置工具「${want}」`);
  }

  // 缺席要能一眼看出来：OpenCode 不注入 MCP，那四行必须标成未注入
  await stage.locator('[data-rt-tab="lt-opencode"]').click();
  const oc = await stage.locator('[data-rt-body="lt-opencode"] [aria-label="工具"]').innerText();
  if ((oc.match(/未注入/g) || []).length < 4) {
    throw new Error("OpenCode 不注入 MCP，那几行没有逐条标出来");
  }
  if (!oc.includes("无需确认")) throw new Error("写文件无需授权确认的状态没有落在工具表上");
  await stage.locator('[data-rt-tab="overview"]').click();
});

await check("运行时不做任务控制：运行中只读，停止在监控（V3.36）", async () => {
  const stage = await gotoRuntime("lt-codex");
  const running = stage.locator('[data-rt-body="lt-codex"] [aria-label="正在运行"]');
  if (!(await running.count())) throw new Error("adapter tab 里没有「正在运行」");
  // 运行时管的是「有哪些执行资源」，不是中止任务的地方
  if (await running.locator(".dl-act").count()) throw new Error("运行时里又出现了任务控制动作——这里只读");
  const head = await running.locator(".dl-head").innerText();
  if (head.includes("操作")) throw new Error("「正在运行」表还有操作列");
  for (const w of ["停止", "结束", "中止", "取消"]) {
    if ((await running.innerText()).includes(w)) throw new Error(`运行时的「正在运行」里出现了「${w}」`);
  }
  // 但要说清去哪儿停，否则等于把人留在死路上
  const pane = await stage.locator('[data-rt-body="lt-codex"]').innerText();
  if (!pane.includes("统计 · 监控")) throw new Error("没有指出停止任务该去哪里");

  // 停止确实在监控那一侧
  await page.locator('.main-rail [data-surface="stats"]').click();
  await page.locator('[data-stat-tab="errors"]').click();
  const mon = page.locator('[data-stat-body="errors"] [aria-label="正在执行的进程"]');
  if (!(await mon.locator("text=停止").count())) throw new Error("监控里没有停止进程的入口");
});

await check("自动化的启用状态是一个开关，不是一个词（V3.38）", async () => {
  await page.locator('.main-rail [data-surface="automation"]').click();
  await page.locator('[data-surface-view="automation"] [data-automation-pick="dep"]').click();
  const dep = page.locator('[data-automation-view="dep"]');
  const sw = dep.locator("[data-rule-toggle]");
  if (!(await sw.count())) throw new Error("启用状态不是开关，看不出能不能点");
  if (!(await sw.isChecked())) throw new Error("这条规则应默认已启用");
  const label = dep.locator(".rule-label");
  if ((await label.innerText()) !== "已启用") throw new Error("开关旁没有当前状态的文字");
  await sw.click();
  if ((await label.innerText()) !== "已暂停") throw new Error("关掉之后文字没跟着变");
  await sw.click();
});

await check("知识库给出配置判断需要的最近召回与采纳数（V3.44）", async () => {
  await page.locator('.main-rail [data-surface="memory"]').click();
  const surface = page.locator('[data-surface-view="memory"]');
  await surface.locator('[data-memory-tab="library"]').click();
  const lib = surface.locator('[aria-label="知识库"]');
  const head = await lib.locator(".dl-head").innerText();
  for (const col of ["最近召回", "采纳"]) {
    if (!head.includes(col)) throw new Error(`知识库缺少「${col}」列`);
  }
  if (!(await lib.locator(".dl-row .dl-warn").count())) throw new Error("超过整理阈值的行没有标出");
  if (!(await lib.locator(".dl-applied").count())) throw new Error("知识库行上没有采纳数");

  const cols = await page.evaluate(() => {
    const table = document.querySelector('[aria-label="知识库"]');
    const count = getComputedStyle(table.querySelector(".dl-head")).gridTemplateColumns.split(" ").length;
    const bad = [...table.querySelectorAll(".dl-row")].filter(
      (row) => [...row.children].filter((child) => !child.classList.contains("dl-detail") && child.tagName === "SPAN").length !== count);
    return { count, bad: bad.length };
  });
  if (cols.bad) throw new Error(`有 ${cols.bad} 行的格子数与表头对不上`);
});
await check("界面只留事实与动作，设计论证撤回文档（V3.28 文案审视）", async () => {
  const text = await page.evaluate(() => document.body.innerText);
  for (const w of ["判据", "债务展览馆", "照 clowder", "照 multica", "打补丁", "中心问题"]) {
    if (text.includes(w)) throw new Error(`界面上出现了设计论证用词「${w}」——它属于 docs/design.md`);
  }
  // 章节号与 ADR 编号是文档坐标，不是使用者要读的东西
  const notes = await page.locator(".pane-note, .rt-sec-note, .sc-note, .stage-note").allInnerTexts();
  for (const n of notes) {
    if (/（(?:ADR|PRD|§)/.test(n)) throw new Error(`说明文字里还带着文档引用：${n.slice(0, 40)}…`);
  }
  // 说明性文字有上限：超过 200 字的段落，说的一定不只是「会发生什么」
  const long = notes.filter((n) => n.replace(/\s/g, "").length > 150);
  if (long.length) throw new Error(`有 ${long.length} 段说明文字超过 150 字：${long[0].slice(0, 40)}…`);
  // 总量守门：说明性文字整站不超过 4500 字，超了说明约束又开始往界面上爬
  const total = await page.evaluate(() =>
    [...document.querySelectorAll(".pane-note, .rt-sec-note, .sc-note, .stage-note, .dl-sub, .tc-note, .fm-warn, .fm-hint, .as-note")]
      .reduce((n, el) => n + (el.textContent || "").replace(/\s/g, "").length, 0));
  if (total > 4500) throw new Error(`说明性文字共 ${total} 字，超过 4500 上限——约束应写进 docs/implementation-notes.md`);
  // 自造名词：装进来的东西一律叫插件
  if (text.includes("能力包")) throw new Error("「能力包」这个自造名词回来了——只有 Skills / MCP / 插件");
  // 给设计者看的备注不该留在界面上
  for (const w of ["不写能力位名字", "不占列表一列", "这一层归它"]) {
    if (text.includes(w)) throw new Error(`界面上留着写给设计者的备注「${w}」`);
  }
});

await check("偏好设置里有个人资料，提交身份单列（V3.30）", async () => {
  await page.locator('.main-rail [data-surface="settings"]').click();
  const st = page.locator('[data-surface-view="settings"]');
  await st.locator('.sp-list [data-settings-pick="prefs"]').click();
  const body = st.locator('.sp-body[data-settings-view="prefs"]');
  const text = await body.innerText();
  for (const want of ["个人资料", "姓名", "邮箱", "关于你"]) {
    if (!text.includes(want)) throw new Error(`偏好设置缺少「${want}」`);
  }
  if (!(await body.locator(".avatar-lg").count())) throw new Error("没有头像上传入口");
  if ((await body.locator('.fm-field input[type="text"]').count()) < 4) throw new Error("个人资料没有可编辑的字段");
  // 显示名只影响界面；Git 身份会写进每一个 commit 并随仓库公开，两者不能合成一张卡
  // 语言暂不做多语言，界面上不该留一个只有一个选项的开关
  if (text.includes("界面语言")) throw new Error("语言设置又回来了——短期内不做多语言");
  // 提交身份归代码仓：它是 git 的事，不是「我怎么看这台机器」
  if (text.includes("提交身份")) throw new Error("提交身份不该在偏好设置里——它归设置 · 代码仓");
  await st.locator('.sp-list [data-settings-pick="repos"]').click();
  const repos = await st.locator('.sp-body[data-settings-view="repos"]').innerText();
  if (!repos.includes("提交身份")) throw new Error("代码仓里没有提交身份");
  if (!repos.includes("提交身份")) throw new Error("代码仓里没有说明 agent 用哪个 git 身份提交");
  if (!repos.includes("git config")) throw new Error("没写明提交身份读的是执行机器上的 git 配置，而不是另存一份");
});

await check("能力面只有 Skills 与 MCP，说明在 tab 栏右侧（V3.30）", async () => {
  await page.locator('.main-rail [data-surface="library"]').click();
  const lib = page.locator('[data-surface-view="library"]');
  const tabs = await lib.locator(".mem-tabs [data-library-tab]").allInnerTexts();
  if (tabs.length !== 2) throw new Error(`能力面应只有 Skills 与 MCP 两个 tab，实际 ${tabs.length} 个`);
  if (await lib.locator('[data-library-tab="inbox"]').count()) throw new Error("「订阅」tab 又回来了——它是插件贡献的示例，不是宿主自带");
  // 页首：标题在上，下面一句面向使用者的解释
  const h1y = await page.evaluate(() => {
    const h = document.querySelector('[data-surface-view="library"] header h1');
    const p = document.querySelector('[data-surface-view="library"] header p');
    return { h: Math.round(h.getBoundingClientRect().y), p: Math.round(p.getBoundingClientRect().y), len: p.textContent.replace(/\s/g, "").length };
  });
  if (h1y.h > h1y.p) throw new Error("标题应该在解释上面");
  if (h1y.len < 8 || h1y.len > 60) throw new Error(`页首那句解释长度不合适：${h1y.len} 字`);
  if (await lib.locator(".lib-tab-hint").count()) throw new Error("tab 栏又挂回一行说明");
});

await check("界面不写「单用户 / 本机工具」这类形态限定（V3.30）", async () => {
  const text = await page.evaluate(() => document.body.innerText);
  for (const w of ["单用户", "本机工具", "个人工具"]) {
    if (text.includes(w)) throw new Error(`界面上出现形态限定「${w}」——设计稿按完全体交付，不预设部署形态`);
  }
});

await check("界面上不再出现「弹层」这个词（V3.27）", async () => {
  const body = await page.evaluate(() => document.body.innerText);
  if (body.includes("弹层")) throw new Error("「弹层」还在——统一叫「弹窗」，那个词更常用");
});

await check("面向用户的文案不包含设计与原型阶段说明（V3.44）", async () => {
  const forbidden = ["静态原型", "设计稿", "本轮静态", "不保存", "不真的", "演示占位"];
  const values = await page.evaluate(() => [
    document.body.innerText,
    ...[...document.querySelectorAll("[data-demo], [title], [aria-label]")].flatMap((node) => [
      node.getAttribute("data-demo") || "",
      node.getAttribute("title") || "",
      node.getAttribute("aria-label") || "",
    ]),
  ]);
  for (const word of forbidden) {
    const hit = values.find((value) => value.includes(word));
    if (hit) throw new Error(`发现开发阶段措辞「${word}」：${hit.slice(0, 60)}`);
  }
});

await check("所有数据表均使用完整、正式的字段与内容（V3.44）", async () => {
  const audit = await page.evaluate(() => {
    const normalize = (value) => value.replace(/\s+/g, " ").trim();
    const tables = [...document.querySelectorAll('table, [role="table"], .run-table')]
      .filter((node) => !node.parentElement?.closest('table, [role="table"], .run-table'));
    const informal = /^(type|server|从|到|怎么来的|怎么发现的|提供什么|已下发|被谁引用|怎么判的 \/ 有什么后果)$/i;
    return tables.map((table, index) => {
      const head = table.querySelector("thead tr, .dl-head, .rn-head, .rn-row.heading, .run-row.heading");
      const headers = head ? [...head.children].map((cell) => normalize(cell.textContent || "")) : [];
      const placeholders = [...table.querySelectorAll("td, .dl-row > span, .rn-row > span, .run-row > span")]
        .filter((cell) => normalize(cell.textContent || "") === "—").length;
      const emptyCells = [...table.querySelectorAll("tbody td, .dl-row > span, .rn-row > span, .run-row:not(.heading) > span")]
        .filter((cell) => !normalize(cell.textContent || "") && !cell.querySelector("input, button, select, textarea")).length;
      return {
        index: index + 1,
        label: table.getAttribute("aria-label") || "",
        headers,
        emptyHeaders: headers.filter((header) => !header).length,
        informalHeaders: headers.filter((header) => informal.test(header)),
        placeholders,
        emptyCells,
      };
    });
  });
  const missingHead = audit.filter((table) => !table.headers.length);
  const emptyHead = audit.filter((table) => table.emptyHeaders);
  const informal = audit.filter((table) => table.informalHeaders.length);
  const placeholders = audit.filter((table) => table.placeholders);
  const unnamed = audit.filter((table) => !table.label);
  const emptyCells = audit.filter((table) => table.emptyCells);
  if (audit.length < 39) throw new Error(`数据表数量异常：预期至少 39 张，实际 ${audit.length} 张`);
  if (unnamed.length) throw new Error(`有 ${unnamed.length} 张表缺少可访问名称：${unnamed.map((table) => table.index).join(", ")}`);
  if (missingHead.length) throw new Error(`有 ${missingHead.length} 张表缺少字段行：${missingHead.map((table) => table.index).join(", ")}`);
  if (emptyHead.length) throw new Error(`有 ${emptyHead.length} 张表存在空字段名：${emptyHead.map((table) => table.index).join(", ")}`);
  if (informal.length) throw new Error(`有 ${informal.length} 张表使用非正式字段名：${informal.map((table) => table.informalHeaders.join("/")).join(", ")}`);
  if (placeholders.length) throw new Error(`有 ${placeholders.length} 张表仍用破折号代替正式内容：${placeholders.map((table) => table.index).join(", ")}`);
  if (emptyCells.length) throw new Error(`有 ${emptyCells.length} 张表存在无内容且无控件的单元格：${emptyCells.map((table) => table.index).join(", ")}`);
});

await browser.close();

const result = { passed: checks.length, failed: failures.length, checks, failures, consoleErrors };
fs.writeFileSync("browser-check.json", `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
if (failures.length || consoleErrors.length) process.exitCode = 1;
