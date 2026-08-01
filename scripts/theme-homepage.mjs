// The toolchain copies a fixed homepage template into bundles/ on every build,
// so the repository's own palette and titles are applied here afterwards.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const { name, description } = JSON.parse(readFileSync("package.json", "utf8"));

const FAVICON =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
      '<circle cx="32" cy="32" r="32" fill="#ffe3ee"/>' +
      '<ellipse cx="32" cy="35" rx="15" ry="19" fill="#ff9f52"/>' +
      '<path d="M33 14 q3 -6 9 -8" fill="none" stroke="#8fb648" stroke-width="4" stroke-linecap="round"/>' +
      '<circle cx="50" cy="14" r="5" fill="#f277a8"/>' +
      "</svg>",
  );

// The template paints itself with a neutral zinc palette; restyle those classes
// so the page reads in the repository's colours rather than the stock ones.
const STYLE = `
    <style>
      body {
        background:
          radial-gradient(circle at 12% -12%, rgba(244, 127, 178, 0.42) 0%, transparent 58%),
          radial-gradient(circle at 86% 4%, rgba(234, 91, 147, 0.3) 0%, transparent 52%),
          radial-gradient(circle at 74% 82%, rgba(255, 154, 94, 0.16) 0%, transparent 48%),
          radial-gradient(circle at 22% 62%, rgba(249, 168, 200, 0.14) 0%, transparent 42%),
          #1b0a14 !important;
        color: #ffeaf2 !important;
      }
      h1 {
        background: linear-gradient(100deg, #ffd7e6 0%, #f47fb2 42%, #ff9a5e 100%);
        -webkit-background-clip: text;
        background-clip: text;
        color: transparent !important;
      }
      .addToPaperbackButton {
        background: linear-gradient(100deg, #ffb8d6 0%, #f47fb2 38%, #ea5b93 80%, #ff9a5e 100%) !important;
        border-bottom-color: rgba(43, 16, 32, 0.35) !important;
        color: #2b1020 !important;
        font-weight: 700;
      }
      .bg-zinc-800 { background-color: #2b1020 !important; }
      .bg-zinc-700 { background-color: #3a1730 !important; }
      .hover\\:bg-zinc-600:hover { background-color: #4a1e3d !important; }
      .bg-gray-500 { background-color: #6b2b4b !important; }
      .border-zinc-700 { border-color: #5e2643 !important; }
      .text-gray-100, .text-gray-200, .text-gray-300 { color: #ffeaf2 !important; }
      .text-gray-400 { color: #f0a8c4 !important; }
      .focus\\:ring-\\[\\#5478db\\]:focus { --tw-ring-color: #f47fb2 !important; }
    </style>
  </head>`;

const REPLACEMENTS = [
  ["  </head>", STYLE],
  [
    '<link rel="icon" href="https://paperback.moe/pb-logo.svg" />',
    `<link rel="icon" href="${FAVICON}" />`,
  ],
  ["<title>Loading...</title>", `<title>${name}</title>`],
  [
    '<meta name="robots" content="noindex" />',
    `<meta name="robots" content="noindex" />\n    <meta name="description" content="${description}" />`,
  ],
  // Header halo: two pinks warming into mango, matching the banner gradient.
  ["rgba(84, 120, 219, 0.4)", "rgba(244, 127, 178, 0.55)"],
  ["rgba(246, 75, 75, 0.4)", "rgba(255, 154, 94, 0.42)"],
  // Install button picks up the same pink as the header and the add button.
  ["bg-[#f64b4b]", "bg-[#ea5b93]"],
  ["hover:bg-[#f46565]", "hover:bg-[#f47fb2]"],
];

const targets = process.argv.slice(2);
const paths = (targets.length > 0 ? targets : [""]).map((folder) =>
  join("bundles", folder, "index.html"),
);

for (const path of paths) {
  if (!existsSync(path)) {
    console.error(`theme-homepage: ${path} not found`);
    process.exitCode = 1;
    continue;
  }

  let html = readFileSync(path, "utf8");
  const missing = REPLACEMENTS.filter(([from]) => !html.includes(from)).map(([from]) => from);
  if (missing.length > 0) {
    // A template change upstream would silently drop the theme otherwise.
    console.error(`theme-homepage: ${path} missing ${missing.length} anchor(s):`);
    for (const anchor of missing) console.error(`  ${anchor}`);
    process.exitCode = 1;
    continue;
  }

  for (const [from, to] of REPLACEMENTS) html = html.replaceAll(from, to);
  writeFileSync(path, html);
  console.log(`theme-homepage: themed ${path}`);
}
