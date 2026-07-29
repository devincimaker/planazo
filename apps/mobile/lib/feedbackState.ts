/**
 * Set while the feedback sheet is mounted so the OS-screenshot listener
 * doesn't stack a second sheet when someone screenshots the sheet itself.
 * Lives apart from the listener so screens can import it without pulling
 * in native modules.
 */
export const feedbackSheetOpen = { current: false };
