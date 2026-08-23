/**
 * DeepSeek Harness supplement to the generic replica runtime.
 *
 * The generic runtime (replica.js) handles declarative clickNav rules,
 * captured overlays, tabs-with-states and sidebars. DSH additionally needs
 * three behaviors that are text-keyed rather than selector-keyed:
 *
 *  1. Sidebar session rows navigate by their title (one archived
 *     conversation; the 新会话 row is the home view).
 *  2. The 对话 / 轨迹 tabs navigate between two archived pages instead of
 *     swapping in-page panels.
 *  3. The settings modal's close affordances return to the home view, and
 *     the details drawer's close hides the baked-in drawer.
 *
 * The generic runtime's capture-phase listener runs first; these rules run
 * afterwards in the bubble phase, so navigation still wins.
 */
(function () {
  "use strict";

  function go(href) {
    if (href && href !== location.pathname.split("/").pop()) {
      location.href = href;
    }
  }

  document.addEventListener(
    "click",
    function (event) {
      var target = event.target;
      if (!target || !target.closest) return;

      // Sidebar session rows: destination comes from the row title.
      var row = target.closest(".YDXeBa_sessionRow");
      if (row) {
        var titleEl = row.querySelector(".YDXeBa_title");
        var title = titleEl ? titleEl.textContent.trim() : "";
        var dest =
          title === "拉取项目最新代码"
            ? "conversation.html"
            : title === "新会话"
              ? "home.html"
              : null;
        if (dest) {
          event.preventDefault();
          go(dest);
          return;
        }
      }

      // 对话 / 轨迹 tabs navigate between the two archived views.
      var tab = target.closest("button.wSkVaW_tab");
      if (tab) {
        var text = tab.textContent.trim();
        var tabDest =
          text === "对话"
            ? "conversation.html"
            : text === "轨迹"
              ? "trajectory.html"
              : null;
        if (tabDest) {
          event.preventDefault();
          go(tabDest);
          return;
        }
      }

      // Session log button: the live app opens a log drawer; the archived
      // trajectory view is the closest counterpart.
      var logButton = target.closest("button.nL4_yW_sessionLogButton");
      if (logButton) {
        event.preventDefault();
        go("trajectory.html");
        return;
      }

      // Settings modal close → home view. The button carries the X icon as a
      // sibling of the settings.close slot, so match the button too. Clicking
      // the backdrop mask closes the modal in the live app, so it returns to
      // the home view here as well.
      var settingsClose = target.closest(
        'button.VOzbGW_close, [data-slot="settings.close"], .VOzbGW_mask',
      );
      if (settingsClose) {
        event.preventDefault();
        go("home.html");
        return;
      }

      // Details drawer close hides the baked-in drawer.
      var detailsClose = target.closest("button.ydkMvW_close");
      if (detailsClose) {
        var root = document.querySelector(".ydkMvW_root");
        if (root) root.style.display = "none";
      }
    },
    false,
  );
})();
