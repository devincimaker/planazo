-- PLA-75: the first-run carousel is shown once per person, not once per device.
--
-- On the profile rather than in device storage, for two reasons. The row is
-- already fetched at launch (app/_layout.tsx syncProfile does select('*') into
-- the auth store), so the gate that reads this costs no extra request and adds
-- no frame of delay. And a reinstall or a second device is the same person, who
-- has already been told what the app is for.
--
-- Timestamp rather than a boolean: same storage, and "when did this account
-- first get explained to" is a question worth being able to answer later.
-- Nullable, and deliberately without a DEFAULT: NULL is the sentinel meaning
-- "has not seen it". A DEFAULT now() would stamp every new signup as already
-- onboarded and silently switch the whole feature off.
ALTER TABLE public.profiles ADD COLUMN onboarded_at TIMESTAMPTZ;

-- Everyone holding an account right now is by definition a returning user, and
-- must never meet the carousel. Rows created after this run start NULL and do.
UPDATE public.profiles SET onboarded_at = now() WHERE onboarded_at IS NULL;

COMMENT ON COLUMN public.profiles.onboarded_at IS
  'When this person finished the first-run carousel. NULL means they have not seen it yet.';
