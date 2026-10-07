import esbuild from "esbuild";
import { readFileSync, writeFileSync } from "fs";
const names = ["bookmark","check","x","mic","pencil","file-plus","chevron-left","chevron-right","layout-dashboard","file-code"];
const icons = Object.fromEntries(names.map(n => [n, readFileSync(`node_modules/lucide-static/icons/${n}.svg`, "utf8").replace(/<!--[\s\S]*?-->/g,"").replace(/width="24"|height="24"/g,"").trim()]));
await esbuild.build({ entryPoints: ["test/harness/main.ts"], bundle: true, format: "iife", outfile: process.argv[2] + "/harness.js", banner: { js: `var ICONS=${JSON.stringify(icons)};` }, logLevel: "error" });
const css = readFileSync("styles.css","utf8");
const page = (theme) => `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif;font-size:15px;}
body.theme-dark{--background-primary:#1e1e1e;--background-secondary:#262626;--background-modifier-border:#363636;--text-normal:#dadada;--text-muted:#a0a0a0;background:#1e1e1e;color:#dadada}
body.theme-light{--background-primary:#fff;--background-secondary:#f5f6f8;--background-modifier-border:#e0e0e0;--text-normal:#222;--text-muted:#6b6b6b;background:#fff;color:#222}
body{--font-monospace:"DejaVu Sans Mono",monospace;--font-ui-smaller:12px;--font-ui-small:13px;--font-ui-medium:15px}
.svg-icon{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
#wrap{height:100vh}
${process.env.HOSTILE ? "button:not(.clickable-icon){background:#f4a460;color:#fff;border-radius:20px;padding:6px 14px;box-shadow:0 2px 4px #0006}select{background:#f4a460;color:#fff}strong{color:#4ade80}" : ""}
${css}</style></head><body class="theme-${theme}"><div id="wrap" class="view-content at-view"><div id="root" class="at-root"></div></div><script src="harness.js"></script></body></html>`;
writeFileSync(process.argv[2] + "/dark.html", page("dark"));
writeFileSync(process.argv[2] + "/light.html", page("light"));
