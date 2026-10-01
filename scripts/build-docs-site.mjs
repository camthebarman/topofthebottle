#!/usr/bin/env node
// Builds the static documentation site (GitHub Pages) from docs/ into site/.
// The site carries documentation and screenshots only, never the application.
// Usage: node scripts/build-docs-site.mjs
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const docs = join(root, "docs");
const out = join(root, "site");
const REPO = "https://github.com/camthebarman/topofthebottle";

// Navigation groups. Paths are relative to docs/.
const NAV = [
  ["Status", [["implementation-status.md", "Implementation status"], ["launch-blockers.md", "Launch blockers"], ["test-results.md", "Test results"], ["screenshots", "Screenshots"]]],
  ["Security", [["threat-model.md", "Threat model"], ["permission-matrix.md", "Permission matrix"], ["ai.md", "AI data handling"], ["source-audit.md", "Source audit"]]],
  ["Operations", [["performance.md", "Performance"], ["cost-model.md", "Cost model"], ["runbooks/environment.md", "Environment"], ["runbooks/migrations.md", "Migrations"], ["runbooks/backup-restore.md", "Backup and restore"], ["runbooks/jobs.md", "Background jobs"], ["runbooks/retention-and-deletion.md", "Retention and deletion"], ["runbooks/incident-response.md", "Incidents"], ["runbooks/demo.md", "Public demo"]]],
  ["Reference", [["import-templates.md", "Import templates"], ["data-dictionary.md", "Data dictionary"], ["adr", "Decisions (ADRs)"]]],
];

const SHOTS = [
  ["00-invite.png", "Inviting a bartender", "Invitations are revocable and carry a role and optional location limit."],
  ["01-product.png", "Product setup", "Container size, tare weights for scale counts, cost history."],
  ["02-recipe-incomplete.png", "Incomplete costing", "An unmapped garnish keeps the cost marked incomplete instead of showing a partial total."],
  ["03-recipe-costed.png", "Costed recipe", "Cost per serving, cost %, ingredient margin and target price for a customized Negroni."],
  ["04-count.png", "Stock count", "Tenths of a bottle, marked as an estimate."],
  ["05-inventory.png", "Inventory overview", "On-hand quantities, value, pars and suggested orders."],
  ["06-invoice-review.png", "Invoice review", "Lines read from a CSV invoice, each confirmed by a person before approval."],
  ["07-import-review.png", "POS import review", "Mapping, a quarantined row with its reason, and the staff-name column excluded."],
  ["08-import-report.png", "Import report", "What was added, skipped as duplicate, and mapped."],
  ["09-insights.png", "Insights variance", "Unexplained usage with the full calculation, uncertainty and checks to run."],
  ["10-barbook-ack-staff.png", "Bar Book acknowledgement", "A bartender acknowledging a shift handoff."],
  ["11-schedule.png", "Published schedule", "An overnight shift and the published version."],
  ["12-event.png", "Beverage event", "Demand allocation, batches, pack rounding and a frozen quote."],
  ["13-legacy-import.png", "Legacy import", "Every record from the old tools that was not imported, with a reason."],
  ["14-stock-changes.png", "Stock changes", "Waste, batch production and a transfer between locations."],
  ["15-invoice-reversed.png", "Reversed invoice", "Kept in history, with its reason and a link to start a correction."],
  ["16-event-sheet.png", "Prep and packing sheet", "Printable sheet for an event."],
];

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const htmlPath = (md) => md.replace(/\.md$/, ".html");

function pills(html) {
  // Turn status words at the start of a table cell into status pills.
  const map = { Verified: "ok", Done: "ok", Implemented: "info", Partial: "warn", Unverified: "warn", "**Unverified**": "warn", Blocked: "bad", "Out of scope": "muted" };
  return html.replace(/<td>(\*\*)?(Verified|Done|Implemented|Partial|Unverified|Blocked|Out of scope)(\*\*)?/g, (_m, _a, word) => `<td><span class="pill ${map[word]}">${word}</span>`)
    .replace(/<td><strong>(Unverified[^<]*)<\/strong>/g, (_m, w) => `<td><span class="pill warn">${w}</span>`);
}

