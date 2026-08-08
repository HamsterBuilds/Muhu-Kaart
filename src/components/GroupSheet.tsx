import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { createGroup, joinGroup, listGroups } from "@/lib/muhu-api.functions";

type Group = { id: string; name: string; join_code: string };

export default function GroupSheet({
  code,
  activeGroupId,
  onSelect,
  onClose,
}: {
  code: string;
  activeGroupId: string | null;
  onSelect: (group: Group) => void;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const listFn = useServerFn(listGroups);
  const createFn = useServerFn(createGroup);
  const joinFn = useServerFn(joinGroup);
  const [name, setName] = useState("");
  const [joinCode, setJoinCode] = useState("");

  const groups = useQuery({
    queryKey: ["groups", code],
    queryFn: () => listFn({ data: { code } }),
  });

  const create = useMutation({
    mutationFn: () => createFn({ data: { code, name } }),
    onSuccess: (g) => {
      setName("");
      void qc.invalidateQueries({ queryKey: ["groups", code] });
      onSelect(g);
      toast.success(`Grupp loodud. Jaga koodi ${g.join_code}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const join = useMutation({
    mutationFn: () => joinFn({ data: { code, joinCode } }),
    onSuccess: (g) => {
      setJoinCode("");
      void qc.invalidateQueries({ queryKey: ["groups", code] });
      onSelect(g);
      toast.success(`Liitusid grupiga ${g.name}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="fixed inset-0 z-[1000] flex flex-col justify-end bg-foreground/40">
      <button className="flex-1" aria-label="Sulge" onClick={onClose} />
      <div className="max-h-[80dvh] overflow-y-auto rounded-t-3xl bg-card p-5 pb-8 shadow-lg">
        <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-border" />
        <h2 className="font-display text-2xl text-foreground">Grupid</h2>

        <ul className="mt-4 space-y-2">
          {(groups.data ?? []).map((g) => (
            <li key={g.id}>
              <button
                onClick={() => onSelect(g)}
                className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left ${g.id === activeGroupId ? "border-accent bg-accent/10" : "border-border bg-background"}`}
              >
                <span className="font-medium text-foreground">{g.name}</span>
                <span className="font-mono text-sm text-muted-foreground">
                  {g.join_code}
                </span>
              </button>
            </li>
          ))}
          {groups.data?.length === 0 && (
            <li className="text-sm text-muted-foreground">
              Sul pole veel gruppe. Loo uus või liitu sõbra koodiga.
            </li>
          )}
        </ul>

        <div className="mt-6 space-y-3">
          <div className="flex gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Uue grupi nimi"
              className="flex-1 rounded-xl border border-input bg-background px-4 py-3 outline-none focus:border-accent"
            />
            <button
              disabled={name.trim().length < 2 || create.isPending}
              onClick={() => create.mutate()}
              className="rounded-xl bg-primary px-4 py-3 font-semibold text-primary-foreground disabled:opacity-40"
            >
              Loo
            </button>
          </div>
          <div className="flex gap-2">
            <input
              value={joinCode}
              inputMode="numeric"
              maxLength={6}
              onChange={(e) => setJoinCode(e.target.value.replace(/\D/g, ""))}
              placeholder="Liitumiskood"
              className="flex-1 rounded-xl border border-input bg-background px-4 py-3 tracking-[0.3em] outline-none focus:border-accent"
            />
            <button
              disabled={joinCode.length !== 6 || join.isPending}
              onClick={() => join.mutate()}
              className="rounded-xl bg-secondary px-4 py-3 font-semibold text-secondary-foreground disabled:opacity-40"
            >
              Liitu
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
