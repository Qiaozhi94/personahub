import fs from "node:fs";
import { chromium } from "playwright";

const baseUrl = process.env.PERSONAHUB_V2_URL ?? new URL("./index.html", import.meta.url).href;
const browserCandidates = [
  process.env.PERSONAHUB_V2_BROWSER,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
].filter(Boolean);
const executablePath = browserCandidates.find((path) => fs.existsSync(path));
const browser = await chromium.launch({ headless: true, executablePath });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const consoleErrors = [];

page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => consoleErrors.push(error.message));

await page.goto(baseUrl, { waitUntil: "networkidle" });
await page.screenshot({ path: "shots/workbench.png", fullPage: true });

const checks = [];
async function check(name, action) {
  await action();
  checks.push(name);
}

await check("默认进入项目工作台并显示三列", async () => {
  await page.locator('[data-surface-view="project"]').waitFor({ state: "visible" });
  await page.locator(".project-explorer").waitFor({ state: "visible" });
  await page.locator(".editor-area").waitFor({ state: "visible" });
  await page.locator("[data-room-dock]").waitFor({ state: "visible" });
  const previewBox = await page.locator(".editor-area").boundingBox();
  const roomBox = await page.locator("[data-room-dock]").boundingBox();
  if (!previewBox || !roomBox || Math.abs(previewBox.width - roomBox.width) > 2) {
    throw new Error("主预览与 Room 未保持等宽");
  }
  if (roomBox.x >= 1440 || roomBox.y >= 900) {
    throw new Error("Room 不在首屏工作区内");
  }
  if ((await page.locator(".global-scope-button").count()) !== 2) {
    throw new Error("全局工作区与项目选择器缺失");
  }
  if ((await page.locator('.explorer-mode-tabs button').first().innerText()).trim() !== "会话") {
    throw new Error("会话未放在左侧第一项");
  }
  if (!(await page.locator('[data-explorer-panel="work"]').isVisible())) {
    throw new Error("会话管理未作为默认左侧视图");
  }
  if (await page.getByText("Workspace 可执行", { exact: true }).count()) {
    throw new Error("仍显示重复的 Workspace 可执行卡片");
  }
  const explorerTabsBox = await page.locator(".explorer-mode-tabs").boundingBox();
  const roomTabsBox = await page.locator(".room-tabs").boundingBox();
  if (!explorerTabsBox || !roomTabsBox || Math.abs(explorerTabsBox.y - roomTabsBox.y) > 1) {
    throw new Error("左右 Tab 未保持水平对齐");
  }
  const selfMessage = await page.locator(".room-user-message > div").boundingBox();
  const agentMessage = await page.locator(".agent-message > div").first().boundingBox();
  if (!selfMessage || !agentMessage || selfMessage.x <= agentMessage.x) {
    throw new Error("本人消息未靠右显示");
  }
  if (!(await page.locator(".room-composer [data-room-pause]").isVisible())) {
    throw new Error("暂停按钮未放入输入框");
  }
  if (!(await page.locator(".fixed-handoff").isVisible())) {
    throw new Error("等待指派卡未固定在输入框上方");
  }
});

await check("会话管理支持创建入口、管理菜单与打开会话", async () => {
  await page.locator('[data-new-object]').click();
  await page.locator('[data-toast]').filter({ hasText: "新建会话" }).waitFor({ state: "visible" });
  await page.locator('[data-explorer-panel="work"] [data-session-menu-toggle]').first().click();
  await page.locator('[data-explorer-panel="work"] .session-menu').first().waitFor({ state: "visible" });
  await page.locator('[data-explorer-panel="work"] .session-menu button').first().click();
  await page.locator('[data-toast]').filter({ hasText: "重命名会话" }).waitFor({ state: "visible" });
  await page.locator('[data-explorer-panel="work"] [data-open="issue-view"]').click();
  await page.locator('[data-document="issue-view"] h1').filter({ hasText: "Room 支持暂停、纠偏与改派" }).waitFor();
});

await check("Room 可暂停和恢复", async () => {
  await page.locator("[data-room-pause]").click();
  await page.locator("[data-room-state]").filter({ hasText: "PAUSED" }).waitFor();
  await page.locator("[data-room-pause]").click();
  await page.locator("[data-room-state]").filter({ hasText: "ACTIVE" }).waitFor();
});

await check("Room 可发送静态演示指令", async () => {
  await page.locator("[data-room-input]").fill("@独立验证员\n检查归档回放。 ");
  await page.locator("[data-room-form] .send-button").click();
  await page.locator(".user-message").filter({ hasText: "检查归档回放" }).waitFor();
});

