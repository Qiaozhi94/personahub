(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const state = {
    surface: "project",
    explorer: "work",
    document: "file-prd",
    roomTab: "room",
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
    "file-room-spec": ["PersonaHub › docs › features › 0.3 › F011-room › spec.md", "F011 · Room spec"],
    "file-code": ["PersonaHub › server › src › services › run-dispatch.ts", "run-dispatch.ts"],
    "file-architecture": ["PersonaHub › docs › personahub-architecture.md", "architecture.md"],
    "issue-view": ["PersonaHub › 任务 › 等待你指派", "任务 · 协作现场人工介入"],
    "issue-validation": ["PersonaHub › 工作 › 反复未收敛", "任务 · 验证未收敛"],
    "issue-permission": ["PersonaHub › 任务 › 等待权限确认", "任务 · 权限确认"],
    "issue-running": ["PersonaHub › 任务 › 运行中", "任务 · 运行环境健康诊断"],
    "issue-research": ["PersonaHub › 任务 › Research 进行中", "任务 · 阶段成果研究"],
    "issue-done": ["PersonaHub › 任务 › 已完成", "任务 · Graph 重启恢复"],
    "room-view": ["PersonaHub › 任务 › 阶段成果契约研究 › 协作现场", "协作现场 · 阶段成果研究"],
    "artifact-view": ["PersonaHub › 产出 › 阶段成果 › synthesis_plan › revision 3", "阶段成果 · synthesis_plan"],
    "artifact-research": ["PersonaHub › 产出 › 阶段成果 › research_findings › revision 1", "阶段成果 · research_findings"],
    "evidence-view": ["PersonaHub › 产出 › 完成摘要 › Graph restart recovery", "完成摘要"],
    "evidence-room": ["PersonaHub › 产出 › 验证依据 › Room pause / resume", "验证依据 · Room pause / resume"],
    "decision-view": ["PersonaHub › 知识 › Decisions › Issue-first", "Decision · Issue-first"],
    "memory-view": ["PersonaHub › 知识 › Memory › 自动回路介入原则", "Memory · 人工介入"],
    "skill-view": ["PersonaHub › 知识 › Skill Candidates › 前端原型验证流程", "Skill candidate"],
  };

  const dockContexts = {
    "project-overview": { tab: "project", target: "项目会话 · PersonaHub", parent: "不绑定任何任务", title: "PersonaHub 项目会话", status: "随时可问", summary: "跨任务提问、回顾结论、直接发起新任务", message: "本周 2 个任务在推进、1 个等你指派。可以直接问我某批改动的结论，或从这里发起新任务。", handoff: false, input: "", who: "项目级", what: "不绑定任务，问什么都行", step: "", block: "" },
    "issue-view": { tab: "room", target: "协作现场 · Implementation", parent: "任务：协作现场支持暂停、纠偏与改派", title: "协作现场支持暂停、纠偏与改派", status: "等待指派", summary: "任务主会话 · Implementation 已完成", message: "建议下一步交给独立验证员；指派后会自动携带固定版本的阶段成果和现有验证依据。", handoff: true, handoffLabel: "等待你指派", handoffSummary: "上一步已完成 · 建议交给独立验证员", handoffMember: "@独立验证员", input: "@独立验证员\n验证上一步实现，重点检查 pause / resume 竞态与归档回放。", who: "实现者", what: "已交付实现，等待独立验证", step: "2 / 3 步", block: "卡在：还没有人独立验证竞态与归档回放"},
    "room-view": { tab: "room", target: "协作现场 · Research", parent: "任务：阶段成果契约研究", title: "阶段成果契约研究", status: "正在执行", summary: "任务主会话 · Research 进行中", message: "研究协作现场正在收集实体、revision 与路径安全结论；当前无需你操作。", handoff: false, input: "", who: "Research 协作现场", what: "3 名成员正在收集契约结论", step: "2 / 3 步", block: ""},
    "issue-validation": { tab: "primary", target: "任务会话 · 验证未收敛", parent: "任务：修复验证循环恢复", title: "修复验证循环恢复", status: "需要你处理", summary: "连续 2 次未解决 · 自动继续已停止", message: "两次验证出现相同问题。建议先由架构研究员隔离分析共同根因，再决定下一次修复。", handoff: true, handoffLabel: "建议改变策略", handoffSummary: "先分析共同根因，不直接继续修改", handoffMember: "@架构研究员", input: "@架构研究员\n先分析两次失败的共同根因，不修改代码；给出新的恢复策略和验证边界。", who: "验证循环", what: "连续 2 次出现相同 finding", step: "已停止自动继续", block: "卡在：重复修复无收敛，需要换策略"},
    "issue-permission": { tab: "primary", target: "任务会话 · 权限确认", parent: "任务：允许读取外部行情缓存", title: "允许读取外部行情缓存", status: "等待确认", summary: "执行已安全暂停 · 外部路径尚未授权", message: "请求只读访问 D:\\MarketData\\cache。允许、拒绝和影响范围都需要由你明确确认。", handoff: false, input: "", who: "执行已安全暂停", what: "等待你确认外部路径访问", step: "1 / 3 步", block: "卡在：D:\MarketData\cache 超出当前代码目录"},
    "issue-running": { tab: "primary", target: "任务会话 · 运行中", parent: "任务：运行环境健康诊断", title: "补齐运行环境健康诊断", status: "正在执行", summary: "Claude 正在检查项目级 CLI 可用性 · 无需你操作", message: "当前进行到第 2 / 4 步，代码目录写锁安全；完成或遇到阻塞时会在这里通知你。", handoff: false, input: "", who: "Claude", what: "正在检查项目级 CLI 可用性", step: "2 / 4 步", block: ""},
    "issue-research": { tab: "primary", target: "任务会话 · Research", parent: "任务：阶段成果契约研究", title: "阶段成果契约研究", status: "正在执行", summary: "Research 阶段 · 2 / 3 步 · 无需你操作", message: "研究协作现场正在形成不可变 revision、来源追踪和路径边界结论。", handoff: false, input: "", who: "OpenCode", what: "正在整理 revision 与来源追踪", step: "2 / 3 步", block: ""},
    "issue-done": { tab: "primary", target: "任务会话 · 已完成", parent: "任务：Graph 重启恢复", title: "Graph 重启恢复", status: "已完成", summary: "验证通过 · 完成要求 3 / 3", message: "任务已可信完成。完成摘要可逐条追到执行记录、变更文件与独立验证结论。", handoff: false, input: "", who: "已完成", what: "完成要求 3 / 3 · 独立验证通过", step: "3 / 3 步", block: ""},
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
    state.explorer = name;
    $$('[data-explorer-tab]').forEach((button) => button.classList.toggle("active", button.dataset.explorerTab === name));
    $$('[data-explorer-panel]').forEach((panel) => panel.classList.toggle("active", panel.dataset.explorerPanel === name));
    const filter = $("[data-tree-filter]");
    if (filter) {
      filter.value = "";
      const placeholders = { work: "搜索任务", library: "搜索文档、产出与知识" };
      filter.placeholder = placeholders[name] || "筛选当前内容";
      filterTree("");
    }
    const create = $("[data-new-object]");
    if (create) {
      const labels = { work: "新建任务", library: "新建文档" };
      create.setAttribute("aria-label", labels[name] || "新建");
      create.title = labels[name] || "新建";
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
    if (state.dockPinned) return;
    const context = dockContexts[id];
    if (!context) return;
    const target = $("[data-dock-target]");
    const parent = $("[data-dock-parent]");
    if (target) target.textContent = context.target;
    if (parent) parent.textContent = context.parent;

    const shell = $(".app-shell");
    if (shell) shell.dataset.dockMode = context.tab === "project" ? "project" : "task";
    const setText = (sel, value) => { const el = $(sel); if (el) el.textContent = value; };
    setText("[data-status-who]", context.who || "");
    setText("[data-status-what]", context.what || "");
    setText("[data-status-step]", context.step || "");
    const blockLine = $("[data-status-block]")?.closest(".dock-status-line");
    if (blockLine) blockLine.hidden = !context.block;
    setText("[data-status-block]", context.block || "");
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
    setRoomTab(context.tab);
  }

  function updateStageBack() {
    const back = $("[data-stage-back]");
    if (!back) return;
    back.hidden = !state.stageParent;
    if (state.stageParent) {
      const meta = documentMeta[state.stageParent];
      back.lastChild.textContent = "返回" + (meta ? meta[1] : "任务");
    }
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

  function setRoomTab(name) {
    state.roomTab = name;
    $$('[data-room-tab]').forEach((button) => button.classList.toggle("active", button.dataset.roomTab === name));
    $$('[data-room-panel]').forEach((panel) => panel.classList.toggle("active", panel.dataset.roomPanel === name));
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

    if (target.dataset.explorerTab) {
      setExplorer(target.dataset.explorerTab);
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

    if (target.dataset.roomTab) {
      setRoomTab(target.dataset.roomTab);
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
      if (!state.dockPinned) syncDock(state.document);
      showToast(state.dockPinned ? "已固定当前协作现场；浏览其他对象时不会自动切换" : "已取消固定；协作 Dock 将跟随任务切换");
      return;
    }

    if (target.hasAttribute("data-room-pause")) {
      setRoomPaused(!state.roomPaused);
      return;
    }

    if (target.hasAttribute("data-room-focus")) {
      setRoomTab("room");
      $("[data-room-input]")?.focus();
      return;
    }

    if (target.hasAttribute("data-thread-focus")) {
      setRoomTab("primary");
      $("[data-thread-input]")?.focus();
      return;
    }

    if (target.dataset.roomPrefill) {
      setRoomTab("room");
      const input = $("[data-room-input]");
      if (input) {
        input.value = target.dataset.roomPrefill;
        input.focus();
      }
      showToast("已把建议指令写入输入框；可以修改成员或要求");
      return;
    }

    if (target.dataset.threadPrefill) {
      setRoomTab("primary");
      const input = $("[data-thread-input]");
      if (input) {
        input.value = target.dataset.threadPrefill;
        input.focus();
      }
      showToast("已把建议写入任务会话；可以修改成员、目标或验证要求");
      return;
    }

    if (target.hasAttribute("data-prefill-evidence")) {
      setRoomTab("room");
      const input = $("[data-room-input]");
      if (input) {
        input.value = "@独立验证员\n请验证竞态与归档回放，并附上测试命令、原始输出和明确结论。";
        input.focus();
      }
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
