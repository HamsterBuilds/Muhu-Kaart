import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { loginWithCode, registerUser } from "@/lib/muhu-api.functions";

type User = { id: string; name: string; code: string };

export default function Welcome({ onReady }: { onReady: (user: User) => void }) {
  const registerFn = useServerFn(registerUser);
  const loginFn = useServerFn(loginWithCode);
  const [mode, setMode] = useState<"new" | "code">("new");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const user =
        mode === "new"
          ? await registerFn({ data: { name } })
          : await loginFn({ data: { code } });
      onReady(user);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Midagi läks valesti");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-dvh flex-col justify-center gap-8 bg-background px-6 py-12">
      <header className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-accent">
          Muhu saar
        </p>
        <h1 className="font-display text-4xl leading-tight text-foreground">
          Minu Muhu punktid
        </h1>
        <p className="text-sm text-muted-foreground">
          Jälgi oma teekonda saarel, märgi lahedad kohad ja jaga neid sõpradega.
        </p>
      </header>

      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="mb-4 flex gap-2 rounded-full bg-secondary p-1 text-sm">
          <button
            className={`flex-1 rounded-full px-3 py-2 font-medium transition-colors ${mode === "new" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
            onClick={() => setMode("new")}
          >
            Olen uus
          </button>
          <button
            className={`flex-1 rounded-full px-3 py-2 font-medium transition-colors ${mode === "code" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
            onClick={() => setMode("code")}
          >
            Mul on kood
          </button>
        </div>

        {mode === "new" ? (
          <label className="block space-y-2">
            <span className="text-sm font-medium text-foreground">Sinu nimi</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nt. Mari"
              className="w-full rounded-xl border border-input bg-background px-4 py-3 text-base outline-none focus:border-accent"
            />
            <span className="block text-xs text-muted-foreground">
              Saad 6-kohalise koodi, millega hiljem sisse logid.
            </span>
          </label>
        ) : (
          <label className="block space-y-2">
            <span className="text-sm font-medium text-foreground">6-kohaline kood</span>
            <input
              value={code}
              inputMode="numeric"
              maxLength={6}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              placeholder="123456"
              className="w-full rounded-xl border border-input bg-background px-4 py-3 text-center text-2xl tracking-[0.4em] outline-none focus:border-accent"
            />
          </label>
        )}

        <button
          disabled={busy || (mode === "new" ? name.trim().length < 2 : code.length !== 6)}
          onClick={submit}
          className="mt-5 w-full rounded-xl bg-primary px-4 py-3 text-base font-semibold text-primary-foreground transition-opacity disabled:opacity-40"
        >
          {busy ? "Hetk..." : mode === "new" ? "Alusta" : "Logi sisse"}
        </button>
      </div>
    </div>
  );
}
