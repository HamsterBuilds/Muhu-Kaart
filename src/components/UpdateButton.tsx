import { useCallback, useEffect, useState } from "react";
import { Browser } from "@capacitor/browser";
import { Capacitor } from "@capacitor/core";
import { toast } from "sonner";

const LATEST_RELEASE_URL = "https://api.github.com/repos/HamsterBuilds/Muhu-Kaart/releases/latest";
const CURRENT_BUILD = Number(import.meta.env["VITE_APP_BUILD_NUMBER"] ?? 0);

type AvailableUpdate = { build: number; downloadUrl: string };

async function findUpdate(): Promise<AvailableUpdate | null> {
  if (!Capacitor.isNativePlatform() || CURRENT_BUILD <= 0) return null;

  const response = await fetch(`${LATEST_RELEASE_URL}?t=${Date.now()}`, {
    headers: { Accept: "application/vnd.github+json" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Uuendust ei saanud kontrollida");

  const release = (await response.json()) as {
    tag_name?: string;
    assets?: { name?: string; browser_download_url?: string }[];
  };
  const build = Number(release.tag_name?.match(/^apk-(\d+)$/)?.[1] ?? 0);
  const apk = release.assets?.find(
    (asset) => asset.name === "app-debug.apk" && asset.browser_download_url,
  );
  return build > CURRENT_BUILD && apk?.browser_download_url
    ? { build, downloadUrl: apk.browser_download_url }
    : null;
}

export default function UpdateButton({ className = "" }: { className?: string }) {
  const [update, setUpdate] = useState<AvailableUpdate | null>(null);
  const [opening, setOpening] = useState(false);

  const check = useCallback(async () => {
    try {
      setUpdate(await findUpdate());
    } catch (error) {
      console.warn("Update check failed:", error);
    }
  }, []);

  useEffect(() => {
    void check();
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [check]);

  if (!update) return null;

  return (
    <button
      type="button"
      disabled={opening}
      onClick={async () => {
        setOpening(true);
        try {
          await Browser.open({ url: update.downloadUrl });
          toast.info("Laadi APK alla ja kinnita Androidi paigaldus");
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Uuenduse avamine ebaõnnestus");
        } finally {
          setOpening(false);
        }
      }}
      className={`rounded-xl bg-[#2f9e7f] px-3 py-2 text-sm font-semibold text-white shadow-sm disabled:opacity-60 ${className}`}
      aria-label={`Paigalda uuendus ${update.build}`}
    >
      {opening ? "Avan..." : "Update"}
    </button>
  );
}
