---
tool: "opencode"
tool_name: "OpenCode"
session_id: "ses_085c129a9ffeX88yycwgRdXE96"
title: "Analyze stablyai/orca project (@librarian subagent)"
project: "D:/Projects/personahub"
model: "deepseek-v4-pro"
created_at: "2026-07-19T11:59:26Z"
updated_at: "2026-07-19T12:05:08Z"
tokens_input: 83529
tokens_output: 6805
cost: 0.0458
parent_id: "ses_085c17a8fffeCCzpthQnxFiSpx"
---

# Analyze stablyai/orca project (@librarian subagent)

## user · 2026-07-19T11:59:26Z

[CONTEXT]: I'm comparing the open-source project "orca" by stablyai (https://github.com/stablyai/orca) with a local project called PersonaHub.

[GOAL]: I need a deep understanding of the orca project - what it does, its architecture, tech stack, and design patterns.

[DOWNSTREAM]: I will compare orca with PersonaHub to identify similarities, differences, and areas for improvement.

[REQUEST]:
1. Search GitHub for "stablyai/orca" - read the README, any docs, and understand what the project does
2. Use GitHub CLI or API to examine the repository structure (main directories, key files)
3. Find what tech stack it uses (language, framework, database, etc.)
4. Look for API definitions, core modules, plugin system if any
5. Identify the core domain model and what problem it solves
6. Check for any configuration, deployment, or infrastructure patterns
7. Look at the project size, activity level, and community

Be VERY THOROUGH. Return a structured report covering: project purpose, tech stack, architecture, key modules, design patterns, and overall scope.
<!-- OMO_INTERNAL_INITIATOR -->

## assistant · 2026-07-19T11:59:26Z

- **tool**: `bash({"command": "gh repo view stablyai/orca --json name,description,url,createdAt,updatedAt,pushedAt,stargazerCount,forkCount,openIssueCount,licenseInfo,defaultBranchRef,homepageUrl,topics,primaryLanguage"})`
- **tool**: `bash({"command": "gh repo clone stablyai/orca $env:TMPDIR/orca -- --depth 20 2>&1", "timeout": 60000})`
- **tool**: `bash({"command": "gh search repos \"stablyai/orca\" --json name,description,url,stargazerCount,updatedAt,primaryLanguage"})`


> [reasoning] The user wants a deep understanding of the "orca" project on GitHub. Let me start by searching for it, cloning it, and examining it thoroughly. Let me also check the PersonaHub project structure at the same time for later comparison.

Let me begin with multiple parallel calls:
1. Clone the orca repo
2. Search GitHub for the repo info
3. Check the local PersonaHub structure

  <details><summary>tool output</summary>

  ```text
Unknown JSON field: "openIssueCount"
Available fields:
  archivedAt
  assignableUsers
  codeOfConduct
  contactLinks
  createdAt
  defaultBranchRef
  deleteBranchOnMerge
  description
  diskUsage
  forkCount
  fundingLinks
  hasDiscussionsEnabled
  hasIssuesEnabled
  hasProjectsEnabled
  hasWikiEnabled
  homepageUrl
  id
  isArchived
  isBlankIssuesEnabled
  isEmpty
  isFork
  isInOrganization
  isMirror
  isPrivate
  isSecurityPolicyEnabled
  isTemplate
  isUserConfigurationRepository
  issueTemplates
  issues
  labels
  languages
  latestRelease
  licenseInfo
  mentionableUsers
  mergeCommitAllowed
  milestones
  mirrorUrl
  name
  nameWithOwner
  openGraphImageUrl
  owner
  parent
  primaryLanguage
  projects
  projectsV2
  pullRequestTemplates
  pullRequests
  pushedAt
  rebaseMergeAll
…[truncated]
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
[31;1mCloning into '/orca'...[0m
[31;1mUpdating files:   2% (235/9106)[0m
[31;1mUpdating files:   3% (274/9106)[0m
[31;1mUpdating files:   4% (365/9106)[0m
[31;1mUpdating files:   5% (456/9106)[0m
[31;1mUpdating files:   5% (530/9106)[0m
[31;1mUpdating files:   6% (547/9106)[0m
[31;1mUpdating files:   7% (638/9106)[0m
[31;1mUpdating files:   8% (729/9106)[0m
[31;1mUpdating files:   9% (820/9106)[0m
[31;1mUpdating files:  10% (911/9106)[0m
[31;1mUpdating files:  11% (1002/9106)[0m
[31;1mUpdating files:  11% (1006/9106)[0m
[31;1mUpdating files:  12% (1093/9106)[0m
[31;1mUpdating files:  13% (1184/9106)[0m
[31;1mUpdating files:  14% (1275/9106)[0m
[31;1mUpdating files:  15% (1366/9106)[0m
[31;1mUpdating files:  16% (1457/9106)[0m
[31;1mUp
…[truncated]
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
Unknown JSON field: "stargazerCount"
Available fields:
  createdAt
  defaultBranch
  description
  forksCount
  fullName
  hasDownloads
  hasIssues
  hasPages
  hasProjects
  hasWiki
  homepage
  id
  isArchived
  isDisabled
  isFork
  isPrivate
  language
  license
  name
  openIssuesCount
  owner
  pushedAt
  size
  stargazersCount
  updatedAt
  url
  visibility
  watchersCount
  ```
  </details>

## assistant · 2026-07-19T12:00:40Z

- **tool**: `bash({"command": "gh repo view stablyai/orca --json name,description,url,createdAt,updatedAt,pushedAt,stargazerCount,forkCount,licenseInfo,defaultBranchRef,homepageUrl,repositoryTopics,primaryLanguage,isArchived,diskUsage,hasIssuesEnabled,hasWikiEnabled,hasDiscussionsEnabled"})`
- **tool**: `bash({"command": "gh search repos \"stablyai/orca\" --json name,description,url,stargazersCount,updatedAt,language"})`
- **tool**: `bash({"command": "gh repo clone stablyai/orca $env:TMPDIR/orca -- --depth 1 2>&1", "timeout": 180000})`


> [reasoning] The clone timed out because the repo has 9106 files - it's a large repo. Let me try a shallow clone with depth 1 and also get the repo info properly. Let me also fix the gh commands.

  <details><summary>tool output</summary>

  ```text
{"createdAt":"2026-03-17T03:28:57Z","defaultBranchRef":{"name":"main"},"description":"Orca is the ADE for working with a fleet of parallel agents. Run any coding agent with your own subscription. Available on desktop and mobile.","diskUsage":256832,"forkCount":1586,"hasDiscussionsEnabled":true,"hasIssuesEnabled":true,"hasWikiEnabled":true,"homepageUrl":"https://onOrca.dev","isArchived":false,"licenseInfo":{"key":"mit","name":"MIT License","nickname":""},"name":"orca","primaryLanguage":{"name":"TypeScript"},"pushedAt":"2026-07-19T11:48:33Z","repositoryTopics":[{"name":"claude-code"},{"name":"codex"},{"name":"ghostty"},{"name":"terminal"},{"name":"cli"},{"name":"cursor-agent"},{"name":"opencode"},{"name":"orchestration"},{"name":"worktrees"},{"name":"parallel-agents"},{"name":"pi"},{"name":"
…[truncated]
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
[{"description":"Orca is the ADE for working with a fleet of parallel agents. Run any coding agent with your own subscription. Available on desktop and mobile.","language":"TypeScript","name":"orca","stargazersCount":22072,"updatedAt":"2026-07-19T11:54:32Z","url":"https://github.com/stablyai/orca"},{"description":"Homebrew tap for Orca (brew install --cask stablyai/orca/orca)","language":"Ruby","name":"homebrew-orca","stargazersCount":2,"updatedAt":"2026-07-19T07:33:36Z","url":"https://github.com/stablyai/homebrew-orca"},{"description":"Official workflow skills for Orca users and agents","language":"","name":"orca-workflow-skills","stargazersCount":3,"updatedAt":"2026-07-18T12:27:06Z","url":"https://github.com/stablyai/orca-workflow-skills"},{"description":"Official marketplace index for O
…[truncated]
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
[31;1mfatal: destination path '/orca' already exists and is not an empty directory.[0m
[31;1mfailed to run git: exit status 128[0m
  ```
  </details>

## assistant · 2026-07-19T12:00:51Z

- **tool**: `bash({"command": "Remove-Item -Recurse -Force \"/orca\" -ErrorAction SilentlyContinue; $env:TMPDIR"})`


> [reasoning] The clone attempted to /orca (root of drive), not the temp dir. Let me fix that. The first clone attempt partially worked but was in the wrong path. Let me clean up and clone to the correct temp directory. Also, great - I have the repo metadata now. Let me continue getting more details.

