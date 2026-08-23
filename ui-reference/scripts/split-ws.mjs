import fs from "node:fs";

const T = "C:/Users/Georg/AppData/Local/Temp/opencode/";
const tabs = JSON.parse(fs.readFileSync(T + "ws-tabs-full.json", "utf8"));
const devContent = tabs.dev.contentHtml;

// dev.contentHtml = sub-tabs row + files content (two top-level nodes joined)
// Parse by scanning for the two root elements.
function splitTopLevel(html) {
  const nodes = [];
  let i = 0;
  while (i < html.length) {
    if (html[i] !== "<") { i++; continue; }
    const m = /<([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/.exec(html.slice(i));
    if (!m) break;
    const tag = m[1].toLowerCase();
    if (/^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/.test(tag)) {
      const full = m[0];
      i += full.length;
      continue;
    }
    const openEnd = i + m[0].length;
    // find matching close
    const closeTag = "</" + tag + ">";
    let depth = 1;
    let j = openEnd;
    const re = new RegExp("<(/?" + tag + ")((?:\"[^\"]*\"|'[^']*'|[^'\">])*)>", "gi");
    re.lastIndex = j;
    let match;
    let endIdx = -1;
    while ((match = re.exec(html))) {
      if (match[1][0] === "/") {
        depth--;
        if (depth === 0) { endIdx = re.lastIndex; break; }
      } else {
        depth++;
      }
    }
    if (endIdx < 0) break;
    nodes.push(html.slice(i, endIdx));
    i = endIdx;
  }
  return nodes;
}

const nodes = splitTopLevel(devContent);
console.log("dev content top-level nodes:", nodes.length);
nodes.forEach((n, idx) => {
  console.log("node", idx, "len", n.length, "head:", n.slice(0, 80).replace(/\s+/g, " "));
});

if (nodes.length >= 2) {
  const subtabRow = nodes[0];
  const filesContent = nodes.slice(1).join("");
  fs.writeFileSync(T + "ws-subtab-row.html", subtabRow);
  fs.writeFileSync(T + "ws-files-content.html", filesContent);
  console.log("\nsubtab row saved:", subtabRow.length);
  console.log("files content saved:", filesContent.length);
}

// Also extract the search form from ws-shell.html (kids[2])
const shell = fs.readFileSync(T + "ws-shell.html", "utf8");
const shellNodes = splitTopLevel(shell);
console.log("\nshell nodes:", shellNodes.length);
shellNodes.forEach((n, idx) => console.log("  shell node", idx, "len", n.length, "tag:", n.slice(0, 60).replace(/\s+/g, " ")));
// shell[0]=header, [1]=project, [2]=search, [3]=tabbar
if (shellNodes.length >= 4) {
  fs.writeFileSync(T + "ws-header.html", shellNodes[0]);
  fs.writeFileSync(T + "ws-project.html", shellNodes[1]);
  fs.writeFileSync(T + "ws-search.html", shellNodes[2]);
  fs.writeFileSync(T + "ws-tabbar.html", shellNodes[3]);
  console.log("header/project/search/tabbar saved");
}
