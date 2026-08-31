import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { listFirebaseGroups } from "@/lib/firebase-data";

import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { signOut } from "firebase/auth";
import { firebaseAuth } from "@/lib/firebase";
import Welcome from "@/components/Welcome";
import GroupSheet from "@/components/GroupSheet";
import PointCard from "@/components/PointCard";
import { clearCode, loadCode, loadGroup, saveCode, saveGroup } from "@/lib/session";
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
    setCode(loadCode());
    setGroupId(loadGroup());
    setReady(true);
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
  const { tracking, liveTrack, start, stop } = useTracking(code, pos);
  const { add, remove, setVisited, update } = usePointActions(code, groupId);

  const points = pointsQuery.data ?? [];
  const visitedCount = points.filter((p) => p.visited || p.mine).length;
  const tracks = useMemo(() => {
    const saved = (tracksQuery.data ?? []).map((t) => t.points);
    return liveTrack.length > 1 ? [...saved, liveTrack] : saved;
  }, [tracksQuery.data, liveTrack]);

  const selectedPoint = points.find((p) => p.id === selected) ?? null;

  if (!ready) return <div className="min-h-dvh bg-background" />;

  if (!code) {
    return (
      <>
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
    if (!pos) {
      toast.error("Asukoht pole veel teada");
      return;
    }
    if (!groupId) {
      toast.error("Vali esmalt grupp");
      return;
    }
    add.mutate({ title, lat: pos.lat, lng: pos.lng });
    setTitle("");
    setAdding(false);
  };

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-background">
      <Suspense fallback={<div className="h-full w-full bg-secondary" />}>
        <MuhuMap points={points} tracks={tracks} me={pos} onSelect={setSelected} />
      </Suspense>

      <header className="pointer-events-none absolute inset-x-0 top-0 z-[800] p-3">
        <div className="pointer-events-auto flex items-center gap-2 rounded-2xl border border-border bg-card/95 px-3 py-2 shadow-sm backdrop-blur">
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-lg leading-tight text-foreground">
              {groupName || "Vali grupp"}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {groupCode ? `Grupi kood ${groupCode} · ` : ""}
              {userName ? `${userName} · ` : ""}minu kood {code}
            </p>
          </div>
          <button
            onClick={() => setShowGroups(true)}
            className="rounded-xl bg-secondary px-3 py-2 text-sm font-medium text-secondary-foreground"
          >
            Grupid
          </button>
          <button
            onClick={() => {
              void signOut(firebaseAuth);
              clearCode();
              setCode(null);
              setGroupId(null);
            }}
            className="rounded-xl px-2 py-2 text-sm text-muted-foreground"
          >
            Välju
          </button>
        </div>
        <div className="pointer-events-auto mt-2 flex w-fit items-center gap-3 rounded-xl border border-border bg-card/95 px-3 py-2 text-xs shadow-sm backdrop-blur">
          <span className="font-semibold text-foreground">
            {visitedCount} / {points.length} punkti
          </span>
          <span className="h-3 w-px bg-border" />
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <i className="h-2.5 w-2.5 rounded-full bg-[#2f9e7f]" /> käidud
          </span>
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <i className="h-2.5 w-2.5 rounded-full bg-[#d9453c]" /> uus
          </span>
        </div>
        {(!onMuhu || geoError) && (
          <p className="pointer-events-auto mt-2 rounded-xl bg-card/95 px-3 py-2 text-xs text-muted-foreground shadow-sm">
            {geoError
              ? `Asukohta ei saa: ${geoError}`
              : pos
                ? "Sa oled Muhu saarest väljas – kaart ja jälgimine töötavad ka siin."
                : "Otsin sinu asukohta..."}
          </p>
        )}
      </header>

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
          ) : (
            <div className="flex gap-2">
              <button
                onClick={() => (tracking ? void stop() : void start())}
                className={`flex-1 rounded-2xl px-4 py-4 text-base font-semibold shadow-lg transition-colors ${
                  tracking
                    ? "bg-destructive text-destructive-foreground"
                    : "bg-primary text-primary-foreground"
                }`}
              >
                {tracking ? "Lõpeta jälgimine" : "Jälgi mind"}
              </button>
              <button
                disabled={!groupId}
                onClick={() => setAdding(true)}
                className="flex-1 rounded-2xl bg-accent px-4 py-4 text-base font-semibold text-accent-foreground shadow-lg disabled:opacity-40"
              >
                Lisa punkt
              </button>
            </div>
          )}
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
