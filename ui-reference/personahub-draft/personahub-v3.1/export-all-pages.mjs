import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const baseUrl = process.env.PERSONAHUB_V3_URL ?? new URL("./index.html", import.meta.url).href;
const shotsDir = path.resolve(new URL("./shots", import.meta.url).pathname.replace(/^\/(\w:)/, "$1"));
const browserCandidates = [
  process.env.PERSONAHUB_V2_BROWSER,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
].filter(Boolean);
const executablePath = browserCandidates.find((candidate) => fs.existsSync(candidate));

fs.mkdirSync(shotsDir, { recursive: true });
for (const entry of fs.readdirSync(shotsDir, { withFileTypes: true })) {
  if (entry.isFile() && entry.name.toLocaleLowerCase().endsWith(".png")) {
    fs.unlinkSync(path.join(shotsDir, entry.name));
  }
}

const browser = await chromium.launch({ headless: true, executablePath });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const consoleErrors = [];
const exports = [];

page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => consoleErrors.push(error.message));

await page.goto(baseUrl, { waitUntil: "networkidle" });
await page.addStyleTag({ content: "*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}" });

async function capture(file, title, kind) {
  const target = path.join(shotsDir, file);
  // toast 活 2200ms，导出比它快，于是每张参考图的右下角都冻着一条提示，
  // 盖住的往往是长表格最后一列的正文。截图前先把它收掉。
  await page.evaluate(() => document.querySelector("[data-toast]")?.classList.remove("show"));
  await page.screenshot({ path: target, fullPage: true });
  exports.push({ file, title, kind });
}

async function openProject() {
  await page.locator(".main-rail [data-surface=\"project\"]").click();
  await page.locator('[data-surface-view="project"]').waitFor({ state: "visible" });
}

async function openDocument({ id, explorer, file, title, host = "issue-view", via }) {
  await openProject();
  // 有些子文档只能从另一个子文档里进（例如阶段成果挂在协作现场里）
  if (via && !(await page.locator(`[data-document="${id}"]`).isVisible())) {
    await openDocument({ id: via.id, explorer, file: null, title: null, host: via.host });
  }
  const targetDocument = page.locator(`[data-document="${id}"]`);
  if (!(await targetDocument.isVisible())) {
    // V3.4：左栏只剩任务列表，子文档的入口散在任务的各个视图里
    // （资源库那三样已经搬进项目面，成果与资料并成了「资源」）。
    // 所以逐个视图找可见入口，而不是假定它一定在左栏。
    const item = page.locator(`.explorer-panel [data-open="${id}"]`).first();
    if (await item.count()) {
      if (!(await item.isVisible())) {
        await page.locator('[data-issue-label="全部"]').click();
        await page.locator('[data-issue-tab="recent"]').click();
      }
      await item.click();
    } else {
      await page.locator(`.explorer-panel [data-open="${host}"]`).first().click();
      let opened = false;
      for (const pane of ["overview", "acceptance", "resource", "thread"]) {
        await page.locator(`[data-pane-tabs] [data-pane-tab="${pane}"]`).click();
        for (const dir of pane === "resource" ? ["out", "in"] : [null]) {
          if (dir) {
            await page.locator(`[data-res-dir="${dir}"]`).click();
            // 资源清单是就地预览，子文档入口在预览栏的「打开全文」里
            for (const item of await page.locator(`[data-res-body="${dir}"] [data-res-open]`).all()) {
              await item.click();
              // 只有当前展示的那份预览里的入口才点得到
              const full = page.locator(`.res-preview [data-res-view]:not([hidden]) [data-open="${id}"]`);
              if (await full.count()) {
                await full.first().click();
                opened = true;
                break;
              }
            }
            if (opened) break;
          }
          const entry = page.locator(`[data-pane="${pane}"] [data-open="${id}"]:visible`).first();
          if (await entry.count()) {
            await entry.click();
            opened = true;
            break;
          }
        }
        if (opened) break;
      }
      if (!opened) throw new Error(`没有可见入口：${id}`);
    }
  }
  // V3.4：任务面五个视图，文档都活在「验收」面里；截图前先切过去。
  await page.locator('[data-pane-tabs] [data-pane-tab="acceptance"]').click();
  await targetDocument.waitFor({ state: "visible" });
  await page.locator(".document-stage").evaluate((element) => { element.scrollTop = 0; });
  if (file) await capture(file, title, "project-document");
}

