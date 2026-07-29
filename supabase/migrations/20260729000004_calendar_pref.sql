-- Profile sheet (design 12b): "Add to my calendar" toggle. The preference is
-- stored now; the actual calendar write happens when plans lock (endgame).
ALTER TABLE public.profiles ADD COLUMN add_to_calendar BOOLEAN NOT NULL DEFAULT false;
