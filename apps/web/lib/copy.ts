export type Lang = 'es' | 'en';

/**
 * The language the site renders in. Every string below exists in both locales,
 * so serving English is a one-line change here — or a `[lang]` route segment
 * when we want both live at once.
 *
 * The Spanish is Rioplatense (voseo: tirá, bajate, marcá, venís). Fixtures are
 * Buenos Aires. Keep both consistent — a Catalan place name under an Argentine
 * verb reads as neither.
 */
export const LANG: Lang = 'es';

export const COPY = {
  en: {
    navCta: 'Get the app',
    eyebrow: 'Plans with your friends',
    heroA: 'From a loose idea',
    heroB: 'to a plan that happens.',
    heroSub:
      "Paintball, a whisky tasting, that weekend away you've been talking about for months. Put it up even without a date.",

    // Fixed-date card — the plan that's already decided.
    circleFixed: 'Tuesday Football',
    hosted: 'Nacho asked',
    planTitle: 'Five-a-side in Palermo',
    planWhen: 'Tue 26 Aug · 21:00',
    slots: '6 of 10 in',
    slotsIn: '7 of 10 in',
    cant: "Can't",
    imIn: "I'm in",
    change: 'Change',
    you: 'You',
    inLabel: "✓ You're in",
    outLabel: "You're out",

    // Flexible card — the idea that hasn't hardened yet. This is the product.
    circleFlex: 'Los de Siempre',
    flexTag: 'No date yet',
    flexTitle: 'Paintball, out of town',
    flexAsk: 'Tick every day you could do.',
    canDo: 'can',
    leading: 'Leading',
    youToo: 'You too',
    lockOpen: 'Locks when 6 can do the same day.',
    lockedIn: 'Locked in ·',

    // Full card — nothing to answer, but the waitlist is one tap.
    circleFull: 'Monday Padel',
    fullTag: 'Full',
    fullTitle: 'Padel, two courts',
    fullWhen: 'Mon 25 Aug · 19:00',
    fullSlots: '8 of 8 in',
    waitCta: 'Take the next spot',
    waitOn: '✓ First in line',
    waitNoteOff: 'Someone always drops out at the last minute.',
    waitNoteOn: "If a spot opens, it's yours. We'll tell you.",

    heroCta: 'Get Planazo',
    heroCtaSub: 'Free. iOS and Android.',

    proofTitle: 'Good ideas die in WhatsApp.',
    before: 'WhatsApp',
    after: 'Planazo',
    threadEnd: 'Three weeks later · still no date',
    proofCircle: 'Los de Siempre',
    proofWhen: 'Sun 24 Aug · 11:00',
    confirmed: '✓ Confirmed · 6 of 6 in',

    circlesEyebrow: 'Groups',
    circlesTitle: 'Different people, different plans.',

    closeTitle: 'Throw it out there. Let it happen.',
    closeSub: "Twenty seconds to put it up. Planazo asks everyone, collects the answers and says when it's on.",
    closeCta: 'Get Planazo',

    fPrivacy: 'Privacy',
    fSupport: 'Support',
    fContact: 'Contact',
  },
  es: {
    navCta: 'Bajate la app',
    eyebrow: 'Planes con tus amigos',
    heroA: 'De una idea suelta',
    heroB: 'a un plan que pasa.',
    heroSub:
      'Paintball, una degustación de whisky, ese finde que venís hablando hace meses. Tirala aunque no tengas fecha.',

    // Plan con fecha cerrada — lo que ya estaba decidido.
    circleFixed: 'Los del fulbito',
    hosted: 'Preguntó Nacho',
    planTitle: 'Fútbol 5 en Palermo',
    planWhen: 'Mar 26 ago · 21:00',
    slots: '6 de 10 van',
    slotsIn: '7 de 10 van',
    cant: 'No puedo',
    imIn: 'Voy',
    change: 'Cambiar',
    you: 'Vos',
    inLabel: '✓ Vas',
    outLabel: 'No vas',

    // Plan sin fecha — la idea todavía blanda. Esto es el producto.
    circleFlex: 'Los de Siempre',
    flexTag: 'Sin fecha',
    flexTitle: 'Paintball en Escobar',
    flexAsk: 'Marcá todos los días que puedas.',
    canDo: 'pueden',
    leading: 'Va ganando',
    youToo: 'Vos también',
    lockOpen: 'Se cierra cuando 6 puedan el mismo día.',
    lockedIn: 'Cerrado ·',

    // Completo — no hay nada que contestar, pero la lista de espera es un toque.
    circleFull: 'Pádel de los lunes',
    fullTag: 'Completo',
    fullTitle: 'Pádel, dos canchas',
    fullWhen: 'Lun 25 ago · 19:00',
    fullSlots: '8 de 8 van',
    waitCta: 'Quiero el próximo lugar',
    waitOn: '✓ Primero en la fila',
    waitNoteOff: 'Siempre se baja alguien a último momento.',
    waitNoteOn: 'Si se libera un lugar, es tuyo. Te avisamos.',

    heroCta: 'Bajate Planazo',
    heroCtaSub: 'Gratis. iOS y Android.',

    proofTitle: 'Las buenas ideas se mueren en WhatsApp.',
    before: 'WhatsApp',
    after: 'Planazo',
    threadEnd: 'Tres semanas después · sigue sin fecha',
    proofCircle: 'Los de Siempre',
    proofWhen: 'Dom 24 ago · 11:00',
    confirmed: '✓ Confirmado · 6 de 6 van',

    circlesEyebrow: 'Grupos',
    circlesTitle: 'Otra gente, otros planes.',

    closeTitle: 'Tirá la idea. Que se arme sola.',
    closeSub: 'Veinte segundos para armarlo. Planazo pregunta, junta las respuestas y avisa cuando está.',
    closeCta: 'Bajate Planazo',

    fPrivacy: 'Privacidad',
    fSupport: 'Ayuda',
    fContact: 'Contacto',
  },
} as const;

