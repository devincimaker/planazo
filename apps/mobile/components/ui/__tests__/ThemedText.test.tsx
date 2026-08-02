import { render } from '@testing-library/react-native';
import { ThemedText } from '../ThemedText';

/**
 * Dynamic Type. iOS accessibility sizes scale text by up to roughly 3.1x, and
 * `screenTitle` starts at 30pt — unchecked, one heading became a ~90pt block
 * that pushed the whole form below the fold.
 *
 * The rule these tests pin down: cap the display sizes, never the content.
 */
describe('ThemedText font scaling', () => {
  it.each(['screenTitle', 'headerTitle', 'cardTitle', 'statusHeadline'] as const)(
    'caps %s so a heading cannot swallow the screen',
    async (variant) => {
      const view = await render(<ThemedText variant={variant}>Title</ThemedText>);
      const cap = view.getByText('Title').props.maxFontSizeMultiplier;

      expect(cap).toBeGreaterThan(1);
      expect(cap).toBeLessThanOrEqual(2);
    },
  );

  // Capping the words is how you fail the setting rather than support it.
  it.each(['body', 'bodyStrong', 'sub', 'caption', 'sectionLabel'] as const)(
    'leaves %s free to scale all the way',
    async (variant) => {
      const view = await render(<ThemedText variant={variant}>Words</ThemedText>);

      expect(view.getByText('Words').props.maxFontSizeMultiplier).toBeUndefined();
    },
  );

  it('lets a caller override the cap', async () => {
    const view = await render(
      <ThemedText variant="screenTitle" maxFontSizeMultiplier={1.1}>
        Title
      </ThemedText>,
    );

    expect(view.getByText('Title').props.maxFontSizeMultiplier).toBe(1.1);
  });
});