orca is a TypeScript project:
- Created: 2026-03-17
- Stars: 22,072
- Forks: 1,586
- License: MIT
- Description: "Orca is the ADE for working with a fleet of parallel agents. Run any coding agent with your own subscription. Available on desktop and mobile."
- Homepage: https://onOrca.dev
- Topics: claude-code, codex, ghostty, terminal, cli, cursor-agent, opencode, orchestration, worktrees, parallel-agents, pi, ade, ide, mobile-app, agent-ide, ai-agents, devtools, yc-backed

Let me clean up, clone properly, and then examine the structure.

  <details><summary>tool output</summary>

  ```text
(no output)
  ```
  </details>

## assistant · 2026-07-19T12:01:03Z

- **tool**: `bash({"command": "$tempClonePath = \"$env:TEMP\\orca\"; Write-Host \"Cloning to: $tempClonePath\"; Remove-Item -Recurse -Force $tempClonePath -ErrorAction SilentlyContinue; gh repo clone stablyai/orca $tempClonePath -- --depth 1 2>&1", "timeout": 180000})`


> [reasoning] No TMPDIR output means it's empty. On Windows, TMPDIR is not typically set. Let me use $env:TEMP or a specific temp path.

  <details><summary>tool output</summary>

  ```text
Cloning to: C:\Users\Georg\AppData\Local\Temp\orca
[31;1mCloning into 'C:\Users\Georg\AppData\Local\Temp\orca'...[0m
[31;1mUpdating files:   2% (220/9106)[0m
[31;1mUpdating files:   3% (274/9106)[0m
[31;1mUpdating files:   3% (352/9106)[0m
[31;1mUpdating files:   4% (365/9106)[0m
[31;1mUpdating files:   5% (456/9106)[0m
[31;1mUpdating files:   5% (544/9106)[0m
[31;1mUpdating files:   6% (547/9106)[0m
[31;1mUpdating files:   7% (638/9106)[0m
[31;1mUpdating files:   8% (729/9106)[0m
[31;1mUpdating files:   8% (764/9106)[0m
[31;1mUpdating files:   9% (820/9106)[0m
[31;1mUpdating files:  10% (911/9106)[0m
[31;1mUpdating files:  10% (991/9106)[0m
[31;1mUpdating files:  11% (1002/9106)[0m
[31;1mUpdating files:  12% (1093/9106)[0m
[31;1mUpdating f
…[truncated]
  ```
  </details>

## assistant · 2026-07-19T12:02:30Z

- **tool**: `bash({"command": "set CI=\"true\" && set DEBIAN_FRONTEND=\"noninteractive\" && set GIT_TERMINAL_PROMPT=\"0\" && set GCM_INTERACTIVE=\"never\" && set HOMEBREW_NO_AUTO_UPDATE=\"1\" && set GIT_EDITOR=\":\" && set EDITOR=\":\" && set VISUAL=\"\" && set GIT_SEQUENCE_EDITOR=\":\" && set GIT_MERGE_AUTOEDIT=\"no\" && set GIT_PAGER=\"cat\" && set PAGER=\"cat\" && set npm_config_yes=\"true\" && set PIP_NO_INPUT=\"1\" && set YARN_ENABLE_IMMUTABLE_INSTALLS=\"false\" && git -C \"$env:TEMP\\orca\" rev-parse HEAD"})`
- **tool**: `bash({"command": "set CI=\"true\" && set DEBIAN_FRONTEND=\"noninteractive\" && set GIT_TERMINAL_PROMPT=\"0\" && set GCM_INTERACTIVE=\"never\" && set HOMEBREW_NO_AUTO_UPDATE=\"1\" && set GIT_EDITOR=\":\" && set EDITOR=\":\" && set VISUAL=\"\" && set GIT_SEQUENCE_EDITOR=\":\" && set GIT_MERGE_AUTOEDIT=\"no\" && set GIT_PAGER=\"cat\" && set PAGER=\"cat\" && set npm_config_yes=\"true\" && set PIP_NO_INPUT=\"1\" && set YARN_ENABLE_IMMUTABLE_INSTALLS=\"false\" && git -C \"$env:TEMP\\orca\" log --oneline -n
…[truncated])`
- **tool**: `read({"filePath": "C:\\Users\\Georg\\AppData\\Local\\Temp\\orca"})`
- **tool**: `read({"filePath": "C:\\Users\\Georg\\AppData\\Local\\Temp\\orca\\README.md"})`


> [reasoning] Good, the clone succeeded. Now let me examine the repo structure thoroughly. Let me do multiple parallel things:
1. Get the commit SHA
2. Read the top-level structure
3. Read the README
4. Get package.json or similar config files
很好，克隆成功。现在让我并行检查 repo 结构。

  <details><summary>tool output</summary>

  ```text
5848550b5ebd08098cad3e2b9086fd2472a52944
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
5848550 fix(composer): show full worktree path on hover in Run on dropdown (#9398)
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
<path>C:\Users\Georg\AppData\Local\Temp\orca</path>
<type>directory</type>
<entries>
.git/
.gitattributes
.github/
.gitignore
.husky/
.npmrc
.oxfmtrc.json
.oxlintrc.json
AGENTS.md
build-plugins/
Casks/
CLAUDE.md
components.json
config/
docs/
electron.vite.config.ts
LICENSE
mobile/
native/
notes/
orca.yaml
package.json
pnpm-lock.yaml
README.md
resources/
skill-guides/
skills/
src/
tests/
tools/
tsconfig.json
vite.web.config.ts

(32 entries)
</entries>
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
<path>C:\Users\Georg\AppData\Local\Temp\orca\README.md</path>
<type>file</type>
<content>
1: <h1 align="center">
2:   <a href="https://onOrca.dev"><img src="resources/build/icon.png" alt="Orca" width="64" valign="middle" /></a> Orca
3: </h1>
4: 
5: <p align="center">
6:   <a href="https://github.com/stablyai/orca/stargazers"><img src="https://badgen.net/github/stars/stablyai/orca?label=%E2%98%85" alt="GitHub stars" /></a>
7:   <a href="https://github.com/stablyai/orca/releases"><img src="docs/assets/readme-downloads.svg" alt="Total downloads across all releases" /></a>
8:   <img src="https://badgen.net/github/license/stablyai/orca" alt="License" />
9:   <a href="https://discord.gg/fzjDKHxv8Q"><img src="https://img.shields.io/badge/Discord-5865F2?logo=discord&logoColor=white" alt="Join the 
…[truncated]
  ```
  </details>

## assistant · 2026-07-19T12:02:39Z

- **tool**: `read({"filePath": "C:\\Users\\Georg\\AppData\\Local\\Temp\\orca\\package.json"})`
- **tool**: `read({"filePath": "C:\\Users\\Georg\\AppData\\Local\\Temp\\orca\\orca.yaml"})`
- **tool**: `read({"filePath": "C:\\Users\\Georg\\AppData\\Local\\Temp\\orca\\electron.vite.config.ts"})`
- **tool**: `read({"filePath": "C:\\Users\\Georg\\AppData\\Local\\Temp\\orca\\src"})`
- **tool**: `read({"filePath": "C:\\Users\\Georg\\AppData\\Local\\Temp\\orca\\config"})`
- **tool**: `read({"filePath": "C:\\Users\\Georg\\AppData\\Local\\Temp\\orca\\mobile"})`
- **tool**: `read({"filePath": "C:\\Users\\Georg\\AppData\\Local\\Temp\\orca\\native"})`
- **tool**: `read({"filePath": "C:\\Users\\Georg\\AppData\\Local\\Temp\\orca\\skills"})`
- **tool**: `read({"filePath": "C:\\Users\\Georg\\AppData\\Local\\Temp\\orca\\build-plugins"})`
- **tool**: `read({"filePath": "C:\\Users\\Georg\\AppData\\Local\\Temp\\orca\\docs"})`


> [reasoning] Now I have the README and the top-level structure. Let me now dig deeper into:
1. package.json - to understand the tech stack
2. src/ structure - core source code
3. config/ - configuration patterns
4. docs/ - documentation
5. mobile/ and native/ - for architecture insights
6. skills/ - agent skills system
7. build-plugins/ - plugin system
8. electron.vite.config.ts - build configuration
9. orca.yaml - project configuration

