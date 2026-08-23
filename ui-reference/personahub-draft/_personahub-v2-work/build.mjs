// PersonaHub V2 project-first workbench.
//
// Visual truth comes from the frozen PersonaHub draft pages, which in turn
// preserve Multica's rendered DOM and compiled CSS. This script only performs
// DOM surgery: it moves already-rendered sections, changes content, and changes
// the resizable panels' initial flex ratio. It does not recreate the style.

import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const SOURCE_ROOT = "../";
const BASE_DOC = `${SOURCE_ROOT}pages/workbench-file-doc.html`;
const BASE_CODE = `${SOURCE_ROOT}pages/workbench-file.html`;
const CHAT_RUNNING = `${SOURCE_ROOT}pages/workbench-running.html`;
const CHAT_WAITING = `${SOURCE_ROOT}pages/workbench-awaiting-assignment.html`;
const CHAT_DONE = `${SOURCE_ROOT}pages/workbench-done.html`;

const BTN =
  "group/button inline-flex shrink-0 items-center justify-center border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50";
const BTN_QUIET = `${BTN} hover:bg-muted hover:text-foreground h-7 px-2 rounded-md text-muted-foreground`;
const CARD =
  "rounded-lg border-[0.5px] border-border bg-card py-3 px-2.5 shadow-[0_3px_6px_-2px_rgba(0,0,0,0.02),0_1px_1px_0_rgba(0,0,0,0.04)]";

const dot = (tone) =>
  `<span class="inline-block size-1.5 shrink-0 rounded-full ${
    tone === "attention"
      ? "bg-warning"
      : tone === "done"
        ? "bg-success"
        : tone === "running"
          ? "bg-primary"
          : "bg-muted-foreground/40"
  }"></span>`;

const chip = (text, tone = "muted") =>
  `<span class="inline-flex items-center shrink-0 whitespace-nowrap rounded-md px-1.5 py-0.5 text-xs font-medium ${
    tone === "attention"
      ? "bg-warning/10 text-warning"
      : tone === "done"
        ? "bg-success/10 text-success"
        : tone === "running"
          ? "bg-primary/10 text-primary"
          : "bg-muted text-muted-foreground"
  }">${text}</span>`;

const fileRow = ({ depth = 0, name, href = "#", change = "", active = false }) => `
<a href="${href}" class="flex items-center gap-1 rounded-md py-1 hover:bg-muted/50 ${active ? "bg-muted/60" : ""}" style="padding-left:${8 + depth * 12}px">
  <span class="min-w-0 flex-1 truncate text-xs ${change ? "text-warning" : "text-foreground"}">${name}</span>
  <span class="w-3 shrink-0 text-xs ${change ? "text-warning" : "text-foreground"}">${change}</span>
</a>`;

const workRow = ({ tone, title, meta, href }) => `
<a href="${href}" class="flex items-start gap-2 rounded-md px-1 py-2 hover:bg-muted/50">
  <span class="mt-1.5">${dot(tone)}</span>
  <span class="min-w-0 flex-1">
    <span class="block truncate text-sm text-foreground">${title}</span>
    <span class="block truncate text-xs text-muted-foreground">${meta}</span>
  </span>
</a>`;

