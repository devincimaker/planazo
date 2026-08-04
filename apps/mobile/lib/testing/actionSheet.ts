import { ActionSheetIOS } from 'react-native';
import { act } from '@testing-library/react-native';

/**
 * Drivers for screens that open an `ActionSheetIOS` sheet.
 *
 * `mockActionSheet()` swallows the call and leaves its arguments on the mock:
 * the config (with its `options` labels) and the callback the sheet would invoke
 * with the chosen row. `sheetOptions()` and `chooseFromSheet()` read that pair
 * back. A suite that drives a sheet needs all three, so the setup lives here
 * rather than being a line each caller has to remember.
 *
 * This module deliberately sits outside `__tests__/`. `jest-expo`'s testMatch is
 * `**\/__tests__/**\/*.[jt]s?(x)`, so a helper file in there is collected as a
 * suite and fails the run for having no `it()`.
 */

/** Stop the sheet reaching the OS, so a test can read and drive it. */
export function mockActionSheet() {
  jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions').mockImplementation(() => {});
}

function lastSheet() {
  const spy = ActionSheetIOS.showActionSheetWithOptions as jest.Mock;
  const call = spy.mock.calls.at(-1);
  if (!call) {
    throw new Error(
      'No action sheet has been shown. Press the control that opens it first, and ' +
        'check the spy on ActionSheetIOS.showActionSheetWithOptions is in place.'
    );
  }
  return {
    options: call[0].options as string[],
    callback: call[1] as (index: number) => void,
  };
}

/** The row labels on the sheet that is open, in order. */
export function sheetOptions(): string[] {
  return lastSheet().options;
}

/** Tap row `index` of the sheet that is open. */
export async function chooseFromSheet(index: number) {
  const { callback } = lastSheet();
  await act(async () => {
    callback(index);
  });
}
