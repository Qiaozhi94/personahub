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

await check("已删除 IDE 隐喻：标签页排、底部执行面板、底部状态栏（§4.5）", async () => {
  for (const [sel, label] of [[".editor-tabs", "标签页排"], [".bottom-panel", "底部执行面板"], [".statusbar", "底部状态栏"], [".activity-rail", "图标活动栏"]]) {
    if (await page.locator(sel).isVisible().catch(() => false)) throw new Error(`${label}仍然可见`);
  }
});

// §4.1 左栏 ───────────────────────────────────────────────
await check("左栏一栏承担一级入口 + 两个对象 tab（§4.1）", async () => {
  const navCount = await page.locator(".primary-nav:visible > button").count();
  if (navCount !== 4) throw new Error(`一级入口应为 4 个，实际 ${navCount}`);
  if (!(await page.locator('.primary-nav:visible [data-surface="library"]').innerText()).includes("能力库")) {
    throw new Error("AI 成员入口未带文字（PRD §10 要求一级可见）");
  }
  const tabs = await page.locator(".explorer-mode-tabs button").allInnerTexts();
  if (tabs.length !== 2 || tabs[0].trim() !== "任务" || tabs[1].trim() !== "资源库") {
    throw new Error(`左栏 tab 应为「任务 / 资源库」，实际 ${JSON.stringify(tabs)}`);
  }
});

await check("资源库收纳文档、产出与知识三组（§4.1 / §7.3）", async () => {
  await page.locator('[data-explorer-tab="library"]').click();
  const groups = await page.locator(".library-group").allInnerTexts();
  for (const want of ["文档与素材", "产出", "知识"]) {
    if (!groups.some((g) => g.trim() === want)) throw new Error(`资源库缺少「${want}」分组`);
  }
  await page.locator('[data-explorer-tab="work"]').click();
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
