// 真实浏览器验收：1440×900 无横向滚动、无控制台错误、关键断言点可见
import { chromium } from "file:///d:/Projects/personahub/node_modules/@playwright/test/index.mjs";
import { readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";

const ASSERTS = {
  "workbench-running": ["当前任务资料", "本次变更", "run-dispatch.ts", "实现草稿"],
  "workbench-awaiting-assignment": ["实现变更集", "等待独立验证", "还不能作为完成结论"],
  "workbench-validation": ["独立验证报告", "不能验收", "测试通过不等于需求成立"],
  "workbench-blocked": ["待我处理 1", "允许推送 origin/main", "批准推送", "查看 3 个提交"],
  "workbench-interrupted": ["中断前产物", "验证未完成", "不能把中断前的局部输出"],
  "workbench-done": ["为什么这个结论成立", "结构化 command event", "实现与验证来自不同运行", "可信边界"],
  "workbench-empty": ["还没有任务", "新建任务"],
  issues: ["开始一件新工作", "先看要紧的", "等你指派下一步", "黄灯内部仍按"],
  setup: ["1 · 代码目录", "2 · AI 成员", "3 · 执行检查", "添加 AI 成员"],
  "create-task": ["建议这样做", "选它的原因", "确认并开始", "没被选上的"],
  agents: ["方案审阅员", "独立验证员", "思考强度", "同一个 CLI 可以配出多个成员"],
  "workbench-file": ["第 1 次尝试产出的版本", "当前任务资料", "目录", "本次变更", "dispatchRun"],
  "workbench-file-doc": ["F011 · Work Room 与人工介入", "当前任务资料", "目录", "本次变更", "验收"],
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
let failed = 0;

for (const file of readdirSync("./pages").filter((f) => f.endsWith(".html"))) {
  const name = file.replace(/\.html$/, "");
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(pathToFileURL(`./pages/${file}`).href);
  await page.waitForTimeout(250);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  const missing = [];
  for (const text of ASSERTS[name] || []) {
    if ((await page.getByText(text, { exact: false }).count()) === 0) missing.push(text);
  }
  // 只查左栏导航：这些是 multica 的导航项，正文里出现同名词（如「运行时配置」）不算残留
  const leftovers = await page.evaluate(() => {
    const nav = document.querySelector("div.fixed.inset-y-0");
    if (!nav) return [];
    const labels = [...nav.querySelectorAll("a,button")].map((e) => e.textContent.trim());
    return ["收件箱", "聊天", "我的 issue", "小队", "用量", "运行时", "Discord"].filter((t) =>
      labels.some((l) => l === t || l.startsWith(t)),
    );
  });
  const workspaceIssue = name.startsWith("workbench-") && name !== "workbench-empty";
  const workspaceProblems = workspaceIssue
    ? await page.evaluate(() => {
        const panel = document.querySelector('[data-right-sidebar-panel="true"]');
        const labels = [...document.querySelectorAll('[data-switch="inspector"]')].map((el) =>
          el.textContent.trim(),
        );
        const expected = ["文件", "产物", "审批", "记忆"];
        const missingModes = expected.filter((mode) => !labels.some((label) => label === mode || label.startsWith(mode + " ")));
        const legacyModes = ["概览", "代码", "执行图", "证据链"].filter((label) => labels.includes(label));
        const width = panel?.getBoundingClientRect().width ?? 0;
        return [
          ...(missingModes.length ? [`缺工作区模式: ${missingModes.join("/")}`] : []),
          ...(legacyModes.length ? [`残留旧模式: ${legacyModes.join("/")}`] : []),
          ...(width < 320 ? [`右框过窄: ${Math.round(width)}px`] : []),
        ];
      })
    : [];

  const ok = !overflow && missing.length === 0 && errors.length === 0 && leftovers.length === 0 && workspaceProblems.length === 0;
  if (!ok) failed++;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${name}` +
      (overflow ? " | 横向溢出" : "") +
      (missing.length ? ` | 缺断言点: ${missing.join(", ")}` : "") +
      (leftovers.length ? ` | 残留参考项目区块: ${leftovers.join(", ")}` : "") +
      (workspaceProblems.length ? ` | ${workspaceProblems.join(", ")}` : "") +
      (errors.length ? ` | 控制台错误 ${errors.length}` : ""),
  );
  await page.screenshot({ path: `shots/${name}.png`, fullPage: false });
}
await browser.close();
console.log(failed ? `\n${failed} 页未通过` : "\n全部通过");
process.exitCode = failed ? 1 : 0;
