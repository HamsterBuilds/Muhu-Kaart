import { useState } from "react";
import type { MapPoint } from "./MuhuMap";

export default function PointCard({
  point,
  onClose,
  onDelete,
}: {
  point: MapPoint;
  onClose: () => void;
  onDelete: (id: string) => void;
}) {
  const [imageOk, setImageOk] = useState(true);

  return (
    <div className="fixed inset-x-0 bottom-0 z-[900] p-3">
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-lg">
        {point.imageUrl && imageOk && (
          <img
            src={point.imageUrl}
            alt={point.title}
            loading="lazy"
            onError={() => setImageOk(false)}
            className="h-40 w-full object-cover"
          />
        )}
        <div className="space-y-2 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-display text-xl text-foreground">{point.title}</h3>
              <p className="text-xs text-muted-foreground">Lisas {point.authorName}</p>
            </div>
            <button
              onClick={onClose}
              className="rounded-full bg-secondary px-3 py-1 text-sm text-secondary-foreground"
            >
              Sulge
            </button>
          </div>
          <p className="text-sm text-foreground/80">
            {point.description ?? "AI otsib selle koha kohta infot..."}
          </p>
          {point.mine && (
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
