import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { listFirebaseGroups } from "@/lib/firebase-data";

import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { firebaseAuth } from "@/lib/firebase";
import Welcome from "@/components/Welcome";
import GroupSheet from "@/components/GroupSheet";
import PointCard from "@/components/PointCard";
import UpdateButton from "@/components/UpdateButton";
import MapDashboard from "@/components/MapDashboard";
import { distanceMeters } from "@/lib/muhu";
import { useRoadCoverage } from "@/hooks/useRoadCoverage";
import { clearCode, loadGroup, saveCode, saveGroup } from "@/lib/session";
import { useGeolocation, useMuhuData, usePointActions, useTracking } from "@/hooks/useMuhu";

const MuhuMap = lazy(() => import("@/components/MuhuMap"));

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Minu Muhu punktid – jälgi teekonda ja jaga lemmikkohti" },
      {
        name: "description",
        content:
          "Muhu saare kaardirakendus: jälgi oma teekonda saarel, märgi lahedad kohad ja jaga punkte sõpradega privaatses grupis.",
      },
      { property: "og:title", content: "Minu Muhu punktid" },
      {
        property: "og:description",
        content:
          "Jälgi teekonda Muhu saarel, märgi lemmikkohad ja jaga neid sõpradega grupikoodiga.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: MuhuApp,
});

function MuhuApp() {
  const [code, setCode] = useState<string | null>(null);
  const [userName, setUserName] = useState<string>("");
  const [groupId, setGroupId] = useState<string | null>(null);
  const [groupName, setGroupName] = useState<string>("");
  const [groupCode, setGroupCode] = useState<string>("");
  const [showGroups, setShowGroups] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setGroupId(loadGroup());
    return onAuthStateChanged(firebaseAuth, (user) => {
      setCode(user?.uid ?? null);
      setUserName(user?.displayName ?? user?.email?.split("@")[0] ?? "");
      if (user) saveCode(user.uid);
      setReady(true);
    });
  }, []);

  const groupsQuery = useQuery({
    queryKey: ["groups", code],
    enabled: !!code,
    queryFn: listFirebaseGroups,
  });

  useEffect(() => {
    const list = groupsQuery.data;
    if (!list?.length) return;
    const active = list.find((g) => g.id === groupId) ?? list[0]!;
    setGroupId(active.id);
    setGroupName(active.name);
    setGroupCode(active.join_code);
    saveGroup(active.id);
  }, [groupsQuery.data, groupId]);

  const { pos, error: geoError, onMuhu } = useGeolocation(!!code);
  const { pointsQuery, tracksQuery } = useMuhuData(code, groupId);
  const { localCoverage, coverageSegments, rememberCoverage, coverageOwner, syncStatus } = useRoadCoverage(tracksQuery.data);
  const { tracking, liveTrack, trackingPos, start, stop } = useTracking(code, rememberCoverage);
  const { add, remove, setVisited, update } = usePointActions(code, groupId);

  // Jälgimise ajal uueneb asukoht ka taustal (BackgroundGeolocation)
  const me = tracking ? trackingPos ?? pos : pos;

  const points = pointsQuery.data ?? [];
  const visitedCount = points.filter((p) => p.visited || p.mine).length;
  const tracks = useMemo(() => {
    const saved = [...localCoverage, ...(tracksQuery.data ?? []).flatMap((t) =>
      t.coverage ? t.points.map((p) => [p]) : [t.points])];
    return liveTrack.length > 1 ? [...saved, liveTrack] : saved;
  }, [tracksQuery.data, liveTrack, localCoverage]);

  const selectedPoint = points.find((p) => p.id === selected) ?? null;

  if (!ready) return <div className="min-h-dvh bg-background" />;

  if (!code) {
    return (
      <>
        <UpdateButton className="fixed right-4 top-4 z-[1000]" />
        <Welcome
          onReady={(user) => {
            saveCode(user.code);
            setCode(user.code);
            setUserName(user.name);
            setShowGroups(false);
          }}
        />
        <Toaster position="top-center" />
      </>
    );
  }

  const submitPoint = () => {
    if (!me) {
      toast.error("Asukoht pole veel teada");
      return;
    }
    if (!groupId) {
      toast.error("Vali esmalt grupp");
      return;
    }
    add.mutate({ title, lat: me.lat, lng: me.lng });
    setTitle("");
    setAdding(false);
  };

  return (
    <div className="map-screen relative h-dvh w-full overflow-hidden">
      <Suspense fallback={<div className="h-full w-full bg-secondary" />}>
        <MuhuMap key={coverageOwner} points={points} tracks={tracks} savedSegments={coverageSegments} me={me} onSelect={setSelected} onCoverage={rememberCoverage} />
      </Suspense>

      <MapDashboard
        groupName={groupName} groupCode={groupCode} userName={userName}
        syncStatus={tracksQuery.error ? tracksQuery.error.message : syncStatus}
        visited={visitedCount} total={points.length} segments={coverageSegments.length}
        walkedKm={coverageSegments.reduce((sum, s) => sum + distanceMeters({lat: s.aLat, lng: s.aLng}, {lat: s.bLat, lng: s.bLng}), 0) / 1000}
        notice={geoError ? `Asukohta ei saa: ${geoError}` : !me ? "Otsin sinu asukohta…" : !onMuhu ? "outside" : null}
        tracking={tracking} canAdd={!!groupId} hideDock={!!selectedPoint || adding}
        onGroups={() => setShowGroups(true)}
        onLogout={() => { void signOut(firebaseAuth); clearCode(); setCode(null); setGroupId(null); }}
        onTrack={() => tracking ? void stop() : void start()} onAdd={() => setAdding(true)}
      />

      {selectedPoint && (
        <PointCard
          point={selectedPoint}
          onClose={() => setSelected(null)}
          onDelete={(id) => {
            remove.mutate(id);
            setSelected(null);
          }}
          onToggleVisited={(id, visited) => setVisited.mutate({ id, visited })}
          onSave={(id, values) => update.mutate({ id, ...values })}
        />
      )}

      {!selectedPoint && (
        <div className="absolute inset-x-0 bottom-0 z-[800] p-3">
          {adding ? (
            <div className="space-y-3 rounded-2xl border border-border bg-card p-4 shadow-lg">
              <p className="font-display text-lg text-foreground">Uus punkt siin</p>
              <input
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Pealkiri, nt. Koguva sadam"
                className="w-full rounded-xl border border-input bg-background px-4 py-3 outline-none focus:border-accent"
              />
              <p className="text-xs text-muted-foreground">
                AI lisab hiljem ise kuni 2-lauselise kirjelduse ja pildi.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setAdding(false)}
                  className="flex-1 rounded-xl bg-secondary px-4 py-3 font-medium text-secondary-foreground"
                >
                  Katkesta
                </button>
                <button
                  disabled={title.trim().length < 2}
                  onClick={submitPoint}
                  className="flex-1 rounded-xl bg-primary px-4 py-3 font-semibold text-primary-foreground disabled:opacity-40"
                >
                  Salvesta
                </button>
              </div>
            </div>
          ) : null}
        </div>
      )}

      {showGroups && (
        <GroupSheet
          code={code}
          activeGroupId={groupId}
          onClose={() => setShowGroups(false)}
          onSelect={(g) => {
            setGroupId(g.id);
            setGroupName(g.name);
            setGroupCode(g.join_code);
            saveGroup(g.id);
            setShowGroups(false);
          }}
        />
      )}

      <Toaster position="top-center" />
    </div>
  );
}