const projectExplorer = (active = "files") => {
  const tab = (id, label) =>
    `<button type="button" data-switch="v2-explorer" data-target="v2-${id}" class="${BTN} h-7 flex-1 rounded-md ${
      id === active
        ? "bg-background text-foreground shadow-sm"
        : "text-muted-foreground hover:text-foreground"
    }">${label}</button>`;
  const panel = (id, content) =>
    `<div data-panel="v2-explorer" id="v2-${id}"${id === active ? "" : " hidden"} class="px-3 py-3">${content}</div>`;

  const files = `
<div class="flex items-center gap-2 rounded-md border border-border px-2.5 py-2">
  <span class="min-w-0 flex-1"><span class="block truncate text-sm font-medium text-foreground">PersonaHub</span><span class="block truncate text-xs text-muted-foreground">D:\\Projects\\personahub · main</span></span>
  ${chip("可读写", "done")}
</div>
<div class="mt-3 rounded-md border border-border px-2 py-1.5 text-xs text-muted-foreground">搜索项目文件…</div>
<div class="mt-3">
  <div class="flex items-center gap-1 py-1 px-1 text-xs font-medium text-foreground"><span>⌄</span><span>docs/</span></div>
  ${fileRow({ depth: 1, name: "personahub-prd.md", href: "index.html", active: true })}
  <div class="flex items-center gap-1 py-1 pl-5 text-xs text-foreground"><span>⌄</span><span>features/0.3/</span></div>
  ${fileRow({ depth: 2, name: "F011-room/spec.md", href: "index.html", change: "~" })}
  ${fileRow({ depth: 1, name: "personahub-architecture.md", href: "index.html" })}
  <div class="flex items-center gap-1 py-1 px-1 text-xs font-medium text-foreground"><span>⌄</span><span>server/src/</span></div>
  ${fileRow({ depth: 1, name: "run-dispatch.ts", href: "code.html", change: "~" })}
  ${fileRow({ depth: 1, name: "workspace-lock.ts", href: "code.html" })}
  <div class="flex items-center gap-1 py-1 px-1 text-xs font-medium text-foreground"><span>›</span><span>web/src/</span></div>
</div>
<div class="mt-3 px-1 text-xs text-muted-foreground">文件在中间打开；当前 Room 在右侧保持不变。</div>`;

  const work = `
<div class="px-1 pb-1 text-xs font-medium text-muted-foreground">需要你处理</div>
${workRow({ tone: "attention", title: "Room 支持暂停、纠偏与改派", meta: "等待你指派 · 3 分钟前", href: "task.html" })}
${workRow({ tone: "attention", title: "修复 validation round 恢复", meta: "连续 2 次未解决 · 18 分钟前", href: "task.html" })}
<div class="px-1 pt-4 pb-1 text-xs font-medium text-muted-foreground">正在进行</div>
${workRow({ tone: "running", title: "Artifact contract research", meta: "Research Room · 2/3 步", href: "index.html" })}
${workRow({ tone: "running", title: "补齐 runtime health 诊断", meta: "Claude 正在执行 · 46 秒", href: "code.html" })}
<div class="px-1 pt-4 pb-1 text-xs font-medium text-muted-foreground">最近完成</div>
${workRow({ tone: "done", title: "Graph restart recovery", meta: "独立验证通过 · 1 小时前", href: "artifact.html" })}`;

  const outputs = `
<div class="px-1 pb-1 text-xs font-medium text-muted-foreground">当前任务成果</div>
${workRow({ tone: "running", title: "synthesis_plan · revision 3", meta: "已被 implementation 消费", href: "artifact.html" })}
${workRow({ tone: "done", title: "research_findings · revision 1", meta: "Research Room 产出", href: "artifact.html" })}
${workRow({ tone: "done", title: "Evidence Summary", meta: "独立验证通过 · 完整", href: "artifact.html" })}
<div class="mt-4 rounded-md bg-muted/50 px-2.5 py-2 text-xs text-muted-foreground">Artifact 有固定 revision；文件仍属于真实 Workspace。</div>`;

  const knowledge = `
<div class="px-1 pb-1 text-xs font-medium text-muted-foreground">项目知识</div>
${workRow({ tone: "muted", title: "坚持 Issue-first，不做 Canvas-first", meta: "Decision · 4 个反向链接", href: "index.html" })}
${workRow({ tone: "done", title: "自动回路必须提供介入点", meta: "Memory · 已确认", href: "task.html" })}
${workRow({ tone: "done", title: "Workspace 是权限边界", meta: "Memory · 已引用 6 次", href: "code.html" })}
<div class="px-1 pt-4 pb-1 text-xs font-medium text-muted-foreground">待沉淀</div>
${workRow({ tone: "attention", title: "前端原型验证流程", meta: "Skill candidate · 等待确认", href: "artifact.html" })}`;

  return `
<div class="flex h-full shrink-0 flex-col border-r bg-background" style="width:18rem" data-project-explorer="true">
  <div class="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
    <div class="min-w-0 flex-1"><div class="truncate text-sm font-medium text-foreground">PersonaHub</div><div class="truncate text-xs text-muted-foreground">项目浏览器</div></div>
    <button type="button" class="${BTN_QUIET}" title="本轮草案不模拟新建对象">＋</button>
  </div>
  <div class="mx-3 mt-3 flex gap-0.5 rounded-lg bg-muted p-0.5">${tab("files", "资源")}${tab("work", "工作")}${tab("outputs", "产出")}${tab("knowledge", "知识")}</div>
  <div class="min-h-0 flex-1 overflow-y-auto">${panel("files", files)}${panel("work", work)}${panel("outputs", outputs)}${panel("knowledge", knowledge)}</div>
</div>`;
};

function rewriteConversation(html, mode) {
  const replacements = [
    ["给 run-dispatch 加超时重试，超过 60s 的 CLI 调用要能自动重试一次", "把 F011 的 Room 人工介入收窄为单 Issue 阶段控制"],
    ["给 run-dispatch 加超时重试", "Room 人工介入"],
    ["server/src/services/run-dispatch.ts", "docs/features/0.3/F011/spec.md"],
    ["run-dispatch.ts +38 −4", "F011/spec.md +24 −8"],
    ["npm test -w @personahub/server", "核对 PRD 与 Feature 边界"],
    ["实现者", "方案审阅员"],
    ["Claude Code · claude-opus-5", "Claude Code · claude-opus-5"],
  ];
  let result = html;
  for (const [from, to] of replacements) result = result.replaceAll(from, to);
  if (mode === "done") result = result.replaceAll("超过 60s 的 CLI 调用会自动重试一次，重试带幂等键，次数上限 1。", "Room 的暂停、纠偏与改派边界已经完成，并通过独立验证。");
  return result;
}

