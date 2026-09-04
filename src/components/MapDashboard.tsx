import { useState } from "react";
import {
  Map,
  Users,
  Settings,
  ChartNoAxesColumnIncreasing,
  Navigation,
  X,
  ChevronRight,
  Plus,
  Play,
  Square,
  Route,
  CloudCheck,
  TrendingUp,
  LogOut,
} from "lucide-react";
import UpdateButton from "./UpdateButton";
import "./map-dashboard.css";

type Props = {
  groupName: string;
  groupCode: string;
  userName: string;
  syncStatus: string;
  visited: number;
  total: number;
  segments: number;
  walkedKm: number;
  notice: string | null;
  tracking: boolean;
  canAdd: boolean;
  onGroups: () => void;
  onLogout: () => void;
  onTrack: () => void;
  onAdd: () => void;
  hideDock: boolean;
};

export default function MapDashboard(p: Props) {
  const [panel, setPanel] = useState<"settings" | "stats" | null>(null);
  const [dismissedNotice, setDismissedNotice] = useState<string | null>(null);
  const stats = (
    <div className="map-stats">
      <div>
        <span className="stat-icon green">
          <Map />
        </span>
        <span>
          <strong>
            {p.visited}/{p.total}
          </strong>
          <small>Käidud punkte</small>
        </span>
      </div>
      <div>
        <span className="stat-icon">
          <Route />
        </span>
        <span>
          <strong>{p.walkedKm.toLocaleString("et-EE", { maximumFractionDigits: 2 })} km</strong>
          <small>Käidud teid</small>
        </span>
      </div>
      <div>
        <span className="stat-icon">
          <CloudCheck />
        </span>
        <span>
          <strong>{p.tracking ? "Aktiivne" : "Pausil"}</strong>
          <small>Jälgimine</small>
        </span>
      </div>
      <div>
        <span className="stat-icon">
          <TrendingUp />
        </span>
        <span>
          <strong>{p.segments}</strong>
          <small>Rohelisi lõike</small>
        </span>
      </div>
    </div>
  );
  return (
    <>
      <header className="map-dashboard-header">
        <section className="map-glass map-identity">
          <button className="map-identity-main" onClick={p.onGroups} aria-label="Vali grupp">
            <span className="map-brand-icon">
              <Map />
            </span>
            <span className="map-identity-copy">
              <strong>{p.groupName || "Vali grupp"}</strong>
              <span>
                {p.groupCode ? `Grupi kood ${p.groupCode} · ` : ""}
                {p.userName}
              </span>
              <small>
                {p.syncStatus} · rohelisi lõike {p.segments}
              </small>
            </span>
            <ChevronRight className="identity-chevron" />
          </button>
          <div className="map-header-actions">
            <UpdateButton />
            <button onClick={p.onGroups}>
              <Users />
              Grupid
            </button>
            <button onClick={() => setPanel("settings")}>
              <Settings />
              Seaded
            </button>
            <button onClick={() => setPanel("stats")}>
              <ChartNoAxesColumnIncreasing />
              Statistika
            </button>
          </div>
        </section>
        {p.notice && p.notice !== "outside" && dismissedNotice !== p.notice && (
          <section className="map-glass map-notice" role="status">
            <span className="map-notice-icon">
              <Navigation />
            </span>
            <span>
              {p.notice === "outside" ? (
                <>
                  <strong>Sa oled Muhu saarest väljas</strong>
                  <small>Kaart ja jälgimine töötavad ka siin.</small>
                </>
              ) : (
                <strong>{p.notice}</strong>
              )}
            </span>
            <button onClick={() => setDismissedNotice(p.notice)} aria-label="Sulge teavitus">
              <X />
            </button>
          </section>
        )}
      </header>
      {!p.hideDock && (
        <footer className="map-glass map-dock">
          <div className="dock-handle" />
          <div className="map-primary-actions">
            <button className="track-action" onClick={p.onTrack}>
              <span>{p.tracking ? <Square /> : <Play />}</span>
              <span>
                <strong>{p.tracking ? "Lõpeta jälgimine" : "Jälgi mind"}</strong>
                <small>Salvestab sinu teekonna</small>
              </span>
            </button>
            <button className="add-action" onClick={p.onAdd} disabled={!p.canAdd}>
              <span>
                <Plus />
              </span>
              <span>
                <strong>Lisa punkt</strong>
                <small>Märgi huvitav koht</small>
              </span>
            </button>
          </div>
        </footer>
      )}
      {panel && (
        <div className="map-panel-backdrop" onClick={() => setPanel(null)}>
          <section
            className="map-glass map-info-panel"
            role="dialog"
            aria-modal="true"
            aria-label={panel === "settings" ? "Seaded" : "Statistika"}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="map-panel-title">
              <h2>{panel === "settings" ? "Seaded" : "Statistika"}</h2>
              <button aria-label="Sulge" onClick={() => setPanel(null)}>
                <X />
              </button>
            </div>
            {panel === "stats" ? (
              <>
                {stats}
                <p>Salvestatud teelõikude pikkus. Korduvad läbimised ei suurenda tulemust.</p>
              </>
            ) : (
              <>
                <p>{p.userName}</p>
                <p>{p.syncStatus}</p>
                <button className="map-logout" onClick={p.onLogout}>
                  <LogOut />
                  Logi välja
                </button>
              </>
            )}
          </section>
        </div>
      )}
    </>
  );
}