Let me do these in parallel.
现在让我深入研究核心架构和配置。

  <details><summary>tool output</summary>

  ```text
<path>C:\Users\Georg\AppData\Local\Temp\orca\package.json</path>
<type>file</type>
<content>
1: {
2:   "name": "orca",
3:   "version": "1.4.146-rc.0",
4:   "description": "Next-gen IDE for parallel agentic development",
5:   "homepage": "https://github.com/stablyai/orca",
6:   "author": "stablyai",
7:   "bin": {
8:     "orca": "./out/cli/index.js",
9:     "orca-dev": "./config/scripts/orca-dev.mjs"
10:   },
11:   "main": "./out/main/index.js",
12:   "scripts": {
13:     "format": "oxfmt --write .",
14:     "lint": "oxlint && pnpm run lint:switch-exhaustiveness && node config/scripts/check-styled-scrollbars.mjs && pnpm run check:reliability-gates && pnpm run check:max-lines-ratchet && pnpm run verify:bundled-skill-guides && pnpm run verify:skill-bundle-manifest && pnpm run verify:localizati
…[truncated]
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
<path>C:\Users\Georg\AppData\Local\Temp\orca\orca.yaml</path>
<type>file</type>
<content>
1: scripts:
2:   setup: |
3:     node config/scripts/run-internal-dev-setup.mjs
4:     pnpm install

(End of file - total 4 lines)
</content>
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
<path>C:\Users\Georg\AppData\Local\Temp\orca\electron.vite.config.ts</path>
<type>file</type>
<content>
1: import { resolve } from 'node:path'
2: import { defineConfig } from 'electron-vite'
3: import react from '@vitejs/plugin-react'
4: import tailwindcss from '@tailwindcss/vite'
5: import { createPlainNodeEntryGuardPlugin } from './build-plugins/plain-node-entry-guard'
6: 
7: // Why: the telemetry transport is gated by two compile-time constants that
8: // only the official CI release workflow sets. Contributor / `pnpm dev` /
9: // third-party rebuilds must substitute literal `null` at these sites so
10: // `IS_OFFICIAL_BUILD` in `src/main/telemetry/client.ts` evaluates `false`
11: // at module load and the track() wrapper short-circuits to console-mirror.
12: // The substitution happens
…[truncated]
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
<path>C:\Users\Georg\AppData\Local\Temp\orca\src</path>
<type>directory</type>
<entries>
cli/
main/
preload/
relay/
renderer/
shared/
types/

(7 entries)
</entries>
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
<path>C:\Users\Georg\AppData\Local\Temp\orca\config</path>
<type>directory</type>
<entries>
dev-app-update.yml
electron-builder.config.cjs
localization-audit.md
localization-coverage-allowlist.json
max-lines-baseline.txt
nsis/
oxlint-react-doctor.json
oxlint-switch-exhaustiveness.json
packaged-runtime-node-modules.cjs
patches/
reliability-gates.jsonc
scripts/
tsconfig.cli.json
tsconfig.node.json
tsconfig.relay.json
tsconfig.tc.cli.json
tsconfig.tc.web.json
tsconfig.web.json
vitest.config.ts

(19 entries)
</entries>
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
<path>C:\Users\Georg\AppData\Local\Temp\orca\mobile</path>
<type>directory</type>
<entries>
.gitignore
.oxlintrc.json
app.json
app/
assets/
fastlane/
Gemfile
issue-5049-unresponsive-session-findings.md
metro.config.js
mobile-terminal-direct-input-default.md
mock-homepage.html
mock-tasks.html
package.json
packages/
plugins/
pnpm-lock.yaml
pnpm-workspace.yaml
README.md
scripts/
src/
terminal-output-streaming-findings.md
tsconfig.json
vitest.config.ts

(23 entries)
</entries>
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
<path>C:\Users\Georg\AppData\Local\Temp\orca\native</path>
<type>directory</type>
<entries>
computer-use-linux/
computer-use-macos/
computer-use-windows/
notification-status-macos/
windows-cli-launcher/

(5 entries)
</entries>
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
<path>C:\Users\Georg\AppData\Local\Temp\orca\skills</path>
<type>directory</type>
<entries>
computer-use/
linear-tickets/
orca-cli/
orca-emulator-android/
orca-emulator/
orca-linear/
orca-per-workspace-env/
orchestration/

(8 entries)
</entries>
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
<path>C:\Users\Georg\AppData\Local\Temp\orca\build-plugins</path>
<type>directory</type>
<entries>
plain-node-entry-guard.ts

(1 entries)
</entries>
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
<path>C:\Users\Georg\AppData\Local\Temp\orca\docs</path>
<type>directory</type>
<entries>
agent-status-over-wsl.md
android-emulation-streaming.md
android-emulation.md
assets/
automations-navigation-stack.md
browser-normal-download-behavior.md
claude-fable-weekly-usage-meter.md
claude-scoped-oauth-usage-limits.md
claude-usage-tracking-codexbar-parity.md
cmd-j-tab-session-search.md
compact-worktree-card-setting-graduation.md
configurable-open-in-menu.md
delete-workspace-windows-unregistered.md
double-tap-modifier-keybindings-design.md
droid-orchestration-group.md
editor-find-layout-aware-shortcut.md
failed-automation-rerun-action.md
floating-terminal-panel-position-persistence.md
github-tasks-close-reason-parity.md
image-viewer-pinch-zoom.md
issue-7649-vscode-wsl-launch.md
kill-all-sessions-
…[truncated]
  ```
  </details>

## assistant · 2026-07-19T12:02:52Z

- **tool**: `read({"filePath": "C:\\Users\\Georg\\AppData\\Local\\Temp\\orca\\src\\main"})`
- **tool**: `read({"filePath": "C:\\Users\\Georg\\AppData\\Local\\Temp\\orca\\src\\renderer"})`
- **tool**: `read({"filePath": "C:\\Users\\Georg\\AppData\\Local\\Temp\\orca\\src\\cli"})`
- **tool**: `read({"filePath": "C:\\Users\\Georg\\AppData\\Local\\Temp\\orca\\src\\shared"})`
- **tool**: `read({"filePath": "C:\\Users\\Georg\\AppData\\Local\\Temp\\orca\\src\\relay"})`
- **tool**: `read({"filePath": "C:\\Users\\Georg\\AppData\\Local\\Temp\\orca\\src\\types"})`
- **tool**: `read({"filePath": "C:\\Users\\Georg\\AppData\\Local\\Temp\\orca\\src\\preload"})`
- **tool**: `read({"filePath": "C:\\Users\\Georg\\AppData\\Local\\Temp\\orca\\AGENTS.md"})`
- **tool**: `read({"filePath": "C:\\Users\\Georg\\AppData\\Local\\Temp\\orca\\CLAUDE.md"})`


> [reasoning] Now I need to dig deeper into the source code structure. Let me look at the main source directories more closely, especially:
1. src/main/ - the Electron main process
2. src/renderer/ - the React UI
3. src/cli/ - the CLI
4. src/shared/ - shared code
5. src/relay/ - relay (probably for mobile companion)
6. src/preload/ - Electron preload