await openDocument({ id: "file-prd",host: "issue-research",  explorer: "work", file: "workbench.png", title: "项目工作台 · PersonaHub PRD" });
await openDocument({ id: "file-room-spec",host: "issue-view",  explorer: "library", file: "document-room-spec.png", title: "Markdown · F011 Room spec" });
await openDocument({ id: "file-code",host: "issue-view",  explorer: "library", file: "change-locations.png", title: "代码 · run-dispatch.ts 修改位置" });
await openDocument({ id: "file-architecture",host: "issue-view",  explorer: "library", file: "document-architecture.png", title: "Markdown · PersonaHub architecture" });
await openDocument({ id: "issue-new", explorer: "work", file: "task-new.png", title: "任务 · 刚创建（成果面空态）" });
await openDocument({ id: "issue-view", explorer: "work", file: "task-and-room.png", title: "任务 · 协作现场人工介入" });
await openDocument({ id: "issue-validation", explorer: "work", file: "task-validation.png", title: "任务 · 验证未收敛" });
await openDocument({ id: "issue-permission", explorer: "work", file: "task-permission.png", title: "任务 · 权限确认" });
await openDocument({ id: "issue-running", explorer: "work", file: "task-running.png", title: "任务 · 正在执行" });
await openDocument({ id: "issue-research", explorer: "work", file: "task-research.png", title: "任务 · 阶段成果研究" });
await openDocument({ id: "room-view",explorer: "library", host: "issue-research", file: "room-research.png", title: "协作现场 · Research" });
await openDocument({ id: "issue-done", explorer: "work", file: "task-done.png", title: "任务 · 已完成" });
await openDocument({ id: "artifact-view",explorer: "library", host: "issue-done", file: "artifact-synthesis.png", title: "阶段成果 · synthesis_plan" });
await openDocument({ id: "artifact-research",explorer: "library", host: "issue-research", file: "artifact-research.png", title: "阶段成果 · research_findings" });
await openDocument({ id: "evidence-view",explorer: "library", host: "issue-done", file: "evidence-summary.png", title: "完成摘要 · Graph recovery" });
await openDocument({ id: "evidence-room",explorer: "library", host: "issue-done", file: "evidence-chain.png", title: "验证依据 · Room pause / resume" });
await openDocument({ id: "decision-view",explorer: "library", host: "issue-done", file: "knowledge-decision.png", title: "Decision · Issue-first" });
await openDocument({ id: "memory-view",explorer: "library", host: "issue-done", file: "knowledge-memory.png", title: "Memory · 人工介入" });
await openDocument({ id: "skill-view",explorer: "library", host: "issue-done", file: "knowledge-skill.png", title: "Skill candidate · 前端原型验证" });

await openDocument({ id: "issue-view", explorer: "work", file: "task-and-room.tmp.png", title: "临时", kind: "temporary" });
fs.unlinkSync(path.join(shotsDir, "task-and-room.tmp.png"));
exports.pop();
await page.locator('[data-explorer-panel="work"] [data-open="issue-view"]').first().click();
await page.locator('[data-pane-tabs] [data-pane-tab="thread"]').click();
await page.locator('[data-room-panel="primary"]').waitFor({ state: "visible" });

await openDocument({ id: "room-view", explorer: "library", host: "issue-research", file: "room-tmp.png", title: "临时", kind: "temporary" });
fs.unlinkSync(path.join(shotsDir, "room-tmp.png"));
exports.pop();
// 轨迹副栏：概览分段条 + 事件表格。没有这张，改概览条时没有参考图可对照。
await page.locator('[data-pane-tabs] [data-pane-tab="thread"]').click();
await page.locator("[data-waterfall]").waitFor({ state: "visible" });
// 副栏有自己的滚动条，初始不在顶部——不滚回去，概览条就不在画面里
await page.locator("[data-waterfall]").evaluate((el) => {
  // 滚动的容器是 .task-pane（副栏的祖先），不是副栏本身——逐级往上全部归零
  for (let n = el; n && n !== document.body; n = n.parentElement) n.scrollTop = 0;
  el.closest("[data-aside]")?.querySelectorAll("*").forEach((n) => (n.scrollTop = 0));
});
await capture("task-trace.png", "任务 · 会话与轨迹副栏（概览分段条）", "task-pane");

await page.locator('[data-pane-tabs] [data-pane-tab="acceptance"]').click();
await page.locator('[data-pick-combo="synthesizer"]').click();
await page.locator("[data-combo-picker]:visible").waitFor({ state: "visible" });
await capture("combo-picker.png", "执行组合选择器 · 综合步", "overlay");
await page.locator('[data-combo-picker]:visible .picker-row:not([disabled])').first().click();
await page.locator("[data-dispatch-undo]").waitFor({ state: "visible" });
await capture("dispatch-undo.png", "指派撤销窗口 · 正在启动", "room-panel");
await page.locator("[data-undo-cancel]").click();

for (const [surface, file, title] of [
  ["threads", "surface-threads.png", "会话"],
  ["projects", "surface-projects.png", "项目"],
  ["memory", "surface-memory.png", "记忆"],
  ["library", "surface-library.png", "能力"],
  ["usage", "surface-usage.png", "用量"],
  ["automation", "surface-automation.png", "自动化"],
  ["settings", "surface-settings.png", "设置"],
]) {
  await page.locator(`.main-rail [data-surface="${surface}"]`).click();
  await page.locator(`[data-surface-view="${surface}"]`).waitFor({ state: "visible" });
  await capture(file, title, "top-level-surface");
}

// 记忆的另外两个 tab 各自成图：知识库承载三轴与状态，健康度承载五项债务（§3.6）
await page.locator('.main-rail [data-surface="memory"]').click();
for (const [tab, file, title] of [
  ["library", "surface-memory-library.png", "记忆 · 知识库（三轴与状态）"],
  ["health", "surface-memory-health.png", "记忆 · 健康度（五项债务）"],
]) {
  await page.locator(`[data-memory-tab="${tab}"]`).click();
  await page.locator(`[data-memory-body="${tab}"]`).waitFor({ state: "visible" });
  await capture(file, title, "top-level-surface");
}
await page.locator('[data-memory-tab="inbox"]').click();

// 设置向导的入口在设置面里；上面切走了，回来才点得到
await page.locator('.main-rail [data-surface="settings"]').click();
await page.locator('[data-surface-view="settings"]').waitFor({ state: "visible" });

await page.locator('[data-surface="setup"]').click();
await page.locator('[data-surface-view="setup"]').waitFor({ state: "visible" });
await capture("surface-setup.png", "首次设置向导", "top-level-surface");

await browser.close();

const result = {
  generatedAt: new Date().toISOString(),
  source: baseUrl,
  viewport: "1440x900",
  count: exports.length,
  exports,
  consoleErrors,
};
fs.writeFileSync(path.join(shotsDir, "pages-manifest.json"), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));

if (exports.length !== 24 || consoleErrors.length) process.exitCode = 1;
