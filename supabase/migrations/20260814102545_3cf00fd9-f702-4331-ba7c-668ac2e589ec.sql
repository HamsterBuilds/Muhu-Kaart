-- App uses custom 6-digit code auth handled exclusively by server functions
-- with the service_role client. No client (anon/authenticated) may touch these
-- tables directly, so we revoke Data API grants and add explicit deny policies.

REVOKE ALL ON public.app_users FROM anon, authenticated;
REVOKE ALL ON public.groups FROM anon, authenticated;
REVOKE ALL ON public.group_members FROM anon, authenticated;
REVOKE ALL ON public.points FROM anon, authenticated;
REVOKE ALL ON public.point_visits FROM anon, authenticated;
REVOKE ALL ON public.tracks FROM anon, authenticated;
REVOKE ALL ON public.track_points FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.track_points_id_seq FROM anon, authenticated;

GRANT ALL ON public.app_users TO service_role;
GRANT ALL ON public.groups TO service_role;
GRANT ALL ON public.group_members TO service_role;
GRANT ALL ON public.points TO service_role;
GRANT ALL ON public.point_visits TO service_role;
GRANT ALL ON public.tracks TO service_role;
GRANT ALL ON public.track_points TO service_role;
GRANT ALL ON SEQUENCE public.track_points_id_seq TO service_role;

ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.points ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.point_visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tracks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.track_points ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "No direct access to app_users" ON public.app_users;
CREATE POLICY "No direct access to app_users" ON public.app_users
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "No direct access to groups" ON public.groups;
CREATE POLICY "No direct access to groups" ON public.groups
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "No direct access to group_members" ON public.group_members;
CREATE POLICY "No direct access to group_members" ON public.group_members
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "No direct access to points" ON public.points;
CREATE POLICY "No direct access to points" ON public.points
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "No direct access to point_visits" ON public.point_visits;
CREATE POLICY "No direct access to point_visits" ON public.point_visits
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "No direct access to tracks" ON public.tracks;
CREATE POLICY "No direct access to tracks" ON public.tracks
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "No direct access to track_points" ON public.track_points;
CREATE POLICY "No direct access to track_points" ON public.track_points
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);