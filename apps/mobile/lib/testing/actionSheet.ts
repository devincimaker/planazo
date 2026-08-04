import { ActionSheetIOS } from 'react-native';
import { act } from '@testing-library/react-native';

/**
 * Drivers for screens that open an `ActionSheetIOS` sheet.
 *
 * Every caller first does `jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions')`
 * in a `beforeEach`, which swallows the call and leaves the arguments on the mock:
 * the config (with its `options` labels) and the callback the sheet would invoke
 * with the chosen row. These two functions read that pair back.
 *
 * This module deliberately sits outside `__tests__/`. `jest-expo`'s testMatch is
 * `**\/__tests__/**\/*.[jt]s?(x)`, so a helper file in there is collected as a
 * suite and fails the run for having no `it()`.
 */

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