function taskPreview() {
  return `
<div class="flex items-center gap-2 rounded-md bg-warning/10 px-3 py-2.5 text-sm text-warning">${dot("attention")}等待你指派下一步</div>
<div class="mt-3 ${CARD}">
  <div class="px-1 text-sm font-medium text-foreground">Room 支持暂停、纠偏与改派</div>
  <div class="mt-1 px-1 text-xs text-muted-foreground">Task · Coding · 当前阶段已完成</div>
  <div class="mt-3 space-y-2 px-1 text-sm text-muted-foreground">
    <div><span class="text-foreground">目标：</span>为复杂 Graph 提供用户可见、可控制的阶段现场，不引入第二套执行状态。</div>
    <div><span class="text-foreground">上一步：</span>方案审阅员已经收窄 F011 范围并更新 Feature spec。</div>
    <div><span class="text-foreground">下一步：</span>建议交给独立验证员检查 pause / resume 竞态和归档回放。</div>
  </div>
</div>
<div class="mt-3 ${CARD}">
  <div class="px-1 text-sm font-medium text-foreground">完成要求</div>
  <div class="mt-2 space-y-2 px-1 text-sm">
    <div class="flex items-center gap-2">${dot("done")}<span class="text-foreground">Room 与 Issue、Thread、Graph 同事务创建</span></div>
    <div class="flex items-center gap-2">${dot("done")}<span class="text-foreground">暂停只阻止尚未开始的节点</span></div>
    <div class="flex items-center gap-2">${dot("attention")}<span class="text-foreground">归档后可完整回放人工介入</span></div>
  </div>
</div>
<div class="mt-3 ${CARD}">
  <div class="flex items-center gap-2 px-1"><span class="min-w-0 flex-1 text-sm font-medium text-foreground">synthesis_plan · revision 3</span>${chip("固定版本", "done")}</div>
  <div class="mt-1 px-1 text-xs text-muted-foreground">来源：Research Room → Synthesis Run · 已传给下一位成员</div>
  <a href="artifact.html" class="mt-2 block px-1 text-xs text-primary underline">打开阶段成果</a>
</div>`;
}

function artifactPreview() {
  return `
<div class="flex items-center gap-2"><span class="flex size-9 items-center justify-center rounded-md bg-primary/10 text-sm font-semibold text-primary">A</span><div class="min-w-0 flex-1"><div class="truncate text-base font-semibold text-foreground">Artifact Contract Plan</div><div class="text-xs text-muted-foreground">synthesis_plan · revision 3 · SHA-256 已验证</div></div>${chip("已验证", "done")}</div>
<div class="mt-4 ${CARD}">
  <div class="px-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">来源与消费</div>
  <div class="mt-2 flex flex-wrap items-center gap-2 px-1 text-xs"><span class="text-primary">Research Room</span><span class="text-muted-foreground">→</span><span class="text-primary">Synthesis Run</span><span class="text-muted-foreground">→</span><span class="font-medium text-foreground">Artifact r3</span><span class="text-muted-foreground">→</span><span class="text-primary">Implementation</span></div>
</div>
<div class="mt-3 ${CARD}">
  <div class="px-1 text-sm font-medium text-foreground">核心结论</div>
  <div class="mt-2 space-y-2 px-1 text-sm text-muted-foreground"><p>Artifact 采用实体与不可变 revision 分离。</p><p>进入执行上下文的引用必须固定 revision；只带 artifact id 的引用只用于界面导航。</p><p>Evidence 与 Artifact 可以双向追溯。</p></div>
</div>
<div class="mt-3 ${CARD}">
  <div class="flex items-center gap-2 px-1"><span class="min-w-0 flex-1 text-sm text-foreground">独立验证</span>${chip("24 / 24 通过", "done")}</div>
  <div class="mt-2 px-1 text-xs text-muted-foreground">验证者与实现者不同源；没有 Workspace 越界写入。</div>
  <a href="code.html" class="mt-2 block px-1 text-xs text-primary underline">查看文件与原始依据</a>
</div>`;
}

