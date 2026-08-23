(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const state = {
    surface: "project",
    explorer: "resources",
    document: "file-prd",
    roomTab: "collaboration",
    roomPaused: false,
    bottomOpen: false,
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
      filterTree("");
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
    if (button) button.innerHTML = paused ? "<span>▶</span><b>恢复后续执行</b>" : "<span>Ⅱ</span><b>暂停后续执行</b>";
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
    message.className = "message agent-message user-message";
    message.innerHTML = `<span class="member-avatar blue">我</span><div><header><strong>你</strong><time>现在</time></header><p></p></div>`;
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
      setRoomTab("collaboration");
      $("[data-room-input]")?.focus();
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

  openDocument(state.document, documentMeta[state.document][1]);
})();
