import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  authErrorMessage,
  completeGoogleRedirect,
  createFirebaseGroup,
  joinFirebaseGroup,
  listFirebaseGroups,
  loginFirebaseUser,
  loginWithGoogle,
  registerFirebaseUser,
} from "@/lib/firebase-data";

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
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const [redirecting, setRedirecting] = useState(false);

  const handleAuthenticated = async (user: User) => {
    try {
      const groups = await listFirebaseGroups();
      if (groups && groups.length > 0) {
        onReady(user);
        return;
      }
    } catch (err) {
      console.warn("Could not fetch groups automatically:", err);
    }
    setAuthenticatedUser(user);
  };

  // Google'i ümbersuunamisega tagasi tullud sisselogimise lõpetamine
  useEffect(() => {
    void (async () => {
      try {
        const user = await completeGoogleRedirect();
        if (user) await handleAuthenticated({ ...user, code: user.id });
      } catch (e) {
        const msg = authErrorMessage(e);
        if (msg) toast.error(msg);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async () => {
    setBusy(true);
    try {
      const user =
        mode === "new"
          ? await registerFirebaseUser(name, email, password)
          : await loginFirebaseUser(email, password);
      await handleAuthenticated({ ...user, code: user.id });
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
      if (!user.id) {
        // Suunatakse Google'ile – leht laaditakse pärast tagasitulekut uuesti
        setRedirecting(true);
        return;
      }
      await handleAuthenticated({ ...user, code: user.id });
    } catch (e) {
      const msg = authErrorMessage(e);
      if (msg) toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  if (redirecting)
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-[#f4f3fb]">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#4285f4] border-t-transparent" />
        <p className="font-medium text-[#242224]">Suunan Google&apos;i sisselogimisele...</p>
      </div>
    );

  if (!started)
    return (
      <div className="relative flex min-h-dvh flex-col items-center justify-between overflow-hidden bg-[#c7ecfb] text-center">
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,transparent_0%,transparent_38%,rgba(255,255,255,0.72)_72%,#fff_88%)]" />
        <div className="pointer-events-none absolute -left-12 top-[55%] h-52 w-52 rounded-full bg-[#fff5a8]/40 blur-3xl" />
        <div className="pointer-events-none absolute -right-12 top-[74%] h-64 w-64 rounded-full bg-[#c9e4ff]/70 blur-3xl" />
        <div className="relative flex min-h-dvh w-full max-w-md flex-col items-center px-6 pt-7 pb-10">
          <div className="flex w-full items-start justify-between px-1">
            <div className="h-28 w-28 rounded-full bg-white shadow-sm" />
            <div className="mt-12 h-24 w-24 rounded-full bg-white shadow-sm" />
            <div className="h-28 w-28 rounded-full bg-white shadow-sm" />
          </div>
          <div className="flex flex-1 flex-col items-center justify-center pb-8">
            <h1 className="max-w-sm font-display text-[clamp(4rem,17vw,6.5rem)] font-black leading-[0.86] tracking-[-0.06em] text-[#242224]">
              Muhu
              <br />
              kaart
            </h1>
          </div>
          <button
            type="button"
            onClick={() => setStarted(true)}
            className="relative mb-6 w-[78%] max-w-sm rounded-full bg-[#292729] px-6 py-5 text-xl font-semibold text-white shadow-lg transition-transform hover:scale-[1.01] active:scale-[0.98]"
          >
            Alusta
          </button>
          <p className="relative text-lg font-medium text-[#242224]">Roberti poolt</p>
        </div>
      </div>
    );

  return (
    <div className="relative flex min-h-dvh flex-col items-center bg-[#f4f3fb] px-6 py-8">
      {!emailMode && !authenticatedUser && (
        <button
          type="button"
          onClick={() => setStarted(false)}
          className="absolute left-6 top-8 text-5xl font-light leading-none text-[#242224]"
          aria-label="Tagasi"
        >
          ‹
        </button>
      )}

      <header className="mx-auto mt-28 max-w-md text-center">
        <h1 className="font-sans text-5xl font-black leading-tight tracking-[-0.05em] text-[#242224]">
          {authenticatedUser ? "Liitu grupiga" : "Logi sisse"}
        </h1>
        {authenticatedUser && (
          <p className="mt-2 text-sm text-muted-foreground">
            {isCreatingGroup
              ? "Loo uus grupp ja jaga seda sõpradega"
              : "Sisesta grupikood Muhu punktide nägemiseks"}
          </p>
        )}
      </header>

      <div className="mt-14 w-full max-w-md p-0">
        {authenticatedUser ? (
          <div className="space-y-4">
            {!isCreatingGroup ? (
              <div className="space-y-4 rounded-[2rem] bg-white p-6 shadow-sm">
                <label className="block text-center text-sm font-semibold text-[#242224]">
                  Sisesta grupi kood
                </label>
                <input
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  inputMode="numeric"
                  placeholder="6-kohaline kood"
                  autoFocus
                  className="w-full rounded-2xl border border-input bg-[#f4f3fb] px-4 py-4 text-center text-2xl font-bold tracking-[0.3em] outline-none focus:border-accent"
                />
                <button
                  disabled={groupBusy || joinCode.length !== 6}
                  onClick={async () => {
                    setGroupBusy(true);
                    try {
                      await joinFirebaseGroup(joinCode);
                      onReady(authenticatedUser);
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : "Grupiga liitumine ebaõnnestus");
                    } finally {
                      setGroupBusy(false);
                    }
                  }}
                  className="w-full rounded-2xl bg-[#292729] py-4 text-lg font-semibold text-white shadow transition-all hover:bg-[#1a191a] disabled:opacity-40"
                >
                  {groupBusy ? "Liitun..." : "Liitu grupiga"}
                </button>
              </div>
            ) : (
              <div className="space-y-4 rounded-[2rem] bg-white p-6 shadow-sm">
                <label className="block text-center text-sm font-semibold text-[#242224]">
                  Uue grupi nimi
                </label>
                <input
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  placeholder="Nt. Muhu seiklejad"
                  autoFocus
                  className="w-full rounded-2xl border border-input bg-[#f4f3fb] px-4 py-4 text-base outline-none focus:border-accent"
                />
                <button
                  disabled={groupBusy || groupName.trim().length < 2}
                  onClick={async () => {
                    setGroupBusy(true);
                    try {
                      await createFirebaseGroup(groupName.trim());
                      onReady(authenticatedUser);
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : "Grupi loomine ebaõnnestus");
                    } finally {
                      setGroupBusy(false);
                    }
                  }}
                  className="w-full rounded-2xl bg-[#292729] py-4 text-lg font-semibold text-white shadow transition-all hover:bg-[#1a191a] disabled:opacity-40"
                >
                  {groupBusy ? "Loon..." : "Loo grupp ja jätka"}
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={() => setIsCreatingGroup(!isCreatingGroup)}
              className="mt-2 block w-full text-center text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              {isCreatingGroup ? "← Sisesta olemasoleva grupi kood" : "Või loo uus grupp →"}
            </button>
          </div>
        ) : emailMode ? (
          <>
            <div className="mb-4 flex gap-2 rounded-full bg-secondary p-1 text-sm">
              <button
                className={`flex-1 rounded-full px-3 py-2 font-medium transition-colors ${
                  mode === "new" ? "bg-primary text-primary-foreground" : "text-muted-foreground"
                }`}
                onClick={() => setMode("new")}
              >
                Olen uus
              </button>
              <button
                className={`flex-1 rounded-full px-3 py-2 font-medium transition-colors ${
                  mode === "login" ? "bg-primary text-primary-foreground" : "text-muted-foreground"
                }`}
                onClick={() => setMode("login")}
              >
                Logi sisse
              </button>
            </div>

            <div className="space-y-4">
              {mode === "new" && (
                <>
                  <span className="text-sm font-medium text-foreground">Sinu nimi</span>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Nt. Mari"
                    className="w-full rounded-xl border border-input bg-background px-4 py-3 text-base outline-none focus:border-accent"
                  />
                </>
              )}
              <label htmlFor="auth-email" className="text-sm font-medium text-foreground">
                E-post
              </label>
              <input
                id="auth-email"
                autoComplete="email"
                inputMode="email"
                value={email}
                type="email"
                onChange={(e) => setEmail(e.target.value)}
                placeholder="sina@email.ee"
                className="w-full rounded-xl border border-input bg-background px-4 py-3 text-base outline-none focus:border-accent"
              />
              <span className="text-sm font-medium text-foreground">Parool</span>
              <input
                value={password}
                type="password"
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Vähemalt 6 tähemärki"
                className="w-full rounded-xl border border-input bg-background px-4 py-3 text-base outline-none focus:border-accent"
              />
            </div>

            <button
              disabled={
                busy ||
                email.trim().length < 5 ||
                password.length < 6 ||
                (mode === "new" && name.trim().length < 2)
              }
              onClick={submit}
              className="mt-5 w-full rounded-xl bg-primary px-4 py-3 text-base font-semibold text-primary-foreground transition-opacity disabled:opacity-40"
            >
              {busy ? "Hetk..." : mode === "new" ? "Loo konto" : "Logi sisse"}
            </button>

            <button
              type="button"
              onClick={() => setEmailMode(false)}
              className="mt-3 w-full text-sm text-muted-foreground"
            >
              ← Tagasi valikute juurde
            </button>
          </>
        ) : (
          <div className="space-y-3">
            <button
              type="button"
              disabled={busy}
              onClick={googleSubmit}
              className="mx-auto flex h-24 w-full items-center justify-center gap-3 rounded-[2rem] bg-white px-5 text-xl font-semibold text-[#202124] shadow-sm transition-transform hover:scale-[1.01] active:scale-[0.99] disabled:opacity-60"
            >
              {busy ? (
                <>
                  <span className="h-6 w-6 animate-spin rounded-full border-[3px] border-[#4285f4] border-t-transparent" />
                  Logisin...
                </>
              ) : (
                <>
                  <svg aria-hidden="true" viewBox="0 0 48 48" className="h-7 w-7">
                    <path
                      fill="#EA4335"
                      d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                    />
                    <path
                      fill="#4285F4"
                      d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                    />
                    <path
                      fill="#34A853"
                      d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                    />
                  </svg>
                  Logi sisse Google&apos;iga
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => setEmailMode(true)}
              className="mx-auto flex h-16 w-full items-center justify-center rounded-[2rem] bg-white px-5 text-lg font-semibold text-[#202124] shadow-sm transition-transform hover:scale-[1.01] active:scale-[0.99]"
            >
              Logi sisse emailiga
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