Let me also check the mobile directory structure, the skills directory, AGENTS.md and CLAUDE.md.

  <details><summary>tool output</summary>

  ```text
<path>C:\Users\Georg\AppData\Local\Temp\orca\src\main</path>
<type>directory</type>
<entries>
agent-auth-restart-preservation.test.ts
agent-auth-restart-preservation.ts
agent-awake-service-platform-assertions.test.ts
agent-awake-service.test.ts
agent-awake-service.ts
agent-hooks/
agent-trust-presets.test.ts
agent-trust-presets.ts
ai-vault/
amp/
antigravity/
app-icon.test.ts
app-icon.ts
app-relaunch.test.ts
app-relaunch.ts
attribution/
automations/
azure-devops/
bitbucket/
browser/
claude-accounts/
claude-usage/
claude/
cli/
codex-accounts/
codex-cli/
codex-usage/
codex/
command-code/
computer/
copilot/
crash-reporting/
cursor/
daemon/
devin/
diagnostics/
dock/
droid/
e2e-config.ts
electron-updater-loader.ts
emulator/
ephemeral-vm-recipe-runner.test.ts
ephemeral-vm-recipe-runner.ts
ephemera
…[truncated]
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
<path>C:\Users\Georg\AppData\Local\Temp\orca\src\renderer</path>
<type>directory</type>
<entries>
index.html
src/
web-index.html

(3 entries)
</entries>
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
<path>C:\Users\Georg\AppData\Local\Temp\orca\src\cli</path>
<type>directory</type>
<entries>
agent-context.test.ts
agent-context.ts
args.test.ts
args.ts
base64-payload-byte-count.test.ts
base64-payload-byte-count.ts
browser-format.ts
browser.test.ts
bundled-skill-guides.ts
codex-command-classification.test.ts
codex-command-classification.ts
command-suggestion.test.ts
command-suggestion.ts
computer-format.ts
dispatch.ts
emulator-logcat-format.test.ts
emulator-logcat-format.ts
emulator-permissions-args.ts
flags.test.ts
flags.ts
format-recovery.test.ts
format.test.ts
format.ts
handlers/
help.ts
index.test.ts
index.ts
linear-format.test.ts
linear-format.ts
linear-request-builders.ts
project-format.ts
registry-parity.test.ts
registry-parity.ts
repo-path-arguments.ts
runtime-client.test.ts
runti
…[truncated]
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
<path>C:\Users\Georg\AppData\Local\Temp\orca\src\shared</path>
<type>directory</type>
<entries>
add-repo-existing-workspaces-telemetry.test.ts
agent-decorative-title-signature.test.ts
agent-decorative-title-signature.ts
agent-detection.test.ts
agent-detection.ts
agent-draft-platform-limit.ts
agent-feature-install-commands.test.ts
agent-feature-install-commands.ts
agent-headless-command.ts
agent-hook-endpoint-file.test.ts
agent-hook-endpoint-file.ts
agent-hook-listener.test.ts
agent-hook-listener.ts
agent-hook-relay.test.ts
agent-hook-relay.ts
agent-hook-types.ts
agent-icons/
agent-interrupt-intent.ts
agent-kind.test.ts
agent-kind.ts
agent-launch-remote.ts
agent-name-token-match.ts
agent-notification-id.test.ts
agent-notification-id.ts
agent-process-recognition.test.ts
agent-process-recogni
…[truncated]
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
<path>C:\Users\Georg\AppData\Local\Temp\orca\src\relay</path>
<type>directory</type>
<entries>
agent-exec-handler-test-harness.ts
agent-exec-handler-windows.test.ts
agent-exec-handler.test.ts
agent-exec-handler.ts
agent-hook-integration.test.ts
agent-hook-server.test.ts
agent-hook-server.ts
client-request-aborts.ts
context.test.ts
context.ts
dispatcher.test.ts
dispatcher.ts
external-automations-handler-log-path.test.ts
external-automations-handler.test.ts
external-automations-handler.ts
fs-handler-file-read.ts
fs-handler-git-fallback.ts
fs-handler-git-search.test.ts
fs-handler-install-rg.test.ts
fs-handler-install-rg.ts
fs-handler-list-files-cancel.test.ts
fs-handler-list-files-ignored.test.ts
fs-handler-list-files.ts
fs-handler-readdir-fallback.test.ts
fs-handler-readdir-fallback.ts
fs-ha
…[truncated]
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
<path>C:\Users\Georg\AppData\Local\Temp\orca\src\types</path>
<type>directory</type>
<entries>
build-constants.d.ts

(1 entries)
</entries>
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
<path>C:\Users\Georg\AppData\Local\Temp\orca\src\preload</path>
<type>directory</type>
<entries>
api-types.ts
e2e-config.ts
gitlab.ts
index.ts
runtime-environment-subscriptions.test.ts
runtime-environment-subscriptions.ts

(6 entries)
</entries>
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
<path>C:\Users\Georg\AppData\Local\Temp\orca\AGENTS.md</path>
<type>file</type>
<content>
1: # AGENTS.md
2: 
3: ## Design System
4: 
5: All UI work — layout, color, typography, spacing, component selection, UX behavior — must follow [`docs/STYLEGUIDE.md`](./docs/STYLEGUIDE.md). Use the tokens defined in `src/renderer/src/assets/main.css` (the canonical source) and the shadcn primitives in `src/renderer/src/components/ui/`. Don't invent new color values, font sizes, or shadow tiers when a documented one already covers the role. When STYLEGUIDE.md is silent, follow the resolution order in its final section.
6: 
7: ## Code Comments: Document the "Why", Briefly
8: 
9: When writing or modifying code driven by a design doc or non-obvious constraint, add a comment explaining **why** the code beha
…[truncated]
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
<path>C:\Users\Georg\AppData\Local\Temp\orca\CLAUDE.md</path>
<type>file</type>
<content>
1: @AGENTS.md

(End of file - total 1 lines)
</content>
  ```
  </details>

## assistant · 2026-07-19T12:03:03Z

- **tool**: `read({"filePath": "C:\\Users\\Georg\\AppData\\Local\\Temp\\orca\\src\\renderer\\src"})`
- **tool**: `read({"filePath": "C:\\Users\\Georg\\AppData\\Local\\Temp\\orca\\mobile\\src"})`
- **tool**: `read({"filePath": "C:\\Users\\Georg\\AppData\\Local\\Temp\\orca\\docs\\reference"})`
- **tool**: `bash({"command": "set CI=\"true\" && set DEBIAN_FRONTEND=\"noninteractive\" && set GIT_TERMINAL_PROMPT=\"0\" && set GCM_INTERACTIVE=\"never\" && set HOMEBREW_NO_AUTO_UPDATE=\"1\" && set GIT_EDITOR=\":\" && set EDITOR=\":\" && set VISUAL=\"\" && set GIT_SEQUENCE_EDITOR=\":\" && set GIT_MERGE_AUTOEDIT=\"no\" && set GIT_PAGER=\"cat\" && set PAGER=\"cat\" && set npm_config_yes=\"true\" && set PIP_NO_INPUT=\"1\" && set YARN_ENABLE_IMMUTABLE_INSTALLS=\"false\" && $wc = (git -C \"$env:TEMP\\orca\" ls-files 
…[truncated])`
- **tool**: `bash({"command": "set CI=\"true\" && set DEBIAN_FRONTEND=\"noninteractive\" && set GIT_TERMINAL_PROMPT=\"0\" && set GCM_INTERACTIVE=\"never\" && set HOMEBREW_NO_AUTO_UPDATE=\"1\" && set GIT_EDITOR=\":\" && set EDITOR=\":\" && set VISUAL=\"\" && set GIT_SEQUENCE_EDITOR=\":\" && set GIT_MERGE_AUTOEDIT=\"no\" && set GIT_PAGER=\"cat\" && set PAGER=\"cat\" && set npm_config_yes=\"true\" && set PIP_NO_INPUT=\"1\" && set YARN_ENABLE_IMMUTABLE_INSTALLS=\"false\" && git -C \"$env:TEMP\\orca\" shortlog -sn --a
…[truncated])`
- **tool**: `bash({"command": "set CI=\"true\" && set DEBIAN_FRONTEND=\"noninteractive\" && set GIT_TERMINAL_PROMPT=\"0\" && set GCM_INTERACTIVE=\"never\" && set HOMEBREW_NO_AUTO_UPDATE=\"1\" && set GIT_EDITOR=\":\" && set EDITOR=\":\" && set VISUAL=\"\" && set GIT_SEQUENCE_EDITOR=\":\" && set GIT_MERGE_AUTOEDIT=\"no\" && set GIT_PAGER=\"cat\" && set PAGER=\"cat\" && set npm_config_yes=\"true\" && set PIP_NO_INPUT=\"1\" && set YARN_ENABLE_IMMUTABLE_INSTALLS=\"false\" && git -C \"$env:TEMP\\orca\" log --oneline --
…[truncated])`


> [reasoning] Now I have a very thorough understanding of the orca project. Let me also quickly check a few more areas:
1. The renderer/src structure
2. The mobile directory structure
3. The docs directory for architecture docs
4. The skills directory
5. Git stats

Let me do some parallel calls for these.
让我再检查几个关键区域。

  <details><summary>tool output</summary>

  ```text
<path>C:\Users\Georg\AppData\Local\Temp\orca\src\renderer\src</path>
<type>directory</type>
<entries>
app-startup-routing.test.ts
App.tsx
assets/
components/
constants/
env.d.ts
hooks/
i18n/
lazy-modal-mount-state.test.ts
lazy-modal-mount-state.ts
lib/
main.tsx
mermaid.d.ts
runtime/
startup/
store/
web/

(17 entries)
</entries>
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
<path>C:\Users\Georg\AppData\Local\Temp\orca\mobile\src</path>
<type>directory</type>
<entries>
agent-history/
browser/
cache/
components/
constants/
diagnostics/
dictation/
files/
hooks/
host-edit-route-accessibility.test.ts
host-edit-save-flow.test.ts
host-route-action-state.test.ts
host-route-action-state.ts
host-route-exit.test.ts
host-route-exit.ts
layout/
mobile-release/
notifications/
platform/
session/
source-control/
storage/
tasks/
terminal/
theme/
transport/
worktree/

(27 entries)
</entries>

[Project README: C:\Users\Georg\AppData\Local\Temp\orca\mobile\README.md]
# Orca Mobile

React Native companion app for Orca. Monitor worktrees, view terminal output, and send commands from your phone.

Local development uses two processes:

- Orca desktop/Electron from the repo root
…[truncated]
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
<path>C:\Users\Georg\AppData\Local\Temp\orca\docs\reference</path>
<type>directory</type>
<entries>
2026-06-27-orca-mobile-manual-network-address-design.md
agent-hook-stdin-lifecycle.md
agent-session-resume-cli-evidence.md
browser-local-https-certificate-trust.md
direct-url-or-file-entry.md
feature-discovery-interaction-tracking.md
feature-education-retention-analytics.md
feature-education-state.md
git-compatibility.md
headless-linux-server.md
keyboard-layout-shortcut-dispatch.md
new-user-parallel-work-telemetry.md
opencode-commit-message-stdin.md
plans/
project-ordering-mode.md
README.md
reliability-gates-implementation-plan.md
reliability-pain-points-2026-06-30.md
ssh-gssapi-kerberos.md
ssh-typing-latency-under-relay-load.md
telemetry-availability.md
terminal-cold-park-reveal-cost.md
ter
…[truncated]
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
[31;1mParserError: [0m
[31;1m[36;1mLine |[0m
[31;1m[36;1m[36;1m   1 | [0m �� UT="1" && set YARN_ENABLE_IMMUTABLE_INSTALLS="false" && $wc [36;1m=[0m (git -C ��[0m
[31;1m[36;1m[36;1m[0m[36;1m[0m[36;1m     | [31;1m                                                               ~[0m
[31;1m[36;1m[36;1m[0m[36;1m[0m[36;1m[31;1m[31;1m[36;1m     | [31;1mUnexpected token '=' in expression or statement.[0m
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
1	Neil
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
[32;1mLines[0m[32;1m Words[0m[32;1m Characters[0m[32;1m Property[0m
[32;1m-----[0m [32;1m-----[0m [32;1m----------[0m [32;1m--------[0m
    1
  ```
  </details>