export type Copy = (typeof COPY)[Lang];

/** Page <title> / meta description, kept out of the UI copy above. */
export const META = {
  en: {
    title: 'Planazo — Plans with friends that actually happen',
    description:
      "Throw out the idea even without a date. Everyone marks the days they can do, and Planazo finds the one that works. Free on iOS and Android.",
  },
  es: {
    title: 'Planazo — Planes con amigos que sí pasan',
    description:
      'Tirá la idea aunque no tengas fecha. Cada uno marca los días que puede y Planazo encuentra el que sirve. Gratis en iOS y Android.',
  },
} as const;

/* ---------------------------------------------------------------- demo data */

export type Avatar = { i: string; bg: string; fg: string };

export const BASE: Avatar[] = [
  { i: 'N', bg: '#171215', fg: '#FCF8F4' },
  { i: 'C', bg: '#F7B0DC', fg: '#171215' },
  { i: 'J', bg: '#F2542D', fg: '#FFFFFF' },
  { i: 'A', bg: '#E4DAD1', fg: '#6B5F58' },
  { i: 'T', bg: '#C9CBA6', fg: '#3F441F' },
  { i: '+2', bg: '#F6F0EA', fg: '#9A8C84' },
];

export const FULL_GOERS: Avatar[] = [
  { i: 'P', bg: '#171215', fg: '#FCF8F4' },
  { i: 'M', bg: '#C9CBA6', fg: '#3F441F' },
  { i: 'S', bg: '#F7B0DC', fg: '#171215' },
  { i: 'L', bg: '#E4DAD1', fg: '#6B5F58' },
  { i: 'B', bg: '#F2542D', fg: '#FFFFFF' },
  { i: '+3', bg: '#F6F0EA', fg: '#9A8C84' },
];

/**
 * [text, isMine] — the thread that never converges. The point isn't silence,
 * it's effort spent without a decision, which is why it ends on "bueno vemos".
 */
export const THREAD: Record<Lang, [string, boolean][]> = {
  en: [
    ['paintball at some point?', false],
    ['hahaha im in', true],
    ['when though', false],
    ['dunno, you tell me', true],
    ["ok we'll see", false],
  ],
  es: [
    ['che, paintball algún día?', false],
    ['jajaja dale', true],
    ['cuándo?', false],
    ['ni idea, ustedes dicen', true],
    ['bueno vemos', false],
  ],
};

/** [name, answer] — the same idea, resolved. */
export const RESOLVED: Record<Lang, [string, string][]> = {
  en: [
    ['Caro', 'In'],
    ['Nacho', 'In'],
    ['Juli', "Can't"],
  ],
  es: [
    ['Caro', 'Va'],
    ['Nacho', 'Va'],
    ['Juli', 'No puede'],
  ],
};

export const CIRCLE_DOTS = ['#F2542D', '#F7B0DC', '#C9CBA6', '#171215'];

export const CIRCLES: Record<Lang, { name: string; vibe: string; people: string; next: string }[]> = {
  en: [
    { name: 'Los de Siempre', vibe: 'Dinners, mostly. Nobody cooks twice.', people: '12 people', next: '2 plans' },
    { name: 'Los del fulbito', vibe: 'Football on Tuesdays, rain or shine.', people: '18 people', next: '1 plan' },
    { name: 'Escapistas', vibe: 'Weekends far from here.', people: '6 people', next: '1 plan' },
    { name: 'Vecinos', vibe: "Whoever's around tonight.", people: '9 people', next: '3 plans' },
  ],
  es: [
    { name: 'Los de Siempre', vibe: 'Cenas, casi siempre. Nadie cocina dos veces.', people: '12 personas', next: '2 planes' },
    { name: 'Los del fulbito', vibe: 'Fútbol los martes, llueva o truene.', people: '18 personas', next: '1 plan' },
    { name: 'Escapistas', vibe: 'Findes lejos de acá.', people: '6 personas', next: '1 plan' },
    { name: 'Vecinos', vibe: 'El que ande cerca hoy.', people: '9 personas', next: '3 planes' },
  ],
};

export type DateOption = { id: string; label: string; time: string; base: number };

/**
 * Two weekends apart, so the card reads as "paintball this month" rather than
 * "pick a weeknight". `sun24` is the one that reaches MIN_PEOPLE on a single
 * tap — keep it in sync with `proofWhen`, which shows that plan resolved.
 */
export const DATES: Record<Lang, DateOption[]> = {
  en: [
    { id: 'sat23', label: 'Sat 23 Aug', time: '15:00', base: 3 },
    { id: 'sun24', label: 'Sun 24 Aug', time: '11:00', base: 5 },
    { id: 'sat30', label: 'Sat 30 Aug', time: '15:00', base: 2 },
  ],
  es: [
    { id: 'sat23', label: 'Sáb 23 ago', time: '15:00', base: 3 },
    { id: 'sun24', label: 'Dom 24 ago', time: '11:00', base: 5 },
    { id: 'sat30', label: 'Sáb 30 ago', time: '15:00', base: 2 },
  ],
};

/** How many people have to share a day before a flexible plan locks. */
export const MIN_PEOPLE = 6;
