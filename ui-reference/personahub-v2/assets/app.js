(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const state = {
    surface: "project",
    explorer: "work",
    document: "file-prd",
    roomTab: "conversation",
    roomPaused: false,
    bottomOpen: false,
    changeIndex: -1,
    toastTimer: null,
  };

  const documentMeta = {
    "file-prd": ["PersonaHub › docs › personahub-prd.md › Room", "personahub-prd.md"],
    "file-room-spec": ["PersonaHub › docs › features › 0.3 › F011-room › spec.md", "F011 · Room spec"],
    "file-code": ["PersonaHub › server › src › services › run-dispatch.ts", "run-dispatch.ts"],
    "file-architecture": ["PersonaHub › docs › personahub-architecture.md", "architecture.md"],
    "issue-view": ["PersonaHub › 工作 › 等待你指派", "任务 · Room 人工介入"],
    "issue-validation": ["PersonaHub › 工作 › 反复未收敛", "任务 · 验证未收敛"],
    "issue-running": ["PersonaHub › 工作 › 运行中", "任务 · Runtime health"],
    "room-view": ["PersonaHub › 工作 › Rooms › Artifact contract research", "Room · Artifact research"],
    "artifact-view": ["PersonaHub › 产出 › Artifacts › synthesis_plan › revision 3", "Artifact · synthesis_plan"],
    "artifact-research": ["PersonaHub › 产出 › Artifacts › research_findings › revision 1", "Artifact · research_findings"],
    "evidence-view": ["PersonaHub › 产出 › Evidence Summary › Graph restart recovery", "Evidence Summary"],
    "evidence-room": ["PersonaHub › 产出 › 验证依据 › Room pause / resume", "验证依据 · Room pause / resume"],
    "decision-view": ["PersonaHub › 知识 › Decisions › Issue-first", "Decision · Issue-first"],
    "memory-view": ["PersonaHub › 知识 › Memory › 自动回路介入原则", "Memory · 人工介入"],
    "skill-view": ["PersonaHub › 知识 › Skill Candidates › 前端原型验证流程", "Skill candidate"],
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
    $$('.activity-rail [data-surface]').forEach((button) => button.classList.toggle("active", button.dataset.surface === name));
    if (name !== "project" && state.bottomOpen) setBottom(false);
  }

  function setExplorer(name) {
    state.explorer = name;
    $$('[data-explorer-tab]').forEach((button) => button.classList.toggle("active", button.dataset.explorerTab === name));
    $$('[data-explorer-panel]').forEach((panel) => panel.classList.toggle("active", panel.dataset.explorerPanel === name));
    const filter = $("[data-tree-filter]");
    if (filter) {
      filter.value = "";
      const placeholders = { work: "搜索会话", resources: "筛选项目文件", outputs: "筛选产出", knowledge: "筛选知识" };
      filter.placeholder = placeholders[name] || "筛选当前内容";
      filterTree("");
    }
    const create = $("[data-new-object]");
    if (create) {
      const labels = { work: "新建会话", resources: "新建资源", outputs: "登记产出", knowledge: "新建知识" };
      create.setAttribute("aria-label", labels[name] || "新建");
      create.title = labels[name] || "新建";
    }
  }

  function ensureEditorTab(id, label) {
    const tabs = $("[data-editor-tabs]");
    if (!tabs) return;
    let tab = tabs.querySelector("[data-open='" + id + "']");
    if (!tab) {
      tab = document.createElement("button");
      tab.type = "button";
      tab.className = "editor-tab";
      tab.dataset.open = id;
      tab.dataset.label = label;
      const type = id.includes("artifact") ? "A" : id.includes("issue") ? "T" : id.includes("room") ? "R" : id.includes("evidence") ? "✓" : id.includes("memory") || id.includes("decision") || id.includes("skill") ? "◇" : "M";
      tab.innerHTML = `<span class="tab-type">${type}</span><span>${label}</span>`;
      tabs.appendChild(tab);
    }
    $$('.editor-tab', tabs).forEach((item) => item.classList.toggle("active", item.dataset.open === id));
  }

  function openDocument(id, label) {
    const target = $("[data-document='" + id + "']");
    if (!target) {
      showToast("当前静态原型没有这个对象的深度页面");
      return;
    }
    setSurface("project");
    state.document = id;
    $$('[data-document]').forEach((documentView) => documentView.classList.toggle("active", documentView.dataset.document === id));
    $$('[data-open]').forEach((button) => {
      if (button.classList.contains("tree-row")) button.classList.toggle("active", button.dataset.open === id);
    });
    const meta = documentMeta[id] || ["PersonaHub › 当前对象", label || id];
    const breadcrumb = $("[data-breadcrumbs]");
    if (breadcrumb) breadcrumb.innerHTML = meta[0].split(" › ").map((part) => `<span>${part}</span>`).join(" › ");
    ensureEditorTab(id, label || meta[1]);
    const stage = $(".document-stage");
    if (stage) stage.scrollTop = 0;
    state.changeIndex = -1;
    updateChangeNavigation();
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
    if (stateLabel) stateLabel.textContent = paused ? "PAUSED" : "ACTIVE";
    if (indicator) indicator.classList.toggle("paused", paused);
    if (button) button.innerHTML = paused ? "<span>▶</span><b>恢复</b>" : "<span>Ⅱ</span><b>暂停</b>";
    showToast(paused ? "已暂停：正在运行的步骤继续，尚未开始的步骤不会启动" : "已恢复：后续步骤将按队列继续");
  }

  function setBottom(open) {
    state.bottomOpen = open;
    const panel = $("[data-bottom-panel]");
    if (panel) panel.classList.toggle("open", open);
  }

  function setCommand(open) {
    const overlay = $("[data-command-overlay]");
    const input = $("[data-command-input]");
    if (!overlay) return;
    overlay.hidden = !open;
    if (open) window.setTimeout(() => input?.focus(), 0);
    else if (input) input.value = "";
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
      const labels = { work: "新建会话", resources: "新建资源", outputs: "登记产出", knowledge: "新建知识" };
      showToast(`${labels[state.explorer] || "新建"}：静态原型在这里打开创建表单`);
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

    if (target.dataset.open) {
      openDocument(target.dataset.open, target.dataset.label || documentMeta[target.dataset.open]?.[1]);
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

    if (target.hasAttribute("data-room-pause")) {
      setRoomPaused(!state.roomPaused);
      return;
    }

    if (target.hasAttribute("data-room-focus")) {
      setRoomTab("conversation");
      $("[data-room-input]")?.focus();
      return;
    }

    if (target.dataset.roomPrefill) {
      setRoomTab("conversation");
      const input = $("[data-room-input]");
      if (input) {
        input.value = target.dataset.roomPrefill;
        input.focus();
      }
      showToast("已把建议指令写入输入框；可以修改成员或要求");
      return;
    }

    if (target.hasAttribute("data-prefill-evidence")) {
      setRoomTab("conversation");
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

    if (target.hasAttribute("data-bottom-toggle")) {
      setBottom(!state.bottomOpen);
      return;
    }

    if (target.hasAttribute("data-bottom-open")) {
      setBottom(true);
      return;
    }

    if (target.hasAttribute("data-command-open")) {
      setCommand(true);
      return;
    }

    if (target.dataset.commandAction) {
      const action = target.dataset.commandAction;
      setCommand(false);
      if (action === "document") openDocument(target.dataset.target, documentMeta[target.dataset.target]?.[1]);
      if (action === "surface") setSurface(target.dataset.target);
      if (action === "bottom") setBottom(!state.bottomOpen);
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
    showToast("指令已加入 Room 活动；静态原型不会启动真实 Agent");
  });

  $("[data-command-overlay]")?.addEventListener("click", (event) => {
    if (event.target === event.currentTarget) setCommand(false);
  });

  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === "k") {
      event.preventDefault();
      setCommand(true);
    }
    if (event.key === "Escape") setCommand(false);
  });

  setExplorer(state.explorer);
  openDocument(state.document, documentMeta[state.document][1]);
})();
