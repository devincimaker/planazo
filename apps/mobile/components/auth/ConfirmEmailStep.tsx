import { useCallback, useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { AuthError, Session } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase';
import { LINK_HIT_SLOP, useAnnounce } from '../../lib/a11y';
import { Button, FormField, ThemedText } from '../ui';
import { colors, fonts, radii, spacing } from '../../theme/tokens';

const CODE_LENGTH = 6;

/**
 * How long the resend link stays quiet after a code goes out.
 *
 * Supabase refuses a second email inside `auth.email.max_frequency` (1s
 * locally, 60s on a stock hosted project) with `over_email_send_rate_limit`.
 * The refusal is handled below either way, but a button whose first press is
 * always rejected is a button that looks broken, so the link waits instead.
 * Thirty seconds is under production's window on purpose: the 429 path stays
 * reachable, rather than becoming dead code we only ever see in a mock.
 */
const RESEND_COOLDOWN = 30;

interface ConfirmEmailStepProps {
  email: string;
  /** Send a code on arrival, for someone who came from sign-in rather than signup */
  autoSend?: boolean;
  onVerified: (session: Session) => void;
  onBack: () => void;
}

interface Notice {
  tone: 'error' | 'info';
  text: string;
}

/**
 * Wrong codes and expired codes are the same error.
 *
 * GoTrue answers both with `otp_expired` / "Token has expired or is invalid",
 * so there is nothing to tell them apart with and one message has to cover
 * both. Naming the *last* email is the part that earns its place: asking for a
 * new code invalidates every code before it, so someone working from the first
 * email they received is holding a dead number through no fault of their own.
 */
function verifyMessage(error: AuthError): string {
  if (error.code === 'otp_expired') {
    return "That code didn't work. Check the last email we sent, or ask for a new one.";
  }
  if (error.code === 'over_request_rate_limit') {
    return 'Too many tries just now. Give it a minute and have another go.';
  }
  return "That didn't go through. Check your connection and try again.";
}

export function ConfirmEmailStep({ email, autoSend = false, onVerified, onBack }: ConfirmEmailStepProps) {
  const [code, setCode] = useState('');
  const [notice, setNotice] = useState<Notice | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [sending, setSending] = useState(false);
  // A code went out with the signup that got us here, so the clock starts warm.
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN);

  useAnnounce(notice?.text);

  const ready = code.length === CODE_LENGTH;

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((left) => left - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const resend = useCallback(
    async (silent = false) => {
      try {
        setSending(true);
        const { error } = await supabase.auth.resend({ type: 'signup', email });

        if (error?.code === 'over_email_send_rate_limit') {
          setNotice({ tone: 'error', text: 'Give it a few seconds, then ask again.' });
          setCooldown(RESEND_COOLDOWN);
          return;
        }
        if (error) {
          setNotice({ tone: 'error', text: "We couldn't send that. Check your connection and try again." });
          return;
        }

        setCooldown(RESEND_COOLDOWN);
        setCode('');
        setNotice({
          tone: 'info',
          // The invalidation is the whole point of saying anything here.
          text: silent
            ? 'We sent you a fresh code. Use the one in the newest email.'
            : 'New code sent. Use the one in the newest email.',
        });
      } catch {
        setNotice({
          tone: 'error',
          text: "We couldn't send that. Check your connection and try again.",
        });
      } finally {
        setSending(false);
      }
    },
    [email],
  );

  // Arriving from sign-in, whatever code they were sent at signup is old and
  // probably lost, so one goes out without them having to ask.
  const sentOnArrival = useRef(false);
  useEffect(() => {
    if (!autoSend || sentOnArrival.current) return;
    sentOnArrival.current = true;
    // Safe to leave unawaited: resend reports every outcome through `notice`.
    void resend(true);
  }, [autoSend, resend]);

  async function handleVerify() {
    if (!ready || verifying) return;

    try {
      setVerifying(true);
      setNotice(null);
      const { data, error } = await supabase.auth.verifyOtp({
        email,
        token: code,
        type: 'signup',
      });

      if (error) {
        setNotice({ tone: 'error', text: verifyMessage(error) });
        return;
      }
      if (!data.session) {
        setNotice({ tone: 'error', text: "That didn't go through. Check your connection and try again." });
        return;
      }

      onVerified(data.session);
    } catch {
      setNotice({ tone: 'error', text: "That didn't go through. Check your connection and try again." });
    } finally {
      setVerifying(false);
    }
  }

  function footerLabel() {
    if (verifying) return 'Checking your code…';
    return ready ? 'Confirm and continue' : `Enter the ${CODE_LENGTH} digits to continue`;
  }

  function resendLabel() {
    if (sending) return 'Sending…';
    return cooldown > 0 ? `You can ask again in ${cooldown}s` : 'Send a new code';
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <View style={styles.tick}>
            <ThemedText variant="bodyStrong" color={colors.confirmed} style={styles.tickGlyph}>
              ✓
            </ThemedText>
          </View>

          <ThemedText variant="screenTitle" style={styles.title}>
            Check your email
          </ThemedText>
          <ThemedText variant="body" color={colors.textSecondary} style={styles.blurb}>
            We sent a {CODE_LENGTH}-digit code to{' '}
            <ThemedText variant="bodyStrong">{email}</ThemedText>. Enter it here and you&apos;re in.
          </ThemedText>

          <View style={styles.field}>
            <FormField
              label="Your code"
              value={code}
              // Digits only: the code is numeric, and stripping as they type is
              // kinder than refusing a paste that carried a stray space.
              onChangeText={(next) => setCode(next.replace(/\D/g, '').slice(0, CODE_LENGTH))}
              placeholder="000000"
              keyboardType="number-pad"
              // iOS offers the code straight from the Mail notification banner,
              // which is the whole reason a code beats a link on a phone.
              textContentType="oneTimeCode"
              autoComplete="one-time-code"
              maxLength={CODE_LENGTH}
              testID="code-input"
            />

            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: cooldown > 0 || sending }}
              disabled={cooldown > 0 || sending}
              hitSlop={LINK_HIT_SLOP}
              onPress={() => resend()}
              testID="resend-code"
            >
              <ThemedText
                variant="caption"
                color={cooldown > 0 || sending ? colors.textFaint : colors.accentText}
              >
                {resendLabel()}
              </ThemedText>
            </Pressable>
          </View>

          {notice ? (
            <View
              style={[styles.noticeBox, notice.tone === 'info' && styles.noticeBoxInfo]}
              accessibilityRole="alert"
              accessibilityLiveRegion="assertive"
              testID={notice.tone === 'info' ? 'confirm-notice' : 'confirm-error'}
            >
              <ThemedText
                variant="bodyStrong"
                color={notice.tone === 'info' ? colors.confirmed : colors.accentText}
              >
                {notice.text}
              </ThemedText>
            </View>
          ) : null}
        </ScrollView>

        <View style={styles.footer}>
          <Button
            label={footerLabel()}
            variant={ready ? 'primary' : 'secondary'}
            disabled={!ready || verifying}
            onPress={handleVerify}
            testID="confirm-code"
          />
          <View style={styles.footerRow}>
            <ThemedText variant="sub">Wrong email?</ThemedText>
            <Pressable accessibilityRole="button" hitSlop={LINK_HIT_SLOP} onPress={onBack} testID="confirm-back">
              <ThemedText variant="sub" color={colors.accentText} style={styles.footerLink}>
                Go back
              </ThemedText>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  flex: {
    flex: 1,
  },
  scroll: {
    paddingHorizontal: spacing.xl,
    paddingTop: 40,
    paddingBottom: spacing.xxl,
  },
  tick: {
    width: 44,
    height: 44,
    borderRadius: radii.pill,
    backgroundColor: colors.confirmedSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tickGlyph: {
    fontSize: 20,
    lineHeight: 24,
  },
  title: {
    marginTop: spacing.xl,
  },
  blurb: {
    marginTop: spacing.sm,
  },
  field: {
    gap: spacing.md,
    marginTop: spacing.xxl,
  },
  noticeBox: {
    marginTop: spacing.xl,
    backgroundColor: colors.accentSoft,
    borderRadius: 14,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  noticeBoxInfo: {
    backgroundColor: colors.confirmedSoft,
  },
  footer: {
    backgroundColor: colors.tabBarBackground,
    borderTopWidth: 1,
    borderTopColor: colors.tabBarBorder,
    paddingHorizontal: spacing.xl,
    paddingTop: 14,
    paddingBottom: spacing.lg,
    gap: spacing.md,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  footerLink: {
    fontFamily: fonts.bodyBold,
  },
});
