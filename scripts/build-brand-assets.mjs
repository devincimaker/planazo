// Regenerate the app icon, adaptive icon, splash lockup and favicon.
//
//   node scripts/build-brand-assets.mjs
//
// Source of truth: "Planazo Auth & Store Assets" 1b/1c. The mark is the letter P
// in Bricolage Grotesque 800, paper on ember — there is no illustration in
// Planazo, so nothing here is hand-drawn and everything is reproducible.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { renderPng } from './render-html.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(ROOT, 'apps/mobile/assets');

const EMBER = '#F2542D';
const PAPER = '#FCF8F4';
const INK = '#171215';

/**
 * Mark ratios measured off the design doc and constant at every size: the glyph
 * is 0.77 of the tile, tracked in by 0.038, and nudged down-right so the P sits
 * optically centred rather than metrically centred.
 */
function mark({ size, color = PAPER, ratio = 0.77 }) {
  return `<span style="
    font-family: 'Bricolage'; font-weight: 800;
    font-size: ${size * ratio}px; line-height: ${size * ratio}px;
    letter-spacing: ${size * -0.038}px; color: ${color};
    transform: translate(${size * 0.0156}px, ${size * 0.0234}px);
  ">P</span>`;
}

const centred = (extra = '') =>
  `display:flex; align-items:center; justify-content:center; overflow:hidden; ${extra}`;

const targets = [
  {
    name: 'iOS app icon (full-bleed square, the OS applies its own mask)',
    out: join(ASSETS, 'icon.png'),
    width: 1024,
    height: 1024,
    body: `<div style="${centred(`width:1024px; height:1024px; background:${EMBER};`)}">
      ${mark({ size: 1024 })}
    </div>`,
  },
  {
    // Android draws this over adaptiveIcon.backgroundColor and crops it to a
    // shape of the launcher's choosing, so the glyph is pulled well inside the
    // 66% safe circle rather than filling the tile like the iOS icon does.
    name: 'Android adaptive foreground (transparent, inside the safe circle)',
    out: join(ASSETS, 'adaptive-icon.png'),
    width: 1024,
    height: 1024,
    transparent: true,
    body: `<div style="${centred('width:1024px; height:1024px;')}">
      ${mark({ size: 1024, ratio: 0.606 })}
    </div>`,
  },
  {
    // resizeMode "contain" scales this to the screen, so the padding around the
    // lockup is what sets its final size — not a number in app.json.
    name: 'Splash lockup (transparent, sits on paper)',
    out: join(ASSETS, 'splash-icon.png'),
    width: 1024,
    height: 1024,
    transparent: true,
    body: `<div style="${centred('width:1024px; height:1024px; flex-direction:column; gap:70px;')}">
      <div style="${centred(
        `width:364px; height:364px; border-radius:119px; background:${EMBER};`,
      )}">${mark({ size: 364 })}</div>
      <span style="
        font-family: 'Bricolage'; font-weight: 800;
        font-size: 119px; line-height: 133px; letter-spacing: -2.5px; color: ${INK};
      ">Planazo</span>
    </div>`,
  },
  {
    name: 'Web favicon',
    out: join(ASSETS, 'favicon.png'),
    width: 64,
    height: 64,
    transparent: true,
    body: `<div style="${centred(
      `width:64px; height:64px; border-radius:21px; background:${EMBER};`,
    )}">${mark({ size: 64 })}</div>`,
  },
];

for (const target of targets) {
  renderPng(target);
  console.log(`  ${target.out.replace(`${ROOT}/`, '')}  —  ${target.name}`);
}

console.log('\nDone. Icons are generated: edit this script, never the PNGs.');