function rewriteLinks(html, fromRel) {
  // Links between docs point at the generated .html pages; links elsewhere in the repo go to GitHub.
  return html.replace(/href="([^"#:]+?)(\.md)?(#[^"]*)?"/g, (m, path, md, hash = "") => {
    if (/^(https?:|mailto:)/.test(path)) return m;
    const target = join(dirname(fromRel), path);
    if (md) return `href="${htmlPath(relative(dirname(fromRel), target + ".md")).replace(/\\/g, "/")}${hash}"`;
    return `href="${REPO}/blob/main/docs/${target.replace(/\\/g, "/")}${hash}"`;
  });
}

function page({ title, body, rel, active }) {
  const up = "../".repeat(rel.split("/").length - 1);
  const nav = NAV.map(([group, items]) => `<div class="nav-group"><p class="nav-label">${group}</p><ul>${items.map(([p, label]) => {
    const href = p === "screenshots" ? "screenshots.html" : p === "adr" ? "adr/index.html" : htmlPath(p);
    return `<li><a href="${up}${href}"${active === p ? ' aria-current="page"' : ""}>${label}</a></li>`;
  }).join("")}</ul></div>`).join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Table Zero Bar docs</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,750&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
<link rel="stylesheet" href="${up}site.css">
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<div class="shell">
  <aside>
    <a class="brand" href="${up}index.html">Table Zero Bar <span>docs</span></a>
    <nav class="nav nav-side" aria-label="Documentation">${nav}</nav>
    <details class="nav nav-mobile"><summary>Contents</summary><nav aria-label="Documentation (menu)">${nav}</nav></details>
  </aside>
  <main id="main">
    ${body}
    <footer>Generated from <a href="${REPO}/tree/main/docs">docs/</a> in the repository. Documentation only: the application is not hosted here.</footer>
  </main>
</div>
</body>
</html>`;
}

function renderDoc(rel) {
  const src = readFileSync(join(docs, rel), "utf8");
  const title = (/^#\s+(.+)$/m.exec(src)?.[1] ?? basename(rel, ".md")).replace(/`/g, "");
  let body = marked.parse(src, { gfm: true });
  body = pills(rewriteLinks(body, rel)).replace(/<table>/g, '<div class="table-box"><table>').replace(/<\/table>/g, "</table></div>");
  return { title, body: `<article class="doc">${body}</article>` };
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
copyFileSync(join(root, "scripts", "docs-site.css"), join(out, "site.css"));
writeFileSync(join(out, ".nojekyll"), "");

// Every markdown file under docs/ becomes a page.
const walk = (dir) => readdirSync(join(docs, dir), { withFileTypes: true }).flatMap((e) => {
  const rel = dir ? `${dir}/${e.name}` : e.name;
  if (e.isDirectory()) return ["screenshots", "evidence"].includes(e.name) ? [] : walk(rel);
  return e.name.endsWith(".md") ? [rel] : [];
});
const files = walk("");
for (const rel of files) {
  const { title, body } = renderDoc(rel);
  mkdirSync(join(out, dirname(rel)), { recursive: true });
  writeFileSync(join(out, htmlPath(rel)), page({ title, body, rel, active: rel }));
}

// Import templates are linked from the docs; publish them as files.
mkdirSync(join(out, "import-templates"), { recursive: true });
for (const f of readdirSync(join(docs, "import-templates"))) copyFileSync(join(docs, "import-templates", f), join(out, "import-templates", f));