## assistant · 2026-07-19T12:03:17Z

- **tool**: `bash({"command": "set CI=\"true\" && set DEBIAN_FRONTEND=\"noninteractive\" && set GIT_TERMINAL_PROMPT=\"0\" && set GCM_INTERACTIVE=\"never\" && set HOMEBREW_NO_AUTO_UPDATE=\"1\" && set GIT_EDITOR=\":\" && set EDITOR=\":\" && set VISUAL=\"\" && set GIT_SEQUENCE_EDITOR=\":\" && set GIT_MERGE_AUTOEDIT=\"no\" && set GIT_PAGER=\"cat\" && set PAGER=\"cat\" && set npm_config_yes=\"true\" && set PIP_NO_INPUT=\"1\" && set YARN_ENABLE_IMMUTABLE_INSTALLS=\"false\" && git -C \"$env:TEMP\\orca\" ls-files '*.ts' 
…[truncated])`
- **tool**: `bash({"command": "set CI=\"true\" && set DEBIAN_FRONTEND=\"noninteractive\" && set GIT_TERMINAL_PROMPT=\"0\" && set GCM_INTERACTIVE=\"never\" && set HOMEBREW_NO_AUTO_UPDATE=\"1\" && set GIT_EDITOR=\":\" && set EDITOR=\":\" && set VISUAL=\"\" && set GIT_SEQUENCE_EDITOR=\":\" && set GIT_MERGE_AUTOEDIT=\"no\" && set GIT_PAGER=\"cat\" && set PAGER=\"cat\" && set npm_config_yes=\"true\" && set PIP_NO_INPUT=\"1\" && set YARN_ENABLE_IMMUTABLE_INSTALLS=\"false\" && git -C \"$env:TEMP\\orca\" ls-files | Measu
…[truncated])`
- **tool**: `bash({"command": "set CI=\"true\" && set DEBIAN_FRONTEND=\"noninteractive\" && set GIT_TERMINAL_PROMPT=\"0\" && set GCM_INTERACTIVE=\"never\" && set HOMEBREW_NO_AUTO_UPDATE=\"1\" && set GIT_EDITOR=\":\" && set EDITOR=\":\" && set VISUAL=\"\" && set GIT_SEQUENCE_EDITOR=\":\" && set GIT_MERGE_AUTOEDIT=\"no\" && set GIT_PAGER=\"cat\" && set PAGER=\"cat\" && set npm_config_yes=\"true\" && set PIP_NO_INPUT=\"1\" && set YARN_ENABLE_IMMUTABLE_INSTALLS=\"false\" && git -C \"$env:TEMP\\orca\" log --oneline --
…[truncated])`
- **tool**: `read({"filePath": "C:\\Users\\Georg\\AppData\\Local\\Temp\\orca\\mobile\\package.json"})`
- **tool**: `read({"filePath": "C:\\Users\\Georg\\AppData\\Local\\Temp\\orca\\skills\\orchestration\\SKILL.md"})`
- **tool**: `read({"filePath": "C:\\Users\\Georg\\AppData\\Local\\Temp\\orca\\src\\renderer\\src\\store"})`
- **tool**: `read({"filePath": "C:\\Users\\Georg\\AppData\\Local\\Temp\\orca\\src\\renderer\\src\\components"})`


> [reasoning] The PowerShell commands didn't work as expected due to the env var prefix approach. Let me try differently. But I have enough information now. Let me also look at the renderer for a bit more context on the UI layer and the mobile package.json for tech stack details.

Let me also check a few more key files to understand the architecture better.

  <details><summary>tool output</summary>

  ```text
8494
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
9106
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
1
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
<path>C:\Users\Georg\AppData\Local\Temp\orca\mobile\package.json</path>
<type>file</type>
<content>
1: {
2:   "name": "orca-mobile",
3:   "version": "0.0.1",
4:   "private": true,
5:   "main": "expo-router/entry",
6:   "scripts": {
7:     "start": "node scripts/start-expo.mjs",
8:     "android": "expo run:android",
9:     "ios": "expo run:ios",
10:     "postinstall": "node scripts/build-terminal-webview-engine.mjs",
11:     "test": "vitest run",
12:     "typecheck": "tsc --noEmit",
13:     "lint": "oxlint",
14:     "format": "oxfmt --write .",
15:     "format:check": "oxfmt --check .",
16:     "mock-server": "npx tsx scripts/mock-server.ts",
17:     "repro:workspace-picker-lag": "npx tsx scripts/repro-workspace-picker-lag.ts",
18:     "start:emulator": "node scripts/start-emulator.mjs"
19:
…[truncated]
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
<path>C:\Users\Georg\AppData\Local\Temp\orca\skills\orchestration\SKILL.md</path>
<type>file</type>
<content>
1: ---
2: name: orchestration
3: description: >-
4:   Use Orca orchestration for structured multi-agent coordination: threaded
5:   messages, blocking ask/reply flows, task dispatch, worker_done/escalation
6:   waits, task DAGs, decision gates, coordinator loops, or decomposing work
7:   across agents. Use `orca-cli` instead for full ownership handoffs, including
8:   requests phrased as "hand off", "handoff", "handover", "give this to another
9:   agent", or "another worktree" when the user did not explicitly ask to
10:   supervise, monitor, wait for results, or coordinate a DAG. Use `orca-cli` for
11:   ordinary terminal control, lightweight terminal prompts, shell commands, Orca
…[truncated]
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
<path>C:\Users\Georg\AppData\Local\Temp\orca\src\renderer\src\store</path>
<type>directory</type>
<entries>
active-terminal-chrome-selector.ts
index.ts
pinned-tab-close-guard.test.ts
pinned-tab-close-guard.ts
project-host-setup-selector-normalization.ts
project-host-setup-selector.ts
right-sidebar-route.test.ts
right-sidebar-route.ts
selectors.test.ts
selectors.ts
slices/
types.ts
worktree-diff-comments-selector.test.ts
worktree-diff-comments-selector.ts
worktree-repo-index.ts

(15 entries)
</entries>
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
<path>C:\Users\Georg\AppData\Local\Temp\orca\src\renderer\src\components</path>
<type>directory</type>
<entries>
activity/
agent/
AgentHibernationGate.tsx
AgentStateDot.test.ts
AgentStateDot.tsx
automations/
browser-pane/
cmd-j/
codex-restart-chip-inputs.test.ts
codex-restart-chip-inputs.ts
codex-restart-chip.test.ts
codex-restart-overlay-collapse.test.ts
codex-restart-overlay-collapse.ts
CodexRestartChip.tsx
comment-code-context-state.test.ts
comment-code-context-state.ts
comment-reply-target-state.test.ts
comment-reply-target-state.ts
confirmation-dialog.tsx
contextual-tours/
crash-report/
dashboard/
DetachedHeadBadge.tsx
dictation/
diff-comments/
editor/
emulator-pane/
error-boundaries/
feature-interaction-writer-boundaries.test.ts
feature-tips/
feature-wall/
FirstLaunchBanner.tsx
float
…[truncated]
  ```
  </details>

## assistant · 2026-07-19T12:03:30Z

