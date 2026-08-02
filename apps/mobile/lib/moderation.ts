import { supabase } from './supabase';

/**
 * Reporting and blocking — the App Store Guideline 1.2 pair.
 *
 * Kept in one module because they are one idea: somebody has posted something
 * they should not have, and the person looking at it needs a way to tell us
 * and a way to stop seeing them. The report goes to a queue only we can read;
 * the block takes effect in the database, not in a filter here — see
 * `has_blocked()` and the plans SELECT policy in the moderation migration.
 */

export type ReportSubject = 'plan' | 'group' | 'profile';

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
  reporterId: string;
  subjectType: ReportSubject;
  subjectId: string;
  reason: ReportReason;
  note?: string;
}

export async function submitReport(input: ReportInput): Promise<void> {
  const { error } = await supabase.from('content_reports').insert({
    reporter_id: input.reporterId,
    subject_type: input.subjectType,
    subject_id: input.subjectId,
    reason: input.reason,
    note: input.note?.trim() ?? '',
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

/** Ids this user has blocked. RLS means it can only ever be their own list. */
export async function fetchBlockedIds(): Promise<string[]> {
  const { data, error } = await supabase.from('blocked_users').select('blocked_id');
  if (error) throw error;
  return (data ?? []).map((row) => row.blocked_id);
}

/** Query key for the block list, so every screen invalidates the same cache. */
export const BLOCKED_QUERY_KEY = ['blocked-users'] as const;
