import { useEffect, useState } from "react";
import type { MapPoint } from "./MuhuMap";

export default function PointCard({
  point,
  onClose,
  onDelete,
  onToggleVisited,
  onSave,
}: {
  point: MapPoint;
  onClose: () => void;
  onDelete: (id: string) => void;
  onToggleVisited: (id: string, visited: boolean) => void;
  onSave: (id: string, values: { title: string; description: string }) => void;
}) {
  const [imageOk, setImageOk] = useState(true);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(point.title);
  const [description, setDescription] = useState(point.description ?? "");

  useEffect(() => {
    setEditing(false);
    setImageOk(true);
    setTitle(point.title);
    setDescription(point.description ?? "");
  }, [point.id, point.title, point.description]);

  return (
    <div className="fixed inset-x-0 bottom-0 z-[900] p-3">
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-lg">
        {point.imageUrl && imageOk && !editing && (
          <img
            src={point.imageUrl}
            alt={point.title}
            loading="lazy"
            onError={() => setImageOk(false)}
            className="h-40 w-full object-cover"
          />
        )}
        <div className="space-y-3 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              {editing ? (
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full rounded-xl border border-input bg-background px-3 py-2 font-display text-lg outline-none focus:border-accent"
                />
              ) : (
                <h3 className="font-display text-xl text-foreground">{point.title}</h3>
              )}
              <p className="mt-1 text-xs text-muted-foreground">
                Lisas {point.authorName}
                {point.visited && !point.mine ? " · käidud" : ""}
              </p>
            </div>
            <button
              onClick={onClose}
              className="rounded-full bg-secondary px-3 py-1 text-sm text-secondary-foreground"
            >
              Sulge
            </button>
          </div>

          {editing ? (
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              placeholder="Kirjeldus"
              className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-accent"
            />
          ) : (
            <p className="text-sm text-foreground/80">
              {point.description ?? "AI otsib selle koha kohta infot..."}
            </p>
          )}

          {editing ? (
            <div className="flex gap-2">
              <button
                onClick={() => setEditing(false)}
                className="flex-1 rounded-xl bg-secondary px-4 py-3 font-medium text-secondary-foreground"
              >
                Katkesta
              </button>
              <button
                disabled={title.trim().length < 2}
                onClick={() =>
                  onSave(point.id, {
                    title: title.trim(),
                    description: description.trim(),
                  })
                }
                className="flex-1 rounded-xl bg-primary px-4 py-3 font-semibold text-primary-foreground disabled:opacity-40"
              >
                Salvesta
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => onToggleVisited(point.id, !point.visited)}
                className={`flex-1 rounded-xl px-4 py-3 text-sm font-semibold ${
                  point.visited
                    ? "bg-secondary text-secondary-foreground"
                    : "bg-primary text-primary-foreground"
                }`}
              >
                {point.visited ? "Eemalda „olen käinud”" : "Olen käinud"}
              </button>
              {point.mine && (
                <button
                  onClick={() => setEditing(true)}
                  className="flex-1 rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-accent-foreground"
                >
                  Muuda
                </button>
              )}
            </div>
          )}

          {point.mine && !editing && (
            <button
              onClick={() => onDelete(point.id)}
              className="text-sm font-medium text-destructive"
            >
              Kustuta punkt
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