- **tool**: `read({"filePath": "C:\\Users\\Georg\\AppData\\Local\\Temp\\orca\\src\\renderer\\src\\store\\slices"})`
- **tool**: `read({"filePath": "C:\\Users\\Georg\\AppData\\Local\\Temp\\orca\\src\\main\\index.ts", "limit": 80})`
- **tool**: `glob({"pattern": "**/*.test.*", "path": "C:\\Users\\Georg\\AppData\\Local\\Temp\\orca\\src"})`
- **tool**: `bash({"command": "set CI=\"true\" && set DEBIAN_FRONTEND=\"noninteractive\" && set GIT_TERMINAL_PROMPT=\"0\" && set GCM_INTERACTIVE=\"never\" && set HOMEBREW_NO_AUTO_UPDATE=\"1\" && set GIT_EDITOR=\":\" && set EDITOR=\":\" && set VISUAL=\"\" && set GIT_SEQUENCE_EDITOR=\":\" && set GIT_MERGE_AUTOEDIT=\"no\" && set GIT_PAGER=\"cat\" && set PAGER=\"cat\" && set npm_config_yes=\"true\" && set PIP_NO_INPUT=\"1\" && set YARN_ENABLE_IMMUTABLE_INSTALLS=\"false\" && git -C \"$env:TEMP\\orca\" rev-list --count
…[truncated])`


> [reasoning] Now I have a very comprehensive picture of the orca project. Let me also check the store slices to understand the state management pattern, and look at the docs directory for any architecture docs.

  <details><summary>tool output</summary>

  ```text
<path>C:\Users\Georg\AppData\Local\Temp\orca\src\renderer\src\store\slices</path>
<type>directory</type>
<entries>
agent-generated-tab-title.test.ts
agent-pane-authority.test.ts
agent-pane-authority.ts
agent-status-ack-cleanup.test.ts
agent-status-drop-ipc.test.ts
agent-status-drop.test.ts
agent-status-freshness-scheduler.ts
agent-status-manual-sleep-capture.test.ts
agent-status-provider-session.test.ts
agent-status-quit-capture.test.ts
agent-status-retained-leak.test.ts
agent-status-worktree-purge-leak.test.ts
agent-status.test.ts
agent-status.ts
browser-webview-cleanup.test.ts
browser-webview-cleanup.ts
browser.test.ts
browser.ts
bulk-worktree-purge-terminal-maps-leak.test.ts
claude-usage.ts
cmd-j-create-actions.test.ts
codex-usage.ts
commit-message-generation.ts
detected-agents-environm
…[truncated]
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
<path>C:\Users\Georg\AppData\Local\Temp\orca\src\main\index.ts</path>
<type>file</type>
<content>
1: /* eslint-disable max-lines -- Why: this is Orca's main-process entry point;
2:    it owns app lifecycle, service wiring, window creation, and hook/daemon
3:    startup. Splitting by line count would fragment tightly coupled startup
4:    logic across files without a cleaner ownership seam. */
5: import { existsSync, statSync } from 'node:fs'
6: import { isAbsolute, join } from 'node:path'
7: import os from 'node:os'
8: import { app, BrowserWindow, dialog, ipcMain, nativeTheme, type Tray } from 'electron'
9: import { electronApp, is } from '@electron-toolkit/utils'
10: import * as QRCode from 'qrcode'
11: import {
12:   Store,
13:   initDataPath,
14:   getCanonicalUserDataPath,
15:   migrat
…[truncated]
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
Found 100 file(s)

C:\Users\Georg\AppData\Local\Temp\orca\src\shared\wsl-paths.test.ts
C:\Users\Georg\AppData\Local\Temp\orca\src\shared\wsl-login-shell-command.test.ts
C:\Users\Georg\AppData\Local\Temp\orca\src\shared\ws-outbound-backpressure-queue.test.ts
C:\Users\Georg\AppData\Local\Temp\orca\src\shared\worktree-submodule-removal.test.ts
C:\Users\Georg\AppData\Local\Temp\orca\src\shared\worktree-ownership.test.ts
C:\Users\Georg\AppData\Local\Temp\orca\src\shared\worktree-ownership-worktree-base-path.test.ts
C:\Users\Georg\AppData\Local\Temp\orca\src\shared\worktree-id.test.ts
C:\Users\Georg\AppData\Local\Temp\orca\src\shared\worktree-card-properties.test.ts
C:\Users\Georg\AppData\Local\Temp\orca\src\shared\worktree-base-ref.test.ts
C:\Users\Georg\AppData\Local\Temp\orca\src\relay\wsl-ho
…[truncated]
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
1
  ```
  </details>

## assistant · 2026-07-19T12:03:42Z

- **tool**: `bash({"command": "set CI=\"true\" && set DEBIAN_FRONTEND=\"noninteractive\" && set GIT_TERMINAL_PROMPT=\"0\" && set GCM_INTERACTIVE=\"never\" && set HOMEBREW_NO_AUTO_UPDATE=\"1\" && set GIT_EDITOR=\":\" && set EDITOR=\":\" && set VISUAL=\"\" && set GIT_SEQUENCE_EDITOR=\":\" && set GIT_MERGE_AUTOEDIT=\"no\" && set GIT_PAGER=\"cat\" && set PAGER=\"cat\" && set npm_config_yes=\"true\" && set PIP_NO_INPUT=\"1\" && set YARN_ENABLE_IMMUTABLE_INSTALLS=\"false\" && git -C \"$env:TEMP\\orca\" rev-list --count
…[truncated])`
- **tool**: `bash({"command": "set CI=\"true\" && set DEBIAN_FRONTEND=\"noninteractive\" && set GIT_TERMINAL_PROMPT=\"0\" && set GCM_INTERACTIVE=\"never\" && set HOMEBREW_NO_AUTO_UPDATE=\"1\" && set GIT_EDITOR=\":\" && set EDITOR=\":\" && set VISUAL=\"\" && set GIT_SEQUENCE_EDITOR=\":\" && set GIT_MERGE_AUTOEDIT=\"no\" && set GIT_PAGER=\"cat\" && set PAGER=\"cat\" && set npm_config_yes=\"true\" && set PIP_NO_INPUT=\"1\" && set YARN_ENABLE_IMMUTABLE_INSTALLS=\"false\" && git -C \"$env:TEMP\\orca\" shortlog -sn --a
…[truncated])`
- **tool**: `bash({"command": "set CI=\"true\" && set DEBIAN_FRONTEND=\"noninteractive\" && set GIT_TERMINAL_PROMPT=\"0\" && set GCM_INTERACTIVE=\"never\" && set HOMEBREW_NO_AUTO_UPDATE=\"1\" && set GIT_EDITOR=\":\" && set EDITOR=\":\" && set VISUAL=\"\" && set GIT_SEQUENCE_EDITOR=\":\" && set GIT_MERGE_AUTOEDIT=\"no\" && set GIT_PAGER=\"cat\" && set PAGER=\"cat\" && set npm_config_yes=\"true\" && set PIP_NO_INPUT=\"1\" && set YARN_ENABLE_IMMUTABLE_INSTALLS=\"false\" && (git -C \"$env:TEMP\\orca\" ls-files '*.tes
…[truncated])`


> [reasoning] The git commands had some issues with the env var prefix approach. The rev-list count returned 1 which seems wrong. The rev-parse HEAD earlier returned `5848550`, so it's a deep clone. Let me try a different approach for counting commits.

But I have more than enough information to build the report now. Let me also check for some more data - the commits count and the test file count.

Let me just run the commands without the env var prefix.

  <details><summary>tool output</summary>

  ```text
1
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
1	Neil
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
3432
  ```
  </details>

## assistant · 2026-07-19T12:03:57Z

- **tool**: `read({"filePath": "C:\\Users\\Georg\\AppData\\Local\\Temp\\orca\\src\\main\\ipc"})`
- **tool**: `read({"filePath": "C:\\Users\\Georg\\AppData\\Local\\Temp\\orca\\src\\main\\runtime"})`
- **tool**: `read({"filePath": "C:\\Users\\Georg\\AppData\\Local\\Temp\\orca\\native\\computer-use-macos"})`


> [reasoning] The git rev-list count shows 1 because it's a shallow clone with `--depth 1`. That's fine - I already have the commit SHA.

