import { useState } from "react";
import { toast } from "sonner";
import { createFirebaseGroup, joinFirebaseGroup, loginFirebaseUser, loginWithGoogle, registerFirebaseUser } from "@/lib/firebase-data";

type User = { id: string; name: string; email: string; code: string };

export default function Welcome({ onReady }: { onReady: (user: User) => void }) {
  const [mode, setMode] = useState<"new" | "login">("new");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [emailMode, setEmailMode] = useState(false);
  const [started, setStarted] = useState(false);
  const [authenticatedUser, setAuthenticatedUser] = useState<User | null>(null);
  const [groupName, setGroupName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [groupBusy, setGroupBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const user = mode === "new"
        ? await registerFirebaseUser(name, email, password)
        : await loginFirebaseUser(email, password);
      setAuthenticatedUser({ ...user, code: user.id });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Midagi läks valesti");
    } finally {
      setBusy(false);
    }
  };

  const googleSubmit = async () => {
    setBusy(true);
    try {
      const user = await loginWithGoogle();
      setAuthenticatedUser({ ...user, code: user.id });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Google’i sisselogimine ebaõnnestus"); }
    finally { setBusy(false); }
  };

  if (authenticatedUser) return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-background px-6 py-12">
      <div className="w-full max-w-md space-y-6">
        <header className="space-y-2 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-accent">Tere tulemast</p>
          <h1 className="font-display text-3xl text-foreground">Liitu grupiga</h1>
          <p className="text-sm text-muted-foreground">Grupiga liitumine on vajalik, et näha ja jagada Muhu punkte.</p>
        </header>
        <div className="space-y-4">
          <input value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="Uue grupi nimi" className="w-full rounded-xl border border-input bg-background px-4 py-3 outline-none focus:border-accent" />
          <p className="text-center text-xs text-muted-foreground">või</p>
          <input value={joinCode} onChange={(e) => setJoinCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" placeholder="6-kohaline grupikood" className="w-full rounded-xl border border-input bg-background px-4 py-3 tracking-[0.2em] outline-none focus:border-accent" />
          <button disabled={groupBusy || (groupName.trim().length < 2 && joinCode.length !== 6) || (groupName.trim().length > 0 && joinCode.length === 6)} onClick={async () => { setGroupBusy(true); try { if (groupName.trim()) await createFirebaseGroup(groupName); else await joinFirebaseGroup(joinCode); onReady(authenticatedUser); } catch (e) { toast.error(e instanceof Error ? e.message : "Grupiga liitumine ebaõnnestus"); } finally { setGroupBusy(false); } }} className="w-full rounded-xl bg-primary px-4 py-4 text-base font-semibold text-primary-foreground disabled:opacity-40">
            {groupBusy ? "Hetk..." : groupName.trim() ? "Loo grupp ja jätka" : "Liitu grupiga ja jätka"}
          </button>
          <p className="text-center text-xs text-muted-foreground">Sisesta ainult üks võimalus: loo grupp või kasuta olemasoleva grupi koodi.</p>
        </div>
      </div>
    </div>
  );

  if (!started) return (
    <div className="relative flex min-h-dvh flex-col items-center overflow-hidden bg-[#c7ecfb] text-center">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,transparent_0%,transparent_38%,rgba(255,255,255,0.72)_72%,#fff_88%)]" />
      <div className="pointer-events-none absolute -left-12 top-[55%] h-52 w-52 rounded-full bg-[#fff5a8]/40 blur-3xl" />
      <div className="pointer-events-none absolute -right-12 top-[74%] h-64 w-64 rounded-full bg-[#c9e4ff]/70 blur-3xl" />
      <div className="relative flex min-h-dvh w-full max-w-md flex-col items-center px-6 pt-7">
        <div className="flex w-full items-start justify-between px-1">
          <div className="h-28 w-28 rounded-full bg-white" />
          <div className="mt-12 h-24 w-24 rounded-full bg-white" />
          <div className="h-28 w-28 rounded-full bg-white" />
        </div>
        <div className="flex flex-1 flex-col items-center justify-center pb-8">
          <h1 className="max-w-sm font-display text-[clamp(4rem,17vw,6.5rem)] font-black leading-[0.86] tracking-[-0.06em] text-[#242224]">Muhu<br />kaart</h1>
        </div>
        <button type="button" onClick={() => setStarted(true)} className="relative mb-7 w-[78%] max-w-sm rounded-full bg-[#292729] px-6 py-5 text-xl font-semibold text-white shadow-lg transition-transform hover:scale-[1.01] active:scale-[0.98]">Alusta</button>
        <p className="relative mb-8 text-lg font-medium text-[#242224]">Roberti poolt</p>
      </div>
      <div className="relative flex h-20 w-full items-center justify-center bg-[#292729] text-lg font-semibold text-white">Muhu kaart</div>
    </div>
  );

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-8 bg-background px-6 py-12">
      <header className="mx-auto max-w-md space-y-3 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-accent">
          Muhu saar
        </p>
        <h1 className="font-display text-4xl leading-tight text-foreground">
          Muhu kaart
        </h1>
        <p className="text-sm text-muted-foreground">
          Jälgi oma teekonda saarel, märgi lahedad kohad ja jaga neid sõpradega.
        </p>
      </header>

      <div className="w-full max-w-md p-0">
        {emailMode && <div className="mb-4 flex gap-2 rounded-full bg-secondary p-1 text-sm">
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
        </div>}

        {emailMode && <>
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
        </>}

        {emailMode && <button
          disabled={busy || email.trim().length < 5 || password.length < 6 || (mode === "new" && name.trim().length < 2)}
          onClick={submit}
          className="mt-5 w-full rounded-xl bg-primary px-4 py-3 text-base font-semibold text-primary-foreground transition-opacity disabled:opacity-40"
        >
          {busy ? "Hetk..." : mode === "new" ? "Loo konto" : "Logi sisse"}
        </button>}
        {!emailMode && <div className="space-y-3">
          <button type="button" disabled={busy} onClick={googleSubmit} className="mx-auto flex w-full max-w-sm items-center justify-center gap-3 rounded-full border-2 border-[#777] bg-white px-5 py-4 text-lg font-semibold text-[#202124] shadow-sm transition-transform hover:scale-[1.01] active:scale-[0.99] disabled:opacity-40">
            <span className="text-2xl font-bold text-[#4285f4]">G</span>
            Sign in with Google
          </button>
          <button type="button" onClick={() => setEmailMode(true)} className="mx-auto block w-full max-w-sm rounded-full border-2 border-[#777] bg-white px-5 py-4 text-lg font-semibold text-[#202124] shadow-sm transition-transform hover:scale-[1.01] active:scale-[0.99]">
            Sign in with email
          </button>
        </div>}
        {emailMode && <button type="button" onClick={() => setEmailMode(false)} className="mt-3 w-full text-sm text-muted-foreground">← Back to sign in options</button>}
      </div>
    </div>
  );
}
