// The toolchain copies a fixed homepage template into bundles/ on every build,
// so the repository's own palette and titles are applied here afterwards.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const { name, description } = JSON.parse(readFileSync("package.json", "utf8"));

const svgUri = (body) => "data:image/svg+xml," + encodeURIComponent(body);

const FAVICON = svgUri(
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">' +
    '<circle cx="32" cy="32" r="32" fill="#ffe3ee"/>' +
    '<ellipse cx="32" cy="35" rx="15" ry="19" fill="#ff9f52"/>' +
    '<path d="M33 14 q3 -6 9 -8" fill="none" stroke="#8fb648" stroke-width="4" stroke-linecap="round"/>' +
    '<circle cx="50" cy="14" r="5" fill="#f277a8"/>' +
    "</svg>",
);

// The template ships the Paperback tile as the header image, which reads as a
// different product's mark above the repository's own name. Both marks carry an
// explicit width and height: the header image is sized by max-height alone, and
// Safari will not lay out an SVG that offers only a viewBox to size itself from,
// so it collapses and nothing is drawn.
const LOGO = svgUri(
  '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">' +
    "<defs>" +
    '<linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0" stop-color="#ffdcea"/><stop offset="0.42" stop-color="#ffbbd5"/>' +
    '<stop offset="0.76" stop-color="#ffcda8"/><stop offset="1" stop-color="#ffc17e"/>' +
    "</linearGradient>" +
    '<linearGradient id="m" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0" stop-color="#ffc98a"/><stop offset="1" stop-color="#ffa45c"/>' +
    "</linearGradient>" +
    "</defs>" +
    '<rect width="128" height="128" rx="30" fill="url(#g)"/>' +
    '<circle cx="38" cy="28" r="11" fill="#ffffff" opacity="0.55"/>' +
    '<circle cx="34" cy="24" r="3.5" fill="#ffffff"/>' +
    '<circle cx="100" cy="98" r="15" fill="#ffffff" opacity="0.4"/>' +
    '<circle cx="103" cy="34" r="6" fill="#ffffff" opacity="0.5"/>' +
    '<g transform="translate(64,74) rotate(-16)">' +
    '<ellipse cx="0" cy="4" rx="23" ry="29" fill="url(#m)"/>' +
    '<ellipse cx="-7" cy="-3" rx="7" ry="11" fill="#ffffff" opacity="0.38"/>' +
    '<circle cx="-9" cy="15" r="3.5" fill="#ffffff" opacity="0.5"/>' +
    '<path d="M1,-22 C3,-30 6,-35 11,-38" fill="none" stroke="#a8d48c" stroke-width="4.5" stroke-linecap="round"/>' +
    '<ellipse cx="18" cy="-36" rx="10" ry="5" fill="#bde3a4" transform="rotate(24 18 -36)"/>' +
    "</g>" +
    "</svg>",
);

// The template paints itself with a neutral zinc palette; restyle those classes
// so the page reads in the repository's colours rather than the stock ones.
const STYLE = `
    <style>
      /* The page carries the same run of colour as the install button, pinned so
         it reads once from top to bottom rather than restarting each screen.
         It belongs on the root, not on the body: the root's background is what
         paints the canvas, so it covers the status bar and the overscroll area
         and does not stop short when the content is shorter than the screen.
         A flat colour here instead would show as a band of that colour above
         and below the gradient. */
      html {
        background: linear-gradient(180deg, #ffe2f0 0%, #ffc4dc 32%, #ffd3b8 70%, #ffca92 100%) fixed !important;
        background-repeat: no-repeat !important;
        min-height: 100%;
      }
      body {
        background: transparent !important;
        color: #33162a !important;
        min-height: 100vh;
      }
      /* Deep enough to hold against the pastel behind it; the light gradient
         used elsewhere would disappear into the page here. */
      h1 {
        background: linear-gradient(100deg, #c9376b 0%, #e0517f 42%, #e8853a 100%);
        -webkit-background-clip: text;
        background-clip: text;
        color: transparent !important;
      }
      .addToPaperbackButton {
        background: #ffffff !important;
        border-bottom-color: rgba(51, 22, 42, 0.12) !important;
        box-shadow: 0 6px 18px rgba(120, 40, 70, 0.16) !important;
        color: #33162a !important;
        font-weight: 700;
      }
      .bg-zinc-800 { background-color: #fffaf9 !important; }
      .bg-zinc-700 { background-color: #ffeef4 !important; }
      .hover\\:bg-zinc-600:hover { background-color: #ffe2ec !important; }
      .bg-gray-500 { background-color: #e9d3de !important; }
      .border-zinc-700 { border-color: #f4cddb !important; }
      .text-gray-100, .text-gray-200, .text-gray-300 { color: #33162a !important; }
      .text-gray-400 { color: #7a4a60 !important; }
      .placeholder-gray-400::placeholder { color: #9a7285 !important; }

      .bg-zinc-800.rounded-lg { border: 1px solid rgba(51, 22, 42, 0.1) !important; }
      .bg-zinc-800.rounded-lg:hover { border-color: #d1477a !important; }
      .shadow-lg { box-shadow: 0 8px 24px rgba(120, 40, 70, 0.14) !important; }

      /* Badge chips are filled from each extension's own colour and drawn at a
         quarter opacity when unselected, so only the label is set here — dark,
         which holds against both the pale unselected tint and the full fill. */
      .font-medium.transition-all { color: #33162a !important; }

      /* bg-red-500 backs both the ADULT pill and the error panel, and those
         carry different label colours, so the pill is matched on the pair. */
      .bg-red-500 { background-color: #c9376b !important; }
      .text-red-500 { color: #c9376b !important; }
      .bg-red-500.text-red-100 { background-color: #ffd9e4 !important; color: #a82d52 !important; }
      .bg-yellow-500.text-yellow-900 { background-color: #ffe6c2 !important; color: #8a4b10 !important; }
      .bg-green-500.text-green-100 { background-color: #d8efd0 !important; color: #2f5a35 !important; }
      .border-red-700 { border-color: rgba(51, 22, 42, 0.12) !important; }
    </style>
  </head>`;

const REPLACEMENTS = [
  ["  </head>", STYLE],
  [
    '<link rel="icon" href="https://paperback.moe/pb-logo.svg" />',
    `<link rel="icon" href="${FAVICON}" />`,
  ],
  ['src="https://paperback.moe/pb-logo.svg"', `src="${LOGO}"`],
  ["<title>Loading...</title>", `<title>${name}</title>`],
  [
    '<meta name="robots" content="noindex" />',
    `<meta name="robots" content="noindex" />\n    <meta name="description" content="${description}" />`,
  ],
  // Header halo: a white bloom lifts the mark off the gradient, where a
  // coloured one would only muddy it.
  ["rgba(84, 120, 219, 0.4)", "rgba(255, 255, 255, 0.6)"],
  ["rgba(246, 75, 75, 0.4)", "rgba(255, 255, 255, 0.35)"],
  // Install button carries white label text, so it has to sit well below the
  // pastels the page itself is painted in.
  ["bg-[#f64b4b]", "bg-[#c9376b]"],
  ["hover:bg-[#f46565]", "hover:bg-[#e0517f]"],
  // The template's blue drives the focus ring, the selected-source ring and the
  // per-source version line, in markup and in script alike. It has to read on
  // the near-white cards, so it matches the heading rather than the fills.
  ["#5478db", "#c9376b"],
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
