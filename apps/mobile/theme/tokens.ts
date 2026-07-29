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

  confirmed: palette.green,
  confirmedSoft: palette.greenSoft,

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
