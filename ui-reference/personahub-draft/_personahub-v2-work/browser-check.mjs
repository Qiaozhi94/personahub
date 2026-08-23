import fs from "node:fs";
import { chromium } from "playwright";

const baseUrl = process.env.PERSONAHUB_V2_URL ?? "http://127.0.0.1:4178";
const browserCandidates = [
  process.env.PERSONAHUB_V2_BROWSER,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
].filter(Boolean);
const executablePath = browserCandidates.find((path) => fs.existsSync(path));
const browser = await chromium.launch({ headless: true, executablePath });
const page = await browser.newPage({ viewport: { width: 1728, height: 1000 } });
const failures = [];

for (const file of ["index.html", "code.html", "task.html", "artifact.html"]) {
  await page.goto(`${baseUrl}/${file}`, { waitUntil: "networkidle" });
  const explorer = page.locator("[data-project-explorer='true']");
  const preview = page.locator("[data-testid='content']");
  const room = page.locator("[data-right-sidebar-panel='true']");
  if (!(await explorer.isVisible())) failures.push(`${file}: 项目资源管理器不可见`);
  if (!(await preview.isVisible())) failures.push(`${file}: 主预览不可见`);
  if (!(await room.isVisible())) failures.push(`${file}: Room 不可见`);

  const previewWidth = await preview.evaluate((node) => node.getBoundingClientRect().width);
  const roomWidth = await room.evaluate((node) => node.getBoundingClientRect().width);
  if (Math.abs(previewWidth - roomWidth) > 2) failures.push(`${file}: 主预览与 Room 不等宽`);
}

await browser.close();
console.log(JSON.stringify({ failures }, null, 2));
if (failures.length) process.exitCode = 1;
