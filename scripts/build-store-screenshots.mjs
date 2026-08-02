// Build the App Store gallery screenshots.
//
//   node scripts/build-store-screenshots.mjs
//
// Source: "Planazo Auth & Store Assets" 1d. Designed at 430 x 932 pt and
// rendered at 3x for the 6.9" slot (1290 x 2796), which App Store Connect also
// down-scales for every smaller iPhone — one set covers the whole listing.
//
// Copy and component styling are lifted from the shipped screens (SlotBar,
// Badge, DateOptionRow, AvatarStack, Button) rather than invented, because
// App Store Review rejects galleries that don't show the actual app.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { renderPng } from './render-html.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'store-assets/screenshots/ios-6.9');

const W = 430;
const H = 932;

const c = {
  ink: '#171215',
  paper: '#FCF8F4',
  surface: '#FFFFFF',
  accent: '#F2542D',
  accentPressed: '#C43B18',
  accentSoft: '#FDEFE9',
  confirmed: '#14A06B',
  confirmedSoft: '#E6F6EF',
  taupe: '#6B5F58',
  stone: '#9A8C84',
  border: '#F0E8E1',
  borderStrong: '#EADFD5',
  divider: '#F3EBE4',
  sunken: '#F6F0EA',
  onInkMuted: '#A99C94',
};

const groupColors = ['#F7B0DC', '#8FC7E8', '#F6C453', '#B7E4C7', '#E5D4F5'];

const css = `
  .display { font-family: 'Bricolage'; font-weight: 800; }
  .body { font-family: 'Instrument'; font-weight: 400; }
  /* The design sets this at 44px for Spanish. English runs longer — "Everyone
     answers" alone is ~390px against 350px of usable width — so the whole
     gallery drops a step rather than letting one shot wrap to four lines and
     sit taller than its neighbours. */
  .headline {
    font-family: 'Bricolage'; font-weight: 800;
    font-size: 38px; line-height: 41px; letter-spacing: -0.95px;
  }
  .card-title {
    font-family: 'Bricolage'; font-weight: 700;
    font-size: 22px; line-height: 25px; letter-spacing: -0.44px; color: ${c.ink};
  }
  .header-title {
    font-family: 'Bricolage'; font-weight: 700;
    font-size: 26px; line-height: 30px; letter-spacing: -0.52px; color: ${c.ink};
  }
  .row-value {
    font-family: 'Bricolage'; font-weight: 700;
    font-size: 18px; line-height: 22px; color: ${c.ink};
  }
  .status {
    font-family: 'Bricolage'; font-weight: 700;
    font-size: 22px; line-height: 26px; letter-spacing: -0.22px;
  }
  .section-label {
    font-family: 'Instrument'; font-weight: 700;
    font-size: 13px; line-height: 16px; letter-spacing: 0.65px;
    text-transform: uppercase; color: ${c.stone};
  }
  .sub { font-family: 'Instrument'; font-weight: 400; font-size: 14px; line-height: 20px; color: ${c.taupe}; }
  .body-strong { font-family: 'Instrument'; font-weight: 600; font-size: 15px; line-height: 20px; }
  .caption { font-family: 'Instrument'; font-weight: 600; font-size: 13px; line-height: 17px; color: ${c.stone}; }
  .tag { font-family: 'Instrument'; font-weight: 700; font-size: 12px; line-height: 15px; }
  .col { display: flex; flex-direction: column; }
  .row { display: flex; flex-direction: row; align-items: center; }
  .between { justify-content: space-between; }
  .btn {
    display: flex; align-items: center; justify-content: center;
    font-family: 'Instrument'; font-weight: 700; font-size: 16px; line-height: 20px;
    padding: 16px 20px; border-radius: 18px;
  }
  .btn-md { padding: 12px; border-radius: 14px; font-size: 14px; line-height: 18px; }
  .btn-primary { background: ${c.accent}; color: ${c.paper}; }
  .btn-ink { background: ${c.ink}; color: ${c.paper}; }
  .btn-outline { background: ${c.surface}; color: ${c.taupe}; border: 1.5px solid ${c.borderStrong}; }
`;

