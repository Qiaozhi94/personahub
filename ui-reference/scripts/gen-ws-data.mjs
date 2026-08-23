import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

const T = "C:/Users/Georg/AppData/Local/Temp/opencode/";
const tabs = JSON.parse(fs.readFileSync(T + "ws-tabs-full.json", "utf8"));
const subtabs = JSON.parse(fs.readFileSync(T + "ws-subtabs-content.json", "utf8"));

// Build a compact data module. Each main tab: { html, activeCls, inactiveCls }
// The contentHtml is everything after the tab bar. We keep the tab-bar row in
// the static page and only swap the sibling content.
const data = {
  mainTabs: {},
  subTabs: {},
  // active/inactive class templates for main tabs
  mainActive: {
    dev: "flex items-center gap-1 px-2.5 py-1 rounded-full text-micro font-semibold transition-all bg-cafe-surface text-cafe-interactive border border-cafe-subtle/60",
    other:
      "flex items-center gap-1 px-2.5 py-1 rounded-full text-micro font-semibold transition-all bg-cafe-accent/10 text-cafe-accent border border-cafe-accent/30",
  },
  mainInactive:
    "flex items-center gap-1 px-2.5 py-1 rounded-full text-micro font-semibold transition-all text-cafe-interactive/40 hover:text-cafe-interactive/60",
  subActive:
    "flex-1 py-1.5 text-micro font-semibold uppercase tracking-wider transition-colors text-cafe-accent border-b-2 border-cafe-accent",
  subInactive:
    "flex-1 py-1.5 text-micro font-semibold uppercase tracking-wider transition-colors text-cafe-interactive/40 hover:text-cafe-interactive/60",
};

for (const [name, v] of Object.entries(tabs)) {
  data.mainTabs[name] = {
    html: v.contentHtml,
    activeCls: v.activeCls,
  };
}
for (const [name, html] of Object.entries(subtabs)) {
  data.subTabs[name] = { html };
}

const json = JSON.stringify(data);
const module = `/* Captured from the running app - the workspace panel's tab contents.
   Replayed by replica-clowder.js; never hand-edited. */
export const WS_DATA = ${json};
`;
fs.writeFileSync(path.join(SCRIPT_DIR, "runtime", "clowder-ws-data.js"), module);
console.log("written", module.length, "bytes");
console.log("mainTabs:", Object.keys(data.mainTabs).join(","));
console.log("subTabs:", Object.keys(data.subTabs).join(","));