await check("Room 概览按会话、Agent、计划排列", async () => {
  await page.locator('[data-room-tab="overview"]').click();
  await page.locator('[data-room-panel="overview"] .session-card').waitFor({ state: "visible" });
  await page.locator('[data-room-panel="overview"] .agent-status-row').first().waitFor({ state: "visible" });
  const agentCount = await page.locator('[data-room-panel="overview"] .agent-status-row').count();
  if (agentCount !== 4) throw new Error(`Agent 状态数量错误：${agentCount}`);
  await page.locator('[data-room-panel="overview"] .message-stats-grid').filter({ hasText: "28" }).waitFor();
  const planCount = await page.locator('[data-room-panel="overview"] .detailed-plan li').count();
  if (planCount !== 3) throw new Error(`详细执行计划步骤错误：${planCount}`);
  if (await page.getByText("当前模式：", { exact: false }).count()) throw new Error("仍显示当前模式文字");
  await page.screenshot({ path: "shots/room-overview.png", fullPage: true });
  await page.locator('[data-room-tab="conversation"]').click();
});

await check("Markdown 与代码可跳转修改位置", async () => {
  await page.locator('[data-explorer-tab="resources"]').click();
  await page.locator('[data-explorer-panel="resources"] [data-open="file-prd"]').click();
  await page.locator('[data-document="file-prd"] [data-change-next]').click();
  await page.locator('[data-document="file-prd"] [data-change-status]').filter({ hasText: "1 / 3" }).waitFor();
  await page.locator('[data-explorer-panel="resources"] [data-open="file-code"]').first().click();
  await page.locator('[data-document="file-code"] [data-change-next]').click();
  await page.locator('[data-document="file-code"] [data-change-location].change-focus').waitFor();
  await page.screenshot({ path: "shots/change-locations.png", fullPage: true });
});

await check("Artifact 与 Evidence 可从产出树打开", async () => {
  await page.locator('[data-explorer-tab="outputs"]').click();
  await page.locator('[data-explorer-panel="outputs"] [data-open="artifact-view"]').click();
  await page.locator('[data-document="artifact-view"] h1').filter({ hasText: "Artifact Contract Plan" }).waitFor();
  await page.locator('[data-explorer-panel="outputs"] [data-open="evidence-view"]').click();
  await page.locator('[data-document="evidence-view"] h1').filter({ hasText: "Graph restart recovery" }).waitFor();
});

await check("证据不足可下钻并预填验证指令", async () => {
  await page.locator('[data-explorer-panel="outputs"] [data-open="evidence-room"]').click();
  await page.locator('[data-document="evidence-room"] .trust-status.pending').waitFor({ state: "visible" });
  await page.screenshot({ path: "shots/evidence-chain.png", fullPage: true });
  await page.locator('[data-document="evidence-room"] [data-prefill-evidence]').first().click();
  await page.locator('[data-room-panel="conversation"].active').waitFor({ state: "visible" });
  const prefilled = await page.locator('[data-room-input]').inputValue();
  if (!prefilled.includes("@独立验证员") || !prefilled.includes("原始输出")) throw new Error("补充验证指令未正确预填");
});

await check("底部执行面板可展开", async () => {
  await page.locator('[data-document="evidence-room"] .evidence-row[data-bottom-open]').click();
  await page.locator("[data-bottom-panel]").waitFor({ state: "visible" });
  await page.locator('[data-bottom-panel] [data-bottom-toggle]').click();
});

await check("五个一级工作面可达", async () => {
  for (const surface of ["start", "library", "automation", "settings", "project"]) {
    await page.locator(`.activity-rail [data-surface="${surface}"]`).click();
    await page.locator(`[data-surface-view="${surface}"]`).waitFor({ state: "visible" });
  }
  await page.locator('[data-surface="start"]').click();
  await page.locator(".global-scope-button.project-scope").waitFor({ state: "visible" });
  await page.locator('.activity-rail [data-surface="project"]').click();
});

await check("命令面板可打开和关闭", async () => {
  await page.locator("[data-command-open]").click();
  await page.locator("[data-command-overlay]").waitFor({ state: "visible" });
  await page.keyboard.press("Escape");
  await page.locator("[data-command-overlay]").waitFor({ state: "hidden" });
});

await page.screenshot({ path: "shots/task-and-room.png", fullPage: true });
await browser.close();

const result = {
  checks,
  consoleErrors,
  screenshots: ["shots/workbench.png", "shots/room-overview.png", "shots/change-locations.png", "shots/evidence-chain.png", "shots/task-and-room.png"],
};

fs.writeFileSync("shots/browser-check.json", `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));

if (consoleErrors.length) process.exitCode = 1;