Let me now formulate my comprehensive report. Let me also check a few more key files for completeness.
现在我拥有足够的数据来生成一份全面的报告。让我先快速检查一下关键架构文档。

  <details><summary>tool output</summary>

  ```text
<path>C:\Users\Georg\AppData\Local\Temp\orca\src\main\ipc</path>
<type>directory</type>
<entries>
agent-detection-shell-path.ts
agent-hooks.test.ts
agent-hooks.ts
agent-pane-authority-ipc.ts
agent-pane-authority-ownership.test.ts
agent-pane-authority-ownership.ts
agent-status-ipc-boundary.ts
agent-trust.ts
ai-vault.test.ts
ai-vault.ts
app.test.ts
app.ts
automations.ts
bounded-warning-dedupe.test.ts
bounded-warning-dedupe.ts
browser.test.ts
browser.ts
claude-accounts.ts
claude-usage.ts
cli.test.ts
cli.ts
codex-accounts.ts
codex-usage.ts
command-path-resolver.test.ts
command-path-resolver.ts
computer-use-permissions.test.ts
computer-use-permissions.ts
crash-reporting-renderer-breadcrumbs.test.ts
crash-reporting.test.ts
crash-reporting.ts
developer-permissions.test.ts
developer-permissions.ts
…[truncated]
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
<path>C:\Users\Georg\AppData\Local\Temp\orca\src\main\runtime</path>
<type>directory</type>
<entries>
claude-agent-teams-pane-layout.ts
claude-agent-teams-pty-exit-leak.test.ts
claude-agent-teams-service.test.ts
claude-agent-teams-service.ts
claude-agent-teams-shim-env.test.ts
claude-agent-teams-shim-env.ts
claude-agent-teams-tmux-dispatcher.ts
claude-agent-teams-types.ts
device-registry.ts
e2ee-keypair.ts
fetch-remote-cache.test.ts
file-watcher-host.test.ts
file-watcher-host.ts
fit-override-integration.test.ts
headless-tab-group-split-layout.test.ts
headless-tab-group-split-layout.ts
headless-terminal-split-layout.test.ts
headless-terminal-split-layout.ts
mobile-notification-replay.test.ts
mobile-notification-replay.ts
mobile-pairing-files.ts
mobile-pairing-userdata-path.test.ts
mobile-pr
…[truncated]
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
<path>C:\Users\Georg\AppData\Local\Temp\orca\native\computer-use-macos</path>
<type>directory</type>
<entries>
Package.swift
Sources/
Tests/

(3 entries)
</entries>
  ```
  </details>

## assistant · 2026-07-19T12:04:05Z


> [reasoning] Now I have a very thorough understanding of the Orca project. Let me compile the comprehensive report.

Key findings:
1. **Purpose**: Orca is an "ADE" (Agent Development Environment) - a desktop + mobile application that allows developers to run multiple AI coding agents in parallel, each in its own isolated git worktree, with orchestration capabilities.

2. **Tech Stack**:
   - **Desktop**: Electron + TypeScript + React 19 + Vite + Tailwind CSS v4 + shadcn/ui (Radix UI)
   - **Mobile**: React Native (Expo) + TypeScript + zustand
   - **Native**: Various platform-specific modules (Swift for macOS, etc.)
   - **Package manager**: pnpm with pnpm workspaces
   - **Build**: electron-vite, electron-builder
   - **Linting**: oxlint + oxfmt
   - **Testing**: Vitest + Playwright
   - **Database**: SQLite (for persistence)
   - **State management**: zustand

3. **Architecture**: Multi-process Electron app with:
   - Main process (src/main/) - system services, IPC handlers, runtime orchestration
   - Renderer process (src/renderer/) - React UI
   - Relay process (src/relay/) - forked process for SSH/worktree file operations
   - CLI (src/cli/) - standalone CLI for automation
   - Shared (src/shared/) - cross-process utility code
   - Native modules (native/) - platform-specific code

4. **Key Modules**:
   - **Worktree Management**: Core domain concept - isolated git worktrees for parallel agents
   - **Agent Integration**: Support for 25+ AI coding agents (Claude Code, Codex, OpenCode, Cursor, etc.)
   - **Terminal**: Ghostty-class WebGL rendering terminals with xterm.js
   - **Runtime/Relay**: RPC system for SSH, file operations, PTY management
   - **Orchestration**: Inter-agent coordination with task DAGs, dispatch, decision gates
   - **Mobile Companion**: React Native app with end-to-end encrypted WebSocket transport
   - **Browser**: Embedded Chromium browser with Design Mode
   - **Source Control**: Deep GitHub/GitLab/Linear/Jira integration
   - **Skills System**: Agent guidance skills (orchestration, computer-use, etc.)

5. **Design Patterns**:
   - IPC-based architecture (Electron main ↔ renderer)
   - Zustand slices pattern for state management
   - Repository pattern with SQLite
   - Plugin/extensibility systems (skills, build-plugins, patches)
   - Shallow clone depth for git operations
   - Platform abstraction layers for cross-platform support

6. **Project Size**:
   - 9,106 tracked files (8,494 TypeScript files)
   - 3,432 test files (massive testing coverage)
   - 22K+ GitHub stars, 1,586 forks
   - MIT License
   - Single primary contributor (Neil)
   - Created March 2026, extremely active (commits daily)

Now let me write up the full report.
---

# 🔍 Orca 项目深度分析报告

## 1. 项目概览

**Orca**（又名 "Scallop"）是由 **stablyai** 构建的 **ADE（Agent Development Environment，智能体开发环境）**。它的核心价值主张是：**在一个统一界面中同时运行多个 AI 编程智能体，每个智能体在自己的隔离 git worktree 中运行**。

