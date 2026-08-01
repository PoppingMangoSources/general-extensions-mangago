// The toolchain copies a fixed homepage template into bundles/ on every build,
// so the repository's own palette and titles are applied here afterwards.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const { name, description } = JSON.parse(readFileSync("package.json", "utf8"));

const FAVICON =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
      '<circle cx="32" cy="32" r="32" fill="#f9c9d8"/>' +
      '<ellipse cx="32" cy="35" rx="15" ry="19" fill="#ffb144"/>' +
      '<path d="M33 14 q3 -6 9 -8" fill="none" stroke="#7a9a3c" stroke-width="4" stroke-linecap="round"/>' +
      "</svg>",
  );

// The template paints itself with a neutral zinc palette; restyle those classes
// so the page reads in the repository's colours rather than the stock ones.
const STYLE = `
    <style>
      body {
        background:
          radial-gradient(circle at 12% -10%, rgba(249, 201, 216, 0.22) 0%, transparent 55%),
          radial-gradient(circle at 88% 8%, rgba(255, 177, 68, 0.14) 0%, transparent 55%),
          #150a11 !important;
        color: #f7e8ee !important;
      }
      h1 {
        background: linear-gradient(100deg, #f9c9d8 0%, #ef6fa5 45%, #ffb144 100%);
        -webkit-background-clip: text;
        background-clip: text;
        color: transparent !important;
      }
      .addToPaperbackButton {
        background: linear-gradient(100deg, #f489b4 0%, #f9a03f 100%) !important;
        border-bottom-color: rgba(0, 0, 0, 0.28) !important;
        color: #2b1109 !important;
        font-weight: 700;
      }
      .bg-zinc-800 { background-color: #241320 !important; }
      .bg-zinc-700 { background-color: #2f1a28 !important; }
      .hover\\:bg-zinc-600:hover { background-color: #3d2233 !important; }
      .bg-gray-500 { background-color: #5c3348 !important; }
      .border-zinc-700 { border-color: #52293c !important; }
      .text-gray-100, .text-gray-200, .text-gray-300 { color: #f7e8ee !important; }
      .text-gray-400 { color: #cf9db4 !important; }
      .focus\\:ring-\\[\\#5478db\\]:focus { --tw-ring-color: #ef6fa5 !important; }
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
  // Header halo: pink and cyan replace the template's blue and red.
  ["rgba(84, 120, 219, 0.4)", "rgba(242, 119, 168, 0.45)"],
  ["rgba(246, 75, 75, 0.4)", "rgba(47, 184, 204, 0.45)"],
  // Install button in mango.
  ["bg-[#f64b4b]", "bg-[#f0982e]"],
  ["hover:bg-[#f46565]", "hover:bg-[#ffb144]"],
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
