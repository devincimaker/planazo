import { Platform, TextStyle } from 'react-native';

// Design tokens for the Planazo redesign ("Planazo Screens Final" design doc).
// Every screen and component styles from here — no raw hex values in screens.

export const palette = {
  ink: '#171215',
  paper: '#FCF8F4',
  white: '#FFFFFF',

  ember: '#F2542D',
  emberPressed: '#C43B18',
  emberSoft: '#FDEFE9',

  green: '#14A06B',
  greenSoft: '#E6F6EF',

  taupe: '#6B5F58',
  stone: '#9A8C84',
  sand: '#B3A79E',
  mushroom: '#8C7F77',

  linen: '#F6F0EA',
  eggshell: '#F0E8E1',
  parchment: '#F3EBE4',
  oat: '#EADFD5',
  mist: '#EFE6DE',

  // Endings family ("Planazo Endings" design doc, 19a–19e): flat stone
  // surfaces for plans that stopped being plans.
  putty: '#F0EAE4',
  pebble: '#E3D9D1',
  dust: '#E9E1DA',
  ash: '#C9BDB4',
  bone: '#F4EEE8',

  // Album (PLA-32): what sits where a photograph is going to be. Two values
  // rather than one so a grid of tiles waiting on their signed URLs reads as
  // a grid rather than one flat block. Warmer than the endings stones on
  // purpose: an album is not a plan that stopped.
  clay: '#E4DAD1',
  clay2: '#EAE4DC',
} as const;

export const colors = {
  background: palette.paper,
  surface: palette.white,
  ink: palette.ink,

  textPrimary: palette.ink,
  textSecondary: palette.taupe,
  textMuted: palette.stone,
  textFaint: palette.sand,
  textOnAccent: palette.white,

  accent: palette.ember,
  accentPressed: palette.emberPressed,
  accentSoft: palette.emberSoft,

  // Ember carries only 3.3:1 against paper and 3.5:1 against white — plenty
  // for fills, borders, icons and big display type, short of the 4.5:1 WCAG
  // asks of body-sized text. This darker ember reads the same but measures
  // 5.0:1 on paper and 5.3:1 on white. Use it whenever the brand colour is
  // carrying words under ~18px: links, captions, inline errors.
  accentText: palette.emberPressed,

  confirmed: palette.green,
  confirmedSoft: palette.greenSoft,

  // On the waiting list (PLA-37): the third answer, between the green of a
  // place you hold and the grey of one you turned down. Warm rather than
  // settled — you have acted, and it is not resolved yet. Named separately
  // from the accent because it means something the accent does not, even
  // while it borrows the same two values; `waiting` is the darker ember for
  // the same contrast reason accentText exists.
  waiting: palette.emberPressed,
  waitingSoft: palette.emberSoft,

  border: palette.eggshell,
  borderStrong: palette.oat,
  divider: palette.parchment,

  surfaceSunken: palette.linen,
  tabInactive: palette.mushroom,

  // Ended plans (called off / didn't happen): the stone status card, its
  // border, the state pill, and the frozen slot bar / strikethrough grey.
  endedCard: palette.putty,
  endedBorder: palette.pebble,
  endedBadge: palette.dust,
  endedMuted: palette.ash,
  pastCard: palette.bone,

  tabBarBackground: 'rgba(252,248,244,0.94)',
  tabBarBorder: palette.mist,

  // Album: the fill under a photo that has not arrived yet, and the alternate
  // it sits beside in a strip.
  photoPlaceholder: palette.clay,
  photoPlaceholderAlt: palette.clay2,
  // Behind a photo filling the screen. Ink rather than black, so the viewer
  // belongs to the same warm palette as everything it opened from.
  photoBackdrop: 'rgba(23,18,21,0.94)',
} as const;

// Group identity colors (design: circle swatches + avatar backgrounds)
export const groupColors = ['#F7B0DC', '#8FC7E8', '#F6C453', '#B7E4C7', '#E5D4F5'] as const;

export const fonts = {
  display: 'BricolageGrotesque_700Bold',
  displayHeavy: 'BricolageGrotesque_800ExtraBold',
  body: 'InstrumentSans_400Regular',
  bodyMedium: 'InstrumentSans_500Medium',
  bodySemiBold: 'InstrumentSans_600SemiBold',
  bodyBold: 'InstrumentSans_700Bold',
} as const;

// Type scale straight from the mockups. letterSpacing is in px (RN),
// converted from the doc's em values at each size.
export const type = {
  screenTitle: {
    fontFamily: fonts.displayHeavy,
    fontSize: 30,
    lineHeight: 33,
    letterSpacing: -0.6,
    color: colors.textPrimary,
  },
  headerTitle: {
    fontFamily: fonts.displayHeavy,
    fontSize: 26,
    lineHeight: 30,
    letterSpacing: -0.52,
    color: colors.textPrimary,
  },
  cardTitle: {
    fontFamily: fonts.display,
    fontSize: 22,
    lineHeight: 25,
    letterSpacing: -0.44,
    color: colors.textPrimary,
  },
  statusHeadline: {
    fontFamily: fonts.display,
    fontSize: 22,
    lineHeight: 26,
    letterSpacing: -0.22,
    color: colors.accent,
  },
  rowValue: {
    fontFamily: fonts.display,
    fontSize: 18,
    lineHeight: 22,
    color: colors.textPrimary,
  },
  body: {
    fontFamily: fonts.body,
    fontSize: 15,
    lineHeight: 22,
    color: colors.textPrimary,
  },
  bodyStrong: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 15,
    lineHeight: 20,
    color: colors.textPrimary,
  },
  sub: {
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
  },
  caption: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 13,
    lineHeight: 17,
    color: colors.textMuted,
  },
  sectionLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: 13,
    lineHeight: 16,
    letterSpacing: 0.65,
    textTransform: 'uppercase' as const,
    color: colors.textMuted,
  },
  tag: {
    fontFamily: fonts.bodyBold,
    fontSize: 12,
    lineHeight: 15,
    color: colors.textSecondary,
  },
  tabLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    lineHeight: 13,
    color: colors.tabInactive,
  },
} satisfies Record<string, TextStyle>;

export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

export const radii = {
  row: 14,
  input: 16,
  footerButton: 18,
  card: 24,
  pill: 999,

  // Album (PLA-32). The hero is a card inset by 4px on every side, so its
  // corner is the card's 24 less that inset. The strip tiles are smaller and
  // take a tighter radius of their own, or four 20s in a row read as bubbles.
  photo: 20,
  photoTile: 14,
} as const;

/**
 * Form-sheet heights, as a fraction of the window.
 *
 * Shared rather than inlined because a formSheet has to be told its height
 * twice: once as `sheetAllowedDetents` so iOS presents it at that size, and
 * once as a real `height` on the screen's root view. Without the second one
 * the content view is laid out at its natural height, `flex: 1` resolves
 * against that instead of the detent, and any ScrollView inside ends up as
 * tall as its own content — so it has nothing to scroll and the sheet
 * silently clips whatever does not fit.
 *
 * A screen whose content wants the whole window is better off as
 * `presentation: 'modal'`, which is bounded by the window and needs none of
 * this. That is what the profile screen does.
 */
export const sheetDetents = {
  invites: 0.78,
} as const;

export const shadows = {
  card: Platform.select({
    ios: {
      shadowColor: palette.ink,
      shadowOpacity: 0.06,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 6 },
    },
    android: { elevation: 2 },
    default: {},
  })!,
} as const;
