import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const root = dirname(fileURLToPath(import.meta.url));
const pages = ["index.html", "code.html", "task.html", "artifact.html"];
const failures = [];
const results = [];

const fail = (file, message) => failures.push(`${file}: ${message}`);

for (const file of pages) {
  const fullPath = resolve(root, file);
  if (!existsSync(fullPath)) {
    fail(file, "页面不存在");
    continue;
  }

  const doc = new JSDOM(readFileSync(fullPath, "utf8")).window.document;
  const explorer = doc.querySelector("[data-project-explorer='true']");
  const preview = doc.querySelector("[data-testid='content']");
  const room = doc.querySelector("[data-right-sidebar-panel='true']");

  if (!explorer) fail(file, "缺少项目资源管理器");
  if (!preview) fail(file, "缺少主预览");
  if (!room) fail(file, "缺少 Room 协作面");
  if (preview?.style.flex !== "1 1 0px") fail(file, "主预览不是 1fr");
  if (room?.style.flex !== "1 1 0px") fail(file, "Room 不是 1fr");
  if (!room?.textContent.includes("Room · 当前协作现场")) fail(file, "Room 未使用主会话结构");
  if (doc.querySelectorAll("[data-switch]").length !== 4) fail(file, "项目树标签不是 4 个");

  for (const element of doc.querySelectorAll("link[href], script[src]")) {
    const path = element.getAttribute("href") ?? element.getAttribute("src");
    if (!path || /^(https?:|data:|#)/.test(path)) continue;
    if (!existsSync(resolve(root, path))) fail(file, `静态资源不存在：${path}`);
  }

  for (const anchor of doc.querySelectorAll("a[href]")) {
    const href = anchor.getAttribute("href");
    if (!href || /^(https?:|mailto:|#)/.test(href)) continue;
    const localPath = href.split("#")[0].split("?")[0];
    if (localPath.endsWith(".html") && !existsSync(resolve(root, localPath))) {
      fail(file, `链接目标不存在：${href}`);
    }
  }

  results.push({
    file,
    explorerTabs: doc.querySelectorAll("[data-switch]").length,
    equalPanels: preview?.style.flex === room?.style.flex,
    roomButtons: room?.querySelectorAll("button").length ?? 0,
  });
}

for (const required of ["docs/design.md", "LICENSE.multica", "NOTICE.multica", "SOURCE-DRAFT-README.md"]) {
  if (!existsSync(resolve(root, required))) fail("project", `缺少 ${required}`);
}

console.log(JSON.stringify({ pages: results, failures }, null, 2));
if (failures.length) process.exitCode = 1;
