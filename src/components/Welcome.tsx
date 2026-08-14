import { useState } from "react";
import { toast } from "sonner";
import { loginFirebaseUser, registerFirebaseUser } from "@/lib/firebase-data";

type User = { id: string; name: string; email: string; code: string };

export default function Welcome({ onReady }: { onReady: (user: User) => void }) {
  const [mode, setMode] = useState<"new" | "login">("new");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const user = mode === "new"
        ? await registerFirebaseUser(name, email, password)
        : await loginFirebaseUser(email, password);
      onReady({ ...user, code: user.id });
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
            className={`flex-1 rounded-full px-3 py-2 font-medium transition-colors ${mode === "login" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
            onClick={() => setMode("login")}
          >
            Logi sisse
          </button>
        </div>

        <>
          <label className="block space-y-2">
            {mode === "new" && <><span className="text-sm font-medium text-foreground">Sinu nimi</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nt. Mari" className="w-full rounded-xl border border-input bg-background px-4 py-3 text-base outline-none focus:border-accent" /></>}
            <span className="text-sm font-medium text-foreground">E-post</span>
            <input
              value={email}
              type="email"
              onChange={(e) => setEmail(e.target.value)}
              placeholder="sina@email.ee"
              className="w-full rounded-xl border border-input bg-background px-4 py-3 text-base outline-none focus:border-accent"
            />
            <span className="text-sm font-medium text-foreground">Parool</span>
            <input value={password} type="password" onChange={(e) => setPassword(e.target.value)} placeholder="Vähemalt 6 tähemärki" className="w-full rounded-xl border border-input bg-background px-4 py-3 text-base outline-none focus:border-accent" />
          </label>
        </>

        <button
          disabled={busy || email.trim().length < 5 || password.length < 6 || (mode === "new" && name.trim().length < 2)}
          onClick={submit}
          className="mt-5 w-full rounded-xl bg-primary px-4 py-3 text-base font-semibold text-primary-foreground transition-opacity disabled:opacity-40"
        >
          {busy ? "Hetk..." : mode === "new" ? "Loo konto" : "Logi sisse"}
        </button>
      </div>
    </div>
  );
}
