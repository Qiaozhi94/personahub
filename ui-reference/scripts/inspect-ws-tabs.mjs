import fs from "node:fs";

const T = "C:/Users/Georg/AppData/Local/Temp/opencode/";
const tabs = JSON.parse(fs.readFileSync(T + "ws-tabs-full.json", "utf8"));

function splitTopLevel(html) {
  const nodes = [];
  let i = 0;
  while (i < html.length) {
    if (html[i] !== "<") { i++; continue; }
    const m = /<([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/.exec(html.slice(i));
    if (!m) break;
    const tag = m[1].toLowerCase();
    if (/^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/.test(tag)) {
      i += m[0].length;
      continue;
    }
    const openEnd = i + m[0].length;
    let depth = 1;
    const re = new RegExp("<(/?" + tag + ")((?:\"[^\"]*\"|'[^']*'|[^'\">])*)>", "gi");
    re.lastIndex = openEnd;
    let match;
    let endIdx = -1;
    while ((match = re.exec(html))) {
      if (match[1][0] === "/") { depth--; if (depth === 0) { endIdx = re.lastIndex; break; } }
      else depth++;
    }
    if (endIdx < 0) break;
    nodes.push(html.slice(i, endIdx));
    i = endIdx;
  }
  return nodes;
}

for (const [name, v] of Object.entries(tabs)) {
  const nodes = splitTopLevel(v.contentHtml);
  const heads = nodes.map((n) => n.slice(0, 70).replace(/\s+/g, " "));
  console.log(name, "| nodes:", nodes.length, "| lens:", nodes.map((n) => n.length).join(","));
  nodes.forEach((n, idx) => console.log("   ", idx, n.slice(0, 55).replace(/\s+/g, " ")));
}
