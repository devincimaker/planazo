import { Text, StyleSheet } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { FooterBar } from '../FooterBar';
import { spacing } from '../../../theme/tokens';

const renderBar = (props: Partial<React.ComponentProps<typeof FooterBar>> = {}, bottom = 34) =>
  render(
    <SafeAreaInsetsContext.Provider value={{ top: 0, bottom, left: 0, right: 0 }}>
      <FooterBar testID="bar" {...props}>
        <Text>Go</Text>
      </FooterBar>
    </SafeAreaInsetsContext.Provider>,
  );

const barStyle = () => StyleSheet.flatten(screen.getByTestId('bar').props.style);

describe('FooterBar', () => {
  it('leaves the inset to its parent by default', async () => {
    await renderBar();

    expect(barStyle().paddingBottom).toBe(spacing.lg);
    expect(barStyle().position).toBeUndefined();
  });

  /**
   * The regression this guards: four screens hardcoded `paddingBottom: 30` for
   * a bar their SafeAreaView never inset (PLA-73).
   */
  it('clears the home indicator itself when pinned', async () => {
    await renderBar({ pinned: true });

    expect(barStyle().paddingBottom).toBe(34);
    expect(barStyle().position).toBe('absolute');
  });

  // poll.tsx: in flow, but its SafeAreaView carries no `bottom` edge.
  it('clears the home indicator without pinning when asked', async () => {
    await renderBar({ insetBottom: true });

    expect(barStyle().paddingBottom).toBe(34);
    expect(barStyle().position).toBeUndefined();
  });

  it('falls back to its own padding where there is no indicator to clear', async () => {
    await renderBar({ pinned: true }, 0);

    expect(barStyle().paddingBottom).toBe(spacing.lg);
  });
});