/** Badge — components/ui/Badge.tsx */
const badge = (label, tone, uppercase = false) => {
  const tones = {
    open: [c.accentSoft, c.accentPressed],
    confirmed: [c.confirmedSoft, c.confirmed],
  };
  const [bg, fg] = tones[tone];
  return `<span class="tag" style="
    background:${bg}; color:${fg}; padding:3px 9px; border-radius:999px; align-self:flex-start;
    ${uppercase ? 'text-transform:uppercase; letter-spacing:0.36px;' : ''}
  ">${label}</span>`;
};

/** SlotBar — components/ui/SlotBar.tsx: one slot per place, floor outlined. */
const slotBar = ({ going, min, cap }) => {
  const total = Math.max(cap ?? min, min, going, 1);
  const fill = going >= min ? c.confirmed : c.accent;
  const slots = Array.from({ length: total }, (_, i) => {
    const style =
      i < going
        ? `background:${fill};`
        : i < min
          ? `background:${c.surface}; border:1.5px solid ${c.borderStrong};`
          : `background:${c.sunken};`;
    return `<div style="flex:1; height:12px; border-radius:999px; ${style}"></div>`;
  }).join('');
  return `<div class="row" style="gap:5px">${slots}</div>`;
};

/** AvatarStack — components/ui/AvatarStack.tsx: 2px surface ring, -8px overlap. */
const avatarStack = (names, size = 30) =>
  `<div class="row">${names
    .map((name, i) => {
      const bg = groupColors[i % groupColors.length];
      return `<div style="
        width:${size + 4}px; height:${size + 4}px; border-radius:999px;
        border:2px solid ${c.surface}; background:${c.surface}; margin-right:-8px;
        display:flex; align-items:center; justify-content:center;
      "><div style="
        width:${size}px; height:${size}px; border-radius:999px; background:${bg};
        display:flex; align-items:center; justify-content:center;
        font-family:'Bricolage'; font-weight:700; font-size:${Math.round(size * 0.42)}px; color:${c.ink};
      ">${name[0].toUpperCase()}</div></div>`;
    })
    .join('')}</div>`;

/** DateOptionRow — components/ui/DateOptionRow.tsx */
const dateRow = (label, meta, selected) => `
  <div class="row between" style="
    padding:11px 14px; border-radius:16px; border:1.5px solid ${selected ? c.accent : 'transparent'};
    background:${selected ? c.accentSoft : c.sunken};
  ">
    <span class="body-strong" style="color:${selected ? c.accentPressed : c.ink}">${label}</span>
    <span class="caption" style="color:${selected ? c.accentPressed : c.stone}">${meta}</span>
  </div>`;

const shots = [
  {
    file: '01-one-plan.png',
    body: `
      <div class="col" style="width:${W}px; height:${H}px; background:${c.paper}">
        <div style="padding:56px 40px 0">
          <h3 class="headline" style="color:${c.ink}">One plan.<br>Everyone answers<br>in one place.</h3>
        </div>
        <div class="col" style="flex:1; padding:44px 30px 0">
          <div class="col" style="
            flex:1; background:${c.surface}; border:1px solid ${c.border};
            border-radius:32px 32px 0 0; overflow:hidden;
          ">
            <div style="height:4px; background:${groupColors[0]}"></div>
            <div class="col" style="padding:22px; gap:16px">
              <div class="row between">
                <span class="section-label">The usual crew</span>
                ${badge('Needs you', 'open')}
              </div>
              <span class="card-title">Paella at Nico's</span>
              <span class="sub">Sat 23 Aug · 21:00 · Dalston</span>
              ${slotBar({ going: 4, min: 6 })}
              <div class="row between">
                <span class="status" style="color:${c.accent}">2 more and it's on</span>
                ${avatarStack(['Ana', 'Bruno', 'Cami', 'Diego'])}
              </div>
              <div class="row" style="gap:10px; padding-top:2px">
                <div class="btn btn-md btn-primary" style="flex:1">I'm in</div>
                <div class="btn btn-md btn-outline" style="flex:1">Can't make it</div>
              </div>
            </div>
            <div style="height:1px; background:${c.divider}"></div>
            <div class="col" style="padding:22px; gap:12px">
              <div class="row between">
                <span class="section-label">Five-a-side</span>
                ${badge('Confirmed', 'confirmed')}
              </div>
              <span class="card-title">Thursday five-a-side</span>
              ${slotBar({ going: 10, min: 10 })}
              <span class="body-strong" style="color:${c.confirmed}">It's on</span>
            </div>
            <div style="height:1px; background:${c.divider}"></div>
            <div class="col" style="padding:22px; gap:12px">
              <div class="row between">
                <span class="section-label">Book club</span>
                ${badge('Needs you', 'open')}
              </div>
              <span class="card-title">Next book night</span>
              <span class="sub">4 dates on the table</span>
              ${slotBar({ going: 2, min: 5 })}
            </div>
          </div>
        </div>
      </div>`,
  },
  {
    file: '02-pick-your-days.png',
    body: `
      <div class="col" style="width:${W}px; height:${H}px; background:${c.ink}">
        <div style="padding:56px 40px 0">
          <h3 class="headline" style="color:${c.paper}">No date yet?<br>Tick the days<br>you can do.</h3>
          <p class="body" style="margin-top:16px; font-size:19px; line-height:27px; color:${c.onInkMuted}; max-width:320px">
            The day the most people can do wins. No message chain.
          </p>
        </div>
        <div class="col" style="flex:1; padding:40px 30px 0">
          <div class="col" style="
            flex:1; background:${c.surface}; border-radius:32px 32px 0 0;
            overflow:hidden; padding:24px; gap:14px;
          ">
            <span class="section-label">Tap the dates you can do</span>
            ${dateRow('Fri 22 Aug', '3 in', false)}
            ${dateRow('Sat 23 Aug', '5 in', true)}
            ${dateRow('Sun 24 Aug', '4 in', true)}
            ${dateRow('Thu 28 Aug', '1 in', false)}
            <div style="height:1px; background:${c.divider}; margin:4px 0"></div>
            <span class="status" style="color:${c.accent}">2 more on Sat 23 Aug</span>
            <div class="col" style="margin-top:auto; gap:10px">
              <div class="btn btn-primary">Send 2 dates</div>
              <span class="caption" style="text-align:center">You can change it whenever</span>
            </div>
          </div>
        </div>
      </div>`,
  },
  {
    file: '03-minimum-met.png',
    body: `
      <div class="col" style="width:${W}px; height:${H}px; background:${c.accent}">
        <div style="padding:56px 40px 0">
          <h3 class="headline" style="color:${c.paper}">Every plan has<br>a minimum.<br>If it's met, it's on.</h3>
        </div>
        <div class="col" style="flex:1; padding:40px 30px 0">
          <div class="col" style="
            flex:1; background:${c.paper}; border-radius:32px 32px 0 0;
            overflow:hidden; padding:26px; gap:18px;
          ">
            <div class="col" style="
              background:${c.surface}; border:1px solid ${c.border};
              border-radius:24px; padding:22px; gap:14px;
            ">
              ${badge('Confirmed', 'confirmed', true)}
              <span class="header-title">Padel, blue courts</span>
              <span class="sub">Sun 24 Aug · 10:30</span>
              ${slotBar({ going: 6, min: 4, cap: 6 })}
              <span class="status" style="color:${c.confirmed}">It's on: 6 going</span>
              ${avatarStack(['Ana', 'Bruno', 'Cami', 'Diego', 'Eze'], 34)}
            </div>
            <div class="col" style="
              background:${c.surface}; border:1px solid ${c.border};
              border-radius:24px; padding:20px; gap:8px;
            ">
              <span class="row-value">You're going too</span>
              <span class="sub">You said yes on Tuesday. You can change it.</span>
            </div>
            <div style="margin-top:auto">
              <div class="btn btn-ink">Nudge the ones who haven't</div>
            </div>
          </div>
        </div>
      </div>`,
  },
];

for (const shot of shots) {
  const out = join(OUT, shot.file);
  renderPng({ body: shot.body, css, width: W, height: H, scale: 3, out });
  console.log(`  ${out.replace(`${ROOT}/`, '')}  —  1290 x 2796`);
}

console.log('\nDone. Upload these to App Store Connect under iPhone 6.9".');
