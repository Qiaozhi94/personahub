/**
 * Replica interaction layer.
 *
 * Two rules govern everything here:
 *
 *  1. Never invent markup. Overlays (menus, popovers, dialogs, tooltips) and
 *     inactive tab panels are not in the captured page at all — Radix mounts
 *     them on open and unmounts them on close. So they are captured separately
 *     from the running app by capture-states.mjs and replayed verbatim. If a
 *     state was not captured, nothing opens. That is the honest outcome; a
 *     hand-written approximation is exactly the failure this pipeline exists
 *     to prevent.
 *
 *  2. Never restyle. Visual state changes are made by setting the source
 *     project's own attributes (data-state, aria-expanded, aria-selected), so
 *     the compiled source CSS drives the appearance unchanged.
 *
 * Everything project-specific arrives in window.__REPLICA__, written by
 * staticize.mjs. This file is identical across projects.
 */
(function () {
  "use strict";

  var CONFIG = window.__REPLICA__ || { page: "", clickNav: [], states: {} };
  var STATES = CONFIG.states || {};

  /** States that open from the pointer rather than a click. */
  var HOVER_KINDS = { tooltip: 1, hovercard: 1 };

  /* ---------------------------------------------------------------- paths */

  /**
   * childIndex path from <html>, skipping non-rendered tags.
   *
   * Same addressing the capture and the diff scripts use, and for the same
   * reason: a CSS selector breaks the moment one class changes, while an index
   * path points at exactly which child moved. It has to skip the same tags the
   * capture skipped, or every path below a <script> is off by one.
   */
  var SKIP = { script: 1, style: 1, template: 1, noscript: 1 };

  function nodePath(el) {
    var parts = [];
    while (el && el !== document.documentElement) {
      var parent = el.parentElement;
      if (!parent) return null;
      var index = 0;
      var found = -1;
      for (var c = parent.firstElementChild; c; c = c.nextElementSibling) {
        if (SKIP[c.tagName.toLowerCase()]) continue;
        if (c === el) {
          found = index;
          break;
        }
        index += 1;
      }
      if (found < 0) return null;
      parts.unshift(found);
      el = parent;
    }
    return parts.join("/");
  }

  /** Nearest ancestor (inclusive) that has a captured state. */
  function findState(el) {
    while (el && el !== document.documentElement) {
      var key = nodePath(el);
      if (key && STATES[key]) return { el: el, key: key, state: STATES[key] };
      el = el.parentElement;
    }
    return null;
  }

  /* ------------------------------------------------------------- overlays */

  var open = null; // { trigger, key, nodes, bodyStyle, bodyAttrs }

  function closeOverlay() {
    if (!open) return;
    for (var i = 0; i < open.nodes.length; i++) {
      if (open.nodes[i].parentNode) open.nodes[i].parentNode.removeChild(open.nodes[i]);
    }
    if (open.trigger.hasAttribute("aria-expanded")) {
      open.trigger.setAttribute("aria-expanded", "false");
    }
    if (open.trigger.hasAttribute("data-state")) {
      open.trigger.setAttribute("data-state", "closed");
    }
    document.body.setAttribute("style", open.bodyStyle);
    for (var name in open.bodyAttrs) {
      if (open.bodyAttrs[name] === null) document.body.removeAttribute(name);
    }
    open = null;
  }

  /**
   * Replays a captured overlay.
   *
   * The capture stores the exact nodes the source app appended to <body>,
   * including the popper wrapper whose inline transform carries the resolved
   * position. Reinserting them reproduces both the content and the placement
   * without this file knowing anything about either.
   */
  function openOverlay(trigger, key, state) {
    closeOverlay();

    var bodyStyle = document.body.getAttribute("style") || "";
    var bodyAttrs = {};
    var applied = state.body || {};
    for (var name in applied) {
      bodyAttrs[name] = document.body.hasAttribute(name)
        ? document.body.getAttribute(name)
        : null;
      document.body.setAttribute(name, applied[name]);
    }

    var holder = document.createElement("div");
    holder.innerHTML = state.html;
    var nodes = [];
    while (holder.firstChild) {
      var node = holder.firstChild;
      holder.removeChild(node);
      document.body.appendChild(node);
      nodes.push(node);
    }

    if (trigger.hasAttribute("aria-expanded")) {
      trigger.setAttribute("aria-expanded", "true");
    }
    if (trigger.hasAttribute("data-state")) {
      trigger.setAttribute("data-state", "open");
    }
    open = {
      trigger: trigger,
      key: key,
      nodes: nodes,
      bodyStyle: bodyStyle,
      bodyAttrs: bodyAttrs,
    };
  }

  /* ----------------------------------------------------------------- tabs */

  /**
   * Radix renders only the active tab panel, so switching tabs needs the other
   * panels captured the same way overlays are. Without a captured panel the
   * triggers still move — which is the part that shows the navigation model —
   * and the panel simply stays put.
   */
  function activateTab(trigger, state) {
    var list = trigger.closest('[role="tablist"]');
    if (!list) return;
    var tabs = list.querySelectorAll('[role="tab"]');
    for (var i = 0; i < tabs.length; i++) {
      var active = tabs[i] === trigger;
      tabs[i].setAttribute("aria-selected", String(active));
      tabs[i].setAttribute("data-state", active ? "active" : "inactive");
      tabs[i].setAttribute("tabindex", active ? "0" : "-1");
    }
    if (!state || !state.html) return;
    var panel = document.querySelector('[role="tabpanel"]');
    if (!panel) return;
    var holder = document.createElement("div");
    holder.innerHTML = state.html;
    var replacement = holder.firstElementChild;
    if (replacement) panel.parentNode.replaceChild(replacement, panel);
  }

  /* -------------------------------------------------------------- sidebar */

  /**
   * The collapse variants live in the compiled CSS keyed off data-state on the
   * sidebar wrapper, so flipping that attribute is the whole implementation.
   */
  function toggleSidebar() {
    var targets = document.querySelectorAll(
      '[data-slot="sidebar"], [data-slot="sidebar-container"], [data-slot="sidebar-wrapper"]',
    );
    var collapsed = null;
    for (var i = 0; i < targets.length; i++) {
      if (!targets[i].hasAttribute("data-state")) continue;
      if (collapsed === null) {
        collapsed = targets[i].getAttribute("data-state") === "expanded";
      }
      targets[i].setAttribute("data-state", collapsed ? "collapsed" : "expanded");
    }
  }

  /* ------------------------------------------------------------ click map */

  function navTarget(el) {
    var rules = CONFIG.clickNav || [];
    for (var i = 0; i < rules.length; i++) {
      var hit = el.closest(rules[i].selector);
      if (hit) return { to: rules[i].to, within: hit };
    }
    return null;
  }

  document.addEventListener(
    "click",
    function (event) {
      var target = event.target;
      if (!target || !target.closest) return;

      // Routes with no captured counterpart. Left inert rather than jumping to
      // the top of the page, which reads as a broken link.
      var dead = target.closest('a[href="#"][data-original-href]');
      if (dead) {
        event.preventDefault();
        return;
      }

      var tab = target.closest('[role="tab"]');
      if (tab) {
        event.preventDefault();
        activateTab(tab, STATES[nodePath(tab)]);
        return;
      }

      var sidebar = target.closest(
        '[data-slot="sidebar-trigger"], [data-slot="sidebar-rail"]',
      );
      if (sidebar) {
        event.preventDefault();
        toggleSidebar();
        return;
      }

      // An overlay is open: a click inside it stays inside, anything else
      // dismisses it — the same model the source components use.
      if (open) {
        for (var i = 0; i < open.nodes.length; i++) {
          if (open.nodes[i].contains && open.nodes[i].contains(target)) return;
        }
        var reopen = open.trigger.contains(target);
        closeOverlay();
        if (reopen) {
          event.preventDefault();
          return;
        }
      }

      var found = findState(target);
      if (found && !HOVER_KINDS[found.state.kind] && found.state.kind !== "tab") {
        event.preventDefault();
        openOverlay(found.el, found.key, found.state);
        return;
      }

      // Real links win over row navigation: clicking an assignee link inside a
      // row should follow the link, not open the row.
      if (target.closest("a[href]:not([href='#'])")) return;

      var nav = navTarget(target);
      if (nav) {
        event.preventDefault();
        window.location.href = nav.to;
      }
    },
    true,
  );

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") closeOverlay();
  });

  /* ---------------------------------------------------------------- hover */

  /**
   * Tooltips and hover cards answer to the pointer, not the mouse button, so
   * routing them through the click handler would make them unreachable. The
   * delay is deliberately not reproduced: an archive is read by someone
   * surveying what exists, and waiting 700ms per label to find out is friction
   * without information.
   */
  var hoverTimer = null;

  document.addEventListener("mouseover", function (event) {
    if (!event.target || !event.target.closest) return;
    var found = findState(event.target);
    if (!found || !HOVER_KINDS[found.state.kind]) return;
    if (open && open.trigger === found.el) return;
    clearTimeout(hoverTimer);
    openOverlay(found.el, found.key, found.state);
  });

  document.addEventListener("mouseout", function (event) {
    if (!open || !HOVER_KINDS[STATES[open.key] && STATES[open.key].kind]) return;
    var to = event.relatedTarget;
    if (to && (open.trigger.contains(to) || insideOverlay(to))) return;
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(closeOverlay, 120);
  });

  function insideOverlay(node) {
    if (!open) return false;
    for (var i = 0; i < open.nodes.length; i++) {
      if (open.nodes[i].contains && open.nodes[i].contains(node)) return true;
    }
    return false;
  }
})();
