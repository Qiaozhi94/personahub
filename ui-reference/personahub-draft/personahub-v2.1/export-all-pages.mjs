import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const baseUrl = process.env.PERSONAHUB_V2_URL ?? new URL("./index.html", import.meta.url).href;
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
  await page.screenshot({ path: target, fullPage: true });
  exports.push({ file, title, kind });
}

async function openProject() {
  await page.locator('.activity-rail [data-surface="project"]').click();
  await page.locator('[data-surface-view="project"]').waitFor({ state: "visible" });
}

async function openDocument({ id, explorer, file, title }) {
  await openProject();
  await page.locator(`[data-explorer-tab="${explorer}"]`).click();
  const targetDocument = page.locator(`[data-document="${id}"]`);
  if (!(await targetDocument.isVisible())) {
    const scoped = page.locator(`[data-explorer-panel="${explorer}"] [data-open="${id}"]`);
    const scopedCount = await scoped.count();
    if (scopedCount > 0) await scoped.first().click();
    else {
      const editorTab = page.locator(`.editor-tabs [data-open="${id}"]`);
      if ((await editorTab.count()) === 0) throw new Error(`没有可见入口：${id}`);
      await editorTab.click();
    }
  }
  await targetDocument.waitFor({ state: "visible" });
  await page.locator(".document-stage").evaluate((element) => { element.scrollTop = 0; });
  await capture(file, title, "project-document");
}

await openDocument({ id: "file-prd", explorer: "work", file: "workbench.png", title: "项目工作台 · PersonaHub PRD" });
await openDocument({ id: "file-room-spec", explorer: "resources", file: "document-room-spec.png", title: "Markdown · F011 Room spec" });
await openDocument({ id: "file-code", explorer: "resources", file: "change-locations.png", title: "代码 · run-dispatch.ts 修改位置" });
await openDocument({ id: "file-architecture", explorer: "resources", file: "document-architecture.png", title: "Markdown · PersonaHub architecture" });
await openDocument({ id: "issue-view", explorer: "work", file: "task-and-room.png", title: "任务 · 协作现场人工介入" });
await openDocument({ id: "issue-validation", explorer: "work", file: "task-validation.png", title: "任务 · 验证未收敛" });
await openDocument({ id: "issue-permission", explorer: "work", file: "task-permission.png", title: "任务 · 权限确认" });
await openDocument({ id: "issue-running", explorer: "work", file: "task-running.png", title: "任务 · 正在执行" });
await openDocument({ id: "issue-research", explorer: "work", file: "task-research.png", title: "任务 · 阶段成果研究" });
await openDocument({ id: "room-view", explorer: "work", file: "room-research.png", title: "协作现场 · Research" });
await openDocument({ id: "issue-done", explorer: "work", file: "task-done.png", title: "任务 · 已完成" });
await openDocument({ id: "artifact-view", explorer: "outputs", file: "artifact-synthesis.png", title: "阶段成果 · synthesis_plan" });
await openDocument({ id: "artifact-research", explorer: "outputs", file: "artifact-research.png", title: "阶段成果 · research_findings" });
await openDocument({ id: "evidence-view", explorer: "outputs", file: "evidence-summary.png", title: "完成摘要 · Graph recovery" });
await openDocument({ id: "evidence-room", explorer: "outputs", file: "evidence-chain.png", title: "验证依据 · Room pause / resume" });
await openDocument({ id: "decision-view", explorer: "knowledge", file: "knowledge-decision.png", title: "Decision · Issue-first" });
await openDocument({ id: "memory-view", explorer: "knowledge", file: "knowledge-memory.png", title: "Memory · 人工介入" });
await openDocument({ id: "skill-view", explorer: "knowledge", file: "knowledge-skill.png", title: "Skill candidate · 前端原型验证" });

await openDocument({ id: "issue-view", explorer: "work", file: "task-and-room.tmp.png", title: "临时", kind: "temporary" });
fs.unlinkSync(path.join(shotsDir, "task-and-room.tmp.png"));
exports.pop();
await page.locator('[data-room-tab="overview"]').click();
await page.locator('[data-room-panel="overview"]').waitFor({ state: "visible" });
await capture("room-overview.png", "Room · 会话概览", "room-panel");
await page.locator('[data-room-tab="room"]').click();

for (const [surface, file, title] of [
  ["start", "surface-start.png", "开始中心"],
  ["setup", "surface-setup.png", "首次设置"],
  ["library", "surface-library.png", "能力库"],
  ["automation", "surface-automation.png", "自动化"],
  ["settings", "surface-settings.png", "设置"],
]) {
  await page.locator(`[data-surface="${surface}"]`).first().click();
  await page.locator(`[data-surface-view="${surface}"]`).waitFor({ state: "visible" });
  await capture(file, title, "top-level-surface");
}

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
