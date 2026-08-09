import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const CodeSchema = z.string().regex(/^\d{6}$/);

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

function randomCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function requireUser(code: string) {
  const db = await admin();
  const { data, error } = await db
    .from("app_users")
    .select("id, name, code")
    .eq("code", code)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Tundmatu kood");
  return data;
}

async function requireMember(userId: string, groupId: string) {
  const db = await admin();
  const { data } = await db
    .from("group_members")
    .select("id")
    .eq("user_id", userId)
    .eq("group_id", groupId)
    .maybeSingle();
  if (!data) throw new Error("Sa ei kuulu sellesse gruppi");
}

/* ---------------- kasutajad ---------------- */

export const registerUser = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ name: z.string().min(1).max(40) }).parse(d))
  .handler(async ({ data }) => {
    const db = await admin();
    for (let i = 0; i < 12; i++) {
      const code = randomCode();
      const { data: row, error } = await db
        .from("app_users")
        .insert({ name: data.name.trim(), code })
        .select("id, name, code")
        .single();
      if (!error && row) return row;
      if (error && !error.message.includes("duplicate")) throw new Error(error.message);
    }
    throw new Error("Koodi loomine ebaõnnestus, proovi uuesti");
  });

export const loginWithCode = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ code: CodeSchema }).parse(d))
  .handler(async ({ data }) => requireUser(data.code));

/* ---------------- grupid ---------------- */

export const listGroups = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ code: CodeSchema }).parse(d))
  .handler(async ({ data }) => {
    const user = await requireUser(data.code);
    const db = await admin();
    const { data: rows, error } = await db
      .from("group_members")
      .select("groups(id, name, join_code)")
      .eq("user_id", user.id);
    if (error) throw new Error(error.message);
    return (rows ?? [])
      .map((r) => r.groups as { id: string; name: string; join_code: string } | null)
      .filter((g): g is { id: string; name: string; join_code: string } => !!g);
  });

export const createGroup = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ code: CodeSchema, name: z.string().min(1).max(40) }).parse(d),
  )
  .handler(async ({ data }) => {
    const user = await requireUser(data.code);
    const db = await admin();
    for (let i = 0; i < 12; i++) {
      const joinCode = randomCode();
      const { data: group, error } = await db
        .from("groups")
        .insert({ name: data.name.trim(), join_code: joinCode, owner_id: user.id })
        .select("id, name, join_code")
        .single();
      if (error) {
        if (error.message.includes("duplicate")) continue;
        throw new Error(error.message);
      }
      await db.from("group_members").insert({ group_id: group.id, user_id: user.id });
      return group;
    }
    throw new Error("Grupi loomine ebaõnnestus");
  });

export const joinGroup = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ code: CodeSchema, joinCode: CodeSchema }).parse(d),
  )
  .handler(async ({ data }) => {
    const user = await requireUser(data.code);
    const db = await admin();
    const { data: group } = await db
      .from("groups")
      .select("id, name, join_code")
      .eq("join_code", data.joinCode)
      .maybeSingle();
    if (!group) throw new Error("Sellise koodiga gruppi ei leitud");
    await db
      .from("group_members")
      .upsert(
        { group_id: group.id, user_id: user.id },
        { onConflict: "group_id,user_id" },
      );
    return group;
  });

/* ---------------- punktid ---------------- */

export const listPoints = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ code: CodeSchema, groupId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }) => {
    const user = await requireUser(data.code);
    await requireMember(user.id, data.groupId);
    const db = await admin();
    const { data: rows, error } = await db
      .from("points")
      .select("id, title, description, image_url, lat, lng, ai_status, created_at, user_id, app_users(name)")
      .eq("group_id", data.groupId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    const ids = (rows ?? []).map((r) => r.id as string);
    const visited = new Set<string>();
    if (ids.length) {
      const { data: visits } = await db
        .from("point_visits")
        .select("point_id")
        .eq("user_id", user.id)
        .in("point_id", ids);
      for (const v of visits ?? []) visited.add(v.point_id as string);
    }
    return (rows ?? []).map((r) => ({
      id: r.id as string,
      title: r.title as string,
      description: (r.description as string | null) ?? null,
      imageUrl: (r.image_url as string | null) ?? null,
      lat: r.lat as number,
      lng: r.lng as number,
      aiStatus: r.ai_status as string,
      createdAt: r.created_at as string,
      mine: r.user_id === user.id,
      visited: visited.has(r.id as string),
      authorName: ((r.app_users as { name?: string } | null)?.name ?? "?") as string,
    }));
  });

