/**
 * The poll a host is still typing (PLA-47). Pure draft logic, shared by the
 * new-poll sheet and the create sheet's collapsed section — and by the data
 * layer, which is why it lives here and not beside the editor component.
 */

/**
 * PLA-48 opens the option list to the whole group; until then a poll is a
 * short host-written list, and six is already generous for one.
 */
export const MAX_POLL_OPTIONS = 6;

export interface PollDraft {
  question: string;
  options: string[];
}

export const emptyPollDraft = (): PollDraft => ({ question: '', options: ['', ''] });

/** Trimmed, blanks dropped — what actually gets inserted. */
export function cleanPollDraft(draft: PollDraft): { question: string; options: string[] } {
  return {
    question: draft.question.trim(),
    options: draft.options.map((o) => o.trim()).filter(Boolean),
  };
}

/** A question with fewer than two real options is not a question. */
export function pollDraftValid(draft: PollDraft): boolean {
  const { question, options } = cleanPollDraft(draft);
  return question.length > 0 && options.length >= 2 && new Set(options).size === options.length;
}

/** Anything typed at all — the create sheet must not post half a poll. */
export function pollDraftTouched(draft: PollDraft): boolean {
  return draft.question.trim().length > 0 || draft.options.some((o) => o.trim().length > 0);
}