// ADR index.
const adrs = files.filter((f) => f.startsWith("adr/")).sort();
const adrList = adrs.map((f) => {
  const t = /^#\s+(.+)$/m.exec(readFileSync(join(docs, f), "utf8"))?.[1] ?? f;
  const [num, ...rest] = t.replace(/^ADR\s+/, "").split(":");
  return `<li><a href="${basename(htmlPath(f))}"><span class="adr-num">${esc(num.trim())}</span>${esc(rest.join(":").trim())}</a></li>`;
}).join("");
writeFileSync(join(out, "adr", "index.html"), page({ title: "Architecture decisions", rel: "adr/index.html", active: "adr", body: `<article class="doc"><h1>Architecture decisions</h1><p>Short records of the choices that shape the codebase, with their trade-offs.</p><ul class="adr-list">${adrList}</ul></article>` }));

// Screenshot gallery.
mkdirSync(join(out, "screenshots"), { recursive: true });
const shots = SHOTS.filter(([f]) => { try { copyFileSync(join(docs, "screenshots", f), join(out, "screenshots", f)); return true; } catch { return false; } });
const gallery = shots.map(([f, t, c]) => `<figure><a href="screenshots/${f}"><img src="screenshots/${f}" alt="${esc(t)}: ${esc(c)}" loading="lazy" width="360"></a><figcaption><strong>${esc(t)}</strong><span>${esc(c)}</span></figcaption></figure>`).join("");
writeFileSync(join(out, "screenshots.html"), page({ title: "Screenshots", rel: "screenshots.html", active: "screenshots", body: `<article class="doc"><h1>Screenshots</h1><p>Captured by the end-to-end tests in Chromium at 360 px wide, full page, with synthetic demo data. Tap one to open it at full size.</p></article><div class="gallery">${gallery}</div>` }));

// Home.
const status = readFileSync(join(docs, "launch-blockers.md"), "utf8");
const blockerCount = (status.split("## Should")[0].match(/^\d+\. /gm) ?? []).length;
writeFileSync(join(out, "index.html"), page({ title: "Overview", rel: "index.html", active: "", body: `
<section class="hero">
  <p class="eyebrow">Documentation</p>
  <h1>Table Zero Bar</h1>
  <p class="lede">Bar operations for independent bars: beverage costing, a recipe book with classic templates, inventory and invoices, POS CSV imports with variance analysis, a Bar Book, schedules and event planning.</p>
  <p class="warning"><strong>Not deployed and not production-ready.</strong> ${blockerCount} launch blockers are open. Start with the implementation status.</p>
</section>
<div class="cards">
  <a class="card" href="implementation-status.html"><strong>Implementation status</strong><span>Each requirement, its status, and the test behind it</span></a>
  <a class="card" href="launch-blockers.html"><strong>Launch blockers</strong><span>What must happen before charging customers</span></a>
  <a class="card" href="test-results.html"><strong>Test results</strong><span>Suites, commands and counts</span></a>
  <a class="card" href="screenshots.html"><strong>Screenshots</strong><span>${shots.length} screens at phone width</span></a>
  <a class="card" href="threat-model.html"><strong>Threat model</strong><span>Controls, evidence and open risks</span></a>
  <a class="card" href="source-audit.html"><strong>Source audit</strong><span>The eight reported defects, reproduced and fixed</span></a>
</div>` }));

console.log(`site/: ${files.length} documents, ${shots.length} screenshots, ${adrs.length} ADRs`);

// Fail the build on any broken internal link or image.
const broken = [];
const pages = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? pages(join(dir, e.name)) : e.name.endsWith(".html") ? [join(dir, e.name)] : []));
for (const f of pages(out)) {
  for (const [, ref] of readFileSync(f, "utf8").matchAll(/(?:href|src)="([^"#][^"]*)"/g)) {
    if (/^[a-z]+:/i.test(ref)) continue;
    try { readFileSync(join(dirname(f), ref.split("#")[0])); } catch { broken.push(`${relative(out, f)} → ${ref}`); }
  }
}
if (broken.length) {
  console.error(`Broken links:\n${broken.join("\n")}`);
  process.exit(1);
}
