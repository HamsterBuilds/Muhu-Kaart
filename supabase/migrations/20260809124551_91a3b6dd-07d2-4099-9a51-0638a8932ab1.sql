CREATE TABLE public.point_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  point_id uuid NOT NULL REFERENCES public.points(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (point_id, user_id)
);

GRANT ALL ON public.point_visits TO service_role;

ALTER TABLE public.point_visits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "No direct access to point_visits"
ON public.point_visits FOR ALL TO authenticated, anon
USING (false) WITH CHECK (false);