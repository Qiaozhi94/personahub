(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const state = {
    surface: "project",
    explorer: "work",
    document: "file-prd",
    dockPanel: "primary",
    recipient: "这个任务",
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
    "project-overview": { panel: "project", recipient: "这个项目", title: "PersonaHub 项目会话", status: "随时可问", summary: "跨任务提问、回顾结论、直接发起新任务", message: "v0.3 有 2 个任务在推进、1 个等你指派。F009 的 artifact 引用刚做完实现，还没有独立验证。", handoff: false, input: "", who: "项目级", what: "不绑定任务，问什么都行", step: "", block: "" },
    "issue-view": { panel: "primary", recipient: "@独立验证员", room: { name: "Implementation 现场", meta: "3 名成员 · 1 名已交付 · 阶段结束后归档，记录不删除" }, title: "artifact 引用不漂移与来源可追", status: "等待指派", summary: "任务主会话 · Implementation 已完成", message: "建议下一步交给独立验证员，重点是 scope 泄露与 TOCTOU 边界——这两条 F009 spec 明确要求，但现在一个用例都没有。", handoff: true, handoffLabel: "等待你指派", handoffSummary: "上一步已完成 · 建议交给独立验证员", handoffMember: "@独立验证员", input: "@独立验证员\n验证上一步实现，重点检查反向查询的 scope 泄露与 archived locator 的 TOCTOU 边界。", who: "实现者", what: "已交付实现，等待独立验证", step: "2 / 3 步", block: "卡在：scope 泄露与 TOCTOU 还没有任何用例"},
    "room-view": { panel: "research-thread", recipient: "@安全研究员", room: { name: "Research 现场", meta: "3 名成员并行 · 1 名已交付 · 1 名执行中 · 1 名等前置" }, title: "Agent session 生命周期调研", status: "正在执行", summary: "任务主会话 · Research 进行中", message: "研究现场正在核实两个参考项目的 session 机制；当前无需你操作。", handoff: false, input: "", who: "Research 协作现场", what: "3 名成员正在核实 session 机制", step: "2 / 3 步", block: ""},
    "issue-new": { panel: "primary", recipient: "这个任务", title: "把 dogfooding 问题导出为周报", status: "刚创建", summary: "还没有执行计划 · 等你指派第一步", message: "你已经写了目标和两条完成要求。我可以先依据它们生成用例集交你确认，再指派实现——用例先于实现固定是 ADR 0009 的硬要求。", handoff: false, input: "", who: "还没有执行者", what: "目标与 2 条完成要求已写", step: "0 / 0 步", block: "卡在：还没有执行计划" },
    "issue-validation": { panel: "primary", recipient: "@架构研究员", title: "修复图重启的并发认领", status: "需要你处理", summary: "连续 2 次未解决 · 自动继续已停止", message: "两轮独立验证都指向同一处并发窗口。建议先由架构研究员隔离分析共同根因，再决定换什么策略。", handoff: true, handoffLabel: "建议改变策略", handoffSummary: "先分析共同根因，不直接继续修改", handoffMember: "@架构研究员", input: "@架构研究员\n先分析两轮都撞上的那个并发窗口，不修改代码；给出新的恢复策略和验证边界。", who: "验证循环", what: "连续 2 次出现相同 finding", step: "已停止自动继续", block: "卡在：两轮都撞同一处并发窗口，需要换策略"},
    "issue-permission": { panel: "primary", recipient: "这个任务", title: "允许 agent 执行 git push", status: "等待确认", summary: "执行已安全暂停 · 外部路径尚未授权", message: "请求执行 git push origin HEAD:feat/f009-artifact-ref。这是显式的能力边界，每次都要你单独授权。", handoff: false, input: "", who: "执行已安全暂停", what: "等待你授权 git push", step: "1 / 3 步", block: "卡在：git push 是显式能力边界，需要你单独授权"},
    "issue-running": { panel: "primary", recipient: "@Claude", title: "补齐 Inspector 的 artifact 状态", status: "正在执行", summary: "Claude 正在检查项目级 CLI 可用性 · 无需你操作", message: "当前进行到第 2 / 4 步，代码目录写锁安全。四种 artifact 状态里已完成两种，完成或遇到阻塞时会在这里通知你。", handoff: false, input: "", who: "Claude", what: "正在补 missing / invalid 两种状态", step: "2 / 4 步", block: ""},
    "issue-research": { panel: "research-thread", recipient: "@安全研究员", room: { name: "Research 现场", meta: "3 名成员并行 · 1 名已交付 · 1 名执行中 · 1 名等前置" }, title: "Agent session 生命周期调研", status: "正在执行", summary: "Research 阶段 · 2 / 3 步 · 无需你操作", message: "研究现场正在核实 multica 与 clowder 的 session 机制，以及 PersonaHub 现状的差距。", handoff: false, input: "", who: "OpenCode", what: "正在整理两个项目的 session 机制", step: "2 / 3 步", block: ""},
    "issue-done": { panel: "primary", recipient: "这个任务", title: "Graph 启动恢复", status: "已完成", summary: "验证通过 · 完成要求 3 / 3", message: "任务已可信完成。完成摘要可逐条追到执行记录、变更文件与独立验证结论。", handoff: false, input: "", who: "已完成", what: "完成要求 3 / 3 · 独立验证通过", step: "3 / 3 步", block: ""},
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
    const filter = $("[data-tree-filter]");
    if (filter) {
      filter.value = "";
      filter.placeholder = "搜索任务、文档与产出";
      filterTree("");
    }
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

  function syncDock(id) {
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

  const TAB_SIGNAL = {
    "issue-new": "", "issue-view": "yellow", "issue-validation": "yellow", "issue-permission": "yellow",
    "issue-running": "blue", "issue-research": "blue", "room-view": "blue",
    "issue-done": "green", "project-overview": "",
  };

  function syncTaskTabs(id) {
    const strip = $("[data-task-tabs]");
    if (!strip) return;
    const owner = state.stageParent || id;
    if (!TAB_DOCUMENTS.has(owner)) return;

    let tab = strip.querySelector('[data-open="' + owner + '"]');

    // 进入子文档 = 这个任务已经不只是「扫一眼」，把预览 tab 钉住。
    if (state.stageParent && tab) tab.classList.remove("preview");

    if (!tab) {
      const meta = documentMeta[owner];
      const preview = strip.querySelector(".editor-tab.preview");
      // 预览 tab 复用：从左栏单击打开的任务落在同一个位置，
      // 不会点五个任务就攒出五个 tab（design.md §4.2.1「预览 tab」）。
      tab = preview || document.createElement("button");
      tab.type = "button";
      tab.className = "editor-tab preview";
      tab.dataset.open = owner;
      tab.dataset.label = meta ? meta[1] : owner;
      tab.innerHTML =
        '<span class="signal ' + (TAB_SIGNAL[owner] || "") + '"></span>' +
        "<span>" + (meta ? meta[1].replace(/^(任务|协作现场) · /, "") : owner) + "</span>" +
        '<i data-tab-close aria-label="关闭">\u00d7</i>';
      if (!preview) strip.appendChild(tab);
    }

    $$("[data-task-tabs] .editor-tab").forEach((button) => {
      button.classList.toggle("active", button === tab);
    });
    tab.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  function pinTab(tab) {
    if (tab) tab.classList.remove("preview");
  }

  function openDocument(id, label, opts) {
    const target = $("[data-document='" + id + "']");
    if (!target) {
      showToast("当前静态原型没有这个对象的深度页面");
      return;
    }
    setSurface("project");
    if (opts && opts.child) {
      if (!state.stageParent) state.stageParent = state.document;
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
    syncTaskTabs(id);
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
  // 它是组织单位（谁一起干、交付什么），那些结构信息在舞台的成员泳道上。
  // Dock 只有一个输入框在场——取当前可见面板里的那个
  function activeComposer() {
    return $('[data-room-panel].active textarea');
  }

  function fillComposer(text) {
    const input = activeComposer();
    if (!input) return;
    input.value = text;
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
  // 否则会对着上一个任务的成员发指令。
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


  // ── 成员选择器 ──────────────────────────────────────────────
  // 不是一份平铺的成员名单：选人本身就是要向 Human Lead 解释的判断，
  // 所以每一行都必须说清「为什么推荐 / 为什么不建议 / 为什么不能选」
  // （design.md §4.6）。
  const MEMBERS = [
    { id: "implementer", name: "实现者", stack: "Codex CLI · GPT-5 · 高推理", mark: "C", tone: "blue", tags: ["代码实现", "重构", "测试"], status: "ok" },
    { id: "architect", name: "架构研究员", stack: "Claude Code · Opus · 深度分析", mark: "A", tone: "green", tags: ["架构", "研究", "文档"], status: "ok" },
    { id: "validator", name: "独立验证员", stack: "Claude Code · Sonnet · 隔离上下文", mark: "V", tone: "purple", tags: ["代码审查", "验证"], status: "ok" },
    { id: "organizer", name: "快速整理员", stack: "OpenCode · Qwen · 中等推理", mark: "O", tone: "blue", tags: ["综合", "格式整理"], status: "unchecked" },
  ];

  // 当前这次实现是谁做的。验证角色据此判定同源。
  const CURRENT_IMPLEMENTER = "implementer";

  const PICKER_ROLES = {
    implementer: {
      title: "选择实现者",
      context: "为「实现」挑一个成员",
      rule: "实现者可以是任何具备对应能力的成员；换人不会丢掉已有改动。",
      judge: (m) =>
        m.status === "unchecked"
          ? { level: "blocked", why: "登录状态需要重新检查，现在派过去会直接失败" }
          : m.tags.includes("代码实现")
            ? { level: "good", why: "能力匹配：代码实现、重构、测试" }
            : { level: "weak", why: "能力项里没有代码实现，可以选但不是这一步的强项" },
    },
    validator: {
      title: "选择独立验证员",
      context: "为「独立验证」挑一个成员",
      rule: "实现与验证不能同源（PRD 第 7.5 节）。同一个成员做完实现再自己验证，等于没有验证。",
      judge: (m) =>
        m.id === CURRENT_IMPLEMENTER
          ? { level: "blocked", why: "本次实现就是它做的，自己验自己不成立" }
          : m.status === "unchecked"
            ? { level: "blocked", why: "登录状态需要重新检查，现在派过去会直接失败" }
            : m.tags.includes("验证")
              ? { level: "good", why: "能力匹配：代码审查、验证 · 与实现者不同模型" }
              : { level: "weak", why: "与实现者不同源，满足硬要求；但没有验证能力项" },
    },
    synthesizer: {
      title: "选择综合员",
      context: "为「收敛为 synthesis_plan」挑一个成员",
      rule: "综合员不应由参与检索的研究员兼任——兼任会让它偏向自己那份结论。",
      judge: (m) =>
        m.id === "architect"
          ? { level: "blocked", why: "它是本阶段的检索成员之一，兼任综合会偏向自己的结论" }
          : m.status === "unchecked"
            ? { level: "blocked", why: "登录状态需要重新检查，现在派过去会直接失败" }
            : m.tags.includes("综合")
              ? { level: "good", why: "能力匹配：综合 · 未参与本阶段检索" }
              : { level: "weak", why: "未参与本阶段检索，可以选；但没有综合能力项" },
    },
  };

  const LEVEL_LABEL = { good: "建议", weak: "可选", blocked: "不建议" };

  function setMemberPicker(role) {
    const overlay = $("[data-member-picker]");
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
    const list = $("[data-picker-list]");
    list.innerHTML = "";
    const rows = MEMBERS.map((m) => ({ m, v: spec.judge(m) }));
    // 建议在前、不建议在后，但不建议的**不隐藏**：藏起来就等于替用户
    // 做了判断，而这里的产品承诺恰恰是把判断依据摊开。
    const order = { good: 0, weak: 1, blocked: 2 };
    rows.sort((a, b) => order[a.v.level] - order[b.v.level]);
    for (const { m, v } of rows) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "picker-row " + v.level;
      row.dataset.pickMemberId = m.id;
      if (v.level === "blocked") row.disabled = true;
      row.innerHTML =
        '<span class="member-avatar ' + m.tone + '">' + m.mark + "</span>" +
        "<span class=\"pr-body\">" +
        "<span class=\"pr-head\"><strong>" + m.name + "</strong>" +
        '<span class="pr-level ' + v.level + '">' + LEVEL_LABEL[v.level] + "</span></span>" +
        "<small>" + m.stack + "</small>" +
        '<small class="pr-why">' + v.why + "</small>" +
        "</span>" +
        '<span class="pr-tags">' + m.tags.map((t) => "<i>" + t + "</i>").join("") + "</span>";
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
    if (!target) return;

    if (target.matches("a[href='#']")) event.preventDefault();

    if (target.dataset.surface) {
      setSurface(target.dataset.surface);
      if (target.dataset.openAfter) openDocument(target.dataset.openAfter, documentMeta[target.dataset.openAfter]?.[1]);
      return;
    }

    // 关闭按钮是 tab <button> 内的 <i>，全局委托的 closest("button, a")
    // 会解析到 tab 本身，因此这里必须回看原始事件目标。
    if (event.target.closest("[data-tab-close]")) {
      const tab = event.target.closest(".editor-tab");
      const strip = $("[data-task-tabs]");
      if (tab && strip && strip.querySelectorAll(".editor-tab").length > 1) {
        const wasActive = tab.classList.contains("active");
        const next = tab.nextElementSibling || tab.previousElementSibling;
        tab.remove();
        if (wasActive && next) openDocument(next.dataset.open, next.dataset.label);
      } else {
        showToast("至少保留一个打开的任务");
      }
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

    // 视图切换：成果看结构，轨迹看时间。两者同属一个任务 tab，不新开 tab。
    if (target.dataset.stageView) {
      const article = target.closest(".task-document");
      if (article) {
        const name = target.dataset.stageView;
        $$("[data-stage-view]", article).forEach((b) => b.classList.toggle("active", b === target));
        $$("[data-stage-pane]", article).forEach((pane) => (pane.hidden = pane.dataset.stagePane !== name));
      }
      return;
    }

    // 轨迹筛选：复盘时通常只关心某一类事件（用例变更 / 产物 / 人工介入）
    if (target.dataset.traceFilter) {
      const pane = target.closest("[data-stage-pane]");
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

    if (target.dataset.pickMember) {
      setMemberPicker(target.dataset.pickMember);
      return;
    }

    if (target.dataset.pickMemberId) {
      const member = MEMBERS.find((m) => m.id === target.dataset.pickMemberId);
      setMemberPicker(null);
      if (member) startDispatch("@" + member.name);
      return;
    }

    if (target.hasAttribute("data-picker-close")) {
      setMemberPicker(null);
      return;
    }

    if (target.hasAttribute("data-picker-goto-library")) {
      setMemberPicker(null);
      setSurface("library");
      return;
    }

    if (target.hasAttribute("data-undo-cancel")) {
      cancelDispatch();
      return;
    }

    if (target.classList.contains("editor-tab")) pinTab(target);

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
      showToast("已把建议指令写入输入框；可以修改成员或要求");
      return;
    }

    if (target.hasAttribute("data-prefill-evidence")) {
      fillComposer("@独立验证员\n请验证竞态与归档回放，并附上测试命令、原始输出和明确结论。");
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
      if (action === "picker") { setMemberPicker(target.dataset.target); return; }
      if (action === "document") openDocument(target.dataset.target, documentMeta[target.dataset.target]?.[1]);
      if (action === "surface") setSurface(target.dataset.target);
      return;
    }

    if (target.dataset.demo) showToast(target.dataset.demo);
  });

  $("[data-tree-filter]")?.addEventListener("input", (event) => filterTree(event.currentTarget.value));

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
    showToast("指令已加入协作现场；静态原型不会启动真实 AI 成员");
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

  $("[data-task-create-form]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    setTaskCreate(false);
    setSurface("project");
    openDocument("issue-running", documentMeta["issue-running"][1]);
    showToast("任务已创建并进入安全队列；重复提交不会创建第二份任务");
  });

  $("[data-member-picker]")?.addEventListener("click", (event) => {
    if (event.target === event.currentTarget) setMemberPicker(null);
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

  setLayout(state.layout);
  setExplorer(state.explorer);
  openDocument(state.document, documentMeta[state.document][1]);
})();
