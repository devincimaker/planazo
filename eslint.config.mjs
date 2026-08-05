import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

/**
 * One flat config for the whole workspace. Each package runs `eslint .`; ESLint
 * walks up to find this file, so the patterns below are relative to the repo
 * root no matter which package the command started in.
 *
 * Two jobs, and they are worth keeping distinct when adding rules:
 *
 * 1. **Catch bugs.** Off-the-shelf rules from typescript-eslint and
 *    eslint-plugin-react-hooks. Generic; knows nothing about Planazo.
 * 2. **Enforce the conventions in AGENTS.md.** Rules written here because the
 *    convention is ours. Until this file existed those lived only as prose that
 *    every agent had to remember, and prose does not fail CI.
 *
 * Rules deliberately switched OFF are listed with the reason. A rule that is
 * off because it is wrong for this codebase is a decision; one that is off
 * because it was noisy and nobody looked is rot. Say which.
 */

/** The em dash the empty-value glyph uses, and the one AGENTS.md bans. */
const EM_DASH = '—';

/**
 * AGENTS.md: no em dash in anything a user can read.
 *
 * The two carve-outs from that rule are handled here rather than by asking
 * people to remember them:
 *
 * - **Comments** are exempt. ESLint only sees the string and JSX nodes below,
 *   so developer prose is never visited in the first place.
 * - **The bare `{cap ?? '—'}` glyph** is exempt: typography standing in for
 *   "no value", not a sentence. Requiring a letter alongside the dash is what
 *   distinguishes them. Copy always has letters; the glyph never does.
 */
const emDashWithText = [
  { node: 'Literal', attr: 'value' },
  { node: 'TemplateElement', attr: 'value.raw' },
  { node: 'JSXText', attr: 'value' },
].map(({ node, attr }) => ({
  selector: `${node}[${attr}=/${EM_DASH}/][${attr}=/[A-Za-z]/]`,
  message:
    'No em dash in product copy (AGENTS.md). Rewrite rather than swap in another dash: ' +
    'a full stop for two sentences, a colon to introduce, a comma for an aside, ' +
    'parentheses for a parenthetical. Splitting in two is usually best.',
}));

