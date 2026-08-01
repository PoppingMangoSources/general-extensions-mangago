// The toolchain copies a fixed homepage template into bundles/ on every build,
// so the repository's own palette and titles are applied here afterwards.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const { name, description } = JSON.parse(readFileSync("package.json", "utf8"));

const svgUri = (body) => "data:image/svg+xml," + encodeURIComponent(body);

const FAVICON = svgUri(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
    '<circle cx="32" cy="32" r="32" fill="#ffe3ee"/>' +
    '<ellipse cx="32" cy="35" rx="15" ry="19" fill="#ff9f52"/>' +
    '<path d="M33 14 q3 -6 9 -8" fill="none" stroke="#8fb648" stroke-width="4" stroke-linecap="round"/>' +
    '<circle cx="50" cy="14" r="5" fill="#f277a8"/>' +
    "</svg>",
);

// The template ships the Paperback tile as the header image, which reads as a
// different product's mark above the repository's own name.
const LOGO = svgUri(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">' +
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
      /* Sized in pixels rather than percentages: percentage-sized glows cover
         a narrow phone viewport end to end and wash the whole page out. */
      body {
        background:
          radial-gradient(120% 420px at 50% -80px, rgba(255, 187, 213, 0.34) 0%, transparent 72%),
          radial-gradient(90% 320px at 88% 40px, rgba(255, 193, 126, 0.2) 0%, transparent 72%),
          radial-gradient(80% 300px at 6% 260px, rgba(207, 235, 180, 0.1) 0%, transparent 72%),
          #150911 !important;
        background-repeat: no-repeat !important;
        background-attachment: scroll !important;
        color: #ffeaf2 !important;
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
      .bg-zinc-800 { background-color: #26101d !important; }
      .bg-zinc-700 { background-color: #351529 !important; }
      .hover\\:bg-zinc-600:hover { background-color: #451c37 !important; }
      .bg-gray-500 { background-color: #6b2b4b !important; }
      .border-zinc-700 { border-color: #55223d !important; }
      .text-gray-100, .text-gray-200, .text-gray-300 { color: #ffeaf2 !important; }
      .text-gray-400 { color: #f0a8c4 !important; }

      /* Source cards: lift them off the background instead of letting them sit
         flat against it. */
      .bg-zinc-800.rounded-lg { border: 1px solid rgba(255, 187, 213, 0.15) !important; }
      .shadow-lg { box-shadow: 0 12px 32px rgba(16, 5, 12, 0.55) !important; }
      .bg-zinc-800.rounded-lg:hover { border-color: rgba(255, 187, 213, 0.4) !important; }

      /* Content-rating pills and the error panel ship in stock red, yellow and
         green, the three loudest colours on the page. */
      .bg-red-500 { background-color: #e8506f !important; }
      .text-red-100 { color: #fff0f4 !important; }
      .text-red-500 { color: #e8506f !important; }
      .bg-yellow-500 { background-color: #f0a94c !important; }
      .text-yellow-900 { color: #3b2408 !important; }
      .bg-green-500 { background-color: #9bc153 !important; }
      .text-green-100 { color: #1e2a10 !important; }
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
  // Header halo: blossom pink and mango, the two ends of the banner gradient.
  ["rgba(84, 120, 219, 0.4)", "rgba(255, 187, 213, 0.5)"],
  ["rgba(246, 75, 75, 0.4)", "rgba(255, 193, 126, 0.42)"],
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