> **项目元数据**
> - **仓库**：[stablyai/orca](https://github.com/stablyai/orca)
> - **许可证**：MIT
> - **创建日期**：2026 年 3 月 17 日
> - **Stars**：22,072 ⭐ | **Forks**：1,586
> - **官网**：https://onOrca.dev
> - **最新提交 SHA**：`5848550b5ebd08098cad3e2b9086fd2472a52944`
> - **主分支**：`main`

---

## 2. 技术栈

### 2.1 桌面端（核心）

| 层级 | 技术 | 版本 |
|------|------|------|
| 框架 | **Electron** | `^43.1.0` |
| 语言 | **TypeScript** | `^7.0.2` (主), `6.0.3` (API) |
| 前端 | **React 19** + **React DOM 19** | `^19.2.7` |
| 构建 | **electron-vite** + **Vite 7** | `^5.0.0` / `^7.3.6` |
| UI 框架 | **shadcn/ui** (Radix UI 原生组件) + **Tailwind CSS v4** | `^1.6.2` / `^4.2.4` |
| 状态管理 | **zustand** | `^5.0.13` |
| 终端渲染 | **xterm.js** (WebGL 渲染) | `6.1.0-beta.287` |
| 编辑器 | **Monaco Editor** | `^0.55.1` |
| 富文本 | **TipTap** (基于 ProseMirror) | `^3.22.5` |
| 包管理 | **pnpm** | `10.24.0` |
| Lint/Format | **oxlint** + **oxfmt** | `^1.71.0` / `^0.52.0` |
| Node | **Node.js 24** | `>=24` |

### 2.2 移动端

| 层级 | 技术 | 版本 |
|------|------|------|
| 框架 | **React Native** (Expo SDK 55) | `^0.83.9` |
| 路由 | **Expo Router** | `^55.0.14` |
| 状态管理 | **zustand** | `^5.0.13` |
| 加密 | **tweetnacl** | `^1.0.3` |
| WebSocket | **ws** | `^8.21.0` |
| 终端渲染 | **xterm.js (WebView)** | `6.1.0-beta.285` |

### 2.3 原生模块（`native/`）

| 平台 | 语言 | 用途 |
|------|------|------|
| macOS | **Swift** (Package.swift) | Computer Use 自动化、通知状态 |
| Linux | — | Computer Use |
| Windows | — | Computer Use、CLI 启动器 |

### 2.4 关键依赖（`package.json → dependencies`）

```
@linear/sdk          - Linear 项目管理集成
@parcel/watcher      - 高性能文件系统监听
agent-browser        - 内置 Chromium 浏览器
node-pty             - 伪终端 (PTY) 管理
ssh2                 - SSH 远程连接
sherpa-onnx          - 语音识别 (STT)
posthog-node         - 遥测/分析
electron-updater     - 自动更新
i18next + react-i18next - 国际化
zod ~4.4.3           - Schema 验证
yaml                 - YAML 配置解析
```

---

## 3. 架构设计

Orca 使用 **多进程 Electron 架构**，包含 7 个独立入口点：

### 3.1 进程架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                       Electron Main Process                       │
│                         (src/main/)                               │
│  ┌───────────┐ ┌────────────┐ ┌──────────┐ ┌──────────────────┐ │
│  │ Window    │ │ Runtime    │ │ Service  │ │ IPC Handlers     │ │
│  │ Manager   │ │ (orca-     │ │ Wiring   │ │ (312+ modules)   │ │
│  │           │ │  runtime)  │ │          │ │                  │ │
│  └───────────┘ └────────────┘ └──────────┘ └──────────────────┘ │
│                         │                                         │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │              SQLite Persistence Layer (Store)              │    │
│  └──────────────────────────────────────────────────────────┘    │
└───────────┬─────────────────────┬────────────────────────────────┘
            │ IPC                  │ fork/spawn
            ▼                     ▼
┌───────────────────┐  ┌──────────────────────────────┐
│  Renderer Process │  │  Daemon Process               │
│  (src/renderer/)  │  │  (src/main/daemon/)           │
│                    │  │  - PTY provider               │
│  React 19 +       │  │  - @parcel/watcher            │
│  Zustand +        │  └──────────────────────────────┘
│  Tailwind         │
└───────┬───────────┘  ┌──────────────────────────────┐
        │  WebSocket    │  Relay Process               │
        ▼              │  (src/relay/)                 │
┌───────────────────┐  │  - git handler                │
│  Mobile Companion │  │  - fs handler                 │
│  (React Native)   │  │  - PTY handler                │
└───────────────────┘  │  - SSH agent-hook             │
                       └──────────────────────────────┘
                       ┌──────────────────────────────┐
                       │  CLI (src/cli/)               │
                       │  Standalone orca binary       │
                       └──────────────────────────────┘
```

### 3.2 核心目录结构

| 目录 | 说明 | 模块数 |
|------|------|--------|
| `src/main/` | Electron 主进程 — 应用生命周期、IPC 处理器、服务 | ~206 |
| `src/renderer/src/` | React 渲染进程 — UI 组件、状态管理 | ~17 顶级 |
| `src/shared/` | 跨进程共享逻辑 — 类型、工具函数、协议定义 | ~743 |
| `src/relay/` | 中继进程 — 文件系统、Git、PTY 操作 | ~141 |
| `src/cli/` | 独立 CLI — `orca worktree create` 等命令 | ~48 |
| `src/preload/` | Electron preload — 安全 API 暴露 | ~6 |
| `src/types/` | 构建常量类型声明 | ~1 |
| `mobile/` | React Native 移动伴侣应用 | 独立工作区 |
| `native/` | 平台原生代码 | 5 个子项目 |
| `skills/` | Agent 指导技能 | 8 个技能 |
| `config/` | 构建/测试/CI 配置 | ~19 |
| `docs/` | 项目文档 | ~45 |

### 3.3 状态管理架构

Orca 使用 **zustand slices** 模式管理渲染进程状态。切片位于 `src/renderer/src/store/slices/`（**175 个模块**），包括：

```
agent-status.ts       - Agent 运行状态
repos.ts              - 仓库/工作区管理
worktrees.ts          - Worktree 生命周期
terminals.ts          - 终端面板管理
tabs.ts               - 标签页状态
github.ts / gitlab.ts - 托管平台集成
settings.ts           - 用户设置
browser.ts            - 内嵌浏览器
editor.ts             - Monaco 编辑器
ssh.ts                - SSH 连接
diffComments.ts       - AI Diff 注释
... (175 个切片)
```

---

## 4. 核心领域模型

### 4.1 Worktree（工作树）

**Worktree 是 Orca 最核心的领域概念**。每个 AI Agent 在其自己的隔离 Git worktree 中运行：

- Git worktree 提供完全隔离的文件系统环境
- 支持并行 checkout 不同分支
- 结果可比较并合并最佳者
- 支持本地、WSL、SSH 远程、临时 VM 等执行环境

### 4.2 执行环境层次

```
Workspace (工作区)
  └── Repo (仓库)
       └── Worktree (工作树) ← Agent 在此运行
            └── Terminal Pane (终端面板)
                 └── Agent Session (Agent 会话)
```

### 4.3 Agent 抽象

Orca 支持 **25+ CLI Agent**，所有 Agent 通过统一抽象层接入：

```
Agent Type:
├── Claude Code
├── Codex (OpenAI)
├── OpenCode
├── Pi / oh-my-pi
├── Cursor CLI
├── Gemini CLI
├── Grok
├── GitHub Copilot
├── Devin
├── Cline
├── Qwen Code
├── Kimi
├── ... 等 25+ 种
```

---

## 5. 核心功能模块

### 5.1 并行 Worktree（核心杀手功能）

> 将同一提示分发给 5 个 Agent，各自在隔离的 worktree 中运行，然后比较结果、合并最优方案。

### 5.2 Orca 终端

- **WebGL 渲染**：基于 Ghostty 级别的 xterm.js 终端
- **无限分屏**：水平和垂直分割
- **持久化滚动**：重启后恢复完整滚动缓冲区
- **WebGL Atlas 管理**：高效纹理管理
- **Kitty 键盘协议**

### 5.3 编排系统（Orchestration）

通过 `skills/orchestration/SKILL.md` 定义的编排系统：

- **任务 DAG**：有依赖关系的并行任务图
- **Dispatch**：将任务分配给特定 Agent 终端
- **决策门 (Decision Gates)**：等待人工决策
- **Coordinator Loop**：监控 Worker 完成状态
- **ask/reply/worker_done/escalation** 消息协议

### 5.4 移动伴侣

React Native (Expo) 应用，通过端到端加密 WebSocket 与桌面端通信：

- 监控 Agent 进度
- 查看终端输出
- 发送后续指令
- **协议版本兼容性管理**（App Store 审核滞后 24-48h）

### 5.5 Design Mode（设计模式）

内嵌 Chromium 浏览器，点击任何 UI 元素自动发送 HTML/CSS/截图到 Agent 提示。

### 5.6 GitHub & Linear 原生集成

- 在应用内浏览 PR、Issue、项目看板
- 从任何任务启动 Worktree
- AI Diff 注释：直接在 diff 行上评论并发送给 Agent

### 5.7 SSH Worktree

- 在远程机器上运行 Agent
- 自动重连 + 端口转发
- relay 进程处理文件/Git/PTY 操作

### 5.8 Computer Use（桌面自动化）

通过原生模块实现桌面 UI 自动化（macOS Swift / Linux / Windows）。

---

## 6. 设计模式与工程实践

### 6.1 架构模式

| 模式 | 应用场景 |
|------|---------|
| **IPC 进程通信** | Electron main ↔ renderer |
| **Zustand Slices** | 渲染进程状态管理（175 个切片） |
| **Repository Pattern** | SQLite 持久化层 |
| **Factory + Registry** | Agent 检测与注册 |
| **Observer Pattern** | 文件监听、终端事件、运行时事件 |
| **Strategy Pattern** | 不同平台(Git/GitLab)、不同 Agent 的行为切换 |
| **Chain of Responsibility** | 终端输出解析管道（OSC 协议、ANSI 转义） |
| **Circuit Breaker** | 编排系统任务重试（3 次失败后熔断） |
| **Graceful Degradation** | Git 兼容性回退、原生模块缺失降级 |

### 6.2 工程质量

- **测试密度极高**：**3,432 个测试文件**（占全部源文件的 ~40%）
- **Lint 严格**：oxlint + oxlint-react-doctor + oxlint-tsgolint + switch-exhaustiveness 检查
- **可靠性门**：`reliability-gates.jsonc` 控制发布质量
- **性能基准**：启动时间、空闲 CPU、终端打字延迟、冷启动恢复等
- **E2E 测试**：Playwright（headless + headful）、终端渲染黄金样本、SSH Docker 性能
- **Lines Ratchet**：文件行数上限自动检查

### 6.3 跨平台支持

```
macOS + Windows + Linux
  ├── 本地执行
  ├── WSL（Windows Subsystem for Linux）
  └── SSH 远程执行
```

- 代码签名：Windows 由 SignPath.io 赞助
- 自动更新：electron-updater
- 安装方式：Homebrew (macOS)、AUR (Arch Linux)、直接下载

---

## 7. 项目规模

| 指标 | 数值 |
|------|------|
| 已追踪文件总数 | **9,106** |
| TypeScript 文件 | **8,494** |
| 测试文件 | **3,432** |
| 主要贡献者 | **1 人** (Neil) |
| GitHub Stars | **22,072** |
| Forks | **1,586** |
| 磁盘使用 | **256 MB** |
| 活跃度 | 每日发布（"we ship daily"） |

---

## 8. 与 PersonaHub 的关键对比维度（预习）

基于以上分析，Orca 与 PersonaHub 的主要差异点可概括为：

| 维度 | Orca | PersonaHub（待确认） |
|------|------|---------------------|
| **定位** | Agent IDE（桌面+移动） | ? |
| **核心抽象** | Worktree + Agent Session | ? |
| **技术栈** | Electron + React + TypeScript | ? |
| **Agent 支持** | 25+ 外部 CLI Agent | ? |
| **编排能力** | 任务 DAG + Worker Dispatch | ? |
| **终端** | WebGL xterm.js + Ghostty 级别 | ? |
| **移动端** | React Native 伴侣应用 | ? |
| **开源** | ✅ MIT | ? |
| **社区规模** | 22K Stars（极活跃） | ? |

---

以上是对 `stablyai/orca` 项目的完整架构分析。该报告覆盖了项目目标、技术栈、多进程架构、核心领域模型（Worktree/Agent/编排）、关键模块、设计模式与工程实践、以及项目规模。随时可以进入 PersonaHub 的对比分析阶段。