export default tseslint.config(
  {
    // A disable comment whose rule no longer fires is debt that paid itself
    // off but kept sitting on the books. Erroring on it makes the file-level
    // suppressions AGENTS.md tracks self-cleaning: the moment one stops being
    // needed, CI says so.
    linterOptions: { reportUnusedDisableDirectives: 'error' },
  },

  {
    // Not ours to lint: build output, dependencies, generated types.
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '**/ios/**',
      '**/android/**',
      '**/.expo/**',
      'packages/shared/src/database.types.ts',
    ],
  },

  ...tseslint.configs.recommended,

  {
    files: ['**/*.{ts,tsx,mjs,js}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      // --- Structure guards (PLA-66) -----------------------------------------
      // All zero-hit when enabled. They cost nothing today and stop the
      // classic agent-written slop: pyramids of nesting, argument lists that
      // should be an options object, `let` that never reassigns, an `else`
      // after a return.
      'max-depth': 'error',
      'max-params': 'error',
      'no-else-return': 'error',
      'no-lonely-if': 'error',
      'prefer-const': 'error',
      'no-unreachable': 'error',

      // --- Off, with reasons -------------------------------------------------

      // 148 hits. Turning this on is a decision about how strictly the codebase
      // types its Supabase payloads and test doubles, and it deserves its own
      // issue rather than riding along with the lint setup.
      '@typescript-eslint/no-explicit-any': 'off',

      // Unused function arguments are how you document a callback signature you
      // do not need all of. Leading underscore opts out, which is the usual
      // convention and keeps the rule useful for genuinely dead locals.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },

  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,

      // Genuinely useful here: this codebase is written by agents, and a stale
      // closure is the classic thing that survives review and typecheck.
      'react-hooks/exhaustive-deps': 'error',

      // 19 hits, all false positives. The rule flags reading a ref during
      // render, but `useRef(new Animated.Value(0)).current` is the standard
      // React Native idiom for a stable animated value, and PanResponder
      // handlers built once in render have to read their inputs through refs
      // or stay pinned to the first render's closure (see SwipeRow). The rule
      // cannot tell those apart from a real violation.
      'react-hooks/refs': 'off',
    },
  },

  {
    // Conventions from AGENTS.md, enforced instead of remembered.
    files: ['**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': ['error', ...emDashWithText],

      // Length is a proxy for "this file is doing too much". 400 counts real
      // code only: this codebase comments heavily and that should never push a
      // file over. Seven screens are over the cap today and each carries a
      // file-level disable pointing at the issue that removes it.
      'max-lines': [
        'error',
        { max: 400, skipBlankLines: true, skipComments: true },
      ],
    },
  },

  {
    /**
     * Tests, their helpers, and the integration-tests tooling are
     * developer-facing throughout. AGENTS.md exempts test names from the em dash
     * rule for the same reason it exempts comments, and the strings in `env.ts`,
     * `global-setup.ts` and `apps/mobile/lib/testing/` are terminal output for
     * whoever a guard just refused. Length is not the complexity max-lines
     * exists to catch when a file is a flat list of independent cases, and
     * `require` is how jest mocks are wired.
     *
     * These are exclusions, not suppressions: the rules do not apply here, as
     * opposed to applying and being ignored.
     */
    files: [
      '**/__tests__/**/*.{ts,tsx}',
      '**/*.test.{ts,tsx}',
      '**/__mocks__/**/*.{ts,tsx}',
      'apps/mobile/lib/testing/**/*.{ts,tsx}',
      'packages/integration-tests/**/*.ts',
    ],
    rules: {
      'max-lines': 'off',
      // A test helper threading five fixtures is a flat list of inputs, not
      // the tangled signature max-params exists to catch.
      'max-params': 'off',
      'no-restricted-syntax': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },

  {
    /**
     * Type-aware rules (PLA-66): the bug class that typecheck, review and
     * tests all miss. Scoped to the mobile app's own code, where the payloads
     * come from Supabase and a wrong assumption about null ships a crash.
     * Tests and their helpers are excluded: jest mocks hand promises around
     * loosely by design, and the rules would fight the mocking idiom, not
     * find bugs. The whole type-aware pass adds ~4s, measured, so cost is not
     * a reason to trim it.
     */
    files: ['apps/mobile/**/*.{ts,tsx}'],
    ignores: [
      'apps/mobile/**/__tests__/**',
      'apps/mobile/**/*.test.{ts,tsx}',
      'apps/mobile/**/__mocks__/**',
      'apps/mobile/lib/testing/**',
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // An `as X` the compiler can prove is a no-op is a reader being told
      // something the types already say, or worse, a stale claim from an old
      // shape that nobody removed.
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',

      // A promise handed to something expecting void is a rejection nobody
      // will ever see. JSX attributes are carved out: `onPress={async ...}`
      // is the standard React Native idiom, and the event system ignores the
      // return value by contract, so the rule would only generate wrappers.
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } },
      ],

      // Comparing an enum to a bare literal keeps compiling after the enum
      // member is renamed; comparing to the member does not.
      '@typescript-eslint/no-unsafe-enum-comparison': 'error',

      // An async function with no await still returns a promise, so every
      // caller pays the wrapper for nothing and the signature lies about
      // there being asynchrony inside.
      '@typescript-eslint/require-await': 'error',

      // A dropped promise is a dropped failure. `invalidateQueries` is the
      // one call exempted by name: its promise resolves when the refetches
      // land, a rejection there surfaces through each query's own error UI,
      // and this codebase never has a reason to wait for it. Everything else
      // says what it does with the failure, with `void` reserved for calls
      // whose comment can say why the failure does not matter.
      '@typescript-eslint/no-floating-promises': [
        'error',
        {
          allowForKnownSafeCalls: [
            {
              // Declared in query-core, which is where the specifier has to
              // point even though the app imports @tanstack/react-query.
              from: 'package',
              package: '@tanstack/query-core',
              name: 'invalidateQueries',
            },
          ],
        },
      ],
    },
  },

  {
    /**
     * `lib/testing/` is for jest suites only. It imports
     * `@testing-library/react-native`, a devDependency, and Metro's resolver
     * does not distinguish those from real ones. A stray import from a screen
     * would quietly ship the test renderer inside the app, and nothing would
     * fail: not the build, not CI, not a release. Only the bundle size, and
     * only if someone measured it.
     */
    files: ['apps/mobile/**/*.{ts,tsx}'],
    ignores: [
      'apps/mobile/**/__tests__/**',
      'apps/mobile/**/*.test.{ts,tsx}',
      'apps/mobile/**/__mocks__/**',
      'apps/mobile/lib/testing/**',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              // Two shapes, because the rule matches the import string and not
              // the resolved path: `../../lib/testing/x` from a screen, and
              // `./testing/x` from a file already inside `lib/`.
              group: ['**/lib/testing', '**/lib/testing/*', '*/testing', '*/testing/*'],
              message:
                'lib/testing/ is jest-only. Importing it from app code ships a devDependency in the bundle.',
            },
          ],
        },
      ],
    },
  },

  {
    // Legal text in two languages. It is content, not logic, and splitting it
    // would serve no reader.
    files: ['apps/web/lib/legal.ts'],
    rules: { 'max-lines': 'off' },
  },
);
