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
      /* Flat, and cool rather than warm. A pink-and-mango wash over a warm base
         mixes to brown at low opacity, which is what covered the whole page;
         the pastels belong on the elements, not behind them. */
      body {
        background: #141019 !important;
        color: #f3e9f4 !important;
      }
      h1 {
        background: linear-gradient(100deg, #ffdcea 0%, #ffbbd5 34%, #ffcda8 70%, #ffc17e 100%);
        -webkit-background-clip: text;
        background-clip: text;
        color: transparent !important;
      }
      .addToPaperbackButton {
        background: linear-gradient(100deg, #ffdcea 0%, #ffbbd5 34%, #ffcda8 68%, #ffc17e 100%) !important;
        border-bottom-color: rgba(51, 22, 42, 0.3) !important;
        color: #33162a !important;
        font-weight: 700;
      }
      .bg-zinc-800 { background-color: #1e1728 !important; }
      .bg-zinc-700 { background-color: #2a2038 !important; }
      .hover\\:bg-zinc-600:hover { background-color: #352845 !important; }
      .bg-gray-500 { background-color: #392b47 !important; }
      .border-zinc-700 { border-color: #392b47 !important; }
      .text-gray-100, .text-gray-200, .text-gray-300 { color: #f3e9f4 !important; }
      .text-gray-400 { color: #c0a8cc !important; }

      .bg-zinc-800.rounded-lg { border: 1px solid #392b47 !important; }
      .bg-zinc-800.rounded-lg:hover { border-color: #f47fb2 !important; }
      .shadow-lg { box-shadow: none !important; }

      /* Content-rating pills read as a tinted panel with light text of the same
         hue, rather than a block of saturated colour. */
      .bg-red-500 { background-color: #431e31 !important; }
      .text-red-100 { color: #ffb3cf !important; }
      .text-red-500 { color: #c94a72 !important; }
      .bg-yellow-500 { background-color: #453320 !important; }
      .text-yellow-900 { color: #ffd79a !important; }
      .bg-green-500 { background-color: #23342d !important; }
      .text-green-100 { color: #a8e0c0 !important; }
      .border-red-700 { border-color: rgba(51, 22, 42, 0.3) !important; }
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
  // Header halo, kept to pink alone: the warm half of it was what turned the
  // area behind the logo brown.
  ["rgba(84, 120, 219, 0.4)", "rgba(255, 187, 213, 0.34)"],
  ["rgba(246, 75, 75, 0.4)", "rgba(244, 127, 178, 0.26)"],
  // Install button sits on white label text, so it stays a step deeper than
  // the pastels used for fills.
  ["bg-[#f64b4b]", "bg-[#e8629b]"],
  ["hover:bg-[#f46565]", "hover:bg-[#f47fb2]"],
  // The template's blue drives the focus ring, the selected-source ring and the
  // per-source link, in markup and in script alike.
  ["#5478db", "#f47fb2"],
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