function makePage({ output, base, chat, explorer, title, headerTitle, previewHtml, summary, mode = "running" }) {
  const doc = new JSDOM(readFileSync(base, "utf8")).window.document;
  const chatDoc = new JSDOM(readFileSync(chat, "utf8")).window.document;
  const center = doc.querySelector("div.relative.flex.h-full.min-w-0.flex-1.flex-col");
  const centerPanel = center.closest('[data-testid="content"]');
  const group = centerPanel.parentElement;
  const rightPanel = group.querySelector('[data-right-sidebar-panel="true"]');
  const rightContent = rightPanel.querySelector("div.h-full.overflow-x-hidden.border-l");
  const originalList = group.firstElementChild;
  const chatCenter = chatDoc.querySelector("div.relative.flex.h-full.min-w-0.flex-1.flex-col");

  originalList.outerHTML = projectExplorer(explorer);

  if (previewHtml) {
    const scroll = center.querySelector("div.min-h-0.flex-1.overflow-y-auto");
    if (scroll) scroll.innerHTML = previewHtml;
  }

  const centerTitle = center.querySelector("div.shrink-0.border-b.bg-background span.truncate.font-medium.text-foreground");
  if (centerTitle && headerTitle) centerTitle.textContent = headerTitle;
  const centerSummary = center.querySelector("div.shrink-0.border-b.bg-background > div.px-4.pb-2");
  if (centerSummary && summary) centerSummary.innerHTML = summary;

  const chatClone = chatCenter.cloneNode(true);
  chatClone.innerHTML = rewriteConversation(chatClone.innerHTML, mode);
  const chatHeader = chatClone.querySelector("div.shrink-0.border-b.bg-background");
  if (chatHeader) {
    chatHeader.insertAdjacentHTML(
      "afterbegin",
      `<div class="px-4 pt-2 text-xs text-muted-foreground">Room · 当前协作现场</div>`,
    );
  }
  rightContent.innerHTML = "";
  rightContent.appendChild(chatClone);
  rightContent.classList.remove("overflow-y-auto");
  rightContent.classList.add("overflow-hidden");

  centerPanel.style.flex = "1 1 0px";
  rightPanel.style.flex = "1 1 0px";
  centerPanel.style.minWidth = "0px";
  rightPanel.style.minWidth = "0px";

  doc.querySelectorAll('link[href^="../assets/"]').forEach((link) => {
    link.setAttribute("href", link.getAttribute("href").replace("../assets/", "assets/"));
  });
  doc.querySelectorAll('script[src^="../assets/"]').forEach((script) => {
    script.setAttribute("src", script.getAttribute("src").replace("../assets/", "assets/"));
  });
  doc.querySelectorAll("a").forEach((link) => {
    const href = link.getAttribute("href");
    if (!href) return;
    const map = {
      "workbench-file-doc.html": "index.html",
      "workbench-file.html": "code.html",
      "workbench-awaiting-assignment.html": "task.html",
      "workbench-running.html": "index.html",
      "workbench-done.html": "artifact.html",
      "issues.html": "task.html",
      "agents.html": "task.html",
      "create-task.html": "task.html",
    };
    if (map[href]) link.setAttribute("href", map[href]);
  });
  doc.title = `PersonaHub V2 · ${title}`;
  doc.body.insertAdjacentHTML(
    "beforeend",
    `<div class="fixed bottom-2 right-3 z-50 rounded-md bg-foreground px-2 py-1 text-xs text-background opacity-70">Visual reference based on Multica UI · internal concept</div>`,
  );
  writeFileSync(output, `<!doctype html>${doc.documentElement.outerHTML}`, "utf8");
}

makePage({
  output: "index.html",
  base: BASE_DOC,
  chat: CHAT_RUNNING,
  explorer: "files",
  title: "项目工作台 · 文档",
  headerTitle: "docs/features/0.3/F011/spec.md",
  summary: "项目文件 · Markdown 渲染 · 本次变化已着色",
});

makePage({
  output: "code.html",
  base: BASE_CODE,
  chat: CHAT_RUNNING,
  explorer: "files",
  title: "项目工作台 · 代码",
  headerTitle: "server/src/services/run-dispatch.ts",
  summary: "项目文件 · 当前 Attempt 的固定版本",
});

makePage({
  output: "task.html",
  base: BASE_DOC,
  chat: CHAT_WAITING,
  explorer: "work",
  title: "项目工作台 · Task",
  headerTitle: "Room 支持暂停、纠偏与改派",
  summary: "等待你指派 · 上一步产出和完成要求",
  previewHtml: taskPreview(),
  mode: "waiting",
});

makePage({
  output: "artifact.html",
  base: BASE_DOC,
  chat: CHAT_DONE,
  explorer: "outputs",
  title: "项目工作台 · Artifact",
  headerTitle: "Artifact Contract Plan · revision 3",
  summary: "阶段成果 · 来源、消费和验证可追溯",
  previewHtml: artifactPreview(),
  mode: "done",
});

copyFileSync("../README.md", "SOURCE-DRAFT-README.md");
console.log("written index.html, code.html, task.html, artifact.html");
