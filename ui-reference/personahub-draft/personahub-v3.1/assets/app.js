(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const state = {
    surface: "project",
    explorer: "work",
    document: "file-prd",
    pane: "overview",
    dockPanel: "primary",
    recipient: "codex-gpt5.6-high",
    contextScope: "只给结果",
    draft: "",
    dockTaskLabel: "",
    pickerRole: null,
    dispatchTimer: null,
    roomPaused: false,
    layout: "balanced",
    dockPinned: false,
    changeIndex: -1,
    stageParent: null,
    toastTimer: null,
  };

  const documentMeta = {
    "project-overview": ["PersonaHub › 项目会话", "PersonaHub 项目会话"],
    "file-prd": ["PersonaHub › docs › personahub-prd.md › Room", "personahub-prd.md"],
    "file-room-spec": ["PersonaHub › docs › features › 0.3 › F011-room › spec.md", "F009 · Artifact spec"],
    "file-code": ["PersonaHub › server › src › services › artifact.ts", "artifact.ts"],
    "file-architecture": ["PersonaHub › docs › personahub-architecture.md", "architecture.md"],
    "issue-view": ["PersonaHub › 任务 › 等待你指派", "任务 · 协作现场人工介入"],
    "issue-new": ["PersonaHub › 任务 › 刚创建", "任务 · 刚创建"],
    "issue-validation": ["PersonaHub › 工作 › 反复未收敛", "任务 · 验证未收敛"],
    "issue-permission": ["PersonaHub › 任务 › 等待权限确认", "任务 · 权限确认"],
    "issue-running": ["PersonaHub › 任务 › 运行中", "任务 · Inspector 的 artifact 状态"],
    "issue-research": ["PersonaHub › 任务 › Research 进行中", "任务 · 阶段成果研究"],
    "issue-done": ["PersonaHub › 任务 › 已完成", "任务 · Graph 启动恢复"],
    "room-view": ["PersonaHub › 任务 › Agent session 生命周期调研 › 协作现场", "协作现场 · 阶段成果研究"],
    "artifact-view": ["PersonaHub › 产出 › 阶段成果 › synthesis_plan › revision 3", "阶段成果 · synthesis_plan"],
    "artifact-research": ["PersonaHub › 产出 › 阶段成果 › research_findings › revision 1", "阶段成果 · research_findings"],
    "evidence-view": ["PersonaHub › 产出 › 完成摘要 › Graph restart recovery", "完成摘要"],
    "evidence-room": ["PersonaHub › 产出 › 验证依据 › Room pause / resume", "验证依据 · Room pause / resume"],
    "decision-view": ["PersonaHub › 知识 › Decisions › Issue-first", "Decision · Issue-first"],
    "memory-view": ["PersonaHub › 知识 › Memory › 自动回路介入原则", "Memory · 人工介入"],
    "skill-view": ["PersonaHub › 知识 › Skill Candidates › 前端原型验证流程", "Skill candidate"],
  };

  const dockContexts = {
    "project-overview": { panel: "project", recipient: "claude-opus4.6-medium", title: "PersonaHub 项目会话", status: "随时可问", summary: "跨任务提问、回顾结论、直接发起新任务", message: "v0.3 有 2 个任务在推进、1 个等你指派。F009 的 artifact 引用刚做完实现，还没有独立验证。", handoff: false, input: "", who: "项目级", what: "不绑定任务，问什么都行", step: "", block: "" },
    "issue-view": { panel: "primary", recipient: "codex-gpt5.6-high", room: { name: "Implementation 现场", meta: "3 个执行组合 · 1 个已交付 · 阶段结束后归档，记录不删除" }, title: "artifact 引用不漂移与来源可追", status: "等待指派", summary: "任务主会话 · Implementation 已完成", message: "建议下一步换一个模型做独立验证，重点是 scope 泄露与 TOCTOU 边界——这两条 F009 spec 明确要求，但现在一个用例都没有。", handoff: true, handoffLabel: "等待你指派", handoffSummary: "上一步已完成 · 建议换一个模型做独立验证", handoffMember: "@claude-sonnet5-medium", input: "@claude-sonnet5-medium\n验证上一步实现，重点检查反向查询的 scope 泄露与 archived locator 的 TOCTOU 边界。", who: "实现者", what: "已交付实现，等待独立验证", step: "2 / 3 步", block: "卡在：scope 泄露与 TOCTOU 还没有任何用例"},
    "room-view": { panel: "research-thread", recipient: "claude-opus4.6-medium", room: { name: "Research 现场", meta: "3 个执行组合并行 · 1 个已交付 · 1 个执行中 · 1 个等前置" }, title: "Agent session 生命周期调研", status: "正在执行", summary: "任务主会话 · Research 进行中", message: "研究现场正在核实两个参考项目的 session 机制；当前无需你操作。", handoff: false, input: "", who: "Research 协作现场", what: "3 名成员正在核实 session 机制", step: "2 / 3 步", block: ""},
    "issue-new": { panel: "primary", recipient: "codex-gpt5.6-high", title: "把 dogfooding 问题导出为周报", status: "刚创建", summary: "还没有执行计划 · 等你指派第一步", message: "你已经写了目标和两条完成要求。我可以先依据它们生成用例集交你确认，再指派实现——用例先于实现固定是 ADR 0009 的硬要求。", handoff: false, input: "", who: "还没有执行者", what: "目标与 2 条完成要求已写", step: "0 / 0 步", block: "卡在：还没有执行计划" },
    "issue-validation": { panel: "primary", recipient: "claude-opus4.6-medium", title: "修复图重启的并发认领", status: "需要你处理", summary: "连续 2 次未解决 · 自动继续已停止", message: "两轮独立验证都指向同一处并发窗口。建议先由架构研究员隔离分析共同根因，再决定换什么策略。", handoff: true, handoffLabel: "建议改变策略", handoffSummary: "先分析共同根因，不直接继续修改", handoffMember: "@架构研究员", input: "@架构研究员\n先分析两轮都撞上的那个并发窗口，不修改代码；给出新的恢复策略和验证边界。", who: "验证循环", what: "连续 2 次出现相同 finding", step: "已停止自动继续", block: "卡在：两轮都撞同一处并发窗口，需要换策略"},
    "issue-permission": { panel: "primary", recipient: "codex-gpt5.6-high", title: "允许 agent 执行 git push", status: "等待确认", summary: "执行已安全暂停 · 外部路径尚未授权", message: "请求执行 git push origin HEAD:feat/f009-artifact-ref。这是显式的能力边界，每次都要你单独授权。", handoff: false, input: "", who: "执行已安全暂停", what: "等待你授权 git push", step: "1 / 3 步", block: "卡在：git push 是显式能力边界，需要你单独授权"},
    "issue-running": { panel: "primary", recipient: "claude-opus4.6-medium", title: "补齐 Inspector 的 artifact 状态", status: "正在执行", summary: "Claude 正在检查项目级 CLI 可用性 · 无需你操作", message: "当前进行到第 2 / 4 步，代码目录写锁安全。四种 artifact 状态里已完成两种，完成或遇到阻塞时会在这里通知你。", handoff: false, input: "", who: "Claude", what: "正在补 missing / invalid 两种状态", step: "2 / 4 步", block: ""},
    "issue-research": { panel: "research-thread", recipient: "claude-opus4.6-medium", room: { name: "Research 现场", meta: "3 个执行组合并行 · 1 个已交付 · 1 个执行中 · 1 个等前置" }, title: "Agent session 生命周期调研", status: "正在执行", summary: "Research 阶段 · 2 / 3 步 · 无需你操作", message: "研究现场正在核实 multica 与 clowder 的 session 机制，以及 PersonaHub 现状的差距。", handoff: false, input: "", who: "OpenCode", what: "正在整理两个项目的 session 机制", step: "2 / 3 步", block: ""},
    "issue-done": { panel: "primary", recipient: "codex-gpt5.6-high", title: "Graph 启动恢复", status: "已完成", summary: "验证通过 · 完成要求 3 / 3", message: "任务已可信完成。完成摘要可逐条追到执行记录、变更文件与独立验证结论。", handoff: false, input: "", who: "已完成", what: "完成要求 3 / 3 · 独立验证通过", step: "3 / 3 步", block: ""},
  };

  function showToast(message) {
    const toast = $("[data-toast]");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("show");
    window.clearTimeout(state.toastTimer);
    state.toastTimer = window.setTimeout(() => toast.classList.remove("show"), 2200);
  }

  function setSurface(name) {
    if (!$("[data-surface-view='" + name + "']")) return;
    state.surface = name;
    $$('[data-surface-view]').forEach((view) => view.classList.toggle("active", view.dataset.surfaceView === name));
    $$('[data-surface]').forEach((button) => button.classList.toggle("active", button.dataset.surface === name));
  }

  function setExplorer(name) {
    // V3.1：左栏已扁平为单一列表（design.md §4.1），不再有「任务 | 资源库」
    // 二级 tab；本函数只维护统一列表的搜索与新建文案。
    state.explorer = name;
    filterTree("");
    const create = $("[data-new-object]");
    if (create) {
      create.setAttribute("aria-label", "新建任务");
      create.title = "新建任务";
    }
  }


  function setLayout(mode) {
    if (!["balanced", "reading", "collaboration"].includes(mode)) return;
    state.layout = mode;
    const shell = $(".app-shell");
    if (shell) shell.dataset.layout = mode;
    $$('[data-layout-mode]').forEach((button) => button.classList.toggle("active", button.dataset.layoutMode === mode));
  }

  // 任务 tab 条已取消（两行 chrome 太重）。当前任务的标识挪到视图行左侧，
  // 切任务回左栏点——左栏本来就常驻任务列表。
  // 任务名与元信息提到 chrome 第一行；概览里那份重复的已经删掉。
  const taskMeta = {
    "issue-new": ["把 dogfooding 问题导出为周报", "未归类", "2026-08-30 14:20", "刚创建，还没有指派", ["未归类"]],
    "issue-view": ["artifact 引用不漂移与来源可追", "PersonaHub", "2026-08-27 09:12", "等待你指派", ["F009", "v0.3", "coding"]],
    "issue-validation": ["修复图重启的并发认领", "PersonaHub", "2026-08-26 16:40", "连续 2 次未解决", ["F006", "bug"]],
    "issue-permission": ["允许 agent 执行 git push", "PersonaHub", "2026-08-30 13:38", "等待你确认权限", ["运维"]],
    "issue-research": ["Agent session 生命周期调研", "PersonaHub", "2026-08-25 10:02", "Research 阶段 · 执行中", ["ADR", "v0.3"]],
    "issue-running": ["补齐 Inspector 的 artifact 状态", "PersonaHub", "2026-08-29 21:15", "Claude 正在执行", ["F009"]],
    "issue-done": ["Graph 启动恢复", "PersonaHub", "2026-08-20 09:00", "已完成 · 验证通过", ["F006", "v0.2"]],
  };

  function syncPaneTask(id) {
    const row = taskMeta[id];
    if (!row) return;
    const [name, project, created, status, labels] = row;
    const nameEl = $("[data-pane-task-name]");
    if (nameEl) nameEl.textContent = name;
    const meta = $("[data-task-meta]");
    if (!meta) return;
    $$("span", meta)[0].innerHTML = `项目 <b>${project}</b>`;
    $$("span", meta)[1].innerHTML = `创建 <b>${created}</b>`;
    const state = $("[data-task-state]", meta);
    if (state) state.textContent = status;
    const tags = $(".th-labels", meta);
    if (tags) tags.innerHTML = labels.map((t) => `<em>${t}</em>`).join("");
  }


  function syncOverview(id) {
    const docs = $$("[data-overview]");
    if (!docs.length) return;
    const hit = docs.some((d) => d.dataset.overview === id);
    docs.forEach((d) => (d.hidden = hit ? d.dataset.overview !== id : d.dataset.overview !== "issue-view"));
  }

  function syncDock(id) {
    syncOverview(id);
    syncPaneTask(id);
    const context = dockContexts[id];
    if (!context) return;
    // 固定后收件人不跟随，但面板仍然跟着舞台走——「看什么」和「发给谁」是两件事
    if (!state.dockPinned) {
      state.dockTaskLabel = context.title || "";
      setRecipient(context.recipient || "这个任务");
    }
    renderPinnedNote();

    const room = $("[data-inline-room]");
    if (room) {
      room.hidden = !context.room;
      if (context.room) {
        const name = $("[data-inline-room-name]");
        const meta = $("[data-inline-room-meta]");
        if (name) name.textContent = context.room.name;
        if (meta) meta.textContent = context.room.meta;
      }
    }

    const shell = $(".app-shell");
    if (shell) shell.dataset.dockMode = context.panel === "project" ? "project" : "task";
    refreshPaneCounts();
    const setText = (sel, value) => { const el = $(sel); if (el) el.textContent = value; };
    // Dock 不重复舞台已经说过的话：任务名归舞台标题，这里只留「谁在做 / 卡在哪」
    const parts = [];
    if (context.who && context.what) parts.push(`${context.who} ${context.what}`);
    else if (context.what) parts.push(context.what);
    if (context.block) parts.push(context.block);
    setText("[data-status-what]", parts.join(" · "));
    setText("[data-status-step]", context.step || "");
    if (context.title) {
      const title = $("[data-primary-title]");
      const status = $("[data-primary-status]");
      const summary = $("[data-primary-summary]");
      const message = $("[data-primary-message]");
      const handoff = $("[data-primary-handoff]");
      const handoffLabel = $("[data-primary-handoff-label]");
      const handoffSummary = $("[data-primary-handoff-summary]");
      const handoffMember = $("[data-primary-handoff-member]");
      const handoffButton = $("[data-primary-handoff-button]");
      const input = $("[data-thread-input]");
      if (title) title.textContent = context.title;
      if (status) status.textContent = context.status;
      if (summary) summary.textContent = context.summary;
      if (message) message.textContent = context.message;
      if (handoff) handoff.hidden = !context.handoff;
      if (handoffLabel && context.handoffLabel) handoffLabel.textContent = context.handoffLabel;
      if (handoffSummary && context.handoffSummary) handoffSummary.textContent = context.handoffSummary;
      if (handoffMember && context.handoffMember) handoffMember.textContent = context.handoffMember;
      if (handoffButton && context.input !== undefined) handoffButton.dataset.threadPrefill = context.input;
      if (input && context.input !== undefined) input.value = context.input;
    }
    setPanel(context.panel);
  }

  function updateStageBack() {
    const back = $("[data-stage-back]");
    const bar = $(".stage-bar");
    // V3.1：tab 条常驻，stage-bar 退化为只在子文档出现的返回条，
    // 否则舞台顶部会叠成两行 chrome（design.md §4.2.1）。
    if (bar) bar.hidden = !state.stageParent;
    if (!back) return;
    back.hidden = !state.stageParent;
    if (state.stageParent) {
      const meta = documentMeta[state.stageParent];
      back.lastChild.textContent = "返回" + (meta ? meta[1] : "任务");
    }
  }

  // 一个 tab = 一个任务的成果面。子文档不新开 tab，归属所在任务。
  const TAB_DOCUMENTS = new Set([
    "issue-new", "issue-view", "issue-validation", "issue-permission",
    "issue-running", "issue-research", "issue-done",
    "room-view", "project-overview",
  ]);

  function openDocument(id, label, opts) {
    const target = $("[data-document='" + id + "']");
    if (!target) {
      showToast("当前静态原型没有这个对象的深度页面");
      return;
    }
    setSurface("project");
    if (opts && opts.child) {
      if (!state.stageParent) state.stageParent = state.document;
      setPane("acceptance");
    } else {
      state.stageParent = null;
    }
    state.document = id;
    $$('[data-document]').forEach((documentView) => documentView.classList.toggle("active", documentView.dataset.document === id));
    $$('[data-open]').forEach((button) => {
      if (button.classList.contains("tree-row")) button.classList.toggle("active", button.dataset.open === id);
    });
    const meta = documentMeta[id] || ["PersonaHub › 当前对象", label || id];
    const breadcrumb = $("[data-breadcrumbs]");
    if (breadcrumb) breadcrumb.innerHTML = meta[0].split(" › ").map((part) => `<span>${part}</span>`).join(" › ");
    const stage = $(".document-stage");
    if (stage) stage.scrollTop = 0;
    state.changeIndex = -1;
    updateChangeNavigation();
    updateStageBack();
    syncDock(id);
  }

  function activeChanges() {
    return $$('[data-document].active [data-change-location]');
  }

  function updateChangeNavigation() {
    const documentView = $("[data-document].active");
    if (!documentView) return;
    const changes = $$('[data-change-location]', documentView);
    const count = $("[data-change-count]", documentView);
    const status = $("[data-change-status]", documentView);
    if (count) count.textContent = changes.length + " 处修改";
    if (status) status.textContent = state.changeIndex < 0 ? "正在显示全部内容" : `${state.changeIndex + 1} / ${changes.length} · ${changes[state.changeIndex]?.dataset.changeLabel || "修改位置"}`;
  }

  function jumpToChange(direction) {
    const changes = activeChanges();
    if (!changes.length) {
      showToast("当前文件没有标记的修改位置");
      return;
    }
    state.changeIndex = direction > 0
      ? (state.changeIndex + 1) % changes.length
      : (state.changeIndex <= 0 ? changes.length - 1 : state.changeIndex - 1);
    changes.forEach((item) => item.classList.remove("change-focus"));
    const target = changes[state.changeIndex];
    target.classList.add("change-focus");
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    updateChangeNavigation();
    showToast(`${state.changeIndex + 1} / ${changes.length} · ${target.dataset.changeLabel || "修改位置"}`);
    window.setTimeout(() => target.classList.remove("change-focus"), 1500);
  }

  // Dock 只有一条流。Room 不再是阅读入口，只是流里的一段可折叠内容：
  // 它是组织单位（谁一起干、交付什么），那些结构信息在舞台的执行组合泳道上。
  // ── 轨迹：adapter 的详细交互过程 ────────────────────────
  //
  // 形态取自 deepseek-harness 的 trajectory：事件表格 + 折叠开关 + 选中出详情。
  // 会话视图看「说了什么」，这里看「实际做了什么」——每次模型调用、每个
  // 工具调用的入参与结果。
  function selectTraceEvent(row) {
    if (!row) return;
    $$("[data-tr-event]").forEach((r) => r.classList.toggle("selected", r === row));
    const detail = $("[data-trace-detail]");
    if (!detail) return;
    detail.hidden = false;
    const kind = $(".tr-kind", row)?.textContent || "";
    const main = $(".tr-main", row)?.textContent || "";
    $("[data-tr-detail-kind]").textContent = `${kind} · ${main.slice(0, 42)}`;
    $("[data-td-body]").textContent = row.dataset.trDetail || "这一行没有更多细节。";
  }

  function refreshTraceCount() {
    const rows = $$("[data-tr-event]").filter((r) => !r.hidden);
    const el = $("[data-tr-count]");
    if (el) el.textContent = `${rows.length} 条事件`;
  }

  // 分段条的四类到表格行的映射。「未计入」不是一类事件，而是「计时不可信」
  // 的那些行：计时未知的、仍在执行的。它单独成段就是为了不被当成实测时间。
  const TRACE_KINDS = {
    input: (row) => row.classList.contains("system") || row.classList.contains("user"),
    model: (row) => row.classList.contains("assistant") || row.classList.contains("req"),
    tool: (row) => row.classList.contains("tool"),
    unmeasured: (row) =>
      row.textContent.includes("计时未知") || row.textContent.includes("进行中"),
  };
  let traceKind = "";

  function filterTraceByKind(kind) {
    traceKind = kind;
    const match = TRACE_KINDS[kind];
    $$("[data-tr-event]").forEach((row) => {
      row.hidden = Boolean(match) && !match(row);
    });
    $$(".tr-turn").forEach((t) => (t.hidden = Boolean(kind)));
    $$("[data-tl-seg]").forEach((el) => {
      el.classList.toggle("active", Boolean(kind) && el.dataset.tlSeg === kind);
      if (el.classList.contains("tl-seg")) {
        el.classList.toggle("dimmed", Boolean(kind) && el.dataset.tlSeg !== kind);
      }
    });
    refreshTraceCount();
  }

  function filterTrace(value) {
    const q = value.trim().toLowerCase();
    $$("[data-tr-event]").forEach((row) => {
      row.hidden = Boolean(q) && !row.textContent.toLowerCase().includes(q);
    });
    $$(".tr-turn").forEach((t) => (t.hidden = Boolean(q)));
    refreshTraceCount();
  }

  // ── 执行组合：选 adapter+模型，深度单独调 ────────────────────
  //
  // 不做固定组合。adapter × 模型 是运行时的真实清单（装了什么、登录没登录），
  // 深度是每次派工的自由参数——把三者打包成预设，等于又造一遍 ADR 0012
  // 刚取消掉的「成员」，只是换了个名字。
  const DEPTHS = ["low", "medium", "high"];
  const comboState = { model: "codex-gpt5.6", depth: "high" };

  function currentModelRow() {
    return $(`[data-pick-model="${comboState.model}"]`);
  }

  function syncCombo() {
    const row = currentModelRow();
    if (!row) return;
    const allowed = (row.dataset.depths || "low,medium,high").split(",");
    const range = $("[data-depth-range]");
    const note = $("[data-depth-note]");
    const est = $("[data-depth-est]");

    // 不是每个模型都支持三档——档位来自模型，不是我们规定的
    if (!allowed.includes(comboState.depth)) comboState.depth = allowed[allowed.length - 1];
    if (range) {
      range.max = String(allowed.length - 1);
      range.value = String(allowed.indexOf(comboState.depth));
      range.disabled = allowed.length < 2;
    }
    $$(".ds-scale > span").forEach((el, i) => {
      el.classList.toggle("off", i >= allowed.length);
      el.classList.toggle("on", DEPTHS[i] === comboState.depth);
    });
    if (note) {
      note.textContent = allowed.length < 2
        ? `${row.querySelector("strong").textContent} 只有 ${allowed[0]} 一档，滑条不可用`
        : "深度由每次派工决定，不烧进配置";
    }

    // 额度按深度折算——这是选深度时真正要权衡的东西
    const quota = Number(row.dataset.quota || 0);
    const cost = { low: 1, medium: 2.5, high: 5 }[comboState.depth] || 1;
    if (est) {
      const calls = Math.max(1, Math.round((quota * 2) / cost));
      est.innerHTML = `当前 <b>${comboState.depth}</b> · 该配置池剩余 ${quota}% 约够 <b>${calls}</b> 次调用`;
      est.classList.toggle("warn", calls < 20);
    }

    const combo = `${comboState.model}-${comboState.depth}`;
    const preview = $("[data-combo-preview]");
    if (preview) preview.textContent = combo;
    setRecipient(combo);

    const advice = row.dataset.advice;
    $$(".model-row").forEach((r) => r.classList.toggle("active", r === row));
    const head = $(".rp-head");
    if (head) head.classList.toggle("mismatch", Boolean(advice));
  }

  // ── 任务面：六个视图共用一个输入框 ──────────────────────
  //
  // Dock 已取消（ADR 0012）。会话降为一个 tab，输入框常驻任务面底部，
  // 切 tab 时保留草稿——因此「发给」必须两段（会话 · 执行组合），
  // 否则在概览里发的话进了哪个会话说不清。
  // ── 左栏：组织维度而非状态维度（照 clowder ThreadSidebar）────
  //
  // 原来按「需要你处理 / 正在进行 / 最近完成」分三组，问题是状态天天在变，
  // 同一个任务今天在这组明天在那组，位置记不住。改成置顶/最近/项目/收藏：
  // 位置由你决定，状态退回条目里的圆点。
  const explorer = { tab: "recent", label: "全部" };

  function filterIssues() {
    const items = $$("[data-issue-tabs]");
    let shown = 0;
    items.forEach((el) => {
      const inTab = el.dataset.issueTabs.split(" ").includes(explorer.tab);
      const inLabel = explorer.label === "全部" || el.dataset.issueTags.split(" ").includes(explorer.label);
      el.hidden = !(inTab && inLabel);
      if (!el.hidden) shown += 1;
    });
    // 「项目」分类下才按项目分段——其余分类里项目名是噪声
    const head = $("[data-project-head]");
    if (head) head.hidden = explorer.tab !== "project" || shown === 0;
    const empty = $("[data-issue-empty]");
    if (empty) empty.hidden = shown > 0;
  }

  function setIssueTab(tab) {
    explorer.tab = tab;
    $$("[data-issue-tab]").forEach((b) => {
      const on = b.dataset.issueTab === tab;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", String(on));
    });
    filterIssues();
  }

  // 标签横排成 chip 条时，标签一多就会挤成两行再挤成三行；收进下拉，
  // 左栏的高度就不再随标签数量变化。
  function setIssueLabel(label) {
    explorer.label = label;
    $$("[data-issue-label]").forEach((b) => b.classList.toggle("active", b.dataset.issueLabel === label));
    const cur = $("[data-label-current]");
    if (cur) cur.textContent = label === "全部" ? "全部标签" : label;
    $("[data-label-menu]")?.setAttribute("hidden", "");
    $("[data-label-menu-toggle]")?.setAttribute("aria-expanded", "false");
    filterIssues();
  }

  function setLabelMenu(open) {
    const menu = $("[data-label-menu]");
    if (!menu) return;
    menu.hidden = !open;
    $("[data-label-menu-toggle]")?.setAttribute("aria-expanded", String(open));
  }

  // 左框选中一项 → 右主体换成它的内容。六个面共用这一套。
  function pickInList(group, value, scope) {
    $$(`[data-${group}-pick]`, scope).forEach((b) => b.classList.toggle("active", b.dataset[`${group}Pick`] === value));
    const views = $$(`[data-${group}-view]`, scope);
    if (views.length) views.forEach((el) => (el.hidden = el.dataset[`${group}View`] !== value));
  }

  // 项目面：点文件在右侧出预览（GitHub 式），树本身不跳走
  function openFilePreview(key) {
    $$("[data-file-view]").forEach((el) => {
      const on = el.dataset.fileView === key;
      el.hidden = !on;
      el.classList.toggle("active", on);
    });
    $$("[data-tree-open]").forEach((b) => b.classList.toggle("selected", b.dataset.treeOpen === key));
  }

  // ── 目录树：折叠状态只影响下一层，深层保持原样 ────────────────
  function treeToggle(node) {
    const open = node.classList.toggle("open");
    $(".tn-twisty", node).textContent = open ? "▾" : "▸";
    applyTreeVisibility();
  }

  // 过滤时把树摊平成命中列表；清空后按各节点的折叠状态复原
  function filterFileTree(q) {
    const query = q.trim().toLowerCase();
    if (!query) {
      applyTreeVisibility();
      refreshTreeCount(null);
      return;
    }
    let n = 0;
    $$("[data-tree-node]").forEach((node) => {
      const hit = $(".tn-name", node).textContent.toLowerCase().includes(query);
      node.hidden = !hit;
      if (hit) n += 1;
    });
    refreshTreeCount(n);
  }

  // 一个节点可见，当且仅当它所有祖先目录都是展开的
  function applyTreeVisibility() {
    const openAt = [];
    $$("[data-tree-node]").forEach((node) => {
      const depth = Number(node.style.getPropertyValue("--tn-depth"));
      node.hidden = openAt.slice(0, depth).some((v) => v === false);
      openAt[depth] = node.dataset.treeNode === "dir" ? node.classList.contains("open") : true;
      openAt.length = depth + 1;
    });
  }

  function refreshTreeCount(n) {
    const el = $("[data-tree-count]");
    if (!el) return;
    el.textContent = n == null ? "" : `${n} 项匹配`;
  }

  // ── 一组同构的 tab：切按钮 + 切对应的面 ──────────────────────
  function setLocalTab(group, value) {
    $$(`[data-${group}-tab]`).forEach((b) => {
      const on = b.dataset[`${group}Tab`] === value;
      b.classList.toggle("active", on);
      if (b.getAttribute("role") === "tab") b.setAttribute("aria-selected", String(on));
    });
    $$(`[data-${group}-body]`).forEach((el) => (el.hidden = el.dataset[`${group}Body`] !== value));
  }

  // ── 统计面 ────────────────────────────────────────────────
  // 三个开关互不影响：周期（页级）决定看哪一段时间、指标（卡内）决定
  // 画什么、形态（卡内）决定怎么画。周期同时决定哪些形态可用——365 根
  // 柱子挤在一屏里读不出东西，30 天的热力图又只有 5 列。
  const statRanges = {
    "7": { span: "7 天", paid: "$0.44", eq: "$5.93", tok: "27.1M", tin: "25.4M", tout: "1.6M",
      time: "8h 00m", tmodel: "1h 46m", ttool: "5h 02m", runs: "42", failed: "3", cache: "16.3M",
      failrate: "7.1%", failcombo: "3", failtop: "1", shapes: ["day"], defaultShape: "day" },
    "30": { span: "30 天", paid: "$2.10", eq: "$28.61", tok: "131.6M", tin: "123.7M", tout: "7.9M",
      time: "35h 56m", tmodel: "7h 54m", ttool: "22h 38m", runs: "206", failed: "15", cache: "79.0M",
      failrate: "7.3%", failcombo: "4", failtop: "6", shapes: ["day", "week"], defaultShape: "day" },
    "365": { span: "一年", paid: "$19.31", eq: "$262.57", tok: "1.14B", tin: "1.07B", tout: "68.5M",
      time: "291h 35m", tmodel: "64h 09m", ttool: "183h 42m", runs: "1,707", failed: "128", cache: "684.0M",
      failrate: "7.5%", failcombo: "6", failtop: "50", shapes: ["week", "year"], defaultShape: "year" },
  };
  const statMetricAxis = { tok: "aTok", cost: "aCost", secs: "aSecs", runs: "aRuns" };
  const statMetricOrder = ["tok", "cost", "secs", "runs"];
  let statRange = "30";

  function setStatMetric(metric) {
    const at = statMetricOrder.indexOf(metric);
    if (at < 0) return;
    $$("[data-stat-metric]").forEach((b) => b.classList.toggle("active", b.dataset.statMetric === metric));
    $$("[data-statshape-body] .sb-col").forEach((col) => {
      const v = (col.dataset.m ?? "").split(",")[at];
      if (v !== undefined) col.style.setProperty("--h", `${v}%`);
    });
    // 热力图每格把四个指标的档位压在一个 data-m 里（一位一个指标），
    // 换指标就是换读第几位——不重画 371 个格子。
    $$(".hm-cell").forEach((cell) => {
      const code = cell.dataset.m ?? "";
      if (code.length > at) cell.dataset.l = code[at];
    });
    $$("[data-statshape-body]").forEach((body) => {
      const label = body.dataset[statMetricAxis[metric]];
      const axis = $("[data-axis-max]", body);
      if (label && axis) axis.textContent = label;
    });
  }

  function fillByRange(scope) {
    $$("[data-v30]", scope).forEach((row) => {
      const values = (row.dataset[`v${statRange}`] ?? "").split("|");
      const slots = $$(".dl-num, [data-fill]", row);
      slots.forEach((slot, i) => {
        const value = values[i];
        if (value === undefined) return;
        if (slot.dataset.fill === "width") slot.style.setProperty("--w", `${value}%`);
        else slot.textContent = value;
      });
    });
  }

  // 详情表按页翻，每页 10 条。「本页合计」跟着页码走，「合计」不带页码——
  // 分页最容易翻掉的就是对账关系：合计行必须始终是整个周期的数。
  const STAT_PAGES = 2;
  let statPage = 1;

  function setStatPage(page) {
    statPage = Math.min(STAT_PAGES, Math.max(1, page));
    $$("[data-page]").forEach((el) => (el.hidden = Number(el.dataset.page) !== statPage));
    const now = $("[data-page-now]");
    if (now) now.textContent = String(statPage);
    const prev = $('[data-stat-page="prev"]');
    const next = $('[data-stat-page="next"]');
    if (prev) prev.disabled = statPage === 1;
    if (next) next.disabled = statPage === STAT_PAGES;
  }

  function setStatRange(days) {
    const preset = statRanges[days];
    if (!preset) return;
    statRange = days;
    $$("[data-stat-range]").forEach((b) => b.classList.toggle("active", b.dataset.statRange === days));
    $$("[data-stat-span]").forEach((el) => (el.textContent = preset.span));
    $$("[data-kpi]").forEach((el) => {
      const value = preset[el.dataset.kpi];
      if (value !== undefined) el.textContent = value;
    });
    const failedBadge = $("[data-stat-failed]");
    if (failedBadge) failedBadge.textContent = preset.failed;
    fillByRange($('[data-surface-view="stats"]'));
    // 形态跟着周期开关：不可用的置灰而不是隐藏——藏起来等于替用户
    // 决定了他不需要它，而这里要说明白的恰恰是「为什么这个周期没有它」。
    const active = $("[data-statshape-tab].active")?.dataset.statshapeTab;
    $$("[data-statshape-tab]").forEach((b) => {
      const ok = preset.shapes.includes(b.dataset.statshapeTab);
      b.disabled = !ok;
      b.title = ok ? "" : `「${b.textContent.trim()}」在${preset.span}这个周期下读不出东西`;
    });
    if (!preset.shapes.includes(active)) setLocalTab("statshape", preset.defaultShape);
  }

  // 会话面复用任务面的骨架：左列表 + 上 tab + 消息流 + 漂浮输入框。
  // tab 切的是「哪一类会话」，左列表跟着只显示这一类。
  const threadMeta = {
    "thread-adr": ["ADR 0013 的 stance 白名单要不要放宽", "codex-gpt5.6-high", "2026-08-30 19:12", "冷启动 · 3 个回合", "solo"],
    "thread-ask": ["这个仓库的 workspace 依赖是怎么解析的", "claude-sonnet5-low", "2026-08-29 11:03", "已结束 · 2 个回合", "solo"],
    "thread-idea": ["随手记：验收面的三张卡能不能合成一张", "还没派出去", "2026-08-27 22:40", "只有你写的一条", "solo"],
    "thread-ph": ["PersonaHub 现在整体什么情况", "claude-sonnet5-medium", "2026-08-29 16:20", "冷启动 · 3 个回合", "project"],
    "thread-mg": ["Market Game Sim 要不要先绑代码目录", "还没派出去", "2026-08-22 09:30", "只有你写的一条", "project"],
  };

  function setThreadTab(kind) {
    $$("[data-thread-tab]").forEach((b) => b.classList.toggle("active", b.dataset.threadTab === kind));
    $$("[data-thread-pane]").forEach((el) => (el.hidden = el.dataset.threadPane !== kind));
    let shown = 0;
    $$("[data-thread-kind]").forEach((el) => {
      el.hidden = el.dataset.threadKind !== kind;
      if (!el.hidden) shown += 1;
    });
    const empty = $("[data-thread-empty]");
    if (empty) empty.hidden = shown > 0;
    // 切类别后选中该类别的第一条，否则标题还停在上一类的会话上
    const first = $$("[data-thread-kind]:not([hidden]) [data-thread-pick]")[0];
    if (first) pickThread(first.dataset.threadPick);
  }

  function pickThread(id) {
    const row = threadMeta[id];
    if (!row) return;
    const [title, combo, started, state] = row;
    $$("[data-thread-pick]").forEach((b) => b.classList.toggle("active", b.dataset.threadPick === id));
    const name = $("[data-thread-name]");
    if (name) name.textContent = title;
    const meta = $("[data-thread-meta]");
    if (!meta) return;
    const spans = $$("span", meta);
    spans[0].innerHTML = `执行组合 <b>${combo}</b>`;
    spans[1].innerHTML = `开始 <b>${started}</b>`;
    spans[2].textContent = state;
  }

  // 右侧留白的解法：每个视图 = 主栏 + 副栏，副栏放「看主栏时最想同时
  // 看到的那一份」。三档布局——both（默认）/ main（收起副栏，主栏拉满）
  // / aside（放大副栏，主栏让位，用于复盘轨迹）。
  function setSplitLayout(key, layout) {
    const split = $(`[data-split="${key}"]`);
    if (!split) return;
    split.dataset.layout = layout;
    const reopen = $(`[data-aside-open="${key}"]`);
    if (reopen) reopen.hidden = layout !== "main";
    const zoom = $(`[data-aside-zoom="${key}"]`);
    if (zoom) zoom.textContent = layout === "aside" ? "⤡" : "⤢";
  }

  // 资源面：点清单里的一项，右侧换成它的内容（和项目面同构）
  function openResource(key) {
    $$("[data-res-open]").forEach((b) => b.classList.toggle("active", b.dataset.resOpen === key));
    $$("[data-res-view]").forEach((el) => {
      const on = el.dataset.resView === key;
      el.hidden = !on;
      el.classList.toggle("active", on);
    });
  }

  function setPane(name) {
    const composer = $("[data-pane-composer]");
    if (composer) state.draft = $("[data-pane-input]", composer)?.value ?? state.draft;

    state.pane = name;
    $$("[data-pane-tab]").forEach((b) => b.classList.toggle("active", b.dataset.paneTab === name));
    $$("[data-pane]").forEach((pane) => (pane.hidden = pane.dataset.pane !== name));

    // 子文档（文件 / 阶段成果 / 知识）活在验收面里，靠返回条回来
    const input = $("[data-pane-input]");
    if (input) input.value = state.draft;
    setRecipientPopover(false);
    setScopePopover(false);
  }

  // tab 上的数字 = 需要人工介入的件数，不是内容总数。
  // 去重规则：一件事只在它的「处理位置」计数——基线变更的按钮在概览，
  // 所以只算概览，不在会话里重复计一次。
  function refreshPaneCounts() {
    const counts = {
      overview: $("[data-baseline-gate]") && !$("[data-baseline-gate]").hidden ? 1 : 0,
      thread: $$('[data-room-panel].active .handoff-draft:not([hidden])').length,
      acceptance: $$('.task-document.active .claim-item.attention').length,
      // 概览块与 article 同步切换，计数只看当前这一块
    };
    $$("[data-pane-count]").forEach((el) => {
      const n = counts[el.dataset.paneCount] ?? 0;
      el.textContent = String(n);
      el.hidden = n === 0;
    });
  }

  function setScopePopover(open) {
    const pop = $("[data-scope-popover]");
    if (!pop) return;
    pop.hidden = !open;
    $("[data-scope-open]")?.setAttribute("aria-expanded", String(open));
  }

  function setContextScope(label) {
    state.contextScope = label;
    const el = $("[data-scope-label]");
    if (el) el.textContent = label;
    $$("[data-scope-pick]").forEach((b) => b.classList.toggle("active", b.dataset.scopePick === label));
    // 把验证类的上下文改回「全部」，这次验证就不算独立（ADR 0012 第 4 条保护条款）
    const warn = $("[data-scope-warn]");
    if (warn) {
      warn.classList.toggle("firing", label === "全部");
      warn.textContent =
        label === "全部"
          ? "⚠ 已选「全部」：验证者会读到实现者的自述，这次验证不算独立，AC-002 的结论将降级"
          : "⚠ 改成「全部」的话，这次验证不算独立，AC-002 的结论会降级";
    }
  }

  function setProjectFilter(name) {
    const label = $("[data-project-filter-label]");
    if (label) label.textContent = name;
    $$("[data-project-pick]").forEach((b) => b.classList.toggle("active", b.dataset.projectPick === name));
    $("[data-project-filter-menu]").hidden = true;
    $("[data-project-filter]")?.setAttribute("aria-expanded", "false");
    showToast(`任务列表已筛为「${name}」；管理项目本身走左上角的项目入口`);
  }

  // ── 验收基线决策：舞台与 Dock 的分工 ──────────────────────
  //
  // 舞台放「待决状态 + 决策界面」，Dock 放「对话原文」。
  // 决定本身产生的是**状态变更**，不是一条你发给实现者的消息——
  // 实现者不在线（ADR 0009：每次执行都是全新进程），它收不到消息，
  // 只会在下次被调度时拿到已经更新的验收基线。
  function revealBaselineRequest() {
    const msg = $("[data-baseline-request]");
    if (!msg) return;
    setPane("thread");
    setPanel("primary");
    msg.scrollIntoView({ block: "center", behavior: "smooth" });
    msg.classList.add("flash");
    window.setTimeout(() => msg.classList.remove("flash"), 1600);
  }

  function decideBaseline(approved) {
    const gate = $("[data-baseline-gate]");
    const claim = $('[data-claim="AC-002"]');
    if (!gate || !claim) return;

    gate.hidden = true;

    if (approved) {
      // 关键一条：改了基线，原来的绿勾就不成立了——
      // 已有证据验的是旧断言 r1，r2 的证据还没产生。
      claim.dataset.claimState = "pending";
      const mark = $(".claim-mark", claim);
      mark.className = "claim-mark pending";
      mark.textContent = "◐";
      $("[data-claim-text]", claim).textContent = "旧 revision ref 解析旧内容，或在源文件缺失时返回 null";
      const rev = $("[data-claim-rev]", claim);
      rev.hidden = false;
      rev.textContent = "r2 · 你批准于 14:32";
      const verdict = $("[data-claim-verdict]", claim);
      verdict.className = "claim-verdict pending";
      verdict.innerHTML =
        "<span>结论</span>下面两条证据验的是 <b>r1</b>，基线已改为 r2 —— r2 的证据尚未产生，独立验证需要重跑";

      setText("[data-count-verified]", "0 / 3 条主张");
      setText("[data-count-pending]", "2 条");
      $("[data-change-text]").innerHTML = "你已批准 <code>AC-002</code> 的验收基线 → <b>r2</b> · 14:32 · 旧主张与旧证据仍可追溯";
      showBaselineEvent("验收基线 AC-002 → r2（你批准）· 已有证据仍指向 r1，需重新验证");
      refreshPaneCounts();
      showToast("已批准为 r2：旧证据验的是 r1，这条主张退回「有证据待验证」");
    } else {
      const rev = $("[data-claim-rev]", claim);
      rev.hidden = false;
      rev.textContent = "r1 · 你拒绝了修改";
      $("[data-change-text]").innerHTML = "你已拒绝 <code>AC-002</code> 的基线修改 · 14:32 · 实现需按原断言继续";
      showBaselineEvent("验收基线 AC-002 保持 r1（你拒绝）· 实现需按原断言继续");
      refreshPaneCounts();
      showToast("已拒绝：验收基线保持 r1，已有的独立验证仍然成立");
    }
  }

  function showBaselineEvent(text) {
    const row = $("[data-baseline-event]");
    if (!row) return;
    row.hidden = false;
    $("[data-baseline-event-text]", row).textContent = text;
    row.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  function setText(selector, value) {
    const el = $(selector);
    if (el) el.textContent = value;
  }

  // Dock 只有一个输入框在场——取当前可见面板里的那个
  function activeComposer() {
    return $("[data-pane-input]");
  }

  function fillComposer(text) {
    const input = activeComposer();
    if (!input) return;
    input.value = text;
    state.draft = text;
    input.focus();
    const at = text.match(/^@(\S+)/);
    if (at) setRecipient("@" + at[1]);
  }

  function setPanel(name) {
    state.dockPanel = name;
    $$('[data-room-panel]').forEach((panel) => panel.classList.toggle("active", panel.dataset.roomPanel === name));
  }

  // 收件人是显式的一件事，不由「看哪个面板」隐含决定——
  // 这正是此前两个输入框分不清的根源。
  function setRecipient(label) {
    state.recipient = label;
    const target = $("[data-dock-target]");
    if (target) target.textContent = label;
    $$("[data-composer-to]").forEach((el) => (el.textContent = label));
    $$("[data-recipient]").forEach((option) =>
      option.classList.toggle("active", option.dataset.recipientLabel === label),
    );
  }

  function setRecipientPopover(open) {
    const popover = $("[data-recipient-popover]");
    const trigger = $("[data-recipient-open]");
    if (!popover) return;
    popover.hidden = !open;
    trigger?.setAttribute("aria-expanded", String(open));
  }

  // 固定住的收件人必须持续可见，并说明它属于哪个任务——
  // 否则会对着上一个任务的执行组合发指令。
  function renderPinnedNote() {
    const note = $("[data-dock-parent]");
    if (!note) return;
    note.hidden = !state.dockPinned;
    if (state.dockPinned) {
      note.textContent = `已固定发给 ${state.recipient} · 属于任务「${state.dockTaskLabel}」 · 切换任务不跟随`;
    }
  }

  function setRoomPaused(paused) {
    state.roomPaused = paused;
    const stateLabel = $("[data-room-state]");
    const indicator = stateLabel?.closest(".live-indicator");
    const button = $("[data-room-pause]");
    if (stateLabel) stateLabel.textContent = paused ? "已暂停" : "活跃";
    if (indicator) indicator.classList.toggle("paused", paused);
    if (button) button.innerHTML = paused ? "<span>▶</span><b>恢复后续步骤</b>" : "<span>Ⅱ</span><b>暂停后续步骤</b>";
    const shell = $(".app-shell");
    if (shell) shell.dataset.roomPaused = paused ? "true" : "false";
    showToast(paused ? "已暂停后续步骤：正在运行的步骤继续，尚未开始的步骤不会启动" : "已恢复后续步骤：将按原队列继续");
  }

  function setCommand(open) {
    const overlay = $("[data-command-overlay]");
    const input = $("[data-command-input]");
    if (!overlay) return;
    overlay.hidden = !open;
    if (open) window.setTimeout(() => input?.focus(), 0);
    else if (input) input.value = "";
  }

  function setTaskCreate(open) {
    const overlay = $("[data-task-create-overlay]");
    if (!overlay) return;
    overlay.hidden = !open;
    if (open) window.setTimeout(() => $("[data-task-goal]")?.focus(), 0);
  }


  // ── 账号与凭据弹层 ─────────────────────────────────────────
  // 认证方式决定要填什么：登录态那一支**没有输入项**，PersonaHub 不代管
  // token；只有 API Key 这一支才由 PersonaHub 自己存。两支共用一个弹层，
  // 但绝不共用字段——混在一起会让人以为登录态也要填 key。
  function setAccountMode(mode) {
    $$("[data-account-mode]").forEach((b) => b.classList.toggle("active", b.dataset.accountMode === mode));
    $$("[data-account-body]").forEach((el) => (el.hidden = el.dataset.accountBody !== mode));
  }

  function setAccountDialog(target) {
    const overlay = $("[data-account-dialog]");
    if (!overlay) return;
    if (target === false) {
      overlay.hidden = true;
      return;
    }
    const editing = typeof target === "string" && target;
    $("[data-account-title]").textContent = editing ? "编辑账号 · " + target : "新增账号";
    $("[data-account-context]").textContent = editing
      ? "已保存的 key 不回显；留空表示不改"
      : "凭据只存在本机，不上传";
    setAccountMode(editing ? "api_key" : "oauth");
    overlay.hidden = false;
  }

  // ── 执行组合选择器 ──────────────────────────────────────────
  // 这里没有「成员」这种常驻角色：能派出去的最小单位是**执行组合**
  // （adapter × 模型 × 深度），由设置里的 adapter 检查决定有哪些，
  // 不在这个弹层里增删。选哪一个本身就是要向使用者解释的判断，
  // 所以每一行都必须说清「为什么建议 / 为什么不建议 / 为什么不能选」
  // （design.md §4.6）。
  const COMBOS = [
    { id: "codex-gpt5.6-high", adapter: "codex", model: "gpt-5.6", depth: "high", mark: "C", tone: "blue", quota: "剩 42 次", tags: ["代码实现", "重构", "测试"], status: "ok" },
    { id: "codex-gpt5.6-medium", adapter: "codex", model: "gpt-5.6", depth: "medium", mark: "C", tone: "blue", quota: "剩 107 次", tags: ["代码实现", "测试"], status: "ok" },
    { id: "claude-opus5-high", adapter: "claude", model: "opus-5", depth: "high", mark: "A", tone: "purple", quota: "剩 3 次 low 折算", tags: ["架构", "调研", "综合"], status: "quota" },
    { id: "claude-opus5-medium", adapter: "claude", model: "opus-5", depth: "medium", mark: "A", tone: "purple", quota: "剩 1 次", tags: ["架构", "调研", "综合"], status: "ok" },
    { id: "claude-sonnet5-medium", adapter: "claude", model: "sonnet-5", depth: "medium", mark: "A", tone: "purple", quota: "剩 451 次", tags: ["代码审查", "验证"], status: "ok" },
    { id: "claude-haiku4.5-low", adapter: "claude", model: "haiku-4.5", depth: "low", mark: "A", tone: "purple", quota: "剩 5.2k 次", tags: ["格式整理"], status: "ok" },
    { id: "opencode-qwen3max-medium", adapter: "opencode", model: "qwen3-max", depth: "medium", mark: "O", tone: "amber", quota: "本地无限", tags: ["综合", "格式整理"], status: "unchecked" },
  ];

  // 本次实现是哪个模型做的。同源判定看**模型**，不看深度：
  // 同一个模型换个深度再验一遍，验的还是它自己。
  const CURRENT_IMPLEMENTER_MODEL = "gpt-5.6";
  // 本阶段检索用过的组合（对应协作现场那两条已交付/执行中的泳道），综合步据此判定兼任。
  const RESEARCH_USED = ["codex-gpt5.6-high", "claude-sonnet5-medium"];

  // ── 「这一步需要什么」：两个来源，取并集（design.md §4.6 第 2 条）──────
  // A = 本次命中的 Skill 各自声明的要求；B = 工作流 / 编组这一步声明的要求。
  // 不设优先级：要求的语义是「至少要满足什么」，并集只会更严不会更松，
  // 因此天然没有「冲突时听谁的」——同 ADR 0018 第 5 条「只能加严，不能放宽」。
  //
  // 两个来源互补对方的洞：B 最准，但 ad-hoc 派工（直接在会话里说一句）没有
  // 步骤，等于不设防；A 覆盖 ad-hoc，但只有**派工前就能确定命中**的 Skill 才
  // 算数——按触碰路径命中的那类，派工时还不知道会改哪些文件，算不出来。
  // **算不出来的不猜，不进这一排。**
  const SKILL_REQUIREMENTS = {
    implementer: [{ tag: "代码实现", from: "skill", label: "改动前先跑 npm run verify" }],
    validator: [{ tag: "验证", from: "skill", label: "验证结论必须逐条挂证据" }],
    synthesizer: [{ tag: "架构", from: "skill", label: "架构设计：先列约束再给两个方案" }],
  };
  const STEP_REQUIREMENTS = {
    implementer: [{ tag: "代码实现", from: "step", label: "Coding · 实现" }],
    validator: [{ tag: "验证", from: "step", label: "Coding · 独立验证" }, { tag: "隔离验证", from: "step", label: "Coding · 独立验证" }],
    synthesizer: [{ tag: "综合", from: "step", label: "Research · 收敛" }],
  };
  function requirementsFor(role) {
    const merged = new Map();
    for (const r of [...(SKILL_REQUIREMENTS[role] ?? []), ...(STEP_REQUIREMENTS[role] ?? [])]) {
      const hit = merged.get(r.tag);
      // 同一个 tag 两边都要求 → 合并来源，不是二选一
      if (hit) hit.sources.push(r);
      else merged.set(r.tag, { tag: r.tag, sources: [r] });
    }
    return [...merged.values()];
  }
  const SOURCE_LABEL = { skill: "来自 Skill", step: "来自步骤" };

  // 组合满足了哪些要求、缺哪些。缺 ≠ 不能选：那是质量判断，归使用者（§4.6 第 6 条）
  function unmetRequirements(c, role) {
    return requirementsFor(role).filter((r) => !c.tags.includes(r.tag)).map((r) => r.tag);
  }

  // 所有角色共用的前置：组合本身能不能派出去，和这一步要什么无关。
  function comboBlocked(c) {
    if (c.status === "unchecked") return "adapter 登录状态需要重新检查，现在派过去会直接失败";
    if (c.status === "quota") return "额度剩余 3 次 low 折算，不足以完成一次 high（需 5 次）——额度池见设置 · 运行时";
    return null;
  }

  const PICKER_ROLES = {
    implementer: {
      title: "选择执行组合",
      context: "为「实现」挑一个执行组合",
      rule: "实现步可以用任何具备对应能力的组合。中途换组合会冷启动一个新进程（ADR 0009），已有改动不会丢，但上下文要重新给。",
      judge: (c) => {
        const stop = comboBlocked(c);
        if (stop) return { level: "blocked", why: stop };
        const miss = unmetRequirements(c, "implementer");
        return miss.length
          ? { level: "weak", why: "不满足要求：" + miss.join(" · ") + "。可以选——这是质量判断，但主张上会留一条标注" }
          : { level: "good", why: "满足全部要求：" + c.tags.join(" · ") };
      },
    },
    validator: {
      title: "选择验证用的执行组合",
      context: "为「独立验证」挑一个执行组合",
      rule: "实现与验证不能同源（PRD 第 7.5 节）。同源看的是**模型**，不是深度——同一个模型换个深度再验一遍，验的还是它自己。",
      judge: (c) => {
        if (c.model === CURRENT_IMPLEMENTER_MODEL) {
          return { level: "blocked", why: "本次实现就是 " + c.model + " 做的，换深度不解决同源，自己验自己不成立" };
        }
        const stop = comboBlocked(c);
        if (stop) return { level: "blocked", why: stop };
        const miss = unmetRequirements(c, "validator");
        return miss.length
          ? { level: "weak", why: "与实现者不同源，硬约束过了；但不满足要求：" + miss.join(" · ") }
          : { level: "good", why: "满足全部要求 · 与实现者不同模型" };
      },
    },
    synthesizer: {
      title: "选择综合用的执行组合",
      context: "为「收敛为 synthesis_plan」挑一个执行组合",
      rule: "综合步不该由参与检索的组合兼任——兼任会让它偏向自己那份结论。",
      judge: (c) => {
        if (RESEARCH_USED.includes(c.id)) {
          return { level: "blocked", why: "它是本阶段的检索组合之一，兼任综合会偏向自己的结论" };
        }
        const stop = comboBlocked(c);
        if (stop) return { level: "blocked", why: stop };
        const miss = unmetRequirements(c, "synthesizer");
        return miss.length
          ? { level: "weak", why: "未参与本阶段检索，硬约束过了；但不满足要求：" + miss.join(" · ") + "。拿 low 深度跑架构设计属于这一档——不挡，但会留痕" }
          : { level: "good", why: "满足全部要求 · 未参与本阶段检索" };
      },
    },
  };

    // 三档的分界是「能不能」，不是「好不好」（§4.6 第 4 条）。
  // 早期版本把硬禁止那一档标成「不建议」——读到「不建议」的人会以为自己能
  // 坚持选，实际点不动，这与「硬约束先说」的意图相反。
  const LEVEL_LABEL = { good: "建议", weak: "可选", blocked: "不可选" };

  function setComboPicker(role) {
    const overlay = $("[data-combo-picker]");
    if (!overlay) return;
    if (!role) {
      overlay.hidden = true;
      return;
    }
    const spec = PICKER_ROLES[role];
    if (!spec) return;
    state.pickerRole = role;
    $("[data-picker-title]").textContent = spec.title;
    $("[data-picker-context]").textContent = spec.context;
    $("[data-picker-rule]").textContent = spec.rule;
    // 「这一步需要什么」：每个 tag 必须标出它从哪来——没有来源的行不允许出现
    // 在决定上下文的视图里（同 §3.2.4）。两处都要求同一个 tag 时并列两个来源。
    const needs = $("[data-picker-needs]");
    if (needs) {
      const reqs = requirementsFor(role);
      needs.innerHTML = reqs.length
        ? "<span class=\"pn-label\">这一步需要什么</span>" +
          reqs
            .map(
              (r) =>
                '<em class="cap-tag" title="' +
                r.sources.map((x) => SOURCE_LABEL[x.from] + "：" + x.label).join(" ／ ") +
                '">' + r.tag +
                r.sources.map((x) => '<i class="ct-src">' + SOURCE_LABEL[x.from] + "</i>").join("") +
                "</em>",
            )
            .join("") +
          '<small class="pn-note">两处贡献取<b>并集</b>，不设优先级——要求的语义是「至少要满足什么」，并集只会更严。</small>'
        : '<span class="pn-label">这一步没有声明要求</span><small class="pn-note">ad-hoc 派工且没有命中可预判的 Skill 时会这样；此时不猜，全部落「可选」。</small>';
    }
    const list = $("[data-picker-list]");
    list.innerHTML = "";
    const rows = COMBOS.map((c) => ({ c, v: spec.judge(c) }));
    // 建议在前、不建议在后，但不建议的**不隐藏**：藏起来就等于替用户
    // 做了判断，而这里的产品承诺恰恰是把判断依据摊开。
    const order = { good: 0, weak: 1, blocked: 2 };
    rows.sort((a, b) => order[a.v.level] - order[b.v.level]);
    for (const { c, v } of rows) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "picker-row " + v.level;
      row.dataset.pickComboId = c.id;
      if (v.level === "blocked") row.disabled = true;
      row.innerHTML =
        '<span class="member-avatar ' + c.tone + '">' + c.mark + "</span>" +
        "<span class=\"pr-body\">" +
        "<span class=\"pr-head\"><strong>" + c.id + "</strong>" +
        '<span class="pr-level ' + v.level + '">' + LEVEL_LABEL[v.level] + "</span></span>" +
        "<small>" + c.adapter + " · " + c.model + " · " + c.depth + " · " + c.quota + "</small>" +
        '<small class="pr-why">' + v.why + "</small>" +
        "</span>" +
        '<span class="pr-tags">' + c.tags.map((t) => "<i>" + t + "</i>").join("") + "</span>";
      list.appendChild(row);
    }
    overlay.hidden = false;
    window.setTimeout(() => list.querySelector(".picker-row:not([disabled])")?.focus(), 0);
  }

  // ── 指派撤销窗口（design.md §6）────────────────────────────
  // 发出指派后不立刻判定「已指派」：先进入可取消的启动窗口，
  // 指派与否由派工结果决定，不由文本前缀猜测。
  function startDispatch(label) {
    const bar = $("[data-dispatch-undo]");
    if (!bar) return;
    window.clearTimeout(state.dispatchTimer);
    bar.hidden = false;
    bar.classList.remove("settled");
    $("[data-undo-text]").textContent = "正在启动 " + label + "…";
    state.dispatchLabel = label;
    state.dispatchTimer = window.setTimeout(() => {
      bar.classList.add("settled");
      $("[data-undo-text]").textContent = label + " 已开始执行";
      state.dispatchTimer = window.setTimeout(() => { bar.hidden = true; }, 4000);
    }, 6000);
  }

  function cancelDispatch() {
    const bar = $("[data-dispatch-undo]");
    window.clearTimeout(state.dispatchTimer);
    if (bar) bar.hidden = true;
    showToast("已取消指派 · 没有产生执行记录");
  }

  function filterTree(value) {
    const activePanel = $("[data-explorer-panel].active");
    if (!activePanel) return;
    const query = value.trim().toLocaleLowerCase("zh-CN");
    $$('button', activePanel).forEach((button) => {
      if (button.matches("[data-folder-toggle]")) return;
      button.hidden = query !== "" && !button.textContent.toLocaleLowerCase("zh-CN").includes(query);
    });
  }

  function appendRoomMessage(text) {
    const stream = $("[data-message-stream]");
    if (!stream) return;
    const message = document.createElement("div");
    message.className = "message room-user-message user-message";
    message.innerHTML = `<span class="member-avatar user">我</span><div><header><strong>我</strong><time>现在</time></header><p></p></div>`;
    $("p", message).textContent = text;
    stream.appendChild(message);
    stream.scrollTop = stream.scrollHeight;
  }

  document.addEventListener("click", (event) => {
    const target = event.target.closest("button, a");
    // 点弹层外部即关闭——弹层比触发按钮高，不能只靠再点一次按钮
    if (!event.target.closest("[data-recipient-popover],[data-recipient-open]")) setRecipientPopover(false);
    if (!event.target.closest("[data-scope-popover],[data-scope-open]")) setScopePopover(false);
    if (!target) return;

    if (target.matches("a[href='#']")) event.preventDefault();

    if (target.dataset.surface) {
      setSurface(target.dataset.surface);
      if (target.dataset.openAfter) openDocument(target.dataset.openAfter, documentMeta[target.dataset.openAfter]?.[1]);
      return;
    }

    if (target.hasAttribute("data-label-menu-toggle")) {
      setLabelMenu($("[data-label-menu]").hidden);
      return;
    }

    if (target.dataset.treeOpen) {
      openFilePreview(target.dataset.treeOpen);
      return;
    }

    for (const group of ["automation", "settings", "runtime"]) {
      const value = target.dataset[`${group}Pick`];
      if (value) {
        pickInList(group, value);
        showToast(`已切换到「${$("strong", target)?.textContent ?? value}」`);
        return;
      }
    }

    if (target.dataset.threadTab) {
      setThreadTab(target.dataset.threadTab);
      return;
    }

    if (target.dataset.threadPick) {
      pickThread(target.dataset.threadPick);
      return;
    }

    if (target.hasAttribute("data-task-model-toggle")) {
      const menu = $("[data-task-model-menu]");
      menu.hidden = !menu.hidden;
      target.setAttribute("aria-expanded", String(!menu.hidden));
      return;
    }

    if (target.dataset.taskModelPick) {
      const value = target.dataset.taskModelPick;
      $$("[data-task-model-pick]").forEach((b) => b.classList.toggle("active", b === target));
      $("[data-task-model]").textContent = value;
      $("[data-task-model-menu]").hidden = true;
      $("[data-task-model-toggle]")?.setAttribute("aria-expanded", "false");
      return;
    }

    if (target.dataset.asideToggle) {
      setSplitLayout(target.dataset.asideToggle, "main");
      return;
    }

    if (target.dataset.asideOpen) {
      setSplitLayout(target.dataset.asideOpen, "both");
      return;
    }

    if (target.dataset.asideZoom) {
      const key = target.dataset.asideZoom;
      const now = $(`[data-split="${key}"]`)?.dataset.layout;
      setSplitLayout(key, now === "aside" ? "both" : "aside");
      showToast(now === "aside" ? "轨迹已还原为副栏" : "轨迹已放大：工具栏、搜索与详情栏都在这里");
      return;
    }

    if (target.dataset.resOpen) {
      openResource(target.dataset.resOpen);
      return;
    }

    if (target.dataset.issueTab) {
      setIssueTab(target.dataset.issueTab);
      return;
    }

    if (target.dataset.issueLabel) {
      setIssueLabel(target.dataset.issueLabel);
      return;
    }

    if (target.hasAttribute("data-tree-toggle")) {
      treeToggle(target);
      return;
    }

    if (target.hasAttribute("data-tree-collapse-all")) {
      $$("[data-tree-node].open").forEach((n) => treeToggle(n));
      return;
    }

    if (target.dataset.resDir) {
      const dir = target.dataset.resDir;
      $$("[data-res-dir]").forEach((b) => b.classList.toggle("active", b.dataset.resDir === dir));
      $$("[data-res-body]").forEach((el) => (el.hidden = el.dataset.resBody !== dir));
      return;
    }

    for (const group of ["project", "memory", "library", "automation", "runtime", "stat", "statshape", "statdim"]) {
      const value = target.dataset[`${group}Tab`];
      if (value) {
        setLocalTab(group, value);
        return;
      }
    }

    if (target.dataset.statRange) {
      setStatRange(target.dataset.statRange);
      return;
    }

    if (target.dataset.statMetric) {
      setStatMetric(target.dataset.statMetric);
      return;
    }

    if (target.dataset.statPage) {
      setStatPage(statPage + (target.dataset.statPage === "next" ? 1 : -1));
      return;
    }

    if (target.hasAttribute("data-group-toggle")) {
      const group = target.closest(".nav-group");
      if (group) {
        const collapsed = group.classList.toggle("collapsed");
        const twisty = $(".twisty", target);
        if (twisty) twisty.textContent = collapsed ? "›" : "⌄";
        target.setAttribute("aria-expanded", String(!collapsed));
      }
      return;
    }

    // 点分段条（或图例）= 把表格筛到这一类事件。概览与表格是同一份数据的
    // 两种画法：概览答「时间花在哪」，表格答「具体做了什么」。
    if (target.dataset.tlSeg) {
      filterTraceByKind(traceKind === target.dataset.tlSeg ? "" : target.dataset.tlSeg);
      return;
    }

    if (target.hasAttribute("data-tr-event")) {
      selectTraceEvent(target);
      return;
    }

    if (target.hasAttribute("data-tr-detail-close")) {
      $("[data-trace-detail]").hidden = true;
      $$("[data-tr-event]").forEach((r) => r.classList.remove("selected"));
      return;
    }

    if (target.dataset.tdTab) {
      $$("[data-td-tab]").forEach((b) => b.classList.toggle("active", b === target));
      const row = $("[data-tr-event].selected");
      const body = $("[data-td-body]");
      const map = {
        result: row?.dataset.trDetail || "这一行没有结果。",
        payload: ($(".tr-main", row)?.textContent || "").replace(/^\S+\s*/, "") || "无入参",
        timing: $(".tr-extra", row)?.textContent || "无耗时记录",
      };
      if (body) body.textContent = map[target.dataset.tdTab];
      return;
    }

    if (target.dataset.trToggle) {
      const key = target.dataset.trToggle;
      const on = target.classList.toggle("active");
      const shell = target.closest(".trace-main");
      if (key === "duration") shell.classList.toggle("no-duration", !on);
      if (key === "turns") $$(".tr-row.user, .tr-row.system", shell).forEach((r) => (r.hidden = on));
      if (key === "calls") $$(".tr-row.tool", shell).forEach((r) => (r.hidden = on));
      refreshTraceCount();
      return;
    }

    if (target.dataset.pickModel) {
      comboState.model = target.dataset.pickModel;
      syncCombo();
  refreshTraceCount();
      if (target.dataset.advice) showToast(`不建议：${target.dataset.advice}`);
      return;
    }

    if (target.dataset.projectTab) {
      const card = target.closest(".project-card");
      if (card) {
        const name = target.dataset.projectTab;
        $$("[data-project-tab]", card).forEach((b) => b.classList.toggle("active", b === target));
        $$("[data-project-body]", card).forEach((body) => (body.hidden = body.dataset.projectBody !== name));
      }
      return;
    }

    if (target.dataset.gotoPane) {
      // 轨迹不再是独立 tab：它是会话面里那条可放大的副栏
      if (target.dataset.gotoPane === "trace") {
        setPane("thread");
        setSplitLayout("thread", "aside");
        return;
      }
      setPane(target.dataset.gotoPane);
      return;
    }

    if (target.dataset.adoptNext) {
      fillComposer(target.dataset.adoptNext);
      showToast("已把建议写入输入框；可以直接改");
      return;
    }

    if (target.dataset.paneTab) {
      setPane(target.dataset.paneTab);
      return;
    }

    if (target.hasAttribute("data-goto-acceptance")) {
      setPane("acceptance");
      return;
    }

    if (target.hasAttribute("data-scope-open")) {
      setScopePopover($("[data-scope-popover]")?.hidden !== false);
      return;
    }

    if (target.dataset.scopePick) {
      setContextScope(target.dataset.scopePick);
      setScopePopover(false);
      return;
    }

    if (target.hasAttribute("data-project-filter")) {
      const menu = $("[data-project-filter-menu]");
      if (menu) {
        menu.hidden = !menu.hidden;
        target.setAttribute("aria-expanded", String(!menu.hidden));
      }
      return;
    }

    if (target.dataset.projectPick) {
      setProjectFilter(target.dataset.projectPick);
      return;
    }

    // 会话面里切 Room：Room 是阅读容器，承载什么由用户决定（ADR 0012）
    if (target.dataset.roomPick) {
      $$("[data-room-pick]").forEach((b) => b.classList.toggle("active", b === target));
      setPanel(target.dataset.roomPick);
      return;
    }

    // 舞台不复述对话，只留一个回链到 Dock 的原文
    if (target.hasAttribute("data-reveal-request")) {
      revealBaselineRequest();
      return;
    }

    if (target.dataset.baselineDecide) {
      decideBaseline(target.dataset.baselineDecide === "approve");
      return;
    }

    // 范围血统默认收起：对每天只看这个任务的人，完整路径是装饰（提案 §9.2）
    if (target.hasAttribute("data-scope-toggle")) {
      const full = target.closest(".task-document")?.querySelector("[data-scope-full]");
      if (full) {
        full.hidden = !full.hidden;
        target.textContent = full.hidden ? "展开血统" : "收起血统";
        target.setAttribute("aria-expanded", String(!full.hidden));
      }
      return;
    }

    // 三张卡是同一条验证进度轴上的三段，点卡片 = 筛主张树。
    // 三个数字之和必须等于主张总数，这是它们能并列的前提。
    if (target.dataset.claimFilterBtn) {
      const doc = target.closest(".task-document");
      const wanted = target.dataset.claimFilterBtn;
      const already = target.classList.contains("active");
      $$("[data-claim-filter-btn]", doc).forEach((b) => b.classList.toggle("active", !already && b === target));
      $$("[data-claim-state]", doc).forEach((item) => {
        item.hidden = !already && item.dataset.claimState !== wanted;
      });
      return;
    }

    // 轨迹筛选：复盘时通常只关心某一类事件（用例变更 / 产物 / 人工介入）
    if (target.dataset.traceFilter) {
      const pane = target.closest("[data-pane]");
      if (pane) {
        const kind = target.dataset.traceFilter;
        $$("[data-trace-filter]", pane).forEach((b) => b.classList.toggle("active", b === target));
        $$("[data-trace-kind]", pane).forEach((item) => {
          item.hidden = kind !== "all" && item.dataset.traceKind !== kind;
        });
      }
      return;
    }

    // 证据抽屉：三张状态卡就地展开原始命令 / 实际改动 / 独立性判定。
    // 抽查成本必须接近零——跳到另一个页面去核对，等于没有人会核对。
    if (target.dataset.drawerToggle) {
      const key = target.dataset.drawerToggle;
      const body = $(`[data-drawer-body="${key}"]`);
      if (body) {
        const open = body.hidden;
        // 同一行三张卡互斥，避免三个抽屉同时撑开把下文推到屏幕外
        const row = target.closest(".outcome-state");
        if (row) {
          $$("[data-drawer-body]", row).forEach((item) => (item.hidden = true));
          $$("[data-drawer-toggle]", row).forEach((item) => item.setAttribute("aria-expanded", "false"));
        }
        body.hidden = !open;
        target.setAttribute("aria-expanded", String(open));
      }
      return;
    }

    // 完成要求：就地展开这一条的可证伪切片（测试名 · 断言 · 实际输出）
    if (target.hasAttribute("data-claim-toggle")) {
      const body = target.nextElementSibling;
      if (body?.classList.contains("claim-body")) {
        body.hidden = !body.hidden;
        target.setAttribute("aria-expanded", String(!body.hidden));
      }
      return;
    }

    if (target.hasAttribute("data-new-object")) {
      if (state.explorer === "work") setTaskCreate(true);
      else {
        const labels = { resources: "新建资源", outputs: "登记产出", knowledge: "新建知识" };
        showToast(`${labels[state.explorer] || "新建"}：在这里打开对应表单`);
      }
      return;
    }

    if (target.hasAttribute("data-session-menu-toggle")) {
      const menu = target.nextElementSibling;
      $$(".session-menu").forEach((item) => {
        if (item !== menu) item.hidden = true;
      });
      if (menu?.classList.contains("session-menu")) menu.hidden = !menu.hidden;
      return;
    }

    if (target.hasAttribute("data-stage-back")) {
      const parent = state.stageParent;
      state.stageParent = null;
      if (parent) openDocument(parent, documentMeta[parent]?.[1]);
      return;
    }

    if (target.hasAttribute("data-account-new") || target.dataset.accountEdit) {
      setAccountDialog(target.dataset.accountEdit ?? null);
      return;
    }

    if (target.hasAttribute("data-account-close")) {
      setAccountDialog(false);
      return;
    }

    if (target.dataset.accountMode) {
      setAccountMode(target.dataset.accountMode);
      return;
    }

    if (target.dataset.pickCombo) {
      setComboPicker(target.dataset.pickCombo);
      return;
    }

    if (target.dataset.pickComboId) {
      const combo = COMBOS.find((c) => c.id === target.dataset.pickComboId);
      const role = state.pickerRole;
      setComboPicker(null);
      if (combo) {
        // §4.6 第 6 条：不满足要求不挡，但不能静默——这次产出的主张上要留一条
        // 标注。形态照 ADR 0012 第 4 条的保护条款（推翻默认可以，但会降级）。
        const miss = role ? unmetRequirements(combo, role) : [];
        startDispatch(combo.id);
        if (miss.length) {
          showToast("已派给 " + combo.id + "：它不满足「" + miss.join("、") + "」，这条会记在本次主张上");
        }
      }
      return;
    }

    if (target.hasAttribute("data-picker-close")) {
      setComboPicker(null);
      return;
    }

    if (target.hasAttribute("data-picker-goto-settings")) {
      setComboPicker(null);
      setSurface("settings");
      return;
    }

    if (target.hasAttribute("data-undo-cancel")) {
      cancelDispatch();
      return;
    }

    if (target.dataset.open) {
      openDocument(target.dataset.open, target.dataset.label || documentMeta[target.dataset.open]?.[1], {
        child: target.hasAttribute("data-stage-child"),
      });
      return;
    }

    if (target.dataset.taskScope) {
      const scope = target.dataset.taskScope;
      $$('[data-task-scope]').forEach((b) => b.classList.toggle("active", b.dataset.taskScope === scope));
      $$('[data-scope-only]').forEach((row) => { row.hidden = scope === "project" && row.dataset.scopeOnly === "all"; });
      showToast(scope === "all" ? "已切到全部项目：跨项目待办合并显示" : "已切回当前项目：PersonaHub");
      return;
    }

    if (target.hasAttribute("data-dock-rail")) {
      setLayout("balanced");
      return;
    }

    if (target.hasAttribute("data-folder-toggle")) {
      const children = target.nextElementSibling;
      const open = target.classList.toggle("expanded");
      const twisty = $(".twisty", target);
      if (twisty) twisty.textContent = open ? "⌄" : "›";
      if (children?.classList.contains("tree-children")) children.hidden = !open;
      return;
    }

    // 收件人选择器：Dock 只有一个输入框，发给谁是显式的一件事
    if (target.hasAttribute("data-recipient-open")) {
      setRecipientPopover($("[data-recipient-popover]")?.hidden !== false);
      return;
    }

    if (target.dataset.recipientLabel) {
      setRecipient(target.dataset.recipientLabel);
      setRecipientPopover(false);
      renderPinnedNote();
      showToast(`下一条指令将发给 ${target.dataset.recipientLabel}`);
      return;
    }

    // 内嵌的协作现场段：Room 是流里的一段，不是第二个阅读入口
    if (target.hasAttribute("data-inline-room-toggle")) {
      const room = target.closest(".inline-room");
      if (room) {
        const collapsed = room.classList.toggle("collapsed");
        target.setAttribute("aria-expanded", String(!collapsed));
      }
      return;
    }

    if (target.dataset.layoutMode) {
      setLayout(target.dataset.layoutMode);
      return;
    }

    if (target.hasAttribute("data-dock-pin")) {
      state.dockPinned = !state.dockPinned;
      target.setAttribute("aria-pressed", String(state.dockPinned));
      target.classList.toggle("active", state.dockPinned);
      target.textContent = state.dockPinned ? "◆" : "◇";
      renderPinnedNote();
      if (!state.dockPinned) syncDock(state.document);
      showToast(
        state.dockPinned
          ? `已固定发给 ${state.recipient}；切换任务时收件人不跟随`
          : "已取消固定；收件人将跟随任务切换",
      );
      return;
    }

    if (target.hasAttribute("data-room-pause")) {
      setRoomPaused(!state.roomPaused);
      return;
    }

    if (target.hasAttribute("data-room-focus") || target.hasAttribute("data-thread-focus")) {
      activeComposer()?.focus();
      return;
    }

    const prefill = target.dataset.roomPrefill || target.dataset.threadPrefill;
    if (prefill) {
      fillComposer(prefill);
      showToast("已把建议指令写入输入框；可以改执行组合或要求");
      return;
    }

    if (target.hasAttribute("data-prefill-evidence")) {
      fillComposer("@claude-sonnet5-medium\n请验证竞态与归档回放，并附上测试命令、原始输出和明确结论。");
      showToast("已预填补充验证指令");
      return;
    }

    if (target.hasAttribute("data-change-next")) {
      jumpToChange(1);
      return;
    }

    if (target.hasAttribute("data-change-prev")) {
      jumpToChange(-1);
      return;
    }

    if (target.hasAttribute("data-command-open")) {
      setCommand(true);
      return;
    }


    if (target.hasAttribute("data-task-create-close")) {
      setTaskCreate(false);
      return;
    }

    if (target.dataset.commandAction) {
      const action = target.dataset.commandAction;
      setCommand(false);
      if (action === "picker") { setComboPicker(target.dataset.target); return; }
      if (action === "document") openDocument(target.dataset.target, documentMeta[target.dataset.target]?.[1]);
      if (action === "surface") setSurface(target.dataset.target);
      return;
    }

    if (target.dataset.demo) showToast(target.dataset.demo);
  });

  syncOverview(state.document);
  syncCombo();
  setIssueTab("recent");
  setPane("overview");
  setContextScope(state.contextScope);
  refreshPaneCounts();

  // 搜索只有一处：顶栏主搜索框。输入即筛左栏任务列表。
  $("[data-tr-search]")?.addEventListener("input", (event) => filterTrace(event.currentTarget.value));

  $("[data-depth-range]")?.addEventListener("input", (event) => {
    const row = currentModelRow();
    const allowed = (row?.dataset.depths || "low,medium,high").split(",");
    comboState.depth = allowed[Number(event.currentTarget.value)] || allowed[0];
    syncCombo();
  });

  $("[data-command-input]")?.addEventListener("input", (event) => {
    const value = event.currentTarget.value;
    filterTree(value);
    const hint = $("[data-command-hint]");
    if (hint) {
      hint.textContent = value
        ? `左栏已按「${value}」筛选 · 按 Esc 关闭面板后仍然保持`
        : "输入即筛左栏的任务列表；这是全站唯一的搜索入口。";
    }
  });

  $("[data-room-form]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = $("[data-room-input]");
    const text = input?.value.trim();
    if (!text) {
      showToast("请输入一条指令");
      return;
    }
    appendRoomMessage(text);
    if (input) input.value = "";
    if (/^@\S+/u.test(text)) {
      const draft = $(".fixed-handoff");
      if (draft) draft.hidden = true;
      const waiting = $(".room-thread-heading .pill");
      if (waiting) waiting.textContent = "已指派";
      const summary = $(".room-thread-heading > small");
      if (summary) summary.textContent = "Independent validation 已加入队列 · 将自动携带上一步产出与证据";
    }
    showToast("指令已加入协作现场；静态原型不会真的派工");
  });

  $("[data-thread-form]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = $("[data-thread-input]");
    const text = input?.value.trim();
    if (!text) {
      showToast("请输入一条任务指令");
      return;
    }
    const stream = $("[data-thread-message-stream]");
    if (stream) {
      const message = document.createElement("div");
      message.className = "message room-user-message user-message";
      message.innerHTML = `<span class="member-avatar user">我</span><div><header><strong>我</strong><time>现在</time></header><p></p></div>`;
      $("p", message).textContent = text;
      stream.appendChild(message);
    }
    if (input) input.value = "";
    showToast("指令已加入任务主会话；后续会自动携带任务上下文");
  });

  // 建完就开跑：这一条和「谁来做等会儿再说」的默认不同——用户在弹窗里
  // 已经选了执行模型，那就说明他现在就要它动起来。所以直接落到会话视图，
  // 并且把第一轮派工写进流里，而不是丢回概览让他再点一次。
  $("[data-account-form]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    setAccountDialog(false);
    showToast("静态原型不保存凭据；真实实现会保存后立刻做一次连通与 key 有效性检查");
  });

  $("[data-task-create-form]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const combo = $("[data-task-model]")?.textContent ?? "codex-gpt5.6-high";
    const goal = $("[data-task-title]")?.value.trim() || "新任务";
    setTaskCreate(false);
    setSurface("project");
    openDocument("issue-running", documentMeta["issue-running"][1]);
    setPane("thread");
    appendRoomMessage(goal);
    showToast(`任务已创建，已派给 ${combo} 并开始执行`);
  });

  $("[data-account-dialog]")?.addEventListener("click", (event) => {
    if (event.target === event.currentTarget) setAccountDialog(false);
  });

  $("[data-combo-picker]")?.addEventListener("click", (event) => {
    if (event.target === event.currentTarget) setComboPicker(null);
  });

  $("[data-command-overlay]")?.addEventListener("click", (event) => {
    if (event.target === event.currentTarget) setCommand(false);
  });

  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === "k") {
      event.preventDefault();
      setCommand(true);
    }
    if (event.key === "Escape") {
      setCommand(false);
      setTaskCreate(false);
    }
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest("[data-label-menu], [data-label-menu-toggle]")) setLabelMenu(false);
  });

  document.addEventListener("input", (event) => {
    if (event.target.matches("[data-tree-filter]")) filterFileTree(event.target.value);
  });

  $("[data-thread-composer]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = $("[data-thread-input]");
    const text = input?.value.trim();
    if (!text) {
      showToast("先写点什么再发");
      return;
    }
    const stream = $('[data-thread-pane]:not([hidden]) .message-stream');
    if (stream) {
      const message = document.createElement("div");
      message.className = "message user-message";
      message.innerHTML = '<span class="member-avatar user">我</span><div><header><strong>我</strong><time>现在</time></header><p></p></div>';
      $("p", message).textContent = text;
      stream.appendChild(message);
      message.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
    input.value = "";
    showToast("已发送；独立会话不产生验收，也不写记忆");
  });

  setThreadTab("solo");
  // 统计面的默认态由数据决定而不是由 HTML 决定：热力图在 30 天下不可用，
  // 这个置灰必须在首屏就成立，否则点进去才发现按不动。
  setStatRange("30");
  setStatMetric("tok");
  setStatPage(1);
  setLayout(state.layout);
  setExplorer(state.explorer);
  openDocument(state.document, documentMeta[state.document][1]);
})();