export const toggleVisit = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({ code: CodeSchema, pointId: z.string().uuid(), visited: z.boolean() })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const user = await requireUser(data.code);
    const db = await admin();
    const { data: point } = await db
      .from("points")
      .select("id, group_id")
      .eq("id", data.pointId)
      .maybeSingle();
    if (!point) throw new Error("Punkti ei leitud");
    await requireMember(user.id, point.group_id as string);
    if (data.visited) {
      const { error } = await db
        .from("point_visits")
        .upsert(
          { point_id: data.pointId, user_id: user.id },
          { onConflict: "point_id,user_id" },
        );
      if (error) throw new Error(error.message);
    } else {
      const { error } = await db
        .from("point_visits")
        .delete()
        .eq("point_id", data.pointId)
        .eq("user_id", user.id);
      if (error) throw new Error(error.message);
    }
    return { visited: data.visited };
  });

export const addPoint = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        code: CodeSchema,
        groupId: z.string().uuid(),
        title: z.string().min(1).max(80),
        lat: z.number(),
        lng: z.number(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const user = await requireUser(data.code);
    await requireMember(user.id, data.groupId);
    const db = await admin();
    const { data: row, error } = await db
      .from("points")
      .insert({
        group_id: data.groupId,
        user_id: user.id,
        title: data.title.trim(),
        lat: data.lat,
        lng: data.lng,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id as string };
  });

export const enrichPoint = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ code: CodeSchema, pointId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }) => {
    const user = await requireUser(data.code);
    const db = await admin();
    const { data: point } = await db
      .from("points")
      .select("id, title, group_id")
      .eq("id", data.pointId)
      .maybeSingle();
    if (!point) throw new Error("Punkti ei leitud");
    await requireMember(user.id, point.group_id as string);

    const { fetchWikiInfo, generateDescription } = await import("./enrich.server");
    const wiki = await fetchWikiInfo(point.title as string);
    const description = await generateDescription(point.title as string, wiki.extract);

    await db
      .from("points")
      .update({
        description,
        image_url: wiki.image,
        ai_status: description ? "done" : "failed",
      })
      .eq("id", point.id);

    return { description, imageUrl: wiki.image };
  });

export const updatePoint = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        code: CodeSchema,
        pointId: z.string().uuid(),
        title: z.string().min(1).max(80).optional(),
        description: z.string().max(600).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const user = await requireUser(data.code);
    const db = await admin();
    const patch: { title?: string; description?: string } = {};
    if (data.title !== undefined) patch.title = data.title.trim();
    if (data.description !== undefined) patch.description = data.description.trim();
    const { error } = await db
      .from("points")
      .update(patch)
      .eq("id", data.pointId)
      .eq("user_id", user.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deletePoint = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ code: CodeSchema, pointId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }) => {
    const user = await requireUser(data.code);
    const db = await admin();
    const { error } = await db
      .from("points")
      .delete()
      .eq("id", data.pointId)
      .eq("user_id", user.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ---------------- rajad ---------------- */

export const startTrack = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ code: CodeSchema }).parse(d))
  .handler(async ({ data }) => {
    const user = await requireUser(data.code);
    const db = await admin();
    const { data: row, error } = await db
      .from("tracks")
      .insert({ user_id: user.id })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id as string };
  });

export const appendTrackPoints = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        code: CodeSchema,
        trackId: z.string().uuid(),
        points: z.array(z.object({ lat: z.number(), lng: z.number(), t: z.string() })),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const user = await requireUser(data.code);
    const db = await admin();
    const { data: track } = await db
      .from("tracks")
      .select("id")
      .eq("id", data.trackId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!track) throw new Error("Rada ei leitud");
    if (data.points.length === 0) return { ok: true };
    const { error } = await db.from("track_points").insert(
      data.points.map((p) => ({
        track_id: data.trackId,
        lat: p.lat,
        lng: p.lng,
        recorded_at: p.t,
      })),
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const endTrack = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ code: CodeSchema, trackId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }) => {
    const user = await requireUser(data.code);
    const db = await admin();
    await db
      .from("tracks")
      .update({ ended_at: new Date().toISOString() })
      .eq("id", data.trackId)
      .eq("user_id", user.id);
    return { ok: true };
  });

export const listMyTracks = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ code: CodeSchema }).parse(d))
  .handler(async ({ data }) => {
    const user = await requireUser(data.code);
    const db = await admin();
    const { data: tracks, error } = await db
      .from("tracks")
      .select("id, started_at, track_points(lat, lng, recorded_at)")
      .eq("user_id", user.id)
      .order("started_at", { ascending: false })
      .limit(20);
    if (error) throw new Error(error.message);
    return (tracks ?? []).map((t) => ({
      id: t.id as string,
      startedAt: t.started_at as string,
      points: ((t.track_points ?? []) as Array<{
        lat: number;
        lng: number;
        recorded_at: string;
      }>)
        .slice()
        .sort((a, b) => a.recorded_at.localeCompare(b.recorded_at))
        .map((p) => [p.lat, p.lng] as [number, number]),
    }));
  });
