// PersonaHub 目标形态拼装草案 — M4-T04
//
// 方法：以 multica 冻结页 issue-detail.html 为骨架真值，做 DOM 手术（删区块、换文案、
// 换中栏与右栏内容），**不重写 CSS、不重建 token**。所有类名必须已存在于 multica 编译后
// 的 CSS 里（`node check-classes.mjs` 验收）。
//
// 行为依据：docs/personahub-user-journeys.md（旅程）
// 选型依据：docs/reviews/page-sourcing.md（三栏定位 + 骨架来源）

import { readFileSync, writeFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const BASE = "../multica/pages/issue-detail.html";
const OUT = "./pages";

// ---------- multica 真值类名（从冻结页原样取出，不自造） ----------
const BTN =
  "group/button inline-flex shrink-0 items-center justify-center border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50";
const BTN_PRIMARY = `${BTN} bg-primary text-primary-foreground hover:bg-primary/90 h-8 px-3 rounded-md`;
const BTN_SECOND = `${BTN} border-border bg-background hover:bg-muted h-8 px-3 rounded-md`;
const BTN_QUIET = `${BTN} hover:bg-muted hover:text-foreground h-7 px-2 rounded-md text-muted-foreground`;
const CARD =
  "rounded-lg border-[0.5px] border-border bg-card py-3 px-2.5 shadow-[0_3px_6px_-2px_rgba(0,0,0,0.02),0_1px_1px_0_rgba(0,0,0,0.04)]";

// ---------- 小组件 ----------
const chip = (text, tone = "muted") => {
  const tones = {
    muted: "bg-muted text-muted-foreground",
    running: "bg-primary/10 text-primary",
    attention: "bg-warning/10 text-warning",
    danger: "bg-destructive/10 text-destructive",
    done: "bg-success/10 text-success",
  };
  return `<span class="inline-flex items-center shrink-0 whitespace-nowrap rounded-md px-1.5 py-0.5 text-xs font-medium ${tones[tone]}">${text}</span>`;
};

const dot = (tone = "muted") => {
  const tones = {
    muted: "bg-muted-foreground/40",
    running: "bg-primary",
    attention: "bg-warning",
    danger: "bg-destructive",
    done: "bg-success",
  };
  return `<span class="inline-block size-1.5 shrink-0 rounded-full ${tones[tone]}"></span>`;
};

// 事件行：形态借 dsh 的工具行（图标位 + 主文本 + 右侧耗时），视觉走 multica
const eventRow = ({ tone = "muted", who, what, meta = "", detail = "" }) => `
<div class="flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50">
  <span class="mt-1.5">${dot(tone)}</span>
  <div class="min-w-0 flex-1">
    <div class="flex items-baseline gap-2">
      <span class="text-sm font-medium text-foreground">${who}</span>
      <span class="min-w-0 flex-1 truncate text-sm text-muted-foreground">${what}</span>
      <span class="shrink-0 text-xs text-muted-foreground">${meta}</span>
    </div>
    ${detail ? `<div class="mt-1 text-xs text-muted-foreground">${detail}</div>` : ""}
  </div>
</div>`;

const userMsg = (text) => `
<div class="flex justify-end px-2 py-1.5">
  <div class="max-w-[80%] rounded-lg bg-muted px-3 py-2 text-sm text-foreground">${text}</div>
</div>`;

const sectionLabel = (text) =>
  `<div class="px-2 pt-4 pb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">${text}</div>`;

// ---------- 右栏：本任务的对象库 ----------
// 不重复中栏的状态和会话，也不把内部架构做成导航。这里管理人会真的打开的对象：
// 文件、任务产物、审批事件，以及本次任务引用/沉淀的记忆。证据附着在产物详情上。
const rowKV = (k, v) => `
<div class="flex items-start gap-2 px-1 py-1.5 text-sm">
  <span class="w-20 shrink-0 text-muted-foreground">${k}</span>
  <span class="min-w-0 flex-1 text-foreground">${v}</span>
</div>`;

const inspector = ({ tabs = {}, active = "files", context = "Run #1 · Attempt #1", approvalCount = 0, collapsible = false }) => {
  const legacyMap = { code: "files", execution: "files", graph: "artifacts", overview: "artifacts", evidence: "artifacts" };
  const current = legacyMap[active] ?? active;
  const modes = {
    files: tabs.files ?? tabs.code ?? filesPanel(),
    artifacts: tabs.artifacts ?? artifactsPanel(),
    approvals: tabs.approvals ?? approvalPanel(),
    memory: tabs.memory ?? memoryPanel(),
  };
  const tabBtn = (id, label) =>
    `<button type="button" data-switch="inspector" data-target="ins-${id}" class="${BTN} h-7 flex-1 rounded-md ${
      id === current
        ? "bg-background text-foreground shadow-sm"
        : "text-muted-foreground hover:text-foreground"
    }">${label}</button>`;
  const panel = (id) =>
    `<div data-panel="inspector" id="ins-${id}"${id === current ? "" : " hidden"} class="px-3 py-3">${modes[id] ?? ""}</div>`;
  return `
<div class="flex h-full flex-col">
  <div class="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
    <div class="min-w-0 flex-1">
      <div class="truncate text-sm font-medium text-foreground">personahub / main</div>
      <div class="truncate text-xs text-muted-foreground">当前任务资料</div>
    </div>
    ${chip(context, "muted")}
  </div>
  <div class="flex items-center gap-2 mx-3 mt-3">
    <div class="flex flex-1 gap-0.5 rounded-lg bg-muted p-0.5">
      ${tabBtn("files", "文件")}${tabBtn("artifacts", "产物")}${tabBtn("approvals", `审批${approvalCount ? ` ${approvalCount}` : ""}`)}${tabBtn("memory", "记忆")}
    </div>
    ${collapsible ? `<button type="button" data-collapse-inspector class="${BTN_QUIET}" title="收起">›</button>` : ""}
  </div>
  <div class="min-h-0 flex-1 overflow-y-auto">${panel("files")}${panel("artifacts")}${panel("approvals")}${panel("memory")}</div>
</div>`;
};

const blockerPinned = (title, body) => `
<div class="border-b border-border bg-warning/10 px-3 py-2.5">
  <div class="flex items-center gap-1.5 text-sm font-medium text-warning">${dot("attention")}${title}</div>
  <div class="mt-1 text-xs text-warning">${body}</div>
</div>`;




// ---------- 会话式现场：结构照 clowder MessageBubble ----------
//   [头像] [ 头部：名字 + 时间
//            气泡：px-4 py-3 rounded-2xl（内容 + 工具调用折叠）
//            页脚：模型 · provider · ↑输入 ↓输出 tokens ]
// 用户与 AI 成员**用完全相同的结构**——用户是最终决策者，不是靠右对齐的旁观者。
const avatarBox = (name, tone = "muted") => {
  const tones = {
    muted: "bg-muted text-muted-foreground",
    running: "bg-primary/10 text-primary",
    done: "bg-success/10 text-success",
    attention: "bg-warning/10 text-warning",
    danger: "bg-destructive/10 text-destructive",
    user: "bg-foreground text-background",
  };
  return `<span class="flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-medium ${tones[tone] ?? tones.muted}">${name.slice(0, 1)}</span>`;
};

const toolBlock = (rows) => `
<details class="mt-2 rounded-md border border-border px-2 py-1.5">
  <summary class="cursor-pointer text-xs text-muted-foreground">执行了 ${rows.length} 步 · 展开看命令与耗时</summary>
  <div class="mt-1.5">${rows.map((r) => eventRow(r)).join("")}</div>
</details>`;

// 一条消息 = 头像 + 头部 + 气泡 + 页脚。用户与成员唯一的差别是页脚（用户没有模型与 token）。
const msg = ({ who, tone = "muted", time, text, tools = [], model = "", tokens = "" }) => `
<div class="flex items-start gap-2 mb-4">
  ${avatarBox(who, tone)}
  <div class="min-w-0 max-w-[80%]">
    <div class="flex items-baseline gap-2">
      <span class="text-sm font-medium text-foreground">${who}</span>
      <span class="text-xs text-muted-foreground">${time}</span>
    </div>
    <div class="mt-1 rounded-2xl bg-muted px-4 py-3 text-sm text-foreground">
      ${text}
      ${tools.length ? toolBlock(tools) : ""}
    </div>
    ${
      model
        ? `<div class="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
      <span>${model}</span>${tokens ? `<span>·</span><span class="tabular-nums">${tokens}</span>` : ""}
    </div>`
        : ""
    }
  </div>
</div>`;

const msgSystem = (text) => `
<div class="px-2 py-1.5 text-center text-xs text-muted-foreground">${text}</div>`;

// ---------- 文件视图：全文为主，变化着色（不做并排 diff）----------
// 用户 2026-08-15 判断：人要审的是「这份文档现在写成什么样」，逐行 diff 是给机器和
// validator agent 看的。因此中栏呈现全文，新增/修改的部分用底色标出即可。
const line = (text, change) => {
  const tone =
    change === "add" ? "bg-success/10" : change === "edit" ? "bg-warning/10" : "";
  return `<div class="whitespace-pre-wrap px-3 py-0.5 text-xs text-foreground ${tone}">${text}</div>`;
};

const docBlock = ({ tag = "p", text, change }) => {
  const tone = change === "add" ? "bg-success/10" : change === "edit" ? "bg-warning/10" : "";
  const cls =
    tag === "h1"
      ? "text-base font-semibold text-foreground"
      : tag === "h2"
        ? "mt-3 text-sm font-medium text-foreground"
        : "mt-1.5 text-sm text-muted-foreground";
  return `<div class="px-3 py-1 ${tone}"><div class="${cls}">${text}</div></div>`;
};

const fileHeader = ({ path, version, changed }) => `
<div class="flex items-center gap-2 border-b border-border px-1 pb-2">
  <span class="min-w-0 flex-1 truncate text-sm font-medium text-foreground">${path}</span>
  ${changed ? chip(changed, "done") : ""}
</div>
<div class="px-1 py-1.5 text-xs text-muted-foreground">${version} · <span class="text-success">绿色</span>为新增、<span class="text-warning">黄色</span>为改写，其余是原样内容</div>`;

// ---------- 右栏「文件」模式：项目目录树 + 变化标记 ----------
const treeRow = ({ depth, name, change, href }) => {
  const tone = change === "add" ? "text-success" : change === "edit" ? "text-warning" : "text-foreground";
  const mark = change === "add" ? "+" : change === "edit" ? "~" : "";
  const pad = 8 + depth * 12;
  const inner = `<span class="min-w-0 flex-1 truncate text-xs ${tone}">${name}</span><span class="w-3 shrink-0 text-xs ${tone}">${mark}</span>`;
  return href
    ? `<a href="${href}" class="flex items-center gap-1 rounded-md py-1 hover:bg-muted/50" style="padding-left:${pad}px">${inner}</a>`
    : `<div class="flex items-center gap-1 py-1" style="padding-left:${pad}px">${inner}</div>`;
};

// Evidence-grounded 不是“完成摘要再抄一遍”，而是要求到原始来源的可追溯关系。
const evidenceRow = ({ requirement, state = "todo", evidence = "尚无", verifiedBy = "—", note = "" }) => {
  const tone = state === "ok" ? "done" : state === "fail" ? "danger" : "muted";
  const label = state === "ok" ? "成立" : state === "fail" ? "不成立" : "待证";
  return `<div class="border-b border-border px-1 py-2.5">
  <div class="flex items-start gap-2"><span class="mt-1.5">${dot(tone)}</span><span class="min-w-0 flex-1 text-sm font-medium text-foreground">${requirement}</span>${chip(label, tone)}</div>
  <div class="ml-4 mt-1 grid gap-1 text-xs text-muted-foreground">
    <div><span class="text-foreground">证据</span> · ${evidence}</div>
    <div><span class="text-foreground">判定</span> · ${verifiedBy}</div>
    ${note ? `<div class="text-warning">${note}</div>` : ""}
  </div>
</div>`;
};

const evidenceChain = ({ rows = [], independence } = {}) => `
${sectionLabel("验收链")}
<div class="rounded-md border border-border px-2">
  ${rows.length ? rows.map(evidenceRow).join("") : '<div class="px-1 py-3 text-sm text-muted-foreground">尚未生成可验证的证据。</div>'}
</div>
${independence ? `<div class="mt-3 rounded-md ${independence.ok ? "bg-success/10" : "bg-warning/10"} px-2.5 py-2 text-xs ${independence.ok ? "text-success" : "text-warning"}">${independence.text}</div>` : ""}
${sectionLabel("版本锚点")}
${rowKV("输入", "Issue goal · revision 3")}
${rowKV("产出", "当前选择的 Run / Attempt")}
${rowKV("范围", "当前代码目录，只读")}`;

const evidenceFromLegacy = ({ criteria = [], conclusions = [], independence } = {}) => {
  const sourceFor = (requirement) => {
    if (requirement.includes("验证者") || requirement.includes("不同源")) return "Run #2 · Codex CLI ≠ Run #1 · Claude Code";
    const keyword = requirement.includes("测试") ? "测试" : requirement.includes("变更") ? "变更" : requirement.includes("并发") ? "并发" : requirement.includes("次数") ? "上限" : "";
    const match = conclusions.find((item) => keyword && item.text.includes(keyword));
    if (match?.text) return `<a href="workbench-file.html" class="underline">${match.text}</a>`;
    if (keyword === "测试") return '<a href="workbench-file.html" class="underline">test report · 当前 Attempt</a>';
    if (keyword === "变更") return '<a href="workbench-file.html" class="underline">change set · 2 files</a>';
    return "尚未绑定来源";
  };
  return evidenceChain({
    rows: criteria.map((item) => ({
      requirement: item.text,
      state: item.state === "ok" ? "ok" : item.state === "fail" ? "fail" : "todo",
      evidence: sourceFor(item.text),
      verifiedBy: item.text.includes("验证者") ? "运行来源校验" : item.state === "ok" ? "验证运行" : item.state === "fail" ? "最新 finding" : "等待独立验证",
      note: item.note ?? "",
    })),
    independence,
  });
};

// 兼容页面状态配置的旧字段名；渲染结果已经是新的「要求 → 证据 → 判定」结构。
const artifactTab = evidenceFromLegacy;

const CRITERIA_DONE = [
  { text: "测试通过", state: "ok" },
  { text: "变更文件可追溯", state: "ok" },
  { text: "验证者与实现者不同源", state: "ok" },
];

const TREE_CODE = [
  { depth: 0, name: "server/" },
  { depth: 1, name: "src/services/" },
  { depth: 2, name: "run-dispatch.ts", change: "edit", href: "workbench-file.html" },
  { depth: 2, name: "run-escalation-handler.ts", href: "workbench-file.html" },
  { depth: 1, name: "tests/unit/" },
  { depth: 2, name: "run-dispatch.test.ts", change: "add", href: "workbench-file.html" },
  { depth: 0, name: "docs/" },
  { depth: 1, name: "personahub-prd.md", href: "workbench-file-doc.html" },
  { depth: 1, name: "features/0.3/" },
  { depth: 2, name: "F011/spec.md", change: "edit", href: "workbench-file-doc.html" },
  { depth: 0, name: "web/" },
];

const filesPanel = ({ rows = TREE_CODE, files = "2 个文件 · +47 −4", active = "files", run = {} } = {}) => {
  const surfaceBtn = (id, label) => `<button type="button" data-switch="workspace" data-target="workspace-${id}" class="${BTN} h-7 flex-1 rounded-md ${id === active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}">${label}</button>`;
  const surface = (id, body) => `<div data-panel="workspace" id="workspace-${id}"${id === active ? "" : " hidden"} class="mt-2">${body}</div>`;
  return `
<div class="flex items-center gap-2 rounded-md border border-border bg-background px-2 py-2">
  ${dot(run.tone ?? "muted")}
  <div class="min-w-0 flex-1"><div class="truncate text-sm font-medium text-foreground">任务目录</div><div class="truncate text-xs text-muted-foreground">${run.context ?? "Run #1 · Attempt #1 · 固定版本"}</div></div>
  ${chip(run.state ?? "只读", run.tone ?? "muted")}
</div>
<div class="mt-2 rounded-md border border-border bg-background px-2 py-1.5">
  <input type="search" aria-label="搜索文件" placeholder="搜索文件…" class="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground" />
</div>
<div class="mt-3 flex gap-0.5 rounded-lg bg-muted p-0.5">${surfaceBtn("files", "目录")}${surfaceBtn("changes", "本次变更")}</div>
${surface("files", `<div class="-mx-1">${rows.map(treeRow).join("")}</div><div class="mt-2 px-1 text-xs text-muted-foreground">点文件在中栏打开本次 Attempt 的只读全文。</div>`)}
${surface("changes", `<div class="flex items-center justify-between px-1 py-1.5 text-sm"><span class="text-foreground">本次产出</span><span class="text-muted-foreground">${files}</span></div>
  <a href="workbench-file.html" class="flex items-center gap-2 rounded-md px-1 py-1.5 hover:bg-muted/50"><span class="min-w-0 flex-1 truncate text-sm text-foreground">run-dispatch.ts</span>${chip("已修改", "attention")}</a>
  <a href="workbench-file.html" class="flex items-center gap-2 rounded-md px-1 py-1.5 hover:bg-muted/50"><span class="min-w-0 flex-1 truncate text-sm text-foreground">run-dispatch.test.ts</span>${chip("新增", "done")}</a>
  <div class="mt-2 rounded-md bg-muted/50 px-2 py-2 text-xs text-muted-foreground">Git · ${run.commit ?? "未提交"} · 内容锚定到当前 Attempt</div>`)}
`;
};

// 兼容旧页面配置；实际界面已经移除「运行」子页。
const workspaceTab = (options = {}) => filesPanel({ ...options, active: options.active === "run" ? "changes" : options.active });

const proofRow = ({ title, meta, source, tone = "done", href = "workbench-file.html" }) => `
<a href="${href}" class="flex items-start gap-2 border-b border-border px-1 py-2.5 hover:bg-muted/40">
  <span class="mt-1.5">${dot(tone)}</span>
  <span class="min-w-0 flex-1"><span class="block text-sm font-medium text-foreground">${title}</span><span class="mt-0.5 block text-xs text-muted-foreground">${meta}</span><span class="mt-1 block text-xs text-primary">查看原始记录 · ${source}</span></span>
</a>`;

const artifactRow = ({ target = "artifact-detail", title, kind, meta, state, tone = "muted", active = false }) => `
<button type="button" data-switch="artifact" data-target="${target}" class="${BTN} w-full rounded-md px-2 py-2 text-left ${active ? "bg-muted" : "hover:bg-muted/50"}">
  <div class="flex items-start gap-2"><span class="mt-1.5">${dot(tone)}</span><span class="min-w-0 flex-1"><span class="block truncate text-sm font-medium text-foreground">${title}</span><span class="mt-0.5 block text-xs text-muted-foreground">${kind} · ${meta}</span></span>${chip(state, tone)}</div>
</button>`;

const artifactDetail = (kind = "done") => {
  const commonHead = `<button type="button" data-switch="artifact" data-target="artifact-list" class="${BTN_QUIET} mb-2">‹ 返回全部产物</button>`;
  if (kind === "awaiting") return `${commonHead}
    <div class="flex items-start gap-2"><div class="min-w-0 flex-1"><div class="text-sm font-medium text-foreground">实现变更集</div><div class="text-xs text-muted-foreground">Run #1 · Attempt #1 · 10:08</div></div>${chip("等待独立验证", "attention")}</div>
    <div class="mt-3 rounded-md border border-border px-2.5 py-2 text-sm text-foreground">2 个文件、24 项测试结果已记录；它们是实现者提交的产物，还不能作为完成结论。</div>
    ${sectionLabel("当前可确认")}${proofRow({ title: "变更内容已固定", meta: "2 个文件 · +47 −4 · file-change-set:run_01", source: "变更集", tone: "done" })}
    ${sectionLabel("仍然缺少")}<div class="rounded-md bg-warning/10 px-2.5 py-2 text-xs text-warning">尚无独立验证 Run，也没有验证者对需求语义作出判定。</div>`;
  if (kind === "failed") return `${commonHead}
    <div class="flex items-start gap-2"><div class="min-w-0 flex-1"><div class="text-sm font-medium text-foreground">独立验证报告</div><div class="text-xs text-muted-foreground">Run #2 · Attempt #2 · Codex CLI</div></div>${chip("不能验收", "danger")}</div>
    <div class="mt-3 rounded-md bg-destructive/10 px-2.5 py-2 text-sm text-destructive">测试 26/26 通过，但“并发重试最多 3 次”仍缺少竞争条件验证。测试通过不等于需求成立。</div>
    ${sectionLabel("发现")}${proofRow({ title: "并发路径没有可复现证据", meta: "Finding F-02 · 连续 2 次未满足", source: "validator event", tone: "danger" })}
    ${sectionLabel("已经证实")}${proofRow({ title: "现有测试全部通过", meta: "npm test -w @personahub/server · exit 0 · 26/26", source: "command event" })}
    <div class="mt-3 rounded-md border border-border px-2.5 py-2 text-xs text-muted-foreground">结论边界：只证明当前测试集通过，不证明高并发重试语义正确。</div>`;
  if (kind === "interrupted") return `${commonHead}
    <div class="flex items-start gap-2"><div class="min-w-0 flex-1"><div class="text-sm font-medium text-foreground">中断前产物</div><div class="text-xs text-muted-foreground">Run #1 · Attempt #1 · 已保留</div></div>${chip("验证未完成", "attention")}</div>
    <div class="mt-3 rounded-md border border-border px-2.5 py-2 text-sm text-foreground">实现文件与测试输出仍可查看；验证 Attempt 被中断，因此没有通过或失败结论。</div>
    ${sectionLabel("已保留")}${proofRow({ title: "目录安全，内容已固定", meta: "目录锁已释放 · 2 个文件", source: "file-change-set" })}
    ${sectionLabel("不能声称")}<div class="rounded-md bg-warning/10 px-2.5 py-2 text-xs text-warning">不能把中断前的局部输出当作验证通过；恢复后需创建新的验证 Attempt。</div>`;
  if (kind === "running") return `${commonHead}
    <div class="flex items-start gap-2"><div class="min-w-0 flex-1"><div class="text-sm font-medium text-foreground">实现草稿</div><div class="text-xs text-muted-foreground">Run #1 · Attempt #1 · 持续更新</div></div>${chip("生成中", "running")}</div>
    <div class="mt-3 rounded-md border border-border px-2.5 py-2 text-sm text-foreground">当前产物尚未封版。可先查看已写入的文件，不展示推测性的可信结论。</div>`;
  return `${commonHead}
    <div class="flex items-start gap-2"><div class="min-w-0 flex-1"><div class="text-sm font-medium text-foreground">最终交付说明</div><div class="text-xs text-muted-foreground">Run #2 · Attempt #1 · 10:26</div></div>${chip("已验证", "done")}</div>
    <div class="mt-3 rounded-md border border-border px-2.5 py-2 text-sm text-foreground">幂等重试已实现并通过独立复核；结论绑定到本次固定变更集。</div>
    ${sectionLabel("为什么这个结论成立")}
    <div class="rounded-md border border-border px-2">
      ${proofRow({ title: "真实命令成功", meta: "npm test -w @personahub/server · exit 0 · 26/26 · 18.4s", source: "结构化 command event" })}
      ${proofRow({ title: "实现与验证来自不同运行", meta: "实现 Claude Code / opus-5 · 验证 Codex / gpt-5-codex", source: "Run #1 ↔ Run #2" })}
      ${proofRow({ title: "验证者判定需求成立", meta: "validation_result: pass · findings: 0", source: "validation event" })}
      ${proofRow({ title: "证据没有缺口", meta: "命令、验证、文件、引用均完整 · policy sha256:7c1…", source: "evidence bundle" })}
    </div>
    ${sectionLabel("可信边界")}
    <div class="rounded-md bg-muted/60 px-2.5 py-2 text-xs text-muted-foreground">证明范围仅覆盖固定变更集及本地测试环境。远端推送没有执行，不声称生产环境已发布。</div>`;
};

const artifactsPanel = ({ kind = "done", active = "list" } = {}) => {
  const panel = (id, body) => `<div data-panel="artifact" id="artifact-${id}"${active === id ? "" : " hidden"}>${body}</div>`;
  const primary = kind === "failed"
    ? { title: "独立验证报告", type: "报告", state: "不能验收", tone: "danger" }
    : kind === "interrupted"
      ? { title: "中断前产物", type: "变更集", state: "未完成", tone: "attention" }
      : kind === "awaiting"
        ? { title: "实现变更集", type: "变更集", state: "待验证", tone: "attention" }
        : kind === "running"
          ? { title: "实现草稿", type: "变更集", state: "生成中", tone: "running" }
          : { title: "最终交付说明", type: "交付", state: "已验证", tone: "done" };
  return `${panel("list", `
    <div class="flex items-center gap-2 pb-2"><span class="min-w-0 flex-1 text-xs text-muted-foreground">本次任务生成 · 3</span><span class="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">全部</span><span class="rounded px-1.5 py-0.5 text-xs text-muted-foreground">报告</span></div>
    ${artifactRow({ title: primary.title, kind: primary.type, meta: "当前 Attempt", state: primary.state, tone: primary.tone })}
    ${artifactRow({ title: "文件变更集", kind: "文件", meta: "2 个文件 · +47 −4", state: "已固定", tone: "done" })}
    ${artifactRow({ title: "测试输出", kind: "记录", meta: "结构化命令事件", state: kind === "running" ? "更新中" : "可追溯", tone: kind === "running" ? "running" : "done" })}
    <div class="mt-3 rounded-md bg-muted/50 px-2 py-2 text-xs text-muted-foreground">产物按 Run / Attempt 固定；点开后查看来源、验证状态和结论边界。</div>`)}
    ${panel("detail", artifactDetail(kind))}`;
};

const approvalPanel = ({ pending = false } = {}) => {
  const tab = (id, label, on) => `<button type="button" data-switch="approval" data-target="approval-${id}" class="${BTN} h-7 flex-1 rounded-md ${on ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}">${label}</button>`;
  const panel = (id, body, on) => `<div data-panel="approval" id="approval-${id}"${on ? "" : " hidden"} class="mt-3">${body}</div>`;
  return `<div class="flex gap-0.5 rounded-lg bg-muted p-0.5">${tab("pending", `待我处理${pending ? " 1" : ""}`, true)}${tab("history", "历史", false)}</div>
  ${panel("pending", pending ? `
    <div data-panel="approval-decision" id="approval-request">
      <div class="rounded-md border border-warning/40 bg-warning/5 px-2.5 py-2.5"><div class="flex items-start gap-2"><span class="mt-1.5">${dot("attention")}</span><span class="min-w-0 flex-1"><span class="block text-sm font-medium text-foreground">允许推送 origin/main</span><span class="block text-xs text-muted-foreground">来自 Claude Code · 2 分钟前</span></span>${chip("高影响", "attention")}</div>
      <div class="mt-2 text-xs text-foreground">将把 3 个本地提交写入远端；凭据隔离策略要求你明确授权。</div>
      <div class="mt-2 rounded bg-muted/60 px-2 py-1.5 text-xs text-muted-foreground">依据：验证已通过 · 工作区干净 · 目标分支 main</div>
      <a href="workbench-file.html" class="mt-2 block text-xs text-primary">查看 3 个提交与固定变更集</a>
      <div class="mt-3 flex gap-2"><button type="button" data-switch="approval-decision" data-target="approval-approved" class="${BTN_PRIMARY} flex-1">批准推送</button><button type="button" data-switch="approval-decision" data-target="approval-rejected" class="${BTN_QUIET} flex-1">拒绝</button></div></div>
    </div>
    <div data-panel="approval-decision" id="approval-approved" hidden class="rounded-md bg-success/10 px-2.5 py-3 text-sm text-success">已批准；审批事件已写入历史，执行者可继续推送。</div>
    <div data-panel="approval-decision" id="approval-rejected" hidden class="rounded-md bg-muted px-2.5 py-3 text-sm text-foreground">已拒绝；远端未发生写入，原因会回传给执行者。</div>` : `<div class="rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">当前没有需要你处理的审批。</div>`, true)}
  ${panel("history", `<div class="rounded-md border border-border px-2.5 py-2"><div class="flex items-center gap-2"><span class="min-w-0 flex-1 text-sm text-foreground">允许执行本地测试</span>${chip("已批准", "done")}</div><div class="mt-1 text-xs text-muted-foreground">你 · 10:03 · approval_event:apr_41</div></div>`, false)}`;
};

const memoryPanel = () => {
  const tab = (id, label, on) => `<button type="button" data-switch="memory-scope" data-target="memory-${id}" class="${BTN} h-7 flex-1 rounded-md ${on ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}">${label}</button>`;
  return `<div class="flex gap-0.5 rounded-lg bg-muted p-0.5">${tab("used", "本次引用 2", true)}${tab("candidate", "待沉淀 1", false)}</div>
  <div data-panel="memory-scope" id="memory-used" class="mt-3 space-y-2">
    <div class="rounded-md border border-border px-2.5 py-2"><div class="flex items-center gap-2"><span class="min-w-0 flex-1 text-sm font-medium text-foreground">重复提交必须携带幂等键</span>${chip("已采用", "done")}</div><div class="mt-1 text-xs text-muted-foreground">来自 Issue #38 的验证结论 · 由 Run #1 引用</div><a href="workbench-file-doc.html" class="mt-2 block text-xs text-primary">跳到来源与原始上下文</a></div>
    <div class="rounded-md border border-border px-2.5 py-2"><div class="flex items-center gap-2"><span class="min-w-0 flex-1 text-sm font-medium text-foreground">外部写入必须经过人工审批</span>${chip("已采用", "done")}</div><div class="mt-1 text-xs text-muted-foreground">项目策略 · policy v3</div></div>
  </div>
  <div data-panel="memory-scope" id="memory-candidate" hidden class="mt-3"><div class="rounded-md border border-warning/40 px-2.5 py-2"><div class="flex items-center gap-2"><span class="min-w-0 flex-1 text-sm font-medium text-foreground">CLI 重试次数必须有明确上限</span>${chip("待确认", "attention")}</div><div class="mt-1 text-xs text-muted-foreground">候选经验 · 来源：本次验证 finding · 尚未进入长期记忆</div></div></div>`;
};

const graphNode = ({ key, title, state = "waiting", meta = "", edge = "" }) => {
  const tone = state === "done" ? "done" : state === "running" ? "running" : state === "failed" || state === "blocked" ? "danger" : state === "ready" ? "attention" : "muted";
  const label = state === "done" ? "完成" : state === "running" ? "运行中" : state === "failed" ? "未通过" : state === "blocked" ? "闸门" : state === "ready" ? "可执行" : "等待";
  return `${edge ? `<div class="ml-4 border-l border-border py-1 pl-4 text-xs text-muted-foreground">${edge}</div>` : ""}<div class="flex items-start gap-2 rounded-md border border-border bg-background px-2.5 py-2">
    <span class="mt-1.5">${dot(tone)}</span><div class="min-w-0 flex-1"><div class="flex items-center gap-2"><span class="rounded bg-muted px-1 py-0.5 font-mono text-xs text-muted-foreground">${key}</span><span class="min-w-0 flex-1 truncate text-sm font-medium text-foreground">${title}</span>${chip(label, tone)}</div>${meta ? `<div class="mt-1 text-xs text-muted-foreground">${meta}</div>` : ""}</div>
  </div>`;
};

const graphTab = ({ nodes = [], attempt = "Attempt #1", lock = "personahub / main", queue = "无等待节点" } = {}) => `
<div class="flex items-center gap-2 px-1 pb-2"><span class="min-w-0 flex-1 text-xs text-muted-foreground">Work Graph · ${attempt}</span>${chip("可恢复", "muted")}</div>
<div>${nodes.length ? nodes.map(graphNode).join("") : graphNode({ key: "N1", title: "等待任务开始", state: "waiting" })}</div>
${sectionLabel("调度约束")}
${rowKV("目录锁", lock)}
${rowKV("队列", queue)}
<div class="mt-2 px-1 text-xs text-muted-foreground">节点、边、尝试与锁来自运行时投影；不是消息时间线。</div>`;

const GRAPH_RUNNING = graphTab({
  nodes: [
    { key: "N1", title: "方案约束", state: "done", meta: "输出 → implementation brief" },
    { key: "N2", title: "实现与测试", state: "running", edge: "brief → input", meta: "Run #1 · Attempt #1 · 持有目录锁" },
    { key: "N3", title: "独立验证", state: "waiting", edge: "变更 + test report → 待满足" },
  ],
  queue: "N3 等待 N2 输出",
});
const GRAPH_AWAITING = graphTab({
  nodes: [
    { key: "N1", title: "方案约束", state: "done", meta: "brief 已冻结" },
    { key: "N2", title: "实现与测试", state: "done", edge: "brief → input", meta: "2 个文件 · 24 tests" },
    { key: "N3", title: "独立验证", state: "ready", edge: "人工指派门", meta: "输入已就绪 · 尚未创建 Run" },
  ],
  lock: "空闲 · 上次由 N2 释放",
  queue: "N3 可执行，等待人工指派",
});
const GRAPH_VALIDATION = graphTab({
  nodes: [
    { key: "N2", title: "实现与修复", state: "done", meta: "Attempt #2" },
    { key: "N3", title: "独立验证", state: "failed", edge: "changes@attempt-2 → evidence", meta: "同一 finding 连续 2 次未满足" },
    { key: "N4", title: "策略调整", state: "ready", edge: "failure → 人工路由门", meta: "可换成员或回到实现节点" },
  ],
  attempt: "Attempt #2",
  lock: "空闲 · 验证已释放",
  queue: "N4 等待人工选择路径",
});
const GRAPH_BLOCKED = graphTab({
  nodes: [
    { key: "N1", title: "实现", state: "done", meta: "3 commits" },
    { key: "N2", title: "独立验证", state: "done", edge: "changes → validation", meta: "26 tests · passed" },
    { key: "G1", title: "推送远端", state: "blocked", edge: "validation → escalation", meta: "凭据隔离 · 必须人工授权" },
  ],
  lock: "安全 · 无写入 Run",
  queue: "G1 停在不可逆操作闸门",
});
const GRAPH_INTERRUPTED = graphTab({
  nodes: [
    { key: "N1", title: "实现", state: "done", meta: "结果已保留" },
    { key: "N2", title: "修复", state: "done", edge: "finding → repair", meta: "结果已保留" },
    { key: "N3", title: "独立验证", state: "failed", edge: "attempt-1 → interrupted", meta: "无结论 · 可从本节点恢复" },
  ],
  lock: "已释放 · 目录安全",
  queue: "N3 可创建 Attempt #2",
});
const GRAPH_DONE = graphTab({
  nodes: [
    { key: "N1", title: "实现", state: "done", meta: "Run #1 · 变更已锚定" },
    { key: "N2", title: "独立验证", state: "done", edge: "changes + tests → verify", meta: "Run #2 · Codex CLI" },
    { key: "END", title: "交付闭环", state: "done", edge: "all requirements satisfied", meta: "Evidence bundle evd_91c…" },
  ],
  lock: "已释放",
  queue: "图已收敛",
});

// ---------- 页内交互：一个通用切换器，覆盖右栏 tab、中栏文件列表、Inspector 折叠 ----------
// 约定：可点元素带 data-switch="<组名>" data-target="<面板 id>"；
//       面板带 data-panel="<组名>"。同组内只显示一个面板，按钮的选中样式一并切换。
const SWITCHER_JS = `
<script>
document.addEventListener("click", (e) => {
  const trigger = e.target.closest("[data-switch]");
  if (trigger) {
    const group = trigger.dataset.switch;
    const target = trigger.dataset.target;
    document.querySelectorAll('[data-panel="' + group + '"]').forEach((panel) => {
      panel.hidden = panel.id !== target;
    });
    document.querySelectorAll('[data-switch="' + group + '"]').forEach((btn) => {
      const on = btn.dataset.target === target;
      btn.classList.toggle("bg-background", on);
      btn.classList.toggle("text-foreground", on);
      btn.classList.toggle("shadow-sm", on && ["inspector", "workspace", "execution"].includes(group));
      btn.classList.toggle("text-muted-foreground", !on);
      btn.classList.toggle("bg-muted", on && group.startsWith("files"));
    });
    e.preventDefault();
    return;
  }
  const toggle = e.target.closest("[data-toggle-inspector]");
  if (toggle) {
    document.getElementById("inspector-full").hidden = false;
    document.getElementById("inspector-strip").hidden = true;
    e.preventDefault();
  }
  const collapse = e.target.closest("[data-collapse-inspector]");
  if (collapse) {
    document.getElementById("inspector-full").hidden = true;
    document.getElementById("inspector-strip").hidden = false;
    e.preventDefault();
  }
});
<\/script>`;
// ---------- 第 2 栏：当前入口的列表（PRD §6）----------
// 规则：本栏内容 = 第 1 栏当前选中入口的列表；只做定位，不承载执行动作。
const listColumn = ({ title, action = "", items }) => `
<div class="flex h-full w-[264px] shrink-0 flex-col border-r border-border bg-background" style="width: 264px;">
  <div class="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
    <span class="min-w-0 flex-1 truncate text-sm font-medium text-foreground">${title}</span>
    ${action}
  </div>
  <div class="min-h-0 flex-1 overflow-y-auto px-2 py-2">${items}</div>
</div>`;

// 列表行：五项按旅程 §6.4.1（目标 / 状态 / 是否需要我 / 执行者 / 最后活动）
// 窄栏里状态与执行者折到第二行，五项信息一个不少。
// 四色灯（旅程 §6.4.1）：黄=该你动手、蓝=系统在跑、绿=完成、灰=还没轮到/已停下
// 列表层不显示细分状态词——用户扫列表只问「有没有我该动手的」
const listIssue = ({ goal, light, who, when, active = false, href = "workbench-running.html" }) => `
<a href="${href}" class="flex items-start gap-2 rounded-md px-2 py-2 ${active ? "bg-muted" : "hover:bg-muted/50"}">
  <span class="mt-1.5">${dot(light)}</span>
  <div class="min-w-0 flex-1">
    <span class="block text-sm ${active ? "font-medium text-foreground" : "text-foreground"}">${goal}</span>
    <div class="mt-0.5 flex items-center gap-1.5">
      <span class="min-w-0 flex-1 truncate text-xs text-muted-foreground">${who}</span>
      <span class="shrink-0 text-xs text-muted-foreground">${when}</span>
    </div>
  </div>
</a>`;

const ISSUES = [
  { goal: "推送前要人工确认，别让 agent 自己 push", light: "attention", who: "等你授权推送", when: "3 分钟前", href: "workbench-blocked.html" },
  { goal: "给 run-dispatch 加超时重试", light: "attention", who: "等你指派下一步", when: "12 分钟前", href: "workbench-awaiting-assignment.html" },
  { goal: "把 F011 的 Room 范围收窄到单 Issue 介入", light: "attention", who: "等你指派下一步", when: "20 分钟前", href: "workbench-file-doc.html" },
  { goal: "把 helpers.ts 拆成按职责分文件", light: "done", who: "独立验证员 · 已完成", when: "1 小时前", href: "workbench-done.html" },
  { goal: "补 api-client 的跨端契约测试", light: "running", who: "快速改手 · 进行中", when: "刚刚", href: "workbench-running.html" },
  { goal: "升级到 Node 24 并对齐锁定", light: "muted", who: "等代码目录空闲", when: "20 分钟前", href: "workbench-running.html" },
];

const issueListColumn = (activeGoal) =>
  listColumn({
    title: "任务",
    action: `<button type="button" class="${BTN_QUIET}" onclick="location.href='create-task.html'">+ 新建</button>`,
    items:
      ISSUES.map((i) => listIssue({ ...i, active: i.goal === activeGoal })).join("") +
      `<div class="px-2 pt-3 text-xs text-muted-foreground">
        <span class="text-warning">黄</span>=该你动手 · <span class="text-primary">蓝</span>=系统在跑 ·
        <span class="text-success">绿</span>=完成 · 灰=还没轮到<br />黄灯内部仍按「需处理 → 等指派 → 已中断」排序，只是不写在脸上。
      </div>`,
  });

// 成员是配置出来的：同一个 CLI 可以配出多个成员（不同模型、思考强度、能力项）
const MEMBERS = [
  { name: "方案审阅员", base: "Claude Code · claude-opus-5", effort: "高", caps: ["写方案", "检视文档", "读代码库"], avail: "可执行", tone: "done", note: "偏设计与评审：思考强度调高，不给它跑测试的活" },
  { name: "实现者", base: "Claude Code · claude-opus-5", effort: "中", caps: ["改代码", "跑测试"], avail: "可执行", tone: "done", note: "和上面同一个 CLI，但参数与能力项不同，因此是两个成员" },
  { name: "独立验证员", base: "Codex CLI · gpt-5-codex", effort: "高", caps: ["审代码", "跑测试", "找边界情况"], avail: "可执行", tone: "done", note: "与实现者不同 CLI —— 验证独立性靠它成立" },
  { name: "快速改手", base: "OpenCode · kimi-k2", effort: "低", caps: ["改代码"], avail: "此目录未登录", tone: "attention", note: "适合小改动；当前代码目录下 CLI 未登录" },
];

const agentListColumn = () =>
  listColumn({
    title: "AI 成员",
    action: `<button type="button" class="${BTN_QUIET}" title="本轮草案未覆盖：新建成员页">+ 新建</button>`,
    items:
      MEMBERS.map(
        (m) => `<a href="agents.html" class="flex flex-col gap-0.5 rounded-md px-2 py-2 hover:bg-muted/50">
  <div class="flex items-center gap-1.5">
    <span class="min-w-0 flex-1 truncate text-sm text-foreground">${m.name}</span>${chip(m.avail, m.tone)}
  </div>
  <span class="truncate text-xs text-muted-foreground">${m.base}</span>
</a>`,
      ).join("") +
      `<div class="px-2 pt-3 text-xs text-muted-foreground">成员由你创建：选 CLI 与模型、定思考强度、写清能力项。CLI 本身的安装与登录在设置里。</div>`,
  });

// ---------- 左栏改造 ----------
// PRD §10 左侧导航：工作区切换 + 项目 + 任务 + AI 成员（一级）+ 记忆/自动化/做法占位 + 设置
const NAV = [
  { match: "收件箱", action: "delete" },
  { match: "聊天", action: "delete" },
  { match: "我的 issue", action: "delete" },
  { match: "Issues", action: "rename", to: "任务", href: "issues.html" },
  { match: "项目", action: "rename", to: "项目", href: "#" },
  { match: "智能体", action: "rename", to: "AI 成员", href: "agents.html" },
  { match: "用量", action: "rename", to: "记忆", href: "#", placeholder: true },
  { match: "自动化", action: "rename", to: "自动化", href: "#", placeholder: true },
  { match: "Skills", action: "rename", to: "可复用做法", href: "#", placeholder: true },
  { match: "小队", action: "delete" },
  { match: "运行时", action: "delete" },
  { match: "设置", action: "rename", to: "设置", href: "#" },
];

function buildFrame(doc) {
  const d = doc;

  // 1) 左栏：项目切换器文案 + 导航裁剪
  const sidebar = d.querySelector("div.fixed.inset-y-0");
  const links = [...sidebar.querySelectorAll("a")];
  for (const a of links) {
    const t = (a.textContent || "").replace(/\s+/g, " ").trim();
    if (/Discord/.test(t)) {
      a.closest("div.flex.flex-col.gap-2.p-2")?.remove();
      continue;
    }
    const rule = NAV.find((n) => t === n.match);
    if (!rule) continue;
    if (rule.action === "delete") {
      (a.closest("li") || a).remove();
      continue;
    }
    const span = [...a.querySelectorAll("span")].find((s) => s.textContent.trim() === rule.match);
    if (span) span.textContent = rule.to;
    a.setAttribute("href", rule.href);
    if (rule.placeholder) {
      a.setAttribute("title", "占位入口：v0.4 之后按需引入");
      a.classList.add("opacity-50");
    } else if (rule.href === "#") {
      // 本轮草案没做这一页——置灰并说明，而不是留一个点了没反应的链接
      a.setAttribute("title", "本轮草案未覆盖此页");
      a.classList.add("opacity-50");
    }
  }
  // 组标签「工作区」——multica 的组织级维度，PersonaHub 没有这一层
  [...sidebar.querySelectorAll("div,span")]
    .filter((e) => e.children.length === 0 && e.textContent.trim() === "工作区")
    .forEach((e) => e.remove());

  // 项目切换器
  const projBtn = sidebar.querySelector("button[data-slot=dropdown-menu-trigger]");
  if (projBtn) {
    // 顶部是 Space（工作区）切换器，不是项目——一个 Space 下可有多个项目
    const label = [...projBtn.querySelectorAll("span")].find((s) => /test/i.test(s.textContent));
    if (label) label.textContent = "我的工作区";
    const avatar = [...projBtn.querySelectorAll("span")].find((s) => s.textContent.trim() === "T");
    if (avatar) avatar.textContent = "W";
    projBtn.setAttribute("title", "本轮草案未覆盖：项目切换下拉");
  }
  // 搜索：无对应旅程步骤，删
  [...sidebar.querySelectorAll("button")]
    .filter((b) => /搜索/.test(b.textContent))
    .forEach((b) => (b.closest("li") || b).remove());
  // 创建任务主入口（全局唯一）
  // 「新建任务」与第 2 栏列表头的「+ 新建」重复，左栏这个删掉（page-sourcing §4.3）
  [...sidebar.querySelectorAll("button")]
    .filter((b) => /新建 issue/.test(b.textContent))
    .forEach((b) => (b.closest("li") || b).remove());

  // 1b) 冻结页留下的 href="#" 占位 preload（字体/脚本）在 file:// 下会报 CORS/404，
  //     它们只是预加载提示，删掉不影响样式——真正的字体走 assets 里的 @font-face。
  d.querySelectorAll('link[rel="preload"][href="#"]').forEach((l) => l.remove());

  // 2) 删掉浮动聊天窗与启动按钮、通知区（无对应旅程步骤）
  d.querySelector("div.absolute.bottom-2.right-2.z-50.flex.flex-col")?.remove();
  d.querySelector("button.absolute.bottom-2.right-2.z-50")?.remove();
  d.querySelector("section[role=region]")?.remove();

  const center = d.querySelector("div.relative.flex.h-full.min-w-0.flex-1.flex-col");
  const right = d.querySelector("div.h-full.overflow-x-hidden.overflow-y-auto.border-l");
  // 第 2 栏插进 main 内的横向 flex row，作为第一个子元素
  const row = center.parentElement.parentElement.parentElement;
  return { center, right, row };
}

// 左栏顶部：工作区（Space）切换 + 当前项目及其代码目录（PRD §5 三层、§10 左侧导航）
const spaceHeader = `
<div class="px-2 pb-2">
  <div class="rounded-md border border-border px-2 py-1.5">
    <div class="text-xs text-muted-foreground">项目 · personahub</div>
    <div class="mt-0.5 truncate text-xs text-foreground">D:\\Projects\\personahub</div>
    <div class="mt-0.5 text-xs text-muted-foreground">分支 main · 可读写</div>
  </div>
</div>`;

// ---------- 中栏 ----------
// 中栏头部：标题 + 状态 +（可选）一行总结。**不做视图切换 tab**——
// 文件视图由右栏「产物」的目录树点进来，回来用返回链接（用户 2026-08-15）。
const centerHtml = ({ title, statusChip, summary = "", body, composer, back = "" }) => `
<div class="shrink-0 border-b bg-background">
  <div class="flex h-12 items-center gap-2 px-4 text-sm">
    ${back}
    <div class="flex min-w-0 flex-1 items-center gap-2">
      <span class="truncate font-medium text-foreground">${title}</span>
      ${statusChip}
    </div>
  </div>
  ${summary ? `<div class="px-4 pb-2 text-xs text-muted-foreground">${summary}</div>` : ""}
</div>
<div class="min-h-0 flex-1 overflow-y-auto px-3 py-2">${body}</div>
${composer}`;

// 输入框：结构与类名整块取自 multica 冻结页的 composer（浮动聊天窗那一处），
// 只把发送按钮换成图标、把 placeholder 换成 PersonaHub 文案。**不加解释性小字。**
const ICON_SEND =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-arrow-up h-4 w-4" aria-hidden="true"><path d="m5 12 7-7 7 7"></path><path d="M12 19V5"></path></svg>';
const ICON_PLUS =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-plus" aria-hidden="true"><path d="M5 12h14"></path><path d="M12 5v14"></path></svg>';

const composerHtml = ({ hint = "输入指令，或用 @ 指定成员…", prefill = "", href = "" }) => `
<div class="shrink-0 px-5 pb-3 pt-0">
  <div class="relative mx-auto flex min-h-16 max-h-40 w-full max-w-4xl flex-col rounded-lg bg-card pb-9 border-1 border-border transition-colors focus-within:border-brand">
    <div class="flex-1 min-h-0 overflow-y-auto px-3 py-2">
      <div class="text-sm ${prefill ? "text-foreground" : "text-muted-foreground"}">${prefill || hint}</div>
    </div>
    <div class="absolute bottom-1.5 left-1.5 flex items-center gap-1">
      <button type="button" aria-label="添加" title="本轮草案未覆盖：附件与引用" class="${BTN} hover:bg-muted hover:text-foreground size-7 rounded-full text-muted-foreground">${ICON_PLUS}</button>
    </div>
    <div class="absolute bottom-1.5 right-1.5 flex items-center gap-1">
      <button type="button" aria-label="发送" ${href ? `onclick="location.href='${href}'"` : 'title="本轮草案未覆盖：草案不模拟发送"'} class="${BTN} bg-primary text-primary-foreground hover:bg-primary/90 size-7 rounded-full">${ICON_SEND}</button>
    </div>
  </div>
</div>`;

// ---------- 各状态数据 ----------
const GOAL = "给 run-dispatch 加超时重试，超过 60s 的 CLI 调用要能自动重试一次";

// 「信息」tab：骨架取 clowder RightStatusPanel（soft rows，不堆白卡），
// 内容按 PRD §2 竞争力重排——完成要求与验证结论必须在这一屏可见（evidence-grounded）。
// 「信息」tab —— 组织方式照 clowder RightStatusPanel 的实测结构：
//   一行当前模式 → 每个参与者一张紧凑卡片（色点/名字/状态标签 · 序号+耗时 · 折叠 ID）
//   → 活跃与「历史参与 (N)」分组、历史默认折叠 → soft rows，全程不堆白卡。
const memberCard = ({ name, role = "", base, state, tone, elapsed, attempt, tokens = "", active = false }) => `
<div class="px-1 py-1.5">
  <div class="flex min-w-0 items-center gap-1.5">
    <span class="inline-block size-2 shrink-0 rounded-full ${
      { running: "bg-primary", done: "bg-success", attention: "bg-warning", danger: "bg-destructive", muted: "bg-muted-foreground/40" }[tone] ??
      "bg-muted-foreground/40"
    } ${active ? "animate-pulse" : ""}"></span>
    <span class="min-w-0 flex-1 truncate text-sm font-medium text-foreground">${name}</span>
    ${chip(state, tone)}
  </div>
  ${role ? `<div class="ml-4 mt-0.5 text-xs text-foreground">${role}</div>` : ""}
  <div class="ml-4 mt-0.5 text-xs text-muted-foreground">${base}</div>
  <div class="ml-4 mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
    <span class="rounded bg-muted px-1 py-0.5">${attempt}</span><span>${elapsed}</span>
  </div>
</div>`;

const historyGroup = (items) => items.length ? `
<details class="mt-1">
  <summary class="cursor-pointer px-1 py-1 text-xs text-muted-foreground">历史参与 (${items.length})</summary>
  ${items.map(memberCard).join("")}
</details>` : "";

// 完成要求逐条 + 当前满足：evidence-grounded 的落点，三个参考项目都没有
const criterion = ({ text, state, note }) => {
  const tone = state === "ok" ? "done" : state === "fail" ? "danger" : "muted";
  const label = state === "ok" ? "已满足" : state === "fail" ? "未满足" : "待验证";
  return `<div class="px-1 py-1">
  <div class="flex items-start gap-2">
    <span class="mt-1.5">${dot(tone)}</span>
    <span class="min-w-0 flex-1 text-sm text-foreground">${text}</span>
    <span class="shrink-0 text-xs text-muted-foreground">${label}</span>
  </div>
  ${note ? `<div class="ml-4 text-xs text-warning">${note}</div>` : ""}
</div>`;
};

const conclusion = ({ text, tone = "done", source = true }) => `
<div class="flex items-start gap-2 px-1 py-1">
  <span class="mt-1.5">${dot(tone)}</span>
  <span class="min-w-0 flex-1 text-sm text-foreground">${text}${source ? ' <a href="workbench-file.html" class="text-xs text-muted-foreground underline">来源</a>' : ""}</span>
</div>`;

// 本 tab 内容不随中栏内容变化：它是 Issue 级快照。
// **不显示「第 N 轮 / 共 M 轮」**——轮次上限是自动 loop 的保护装置，P0 完全手动指派下
// 用户自己就是保护装置；用户需要的是收敛信号（同一个问题重复几次），不是过程计数器。
// 「信息」tab = Issue 级快照，切换中栏内容时不变。
// 内容 = PRD §10 右侧 Inspector 明列的必须项 ∩ 「现在怎么样」，按 clowder 的 soft row 排布：
//   Issue 信息 / 当前状态 → 工作方式（Issue Type + Workflow Template）
//   → 本任务成员（执行者 / 验证者，含历史参与）→ 完成要求逐条 → 代码目录占用
// PRD 的 Evidence refs 与 Done evidence summary 归「产物」，Run logs 与审计归「诊断」。
// 概览只回答「现在怎么样」：任务状态、当前阶段、下一步和参与成员。
// 消息数 / token 数不对应用户决策，移到 P0 之外；运行细节统一进入「执行」。
const infoTab = ({ members, status = "运行中", stage = "第 1 步 · 实现", next = "等待当前步骤完成" }) => `
${sectionLabel("任务")}
${rowKV("目标", GOAL)}
${rowKV("状态", status)}
${rowKV("工作方式", "实现 → 独立验证")}
${sectionLabel("当前")}
${rowKV("阶段", stage)}
${rowKV("下一步", next)}
${rowKV("代码目录", "personahub · main")}
${sectionLabel("参与成员")}
${members.join("")}`;

const CRITERIA_BASE = [
  { text: "测试通过", state: "ok" },
  { text: "变更文件可追溯", state: "ok" },
  { text: "验证者与实现者不同源", state: "todo" },
];

const issueInfo = (status, stage) => `
${sectionLabel("任务")}
${rowKV("目标", GOAL)}
${rowKV("状态", status)}
${rowKV("工作方式", "实现 → 独立验证（建议路径）")}
${sectionLabel("当前")}
${rowKV("阶段", stage)}`;

const evidenceTab = ({ items, files, sameSource = false }) => `
${sectionLabel("验证证据")}
${items.map((i) => `<div class="flex items-start gap-2 px-1 py-1.5 text-sm"><span class="mt-1.5">${dot(i.tone)}</span><span class="min-w-0 flex-1"><span class="text-foreground">${i.text}</span><a href="workbench-file.html" class="ml-1 text-xs text-muted-foreground underline">来源</a></span></div>`).join("")}
${sectionLabel("文件变化")}
${files.map((f) => `<div class="px-1 py-1 text-xs text-muted-foreground"><span class="text-foreground">${f.path}</span> ${f.stat}</div>`).join("")}
${
  sameSource
    ? `<div class="mt-3 rounded-md bg-warning/10 px-2.5 py-2 text-xs text-warning">同源验证：实现与验证由同一 CLI + 模型完成，独立性较低。<a href="#" class="underline">用另一成员复验</a></div>`
    : `<div class="mt-3 rounded-md bg-success/10 px-2.5 py-2 text-xs text-success">独立验证：验证者与实现者的 CLI 不同。</div>`
}`;

// 执行模式照 Clowder Workspace 的二级视图组织：当前运行 / 命令 / 测试共享同一个 Run 上下文。
const executionTab = ({
  state = "运行中",
  tone = "running",
  step = "第 1 步 · 实现",
  agent = "实现者 · Claude Code",
  elapsed = "1 分 12 秒",
  log = ["10:01:08  run started", "10:01:19  reading run-dispatch.ts", "10:02:20  running tests…"],
  tests = "测试进行中",
} = {}) => `
${sectionLabel("当前运行")}
<div class="rounded-md border border-border px-2.5 py-2">
  <div class="flex items-center gap-2"><span class="min-w-0 flex-1 truncate text-sm font-medium text-foreground">${step}</span>${chip(state, tone)}</div>
  <div class="mt-1 text-xs text-muted-foreground">${agent} · ${elapsed}</div>
  <div class="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><span class="rounded bg-muted px-1 py-0.5">Run #1</span><span>Attempt #1</span></div>
</div>
<div class="mt-3 flex gap-0.5 rounded-lg bg-muted p-0.5">
  <button type="button" data-switch="execution" data-target="execution-logs" class="${BTN} h-7 flex-1 rounded-md bg-background text-foreground shadow-sm">日志</button>
  <button type="button" data-switch="execution" data-target="execution-commands" class="${BTN} h-7 flex-1 rounded-md text-muted-foreground hover:text-foreground">命令</button>
  <button type="button" data-switch="execution" data-target="execution-tests" class="${BTN} h-7 flex-1 rounded-md text-muted-foreground hover:text-foreground">测试</button>
</div>
<div data-panel="execution" id="execution-logs" class="mt-2 max-h-48 overflow-y-auto rounded-md bg-muted/50 px-2 py-2 font-mono text-xs text-muted-foreground">${log.map((line) => `<div>${line}</div>`).join("")}</div>
<div data-panel="execution" id="execution-commands" hidden class="mt-2">
  <div class="rounded-md border border-border px-2 py-2 font-mono text-xs text-foreground">npm test -w @personahub/server</div>
  <div class="mt-1 rounded-md border border-border px-2 py-2 font-mono text-xs text-foreground">git diff --stat</div>
</div>
<div data-panel="execution" id="execution-tests" hidden class="mt-2 rounded-md border border-border px-2 py-2 text-sm text-foreground">${tests}</div>
${sectionLabel("运行历史")}
<div class="flex items-center gap-2 px-1 py-1.5 text-sm"><span>${dot(tone)}</span><span class="min-w-0 flex-1 text-foreground">Run #1 · ${step}</span><span class="text-xs text-muted-foreground">${elapsed}</span></div>
${sectionLabel("追踪")}
<div class="px-1 py-1 text-xs text-muted-foreground">Run run_7c1f… · Attempt att_18b… · 日志与证据锚定到同一版本。</div>`;

const diagnosticsTab = executionTab();

const PAGES = {
  "workbench-running": {
    summary: "第 1 步 实现中 · 已改 1 个文件 · 正在跑测试",
    title: "工作台 · 执行中",
    statusChip: chip("运行中", "running"),
    body: `
${msg({ who: "我", tone: "user", time: "10:01", text: GOAL })}
${msgSystem("已确认执行方案 · 第 1 步交给「实现者」（它在这个代码目录可执行，能力项含「改代码」「跑测试」）")}
${msg({
  who: "实现者",
  model: "Claude Code · claude-opus-5",
  tone: "running",
  time: "1 分 12 秒",
  text: "先看现在怎么处理超时。<span class=\"text-muted-foreground\">正在跑测试…</span>",
  tools: [
    { tone: "done", who: "读取", what: "server/src/services/run-dispatch.ts", time: "1.2s" },
    { tone: "done", who: "编辑", what: "run-dispatch.ts +38 −4", time: "3.4s" },
    { tone: "running", who: "运行", what: "npm test -w @personahub/server", time: "进行中 42s" },
  ],
})}`,
    composer: composerHtml({ hint: "补充要求或纠正方向…" }),
    inspector: {
      active: "files",
      context: "Run #1 · Attempt #1",
      tabs: {
        files: filesPanel({ active: "changes", run: { state: "生成中", tone: "running", context: "Run #1 · Attempt #1 · 固定版本" } }),
        artifacts: artifactsPanel({ kind: "running" }),
        code: workspaceTab({ active: "run", run: { state: "运行中", tone: "running", step: "N2 · 实现与测试", agent: "实现者 · Claude Code", elapsed: "1 分 12 秒", tests: "测试进行中 · 24/26", log: ["10:01:08  run started", "10:01:19  run-dispatch.ts updated", "10:02:20  24/26 tests passed…"] } }),
        graph: GRAPH_RUNNING,
        overview: infoTab({
          status: "运行中",
          stage: "第 1 步 · 实现",
          next: "完成后等待你指派验证",
          members: [
            memberCard({ name: "实现者", role: "第 1 步 实现 · 进行中", base: "Claude Code · claude-opus-5 · 思考强度中", state: "执行中", tone: "running", elapsed: "1 分 12 秒", attempt: "第 1 次尝试", tokens: "↑ 18.2k ↓ 940", active: true }),
            memberCard({ name: "方案审阅员", role: "开工前 · 给了实现思路", base: "Claude Code · claude-opus-5 · 思考强度高", state: "已完成", tone: "done", elapsed: "48 秒", attempt: "第 1 次", tokens: "↑ 12.4k ↓ 380" }),
          ],
          stats: [["总消息数", "5"], ["成员消息", "2"], ["你的消息", "2"], ["系统事件", "1"]],
        }),
        execution: executionTab(),
        evidence: artifactTab({ criteria: CRITERIA_BASE, files: "2 个文件 · +47 −4" }),
        diagnostics: diagnosticsTab,
      },
    },
  },

  "workbench-awaiting-assignment": {
    summary: "第 1 步完成 · 2 个文件变更 · 24 个测试通过 · <span class=\"text-warning\">未覆盖并发场景</span>",
    title: "工作台 · 等待你指派",
    activeGoal: GOAL,
    statusChip: chip("等待你指派", "attention"),
    body: `
${msg({ who: "我", tone: "user", time: "10:01", text: GOAL })}
${msgSystem("已确认执行方案 · 先让「方案审阅员」看一眼，再交「实现者」动手")}
${msg({
  who: "方案审阅员",
  tone: "done",
  time: "10:02",
  model: "claude-opus-5 · Claude Code",
  tokens: "↑ 12.4k ↓ 380 · 48 秒",
  text: "看过 run-dispatch 了。建议不要在 dispatch 里直接重试——它没有幂等键，两个 run 同时超时会重复提交。<span class=\"text-foreground\">先加 idempotencyKey，再谈重试</span>。",
  tools: [{ tone: "done", who: "读取", what: "server/src/services/run-dispatch.ts", time: "0.9s" }],
})}
${msg({ who: "我", tone: "user", time: "10:03", text: "同意，就按这个来。" })}
${msg({
  who: "实现者",
  tone: "done",
  time: "10:04",
  model: "claude-opus-5 · Claude Code",
  tokens: "↑ 31.8k ↓ 2.1k · 3 分 21 秒",
  text: "改完了。超时阈值提到 60s，超时后带幂等键重试一次，24 个测试通过。<span class=\"text-foreground\">并发场景我没覆盖</span>——两个 run 同时超时会不会重复提交，需要验证时确认。",
  tools: [
    { tone: "done", who: "读取", what: "server/src/services/run-dispatch.ts", time: "1.2s" },
    { tone: "done", who: "编辑", what: "run-dispatch.ts +38 −4", time: "3.4s" },
    { tone: "done", who: "运行", what: "npm test -w @personahub/server — 24 passed", time: "51s" },
  ],
})}
${msgSystem("第 1 步完成 · 等你指派第 2 步")}`,
    composer: composerHtml({ prefill: '<span class="font-medium">@独立验证员</span> 验证上一步的实现，重点看并发场景下重试会不会重复提交。', href: "workbench-validation.html" }),
    inspector: {
      active: "artifacts",
      context: "Run #1 · complete",
      tabs: {
        artifacts: artifactsPanel({ kind: "awaiting", active: "detail" }),
        graph: GRAPH_AWAITING,
        overview: infoTab({
          status: "等待你指派",
          stage: "第 1 步已完成",
          next: "建议交给独立验证员",
          members: [
            memberCard({ name: "实现者", role: "第 1 步 实现 · 已交付", base: "Claude Code · claude-opus-5 · 思考强度中", state: "已完成", tone: "done", elapsed: "3 分 21 秒", attempt: "第 1 次尝试", tokens: "↑ 31.8k ↓ 2.1k" }),
            memberCard({ name: "方案审阅员", role: "开工前 · 给了实现思路", base: "Claude Code · claude-opus-5 · 思考强度高", state: "已完成", tone: "done", elapsed: "48 秒", attempt: "第 1 次", tokens: "↑ 12.4k ↓ 380" }),
            memberCard({ name: "独立验证员", role: "第 2 步 验证 · 建议人选", base: "Codex CLI · gpt-5-codex · 思考强度高", state: "待指派", tone: "attention", elapsed: "—", attempt: "未开始" }),
          ],
          stats: [["总消息数", "5"], ["成员消息", "2"], ["你的消息", "2"], ["系统事件", "1"]],
        }),
        execution: executionTab({ state: "已完成", tone: "done", step: "第 1 步 · 实现", elapsed: "3 分 21 秒", log: ["10:04:02  run started", "10:05:40  tests passed", "10:07:23  run completed"], tests: "24 个测试通过 · 并发场景待验证" }),
        evidence: artifactTab({
          criteria: CRITERIA_BASE,
          conclusions: [{ text: "24 个测试通过" }, { text: "并发场景未覆盖，待验证确认", tone: "attention" }],
          independence: { ok: false, text: "指派「独立验证员」即满足独立性；仍交给「实现者」的话，完成时会标记同源验证。" },
          files: "2 个文件 · +47 −4",
        }),
        diagnostics: diagnosticsTab,
      },
    },
  },

  "workbench-validation": {
    summary: "第 2 次验证未通过 · <span class=\"text-warning\">并发重复提交连续 2 次未解决</span> · 另有 1 项新增",
    title: "工作台 · 反复未收敛",
    statusChip: chip("验证未通过", "attention"),
    body: `
${msgSystem("第 3 步 · 验证 ·「独立验证员」· 第 2 次")}
${msg({
  who: "独立验证员",
  tone: "attention",
  time: "10:39",
  model: "gpt-5-codex · Codex CLI",
  tokens: "↑ 24.6k ↓ 1.3k · 1 分 04 秒",
  text: "还是没过，2 项不满足完成要求。",
  tools: [
    { tone: "done", who: "运行", what: "npm test -w @personahub/server — 26 passed", time: "38s" },
    { tone: "danger", who: "审查", what: "并发路径未覆盖", time: "26s" },
  ],
  card: `
<div class="mt-3 ${CARD}">
  <div class="space-y-1.5">
    <div class="flex items-start gap-2 rounded-md bg-warning/10 px-2 py-1.5">
      <span class="mt-1.5">${dot("attention")}</span>
      <div class="min-w-0 flex-1 text-sm text-warning">并发场景下重试会重复提交<div class="mt-0.5 text-xs text-warning">连续 2 次未解决</div></div>
    </div>
    <div class="flex items-start gap-2 rounded-md px-2 py-1.5">
      <span class="mt-1.5">${dot("danger")}</span>
      <div class="min-w-0 flex-1 text-sm text-foreground">重试次数没有上限保护<div class="mt-0.5 text-xs text-muted-foreground">这次新增</div></div>
    </div>
  </div>
  <div class="mt-2 px-1 text-xs text-muted-foreground">重复项带底色，新增项不带——不需要逐条比对文字。</div>
</div>`,
})}
${msgSystem("这样下去能收敛吗？可以现在改变策略")}
<div class="${CARD}">
  <div class="flex flex-wrap items-center gap-2 px-1">
    <button type="button" class="${BTN_PRIMARY}" onclick="location.href='workbench-awaiting-assignment.html'">换个成员来修</button>
    <button type="button" class="${BTN_SECOND}" title="本轮草案未覆盖：完成要求编辑">改完成要求</button>
    <button type="button" class="${BTN_SECOND}" title="本轮草案未覆盖：等同于在下方输入框补充">补充约束</button>
    <button type="button" class="${BTN_SECOND}" title="本轮草案未覆盖：叫停确认">直接叫停</button>
  </div>
  <div class="mt-2 px-1 text-xs text-muted-foreground">任何一次验证之后都能用；已产出的证据与 findings 不会丢。</div>
</div>`,
    composer: composerHtml({ prefill: '<span class="font-medium">@方案审阅员</span> 并发下重试重复提交，连续 2 次没解决。先给一个幂等方案，再交回实现。', href: "workbench-running.html" }),
    inspector: {
      active: "artifacts",
      context: "Run #3 · Attempt #2",
      tabs: {
        artifacts: artifactsPanel({ kind: "failed", active: "detail" }),
        graph: GRAPH_VALIDATION,
        overview: infoTab({
          status: "验证未通过",
          stage: "第 3 步 · 第 2 次验证",
          next: "换成员、改要求、补约束或叫停",
          members: [
            memberCard({ name: "独立验证员", role: "第 3 步 验证 · 刚出结论", base: "Codex CLI · gpt-5-codex · 思考强度高", state: "未通过", tone: "attention", elapsed: "1 分 04 秒", attempt: "第 2 次验证", tokens: "↑ 24.6k ↓ 1.3k", active: true }),
            memberCard({ name: "实现者", role: "第 2 步 修复", base: "Claude Code · claude-opus-5 · 思考强度中", state: "已完成", tone: "done", elapsed: "2 分 05 秒", attempt: "第 2 次", tokens: "↑ 22.1k ↓ 1.6k" }),
            memberCard({ name: "实现者", role: "第 1 步 实现", base: "Claude Code · claude-opus-5 · 思考强度中", state: "已完成", tone: "done", elapsed: "3 分 21 秒", attempt: "第 1 次", tokens: "↑ 31.8k ↓ 2.1k" }),
          ],
          stats: [["总消息数", "9"], ["成员消息", "5"], ["你的消息", "2"], ["系统事件", "2"]],
        }),
        execution: executionTab({ state: "未通过", tone: "attention", step: "第 3 步 · 验证", agent: "独立验证员 · Codex CLI", elapsed: "1 分 04 秒", log: ["10:39:01  validation started", "10:39:39  26 tests passed", "10:40:05  concurrency finding recorded"], tests: "26 个测试通过 · 2 项完成要求未满足" }),
        evidence: artifactTab({
          criteria: [
            { text: "测试通过", state: "ok" },
            { text: "变更文件可追溯", state: "ok" },
            { text: "并发场景不重复提交", state: "fail", note: "连续 2 次未满足" },
            { text: "重试次数有上限", state: "fail" },
          ],
          conclusions: [
            { text: "26 个测试通过" },
            { text: "并发重复提交连续 2 次未解决", tone: "danger" },
            { text: "重试无上限保护（这次新增）", tone: "danger" },
          ],
          independence: { ok: true, text: "独立验证：验证者与实现者的 CLI 不同。" },
          files: "2 个文件 · +47 −4",
        }),
        diagnostics: diagnosticsTab,
      },
    },
  },

  "workbench-blocked": {
    summary: "第 2 步完成 · 等你授权推送 · <span class=\"text-warning\">未授权前不会执行</span>",
    title: "工作台 · 需要你处理",
    activeGoal: "推送前要人工确认，别让 agent 自己 push",
    statusChip: chip("需要你处理", "danger"),
    body: `
${msg({ who: "我", tone: "user", time: "09:12", text: "推送前要人工确认，别让 agent 自己 push。" })}
${msgSystem("第 1 步 实现 · 第 2 步 验证 · 都已完成")}
${msg({
  who: "实现者",
  tone: "attention",
  time: "09:47",
  model: "claude-opus-5 · Claude Code",
  tokens: "↑ 28.3k ↓ 1.4k · 2 分 11 秒",
  text: "改动都验完了，我需要把 3 个提交推到远端才算收尾。<span class=\"text-foreground\">推送需要你授权</span>——凭据没有下发给我，我也不打算绕过。",
  tools: [{ tone: "danger", who: "被拦下", what: "git push origin main", meta: "已阻止" }],
})}
<div class="${CARD}">
  <div class="flex items-center gap-1.5 px-1 text-sm font-medium text-foreground">${dot("danger")}要推送到远端，需要你授权</div>
  <div class="mt-2 space-y-1 px-1 text-sm text-muted-foreground">
    <div><span class="text-foreground">影响什么：</span>把本地 3 个提交推到远端，<span class="text-foreground">不可撤销</span>；代码目录本身安全，已完成的结果都在。</div>
    <div><span class="text-foreground">建议做什么：</span>先看这 3 个提交改了什么，再决定。</div>
  </div>
  <div class="mt-3 flex flex-wrap items-center gap-2 px-1">
    <button type="button" class="${BTN_PRIMARY}" onclick="location.href='workbench-file.html'">看看这 3 个提交</button>
    <button type="button" class="${BTN_QUIET}" title="本轮草案未覆盖：保持当前状态，无跳转">保持拒绝</button>
  </div>
  <div class="mt-2 px-1 text-xs text-muted-foreground">默认拒绝。授权需要单独确认，并会写进活动记录。</div>
</div>`,
    composer: composerHtml({ hint: "补充说明，或提出别的处理方式…" }),
    inspector: {
      active: "approvals",
      context: "Run #1 · 待授权",
      approvalCount: 1,
      tabs: {
        approvals: approvalPanel({ pending: true }),
        graph: GRAPH_BLOCKED,
        overview: infoTab({
          status: "需要你处理",
          stage: "等待授权 · 推送远端",
          next: "审查 3 个提交后决定是否授权",
          members: [
            memberCard({ name: "实现者", role: "第 1 步 实现 · 已交付", base: "Claude Code · claude-opus-5 · 思考强度中", state: "等你授权", tone: "attention", elapsed: "2 分 11 秒", attempt: "第 1 次尝试", tokens: "↑ 28.3k ↓ 1.4k", active: true }),
            memberCard({ name: "独立验证员", role: "第 2 步 验证 · 已通过", base: "Codex CLI · gpt-5-codex · 思考强度高", state: "已完成", tone: "done", elapsed: "58 秒", attempt: "第 1 次验证", tokens: "↑ 19.7k ↓ 820" }),
          ],
          stats: [["总消息数", "7"], ["成员消息", "3"], ["你的消息", "2"], ["系统事件", "2"]],
        }),
        execution: executionTab({ state: "已暂停", tone: "attention", step: "第 3 步 · 推送", elapsed: "等待你授权", log: ["10:41:02  git push requested", "10:41:02  credential isolation blocked", "10:41:03  waiting for human decision"], tests: "26 个测试通过 · 代码目录安全" }),
        evidence: artifactTab({
          criteria: CRITERIA_DONE,
          conclusions: [{ text: "26 个测试通过" }, { text: "变更文件可追溯" }],
          independence: { ok: true, text: "独立验证：验证者与实现者的 CLI 不同。" },
          files: "3 个文件 · +64 −9",
        }),
        diagnostics: diagnosticsTab,
      },
    },
  },

  "workbench-interrupted": {
    summary: "第 3 步验证中断 · 前两步结果都在 · <span class=\"text-warning\">这次尝试不计入证据</span>",
    title: "工作台 · 已中断",
    statusChip: chip("已中断", "danger"),
    body: `
${msgSystem("第 3 步 验证 · 进行到一半时服务重启")}
${msg({
  who: "系统",
  tone: "danger",
  time: "11:20",
  text: "验证被打断了。<span class=\"text-foreground\">第 1、2 步的结果都在</span>；第 3 步没有产出结论，不计入证据。代码目录已回到安全状态，没有半写入的文件。",
})}
<div class="${CARD}">
  <div class="px-1 text-sm font-medium text-foreground">要从第 3 步重新开始吗？</div>
  <div class="mt-2 px-1 text-sm text-muted-foreground">新尝试会引用已有结果，但不覆盖旧记录；已完成的步骤不会重跑。</div>
  <div class="mt-3 flex flex-wrap items-center gap-2 px-1">
    <button type="button" class="${BTN_PRIMARY}" onclick="location.href='workbench-running.html'">从第 3 步重新开始</button>
    <button type="button" class="${BTN_QUIET}" onclick="location.href='workbench-file.html'">先看看已有结果</button>
  </div>
</div>`,
    composer: composerHtml({ hint: "补充说明…" }),
    inspector: {
      active: "artifacts",
      context: "Run #3 · interrupted",
      tabs: {
        artifacts: artifactsPanel({ kind: "interrupted", active: "detail" }),
        graph: GRAPH_INTERRUPTED,
        overview: infoTab({
          status: "已中断",
          stage: "第 3 步 · 验证中断",
          next: "决定是否从第 3 步重新开始",
          members: [
            memberCard({ name: "独立验证员", role: "第 3 步 验证 · 被中断", base: "Codex CLI · gpt-5-codex · 思考强度高", state: "已中断", tone: "danger", elapsed: "37 秒", attempt: "第 1 次验证", tokens: "↑ 8.1k ↓ 0" }),
            memberCard({ name: "实现者", role: "第 1–2 步 · 已交付", base: "Claude Code · claude-opus-5 · 思考强度中", state: "已完成", tone: "done", elapsed: "5 分 26 秒", attempt: "第 2 次", tokens: "↑ 53.9k ↓ 3.7k" }),
          ],
          stats: [["总消息数", "7"], ["成员消息", "3"], ["你的消息", "2"], ["系统事件", "2"]],
        }),
        execution: executionTab({ state: "已中断", tone: "danger", step: "第 3 步 · 验证", agent: "独立验证员 · Codex CLI", elapsed: "37 秒", log: ["11:20:01  validation started", "11:20:38  server connection lost", "11:20:38  attempt marked interrupted"], tests: "本次验证没有可信结论" }),
        evidence: artifactTab({
          criteria: CRITERIA_BASE,
          conclusions: [{ text: "第 3 步未产出结论，不计入证据", tone: "muted", source: false }],
          files: "2 个文件 · +47 −4",
        }),
        diagnostics: diagnosticsTab,
      },
    },
  },

  "workbench-done": {
    summary: "全部完成 · 2 个文件变更 · 26 个测试通过 · <span class=\"text-success\">独立验证</span>",
    title: "工作台 · 已完成",
    activeGoal: "把 helpers.ts 拆成按职责分文件",
    statusChip: chip("已完成", "done"),
    body: `
${msg({
  who: "独立验证员",
  tone: "done",
  time: "10:41",
  model: "gpt-5-codex · Codex CLI",
  tokens: "↑ 26.2k ↓ 1.1k · 58 秒",
  text: "验证通过。26 个测试全过，并发重复提交的场景这次覆盖到了，变更文件都能追到对应提交。",
  tools: [
    { tone: "done", who: "运行", what: "npm test -w @personahub/server — 26 passed", meta: "41s" },
    { tone: "done", who: "审查", what: "并发路径与幂等键", meta: "17s" },
  ],
})}
<div class="${CARD}">
  <div class="px-1 text-sm font-medium text-foreground">完成摘要</div>
  <div class="mt-2 space-y-1.5 px-1 text-sm text-muted-foreground">
    <div><span class="text-foreground">交付了什么：</span>超过 60s 的 CLI 调用会自动重试一次，重试带幂等键，次数上限 1。</div>
    <div><span class="text-foreground">验证结论：</span>26 个测试通过；并发重复提交已覆盖。<a href="workbench-file.html" class="underline">来源</a></div>
    <div><span class="text-foreground">风险与后续：</span>重试上限写死为 1，需要可配置时再开任务。</div>
  </div>
  <div class="mt-3 flex flex-wrap items-center gap-2 px-1">
    <button type="button" class="${BTN_PRIMARY}" onclick="location.href='create-task.html'">基于此结果继续</button>
    <button type="button" class="${BTN_SECOND}" onclick="location.href='issues.html'">返回任务列表</button>
  </div>
  <div class="mt-2 px-1 text-xs text-muted-foreground">「基于此结果继续」会新建任务并带入本摘要，不改动本次结果。</div>
</div>`,
    composer: composerHtml({ hint: "对这个结果还有疑问？直接问…" }),
    inspector: {
      active: "artifacts",
      context: "Run #2 · 已验证",
      tabs: {
        artifacts: artifactsPanel({ kind: "done", active: "detail" }),
        graph: GRAPH_DONE,
        overview: infoTab({
          status: "已完成",
          stage: "实现与独立验证均完成",
          next: "返回任务列表，或基于结果新建任务",
          members: [
            memberCard({ name: "独立验证员", role: "第 2 步 验证 · 已通过", base: "Codex CLI · gpt-5-codex · 思考强度高", state: "已完成", tone: "done", elapsed: "58 秒", attempt: "第 1 次验证", tokens: "↑ 26.2k ↓ 1.1k" }),
            memberCard({ name: "实现者", role: "第 1 步 实现 · 已交付", base: "Claude Code · claude-opus-5 · 思考强度中", state: "已完成", tone: "done", elapsed: "3 分 21 秒", attempt: "第 1 次尝试", tokens: "↑ 31.8k ↓ 2.1k" }),
          ],
          stats: [["总消息数", "7"], ["成员消息", "3"], ["你的消息", "2"], ["系统事件", "2"]],
        }),
        execution: executionTab({ state: "已完成", tone: "done", step: "第 2 步 · 独立验证", agent: "独立验证员 · Codex CLI", elapsed: "58 秒", log: ["10:40:03  validation started", "10:40:44  26 tests passed", "10:41:01  evidence summary persisted"], tests: "26 个测试通过 · 并发路径已覆盖" }),
        evidence: artifactTab({
          summary: "超过 60s 的 CLI 调用会自动重试一次，重试带幂等键，次数上限 1。",
          criteria: CRITERIA_DONE,
          conclusions: [
            { text: "26 个测试通过" },
            { text: "并发重复提交场景已覆盖" },
            { text: "变更文件与提交可追溯" },
          ],
          independence: { ok: true, text: "独立验证：验证者与实现者的 CLI 不同。" },
          files: "2 个文件 · +61 −7",
        }),
        diagnostics: diagnosticsTab,
      },
    },
  },

  "workbench-empty": {
    noInspector: true,
    title: "工作台 · 还没有任务",
    statusChip: "",
    body: `
<div class="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
  <div class="text-base font-semibold text-foreground">还没有任务</div>
  <div class="max-w-md text-sm text-muted-foreground">把一个真实的开发目标交出去：描述你想要的结果，系统会给出建议的执行方式和执行者，确认后才真正开始。</div>
  <button type="button" class="${BTN_PRIMARY}" onclick="location.href='create-task.html'">新建任务</button>
</div>`,
    composer: "",
    inspector: {
      active: "graph",
      tabs: {
        overview: `<div class="px-1 py-2 text-sm text-muted-foreground">选中一个任务后，这里显示它的状态快照。</div>`,
        evidence: `<div class="px-1 py-2 text-sm text-muted-foreground">暂无证据。</div>`,
        diagnostics: diagnosticsTab,
      },
    },
  },
};


// ---------- P07–P10：列表与设置类页面 ----------
// 任务列表行：五项按旅程 §6.4.1（目标 / 状态 / 是否需要我 / 执行者 / 最后活动）
const issueRow = ({ goal, status, tone, needsYou, who, when }) => `
<a href="workbench-running.html" class="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-muted/50">
  <span class="w-4 shrink-0">${needsYou ? dot("attention") : ""}</span>
  <span class="min-w-0 flex-1 truncate text-sm text-foreground">${goal}</span>
  <span class="w-20 shrink-0">${chip(status, tone)}</span>
  <span class="w-28 shrink-0 truncate text-xs text-muted-foreground">${who}</span>
  <span class="w-16 shrink-0 text-right text-xs text-muted-foreground">${when}</span>
</a>`;

const checklistItem = ({ state, title, body, action }) => `
<div class="mt-2 ${CARD}">
  <div class="flex items-center gap-1.5 px-1 text-sm font-medium text-foreground">
    ${dot(state === "done" ? "done" : state === "current" ? "attention" : "muted")}${title}
  </div>
  <div class="mt-1.5 px-1 text-sm text-muted-foreground">${body}</div>
  ${action ? `<div class="mt-3 px-1">${action}</div>` : ""}
</div>`;

const agentRow = ({ name, base, effort, caps, avail, tone, note }) => `
<div class="flex items-start gap-3 rounded-md px-2 py-2.5 hover:bg-muted/50">
  ${avatarBox(name, tone)}
  <div class="min-w-0 flex-1">
    <div class="flex items-center gap-2">
      <span class="text-sm font-medium text-foreground">${name}</span>
      ${chip(avail, tone)}
    </div>
    <div class="mt-1 text-xs text-muted-foreground">基于 ${base} · 思考强度 ${effort}</div>
    <div class="mt-1.5 flex flex-wrap gap-1">
      ${caps.map((c) => `<span class="inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">${c}</span>`).join("")}
    </div>
    ${note ? `<div class="mt-1.5 text-xs text-muted-foreground">${note}</div>` : ""}
  </div>
  <button type="button" class="${BTN_QUIET}" title="本轮草案未覆盖：成员编辑页">编辑</button>
</div>`;

Object.assign(PAGES, {
  issues: {
    noInspector: true,
    title: "任务列表",
    headerTitle: "还没有选中任务",
    statusChip: "",
    body: `
<div class="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
  <div class="text-base font-semibold text-foreground">开始一件新工作</div>
  <div class="max-w-md text-sm text-muted-foreground">
    描述你想要的结果，系统会给出建议的做法和执行者，确认后才真正开始。<br />
    也可以从左边挑一个正在进行的任务接着看。
  </div>
  <div class="w-full max-w-xl">
    <div class="relative flex min-h-16 w-full flex-col rounded-lg bg-card pb-9 border-1 border-border transition-colors focus-within:border-brand text-left">
      <div class="flex-1 min-h-0 overflow-y-auto px-3 py-2">
        <div class="text-sm text-muted-foreground">比如：给 run-dispatch 加超时重试，超过 60s 的 CLI 调用要能自动重试一次</div>
      </div>
      <div class="absolute bottom-1.5 right-1.5 flex items-center gap-1">
        <button type="button" aria-label="发送" onclick="location.href='create-task.html'" class="${BTN} bg-primary text-primary-foreground hover:bg-primary/90 size-7 rounded-full">${ICON_SEND}</button>
      </div>
    </div>
  </div>
  <div class="flex items-center gap-2 pt-1">
    <span class="text-xs text-muted-foreground">左边有 <span class="text-warning">2 个任务在等你</span></span>
    <a href="workbench-blocked.html" class="${BTN_QUIET}">先看要紧的</a>
  </div>
</div>`,
    composer: "",
  },

  setup: {
    noInspector: true,
    title: "首次设置",
    headerTitle: "开始设置",
    statusChip: chip("尚未设置", "attention"),
    body: `
<div class="px-2 pt-2 text-sm text-muted-foreground">三步之后就能创建任务。已完成的项随时可以回来改。</div>
${checklistItem({
  state: "done",
  title: "1 · 代码目录",
  body: `<span class="text-foreground">D:\\Projects\\personahub</span> · 分支 main · 可读写<div class="mt-1">项目名「personahub」</div>`,
  action: `<button type="button" class="${BTN_SECOND}" title="本轮草案未覆盖：目录选择器">换一个目录</button>`,
})}
${checklistItem({
  state: "current",
  title: "2 · AI 成员",
  body: `已添加成员 <span class="text-foreground">「实现者」</span>（基于 Claude Code · opus-5，可执行）。<div class="mt-1">建议再加一个不同的 CLI：验证者与实现者不同源时，完成结论才算独立验证；只有一个也能开始，但结果会标「同源验证」。</div>`,
  action: `<button type="button" class="${BTN_PRIMARY}" onclick="location.href='agents.html'">添加 AI 成员</button> <button type="button" class="${BTN_QUIET}" onclick="location.href='workbench-empty.html'">先这样，继续</button>`,
})}
${checklistItem({
  state: "todo",
  title: "3 · 执行检查",
  body: "检查这个代码目录下，实现和验证是不是真的跑得起来。",
  action: `<button type="button" class="${BTN_SECOND}" onclick="location.href='workbench-empty.html'">运行检查</button>`,
})}
<div class="mt-4 px-2 text-xs text-muted-foreground">必需项只有一个：至少一个可用的 AI 成员。</div>`,
    composer: "",
    inspector: {
      active: "graph",
      tabs: {
        overview: `${sectionLabel("这个项目")}
${rowKV("代码目录", "D:\\Projects\\personahub")}
${rowKV("分支", "main")}
${rowKV("可用成员", "1 个")}
${sectionLabel("执行能力")}
${rowKV("实现路径", "可用（成员「实现者」）")}
${rowKV("独立验证", '<span class="text-warning">不足：只有一个 CLI</span>')}`,
        evidence: `<div class="px-1 py-2 text-sm text-muted-foreground">还没有任务，暂无证据。</div>`,
        diagnostics: diagnosticsTab,
      },
    },
  },

  "create-task": {
    noInspector: true,
    title: "创建任务与推荐确认",
    headerTitle: "新建任务",
    statusChip: chip("等待确认", "attention"),
    body: `
${msg({ who: "我", tone: "user", time: "10:01", text: GOAL })}
<div class="mt-2 ${CARD}">
  <div class="px-1 text-sm font-medium text-foreground">建议这样做</div>
  <div class="mt-2 space-y-1 px-1 text-sm text-muted-foreground">
    <div><span class="text-foreground">第 1 步 实现：</span>「实现者」（Claude Code · opus-5 · 思考强度中）</div>
    <div class="text-xs">选它的原因：在这个代码目录可执行，具备「改代码」「跑测试」能力项。</div>
    <div class="pt-1"><span class="text-foreground">完成要求：</span>测试通过 + 变更文件可追溯 + 验证者与实现者不同源</div>
  </div>
  <div class="mt-2 px-1 text-xs text-muted-foreground">
    没被选上的：<span class="text-foreground">「快速改手」</span>（当前代码目录未登录）、<span class="text-foreground">「独立验证员」</span>（留作独立验证，避免同源）。
  </div>
  <div class="mt-3 flex flex-wrap items-center gap-2 px-1">
    <button type="button" class="${BTN_PRIMARY}" onclick="location.href='workbench-running.html'">确认并开始</button>
    <button type="button" class="${BTN_SECOND}" title="本轮草案未覆盖：执行者选择器">换个执行者</button>
    <button type="button" class="${BTN_QUIET}" onclick="location.href='workbench-empty.html'">返回修改目标</button>
  </div>
  <div class="mt-2 px-1 text-xs text-muted-foreground">确认前不会创建任何任务或执行记录；取消也不会留下半成品。</div>
</div>`,
    composer: composerHtml({ hint: "补充目标或约束…" }),
    inspector: {
      active: "graph",
      tabs: {
        overview: `${sectionLabel("待创建的任务")}
${rowKV("目标", GOAL)}
${rowKV("状态", "等待确认")}
${rowKV("代码目录", "personahub · main")}
${sectionLabel("候选成员")}
${rowKV("实现者", "Claude Code · 中 · 改代码 / 跑测试")}
${rowKV("独立验证员", "Codex CLI · 高 · 审代码 / 跑测试")}
${rowKV("快速改手", 'OpenCode · 低 · <span class="text-warning">此目录未登录</span>')}`,
        evidence: `<div class="px-1 py-2 text-sm text-muted-foreground">任务尚未开始，暂无证据。</div>`,
        diagnostics: diagnosticsTab,
      },
    },
  },

  agents: {
    title: "AI 成员",
    headerTitle: "AI 成员",
    list: agentListColumn(),
    noInspector: true,
    statusChip: "",
    body: `
<div class="flex items-center justify-between px-2 py-1.5">
  <span class="text-xs text-muted-foreground">成员 = CLI + 模型 + 执行参数 + 能力项。同一个 CLI 可以配出多个成员。</span>
  <button type="button" class="${BTN_PRIMARY}" title="本轮草案未覆盖：新建成员页">新建成员</button>
</div>
${MEMBERS.map((m) => agentRow(m)).join("")}
<div class="px-2 pt-4 text-xs text-muted-foreground">
  按「能做什么」描述成员，不分配固定角色——角色是每次任务里的分工，不是身份。<br />
  CLI 的安装、登录与可用性检测属于运行时配置，在<span class="text-foreground">设置</span>里，不混进这张表。
</div>`,
    composer: "",
  },
});


// ---------- P11：变更与文件（旅程 §6.6） ----------
// 骨架：dsh 的 detailsCol「点某一行 → 右边出详情」；中栏内部左右两栏，不是第四个主栏。
const fileItem = ({ path, stat, active = false, kind, target }) => `
<a href="#" data-switch="files" data-target="${target}" class="flex flex-col gap-0.5 rounded-md px-2 py-1.5 ${active ? "bg-muted" : "hover:bg-muted/50"}">
  <span class="truncate text-sm ${active ? "font-medium text-foreground" : "text-foreground"}">${path}</span>
  <span class="text-xs text-muted-foreground">${stat}${kind ? ` · ${kind}` : ""}</span>
</a>`;

const diffLine = (mark, text) => {
  const tone =
    mark === "+"
      ? "bg-success/10 text-success"
      : mark === "-"
        ? "bg-destructive/10 text-destructive"
        : "text-muted-foreground";
  return `<div class="flex gap-2 px-2 py-0.5 text-xs ${tone}"><span class="w-3 shrink-0">${mark === " " ? "" : mark}</span><span class="min-w-0 flex-1 whitespace-pre-wrap">${text}</span></div>`;
};

const changesBody = ({ fileList, viewer }) => `
<div class="flex h-full gap-3">
  <div class="w-56 shrink-0 overflow-y-auto border-r border-border pr-2" style="width:224px">
    <div class="px-2 pt-1 pb-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">本任务涉及的文件</div>
    ${fileList}
    <div class="mt-3 border-t border-border pt-2">
      <button type="button" class="${BTN_SECOND} w-full justify-start" title="本轮草案未覆盖">按路径打开其他文件…</button>
      <div class="mt-1.5 px-2 text-xs text-muted-foreground">只读，且不能超出当前代码目录。</div>
    </div>
  </div>
  <div class="min-w-0 flex-1 overflow-y-auto">${viewer}</div>
</div>`;

// mode 组：group 传入时「改动/全文」是真开关，两个面板都渲染；不传则是静态标签
const viewerHeader = ({ path, version, mode, group }) => `
<div class="flex items-center gap-2 border-b border-border pb-2">
  <span class="min-w-0 flex-1 truncate text-sm font-medium text-foreground">${path}</span>
  <div class="flex shrink-0 gap-0.5 rounded-lg bg-muted p-0.5">
    ${["改动", "全文"]
      .map((m) => {
        const on = m === mode;
        const cls = `${BTN} h-6 rounded-md px-2.5 ${
          on ? "bg-background text-foreground" : "text-muted-foreground hover:text-foreground"
        }`;
        return group
          ? `<button type="button" data-switch="${group}" data-target="${group}-${m === "改动" ? "diff" : "full"}" class="${cls}">${m}</button>`
          : `<button type="button" class="${cls}" title="本轮草案只在主文件上做了改动/全文切换">${m}</button>`;
      })
      .join("")}
  </div>
</div>
<div class="px-1 py-1.5 text-xs text-muted-foreground">${version}</div>`;

Object.assign(PAGES, {
  "workbench-file": {
    back: `<a href="workbench-awaiting-assignment.html" class="${BTN_QUIET}">← 返回会话</a>`,
    title: "工作台 · 文件（代码）",
    activeGoal: GOAL,
    statusChip: chip("等待你指派", "attention"),
    body: `
${fileHeader({
  path: "server/src/services/run-dispatch.ts",
  version: "第 1 步 · 实现 ·「实现者」 · 第 1 次尝试产出的版本",
  changed: "本任务改写",
})}
<div class="mt-2 rounded-md border border-border py-1">
${line('import { runCli } from "./cli-runner";')}
${line("")}
${line("export async function dispatchRun(input: DispatchInput) {")}
${line("  const timeoutMs = 60_000;", "edit")}
${line("  let attempted = false;", "add")}
${line("  const result = await runCli(input, { timeoutMs });")}
${line("  if (result.timedOut && !attempted) {", "add")}
${line("    attempted = true;", "add")}
${line("    return runCli(input, { timeoutMs, idempotencyKey: input.runId });", "add")}
${line("  }")}
${line("  return result;")}
${line("}")}
</div>
<div class="mt-2 px-1 text-xs text-muted-foreground">看的是这一次尝试产出的版本，不是磁盘当前状态。换一次尝试，这里跟着换。要逐行对照哪些被删掉，那是验证成员的工作。</div>`,
    composer: composerHtml({ hint: "看完可以直接指派下一步，或提出修改意见…" }),
    inspector: {
      active: "files",
      context: "Run #1 · Attempt #1",
      tabs: {
        files: filesPanel({ active: "files", run: { context: "Run #1 · Attempt #1 · 固定版本" } }),
        graph: GRAPH_AWAITING,
        overview: `${issueInfo("等待你指派", "第 1 步已完成 · 等待指派第 2 步")}`,
        evidence: artifactTab({ criteria: CRITERIA_BASE, files: "2 个文件 · +47 −4" }),
        diagnostics: diagnosticsTab,
      },
    },
  },

  "workbench-file-doc": {
    back: `<a href="workbench-awaiting-assignment.html" class="${BTN_QUIET}">← 返回会话</a>`,
    title: "工作台 · 文件（文档，渲染后）",
    headerTitle: "把 F011 的 Room 范围收窄到单 Issue 介入",
    activeGoal: "把 F011 的 Room 范围收窄到单 Issue 介入",
    statusChip: chip("等待你指派", "attention"),
    body: `
${fileHeader({
  path: "docs/features/0.3/F011/spec.md",
  version: "第 2 步 · 写方案 ·「方案审阅员」· 第 1 次尝试产出的版本",
  changed: "本任务改写",
})}
<div class="mt-2 rounded-md border border-border py-2">
${docBlock({ tag: "h1", text: "F011 · Work Room 与人工介入" })}
${docBlock({ text: "本 Feature 把 Human Lead 能力落到单 Issue 的执行链路上，不追求完整的多 agent 协作现场。", change: "edit" })}
${docBlock({ tag: "h2", text: "背景" })}
${docBlock({ text: "PRD §5 Room 定义早就承诺了打断、纠偏、指定 agent 接手这些能力，v0.1/v0.2 一直没落地。" })}
${docBlock({ tag: "h2", text: "范围" })}
${docBlock({ text: "· 阶段完成后停下来等指派，展示上一步产出与建议执行者。" })}
${docBlock({ text: "· 用户可随时打断、补充约束、要求重做。" })}
${docBlock({ text: "· 不做：多成员并行拓扑、Room 终止条件。", change: "add" })}
${docBlock({ tag: "h2", text: "验收" })}
${docBlock({ text: "阶段完成后 15 秒内可完成一次指派，且不需要展开任何折叠区。", change: "add" })}
${docBlock({ tag: "h2", text: "依赖" })}
${docBlock({ text: "F006 图执行、F007 推荐路由；不依赖 F012 Squad。" })}
</div>
<div class="mt-2 px-1 text-xs text-muted-foreground">整份文档都在，改动只是着色——审文档看的是它现在写成什么样，不是一堆增删行。</div>`,
    composer: composerHtml({ hint: "对这份方案有意见就直接说，或指派下一步…" }),
    inspector: {
      active: "files",
      context: "Run #2 · Attempt #1",
      tabs: {
        files: filesPanel({ active: "files", run: { context: "Run #2 · Attempt #1 · 固定版本" } }),
        graph: GRAPH_AWAITING,
        overview: `${sectionLabel("任务")}
${rowKV("目标", "把 F011 的 Room 范围收窄到单 Issue 介入")}
${rowKV("状态", "等待你指派")}
${rowKV("工作方式", "写方案 → 人工审阅 → 定稿")}`,
        evidence: artifactTab({ criteria: CRITERIA_BASE, files: "2 个文件 · +47 −4" }),
        diagnostics: diagnosticsTab,
      },
    },
  },
});


// ---------- 生成 ----------
const baseHtml = readFileSync(BASE, "utf8");
for (const [name, page] of Object.entries(PAGES)) {
  const dom = new JSDOM(baseHtml);
  const doc = dom.window.document;
  const { center, right, row } = buildFrame(doc);

  // 第 2 栏
  row.insertAdjacentHTML("afterbegin", page.list ?? issueListColumn(page.activeGoal ?? GOAL));
  // 项目信息与代码目录归项目页管理，左栏不常驻（page-sourcing §4.3）

  center.innerHTML = centerHtml({
    title: page.headerTitle ?? GOAL,
    statusChip: page.statusChip,
    body: page.body,
    composer: page.composer,
    summary: page.summary,
    back: page.back,
  });
  if (page.noInspector) {
    // 第 4 栏只在有 Issue 上下文时存在（page-sourcing §4.1）——不是留空，是整栏不存在
    const row2 = center.parentElement.parentElement.parentElement;
    let node = right;
    while (node && node.parentElement !== row2) node = node.parentElement;
    if (node) {
      const sep = node.previousElementSibling;
      if (sep && sep.getAttribute("role") === "separator") sep.remove();
      node.remove();
    }
  } else if (page.collapseInspector) {
    // 可选聚焦态：右框收成窄条；点 ‹ 随时恢复任务工作区。
    right.innerHTML = `
<div id="inspector-strip" class="flex h-full flex-col items-center gap-2 py-3">
  <button type="button" data-toggle-inspector class="${BTN_QUIET}" title="展开 Inspector">‹</button>
  <div class="mt-1 text-xs text-muted-foreground" style="writing-mode: vertical-rl">文件 · 产物 · 审批 · 记忆</div>
</div>
<div id="inspector-full" hidden class="h-full">${inspector({ ...page.inspector, collapsible: true })}</div>`;
  } else {
    right.innerHTML = inspector(page.inspector);
  }
  if (!page.noInspector) {
    // Clowder Workspace 的关键不是窄 Inspector，而是可承载任务对象的工作面。
    // 保留现有四栏大结构，只在 center/right 这组可拖动面板内调整初始比例。
    const centerPanel = center.closest('[data-testid="content"]');
    const rightPanel = right.closest('[data-right-sidebar-panel="true"]');
    if (centerPanel) centerPanel.style.flex = "60 1 0px";
    if (rightPanel) rightPanel.style.flex = "40 1 0px";
  }
  right.classList.remove("overflow-y-auto");
  right.classList.add("overflow-hidden");

  doc.title = `PersonaHub 草案 · ${page.title}`;
  // 资源路径指向本目录的 assets（已从 multica 原样复制）
  doc.querySelectorAll("link[href^='../assets/']").forEach((l) => {
    l.setAttribute("href", l.getAttribute("href"));
  });
  doc.body.insertAdjacentHTML("beforeend", SWITCHER_JS.replace("<\\/script>", "</script>"));
  writeFileSync(`${OUT}/${name}.html`, dom.serialize(), "utf8");
  console.log("written", name);
}
