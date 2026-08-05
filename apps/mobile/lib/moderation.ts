import { supabase } from './supabase';

/**
 * Filtering, reporting and blocking — the App Store Guideline 1.2 trio.
 *
 * Kept in one module because they are one idea: somebody is posting something
 * they should not, and the app needs a way to stop the worst of it at the
 * door, a way for the person looking at it to tell us, and a way to shut the
 * poster out. The report goes to a queue only we can read; the block takes
 * effect in the database, not in a filter here — the shield rule (PLA-44):
 * the person you block stops seeing what you create, cannot find or contact
 * you, and no longer attends your plans, while you keep seeing them exactly
 * as before. See `is_blocked_by()` and `dissolve_block_ties()` in the
 * block_shield migration.
 */

// 'photo' (PLA-32) is not a nicety. A word list cannot read a photograph, so
// for images reporting is not the backstop behind the content filter, it is
// the entire mechanism. Reporting the plan instead would tell whoever reads
// the report nothing about which of forty photos was the problem.
export type ReportSubject = 'plan' | 'group' | 'profile' | 'photo';

export type ReportReason = 'harassment' | 'hate' | 'sexual' | 'violence' | 'spam' | 'other';

export const REPORT_REASONS: { key: ReportReason; label: string; blurb: string }[] = [
  { key: 'harassment', label: 'Harassment or bullying', blurb: 'Aimed at someone, and meant to hurt' },
  { key: 'hate', label: 'Hate speech', blurb: 'Attacks a group of people for what they are' },
  { key: 'sexual', label: 'Sexual content', blurb: 'Explicit, or involving someone under age' },
  { key: 'violence', label: 'Violence or threats', blurb: 'Threatens harm to somebody' },
  { key: 'spam', label: 'Spam or a scam', blurb: 'Advertising, phishing, or a fake plan' },
  { key: 'other', label: 'Something else', blurb: 'Tell us below and a person will read it' },
];

export interface ReportInput {
  subjectType: ReportSubject;
  subjectId: string;
  reason: ReportReason;
  note?: string;
  /** Block this person in the same transaction as the report. */
  blockUserId?: string | null;
}

/**
 * One RPC rather than an insert followed by a block, because the report
 * screen offers "block them too" as a single gesture. As two calls, a report
 * that landed followed by a block that failed read as total failure — and
 * retrying filed the report again. `file_report` does both or neither.
 */
export async function submitReport(input: ReportInput): Promise<void> {
  const { error } = await supabase.rpc('file_report', {
    p_subject_type: input.subjectType,
    p_subject_id: input.subjectId,
    p_reason: input.reason,
    p_note: input.note?.trim() ?? '',
    p_block_user_id: input.blockUserId ?? null,
  });
  if (error) throw error;
}

export async function blockUser(blockerId: string, blockedId: string): Promise<void> {
  const { error } = await supabase
    .from('blocked_users')
    // Blocking twice is not an error, it is the same wish expressed twice —
    // but `ignoreDuplicates` is doing real work here, not just being tidy.
    // A plain upsert becomes ON CONFLICT DO UPDATE, and blocked_users has no
    // UPDATE policy on purpose (there is nothing in the row worth changing),
    // so the second block would come back as an RLS failure. This sends
    // ON CONFLICT DO NOTHING, which the INSERT policy alone can satisfy.
    .upsert(
      { blocker_id: blockerId, blocked_id: blockedId },
      { onConflict: 'blocker_id,blocked_id', ignoreDuplicates: true },
    );
  if (error) throw error;
}

export async function unblockUser(blockerId: string, blockedId: string): Promise<void> {
  const { error } = await supabase
    .from('blocked_users')
    .delete()
    .eq('blocker_id', blockerId)
    .eq('blocked_id', blockedId);
  if (error) throw error;
}

/**
 * Ids this user has blocked, most recent block first. RLS means it can only
 * ever be their own list. The order matters to the Blocked people screen;
 * manage.tsx builds a Set from it and never notices.
 */
export async function fetchBlockedIds(): Promise<string[]> {
  const { data, error } = await supabase
    .from('blocked_users')
    .select('blocked_id')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data.map((row) => row.blocked_id);
}

/** Query key for the block list, so every screen invalidates the same cache. */
export const BLOCKED_QUERY_KEY = ['blocked-users'] as const;

// ---------------------------------------------------------------------------
// Content filter — Guideline 1.2's "method for filtering objectionable
// material from being posted". Every free-text field another member will see
// (plan titles, descriptions, locations, group names, display names) runs
// through this before it is written.
//
// The list is deliberately short and unambiguous: slurs and explicit terms
// only, matched on word boundaries so Scunthorpe can keep its name and a
// plan can still involve spices, grapes, or rapeseed fields. Milder swearing
// between friends in a private group is their business; the report screen
// and the block button are the answer to everything a word list cannot be.
// A determined poster can spell around any filter — that is what the
// report-driven side of §6 in store-assets/APP-STORE.md is for.

// The usual disguises, folded back before matching: an accent, a digit or a
// symbol standing in for the letter it resembles.
const LOOKALIKES: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '8': 'b',
  '@': 'a',
  $: 's',
  '!': 'i',
};

const normalise = (text: string): string =>
  text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[0134578@$!]/g, (c) => LOOKALIKES[c] ?? c);

const BLOCKED_TERMS = [
  'nigger',
  'nigga',
  'kike',
  'spic',
  'wetback',
  'beaner',
  'chink',
  'gook',
  'raghead',
  'towelhead',
  'faggot',
  'tranny',
  'shemale',
  'cunt',
  'whore',
  'slut',
  'blowjob',
  'handjob',
  'rimjob',
  'cocksucker',
  'dildo',
  'retard',
  'rape',
  'rapist',
  'child porn',
];

// `s?` and not broader suffixing: "(s|es)?" would turn "spic" into a match
// for "spices". A bare optional plural cannot leak into another word because
// the boundary after it still has to hold.
const BLOCKED_PATTERN = new RegExp(
  `\\b(?:${BLOCKED_TERMS.map((t) => t.replace(/ /g, '\\s+')).join('|')})s?\\b`,
);

/**
 * The first field whose text contains a blocked term, phrased for an alert —
 * or null when everything is clean. Keys are field names as a person would
 * say them ("plan title", "group name"); values are the raw drafts.
 */
export function contentViolation(
  fields: Record<string, string | null | undefined>,
): string | null {
  for (const [label, value] of Object.entries(fields)) {
    if (value && BLOCKED_PATTERN.test(normalise(value))) {
      return `That ${label} contains language that isn’t allowed on Planazo. See planazo.me/terms for the rules.`;
    }
  }
  return null;
}
