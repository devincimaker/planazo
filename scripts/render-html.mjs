// Render an HTML string to a PNG with headless Chrome.
//
// Every brand asset and store screenshot in this repo is generated, not drawn:
// the design system already exists as tokens and the real Bricolage/Instrument
// TTFs ship in node_modules, so rendering from markup keeps the exports and the
// app honest about each other. Redesign the tokens, re-run the script.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';

// The font packages are dependencies of the mobile app, and pnpm does not link
// them at the workspace root — resolve from apps/mobile, not from here.
const require = createRequire(
  new URL('../apps/mobile/package.json', import.meta.url),
);

const CHROME =
  process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

/** Absolute file:// URL for a font shipped by @expo-google-fonts. */
function fontUrl(pkg, weightDir, file) {
  const entry = require.resolve(`@expo-google-fonts/${pkg}/package.json`);
  return `file://${join(dirname(entry), weightDir, file)}`;
}

export const FONTS = {
  displayHeavy: fontUrl(
    'bricolage-grotesque',
    '800ExtraBold',
    'BricolageGrotesque_800ExtraBold.ttf',
  ),
  display: fontUrl('bricolage-grotesque', '700Bold', 'BricolageGrotesque_700Bold.ttf'),
  body: fontUrl('instrument-sans', '400Regular', 'InstrumentSans_400Regular.ttf'),
  bodyMedium: fontUrl('instrument-sans', '500Medium', 'InstrumentSans_500Medium.ttf'),
  bodySemiBold: fontUrl('instrument-sans', '600SemiBold', 'InstrumentSans_600SemiBold.ttf'),
  bodyBold: fontUrl('instrument-sans', '700Bold', 'InstrumentSans_700Bold.ttf'),
};

const FONT_FACES = `
  @font-face { font-family: 'Bricolage'; font-weight: 800; src: url('${FONTS.displayHeavy}'); }
  @font-face { font-family: 'Bricolage'; font-weight: 700; src: url('${FONTS.display}'); }
  @font-face { font-family: 'Instrument'; font-weight: 400; src: url('${FONTS.body}'); }
  @font-face { font-family: 'Instrument'; font-weight: 500; src: url('${FONTS.bodyMedium}'); }
  @font-face { font-family: 'Instrument'; font-weight: 600; src: url('${FONTS.bodySemiBold}'); }
  @font-face { font-family: 'Instrument'; font-weight: 700; src: url('${FONTS.bodyBold}'); }
`;

/**
 * @param {object} spec
 * @param {string} spec.body      markup for <body>
 * @param {string} [spec.css]     extra CSS
 * @param {number} spec.width     CSS pixels
 * @param {number} spec.height    CSS pixels
 * @param {number} [spec.scale]   device pixel ratio (3 for App Store 6.9")
 * @param {boolean} [spec.transparent]
 * @param {string} spec.out       absolute output path
 */
export function renderPng({ body, css = '', width, height, scale = 1, transparent = false, out }) {
  const workdir = mkdtempSync(join(tmpdir(), 'planazo-render-'));
  const htmlPath = join(workdir, 'page.html');

  writeFileSync(
    htmlPath,
    `<!doctype html><html><head><meta charset="utf-8"><style>
      ${FONT_FACES}
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body {
        width: ${width}px; height: ${height}px; overflow: hidden;
        ${transparent ? 'background: transparent;' : ''}
        -webkit-font-smoothing: antialiased;
      }
      ${css}
    </style></head><body>${body}</body></html>`,
  );

  mkdirSync(dirname(out), { recursive: true });

  execFileSync(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--no-sandbox',
      '--allow-file-access-from-files',
      `--force-device-scale-factor=${scale}`,
      ...(transparent ? ['--default-background-color=00000000'] : []),
      // Fonts are local files, but Chrome still needs a tick to lay them out.
      '--virtual-time-budget=3000',
      `--window-size=${width},${height}`,
      `--screenshot=${out}`,
      `file://${htmlPath}`,
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );

  rmSync(workdir, { recursive: true, force: true });
  return resolve(out);
}
