import fs from "node:fs";

const html = fs.readFileSync(new URL("./index.html", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("./assets/styles.css", import.meta.url), "utf8");
const theme = fs.readFileSync(new URL("./assets/multica-theme.css", import.meta.url), "utf8");
const js = fs.readFileSync(new URL("./assets/app.js", import.meta.url), "utf8");

const intentionalShallowTargets = new Set([
  "issue-validation",
  "room-view",
  "issue-running",
]);

const documents = new Set(
  [...html.matchAll(/data-document="([^"]+)"/g)].map((match) => match[1]),
);
const openTargets = [
  ...html.matchAll(/data-open="([^"]+)"/g),
].map((match) => match[1]);
const missingDocuments = [...new Set(openTargets.filter(
  (id) => !documents.has(id) && !intentionalShallowTargets.has(id),
))];

const surfaceViews = new Set(
  [...html.matchAll(/data-surface-view="([^"]+)"/g)].map((match) => match[1]),
);
const surfaceTargets = [
  ...html.matchAll(/data-surface="([^"]+)"/g),
].map((match) => match[1]);
const missingSurfaces = [...new Set(surfaceTargets.filter((id) => !surfaceViews.has(id)))];

const requiredFiles = [
  "assets/styles.css",
  "assets/multica-theme.css",
  "assets/f661a7a97e09a850.css",
  "assets/app.js",
  "docs/design.md",
  "LICENSE.multica",
  "NOTICE.multica",
];
const missingFiles = requiredFiles.filter(
  (path) => !fs.existsSync(new URL(`./${path}`, import.meta.url)),
);

const checks = {
  documents: documents.size,
  openLinks: openTargets.length,
  surfaces: surfaceViews.size,
  missingDocuments,
  missingSurfaces,
  missingFiles,
  hasRoomDock: html.includes("data-room-dock"),
  hasCommandPalette: html.includes("data-command-overlay"),
  hasResponsiveRules: css.includes("@media (max-width: 640px)"),
  hasEventDelegation: js.includes('document.addEventListener("click"'),
  retainsOriginalWorkbench: html.includes("data-room-dock") && html.includes("data-bottom-panel"),
  hasMulticaLightTokens: theme.includes("oklch(100% 0 0)") && theme.includes("--accent: oklch(55% 0.16 255)"),
  hasEqualPreviewAndRoom: theme.includes("grid-template-columns: var(--sidebar) minmax(0, 1fr) minmax(0, 1fr)"),
  hasGlobalScopeSelectors: html.includes("workspace-scope") && html.includes("project-scope"),
  hasConversationStructure: html.includes("agent-run-details") && html.includes('data-room-panel="conversation"'),
  hasRoomOverview: html.includes('data-room-panel="overview"') && html.includes("message-stats-grid"),
  removesContextTab: !html.includes('data-room-tab="context"'),
  hasAlignedBareTabs: !html.includes("当前协作现场") && !html.includes("项目资源"),
  hasRightAlignedSelfMessage: theme.includes(".room-user-message") && theme.includes("row-reverse"),
  hasPauseInComposer: html.includes('class="composer-pause" data-room-pause') && !html.includes('class="room-controls"'),
  usesMentionAssignment: html.includes("data-room-prefill") && html.includes("@独立验证员") && !html.includes("低频管理操作"),
  hasFixedHandoffDraft: html.includes("fixed-handoff") && theme.includes(".room-conversation .fixed-handoff"),
  hasReorderedOverview: !html.includes("当前模式：") && html.indexOf('class="overview-card session-card"') < html.indexOf('class="overview-card agent-status-card"') && html.indexOf('class="overview-card agent-status-card"') < html.indexOf('class="overview-card plan-card"'),
  hasTrustLayer: html.includes('data-document="evidence-room"') && html.includes("message-trust-link") && html.includes("evidence-chain"),
  hasVisibleChangeNavigation: html.includes("data-change-next") && html.includes("data-change-location") && js.includes("jumpToChange"),
  hasConversationFirst: /<button[^>]*class="active"[^>]*data-explorer-tab="work">会话<\/button>/.test(html) && js.includes('explorer: "work"'),
  removesRedundantWorkspaceCard: !html.includes("Workspace 可执行") && !html.includes('class="workspace-card"'),
  hasConversationCrud: html.includes("data-new-object") && html.includes("data-session-menu-toggle") && html.includes("重命名") && html.includes("归档") && html.includes("删除…"),
};

console.log(JSON.stringify(checks, null, 2));

if (
  missingDocuments.length ||
  missingSurfaces.length ||
  missingFiles.length ||
  !checks.hasRoomDock ||
  !checks.hasCommandPalette ||
  !checks.hasResponsiveRules ||
  !checks.hasEventDelegation ||
  !checks.retainsOriginalWorkbench ||
  !checks.hasMulticaLightTokens ||
  !checks.hasEqualPreviewAndRoom ||
  !checks.hasGlobalScopeSelectors ||
  !checks.hasConversationStructure ||
  !checks.hasRoomOverview ||
  !checks.removesContextTab ||
  !checks.hasAlignedBareTabs ||
  !checks.hasRightAlignedSelfMessage ||
  !checks.hasPauseInComposer ||
  !checks.usesMentionAssignment ||
  !checks.hasFixedHandoffDraft ||
  !checks.hasReorderedOverview ||
  !checks.hasTrustLayer ||
  !checks.hasVisibleChangeNavigation ||
  !checks.hasConversationFirst ||
  !checks.removesRedundantWorkspaceCard ||
  !checks.hasConversationCrud
) {
  process.exitCode = 1;
}
