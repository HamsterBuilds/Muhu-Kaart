import { useState } from "react";
import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { clearIndexedDbPersistence, terminate } from "firebase/firestore";
import { firebaseAuth, firestore } from "@/lib/firebase";

export default function DataSettings({ tracking }: { tracking: boolean }) {
  const [action, setAction] = useState<"local" | "server" | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const user = firebaseAuth.currentUser;
  const admin = user?.email === "hamsterbuildsee@gmail.com" && user.emailVerified && user.providerData.some(p => p.providerId === "google.com");
  const execute = async () => {
    if (tracking || busy || !action) return;
    setBusy(true); setMessage("");
    try {
      if (action === "server") {
        const token = await firebaseAuth.currentUser?.getIdToken();
        if (!token) throw new Error("Sign in first");
        const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
        if (Capacitor.isNativePlatform()) {
          const origin = import.meta.env.VITE_APP_SERVER_URL;
          if (!origin || !origin.startsWith("https://")) throw new Error("Admin server URL has not been configured");
          const response = await CapacitorHttp.post({url: `${origin.replace(/\/$/, "")}/api/admin/delete-tracks`,headers,data:{confirmation},readTimeout:300000});
          if (response.status !== 200) throw new Error(response.data?.message ?? "Server deletion failed");
        } else {
          const response = await fetch("/api/admin/delete-tracks",{method:"POST",headers,body:JSON.stringify({confirmation})});
          const result = await response.json();
          if (!response.ok) throw new Error(result.message ?? "Server deletion failed");
        }
        setMessage("Serveri tracks andmed kustutatud. Seadmete kohalikud koopiad jäid alles.");
        setAction(null);
      } else {
        await terminate(firestore);
        await clearIndexedDbPersistence(firestore);
        // Keep authentication and unrelated application storage intact.
        for (const key of Object.keys(localStorage)) {
          if (key.startsWith("muhu-") || key.startsWith("muhu_") || key.startsWith("muhu.")) localStorage.removeItem(key);
        }
        window.location.reload();
      }
    } catch (error) {
      setMessage(`${error instanceof Error ? error.message : String(error)}${action === "local" ? " Ava leht uuesti. Sulge teised äpi vahelehed enne järgmist katset." : ""}`);
    } finally { setBusy(false); }
  };
  return <section>
    <button className="map-logout" disabled={tracking || busy} onClick={() => {setAction("local");setConfirmation("");}}>Delete local data</button>
    {admin && <button className="map-logout" disabled={tracking || busy} onClick={() => {setAction("server");setConfirmation("");}}>Delete all users’ server tracks</button>}
    {tracking && <p>Peata jälgimine enne andmete kustutamist.</p>}
    {action && <div>
      <p>{action === "local" ? "Kustutab selle äpi kohalikud andmed, sh pilve saatmata rajad. Serveri andmeid ei kustutata ja need võivad uuesti alla laadida. Sisselogimine säilib." : "Kustutab kõigi kasutajate serverirajad ja nende punktid. Tagasivõtmist ei ole. Kohalikud koopiad säilivad ning ootel andmed võivad uuesti üles laadida."}</p>
      <label>Type {action === "local" ? "DELETE LOCAL DATA" : "DELETE ALL TRACKS"}<input aria-label="Deletion confirmation" value={confirmation} onChange={e => setConfirmation(e.target.value)} disabled={busy}/></label>
      <button disabled={busy || confirmation !== (action === "local" ? "DELETE LOCAL DATA" : "DELETE ALL TRACKS")} onClick={execute}>{busy ? "Deleting…" : "Confirm deletion"}</button>
      <button disabled={busy} onClick={() => setAction(null)}>Cancel</button>
    </div>}
    {message && <p role="status">{message}</p>}
  </section>;
}
