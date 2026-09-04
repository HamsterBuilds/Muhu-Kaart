import {
  createUserWithEmailAndPassword,
  getRedirectResult,
  GoogleAuthProvider,
  signInWithCredential,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  type User as FirebaseAuthUser,
} from "firebase/auth";
import { FirebaseError } from "firebase/app";
import { Capacitor } from "@capacitor/core";
import { FirebaseAuthentication } from "@capacitor-firebase/authentication";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { firebaseAuth, firestore } from "@/lib/firebase";

export type FirebaseUser = { id: string; name: string; email: string };
export type FirebaseGroup = { id: string; name: string; join_code: string };
export type MapPointData = {
  id: string;
  title: string;
  description: string | null;
  imageUrl: null;
  lat: number;
  lng: number;
  aiStatus: string;
  createdAt: string;
  mine: boolean;
  visited: boolean;
  authorName: string;
};
const uid = () =>
  firebaseAuth.currentUser?.uid ??
  (() => {
    throw new Error("Palun logi sisse");
  })();
const code = () => String(Math.floor(100000 + Math.random() * 900000));

const AUTH_TIMEOUT_MS = 20_000;
const DATA_TIMEOUT_MS = 10_000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export async function registerFirebaseUser(name: string, email: string, password: string) {
  const credential = await createUserWithEmailAndPassword(firebaseAuth, email.trim(), password);
  await setDoc(doc(firestore, "users", credential.user.uid), {
    name: name.trim(),
    email: email.trim(),
    createdAt: serverTimestamp(),
  });
  return { id: credential.user.uid, name: name.trim(), email: email.trim() } satisfies FirebaseUser;
}
export async function loginFirebaseUser(email: string, password: string) {
  const credential = await withTimeout(
    signInWithEmailAndPassword(firebaseAuth, email.trim(), password),
    AUTH_TIMEOUT_MS,
    "Sisselogimine võttis liiga kaua. Kontrolli internetiühendust ja proovi uuesti.",
  );
  let data: Record<string, unknown> | undefined;
  try {
    data = (
      await withTimeout(
        getDoc(doc(firestore, "users", credential.user.uid)),
        DATA_TIMEOUT_MS,
        "Profiili laadimine võttis liiga kaua",
      )
    ).data();
  } catch (error) {
    // Authentication succeeded. A temporarily unavailable profile must not
    // trap the user on the sign-in screen.
    console.warn("Could not load user profile after email sign-in:", error);
  }
  return {
    id: credential.user.uid,
    name: (data?.["name"] as string | undefined) ?? "Kasutaja",
    email: credential.user.email ?? email,
  } satisfies FirebaseUser;
}

/** Firebase'i veakoodid, kus popupi asemel tasub proovida ümbersuunamist. */
const REDIRECT_FALLBACK_CODES = new Set([
  "auth/popup-blocked",
  "auth/popup-failed-to-open",
  "auth/cancelled-popup-request",
  "auth/operation-not-supported-in-this-environment",
]);

export function authErrorMessage(e: unknown): string {
  const code = e instanceof FirebaseError ? e.code : "";
  if (code === "auth/unauthorized-domain")
    return "Seda aadressi pole Firebase'i projektis lubatud (Firebase Console → Authentication → Settings → Authorized domains)";
  if (code === "auth/operation-not-allowed")
    return "Google'i sisselogimine pole Firebase'i projektis sisselülitatud";
  if (code === "auth/network-request-failed") return "Võrguühendus puudub – proovi uuesti";
  if (code === "auth/configuration-not-found")
    return "Google'i sisselogimine pole Firebase'i projektis seadistatud";
  if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") return "";
  return e instanceof Error ? e.message : "Google'i sisselogimine ebaõnnestus";
}

async function ensureGoogleUser(authUser: FirebaseAuthUser): Promise<FirebaseUser> {
  const ref = doc(firestore, "users", authUser.uid);
  let data: Record<string, unknown> | undefined;
  try {
    const existing = await withTimeout(
      getDoc(ref),
      DATA_TIMEOUT_MS,
      "Profiili laadimine võttis liiga kaua",
    );
    data = existing.data();
    if (!existing.exists()) {
      await withTimeout(
        setDoc(ref, {
          name: authUser.displayName ?? "Kasutaja",
          email: authUser.email ?? "",
          createdAt: serverTimestamp(),
        }),
        DATA_TIMEOUT_MS,
        "Profiili salvestamine võttis liiga kaua",
      );
    }
  } catch (error) {
    // Google authentication is already complete, so continue with the data
    // supplied by Firebase Auth and let Firestore recover in the background.
    console.warn("Could not sync Google user profile:", error);
  }
  return {
    id: authUser.uid,
    name: (data?.["name"] as string | undefined) ?? authUser.displayName ?? "Kasutaja",
    email: authUser.email ?? "",
  } satisfies FirebaseUser;
}

/** Lõpetab Google'i ümbersuunamisel tagasi tulnud sisselogimise. Null, kui ümbersuunamist polnud. */
export async function completeGoogleRedirect(): Promise<FirebaseUser | null> {
  const credential = await getRedirectResult(firebaseAuth);
  if (!credential?.user) return null;
  return ensureGoogleUser(credential.user);
}

export async function loginWithGoogle(): Promise<FirebaseUser> {
  if (Capacitor.isNativePlatform()) {
    try {
      // The legacy account chooser is reliable across the Android versions
      // supported by this app. Credential Manager can remain pending forever
      // on devices where its Google provider is not configured.
      const result = await withTimeout(
        FirebaseAuthentication.signInWithGoogle({
          useCredentialManager: false,
        }),
        45_000,
        "Google'i sisselogimine võttis liiga kaua. Proovi uuesti.",
      );
      const idToken = result.credential?.idToken;
      if (!idToken) throw new Error("Google'i sisselogimise token puudub");
      const credential = await withTimeout(
        signInWithCredential(firebaseAuth, GoogleAuthProvider.credential(idToken)),
        AUTH_TIMEOUT_MS,
        "Google'i sisselogimine võttis liiga kaua. Kontrolli internetiühendust.",
      );
      return ensureGoogleUser(credential.user);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("10:") || message.includes("DEVELOPER_ERROR")) {
        throw new Error(
          "Google'i sisselogimise seadistus ei klapi selle Androidi versiooniga (viga 10).",
        );
      }
      throw error;
    }
  }

  try {
    const credential = await signInWithPopup(firebaseAuth, new GoogleAuthProvider());
    return await ensureGoogleUser(credential.user);
  } catch (e) {
    // Popup blokeeritud või keskkond ei toeta – kasuta ümbersuunamist
    if (e instanceof FirebaseError && REDIRECT_FALLBACK_CODES.has(e.code)) {
      await signInWithRedirect(firebaseAuth, new GoogleAuthProvider());
      // Leht suunatakse Google'ile ja laaditakse pärast uuesti
      return { id: "", name: "", email: "" };
    }
    throw e;
  }
}
export async function listFirebaseGroups() {
  const memberships = await getDocs(collection(firestore, "users", uid(), "groups"));
  const groups = await Promise.all(
    memberships.docs.map(async (m) => {
      const snap = await getDoc(doc(firestore, "groups", m.id));
      const d = snap.data();
      return d ? { id: snap.id, name: d.name as string, join_code: d.joinCode as string } : null;
    }),
  );
  return groups.filter((g): g is FirebaseGroup => !!g);
}
export async function createFirebaseGroup(name: string) {
  const ownerId = uid();
  const joinCode = code();
  const group = await addDoc(collection(firestore, "groups"), {
    name: name.trim(),
    joinCode,
    ownerId,
    createdAt: serverTimestamp(),
  });
  await Promise.all([
    setDoc(doc(firestore, "groups", group.id, "members", ownerId), { joinedAt: serverTimestamp() }),
    setDoc(doc(firestore, "users", ownerId, "groups", group.id), { joinedAt: serverTimestamp() }),
  ]);
  return { id: group.id, name: name.trim(), join_code: joinCode } satisfies FirebaseGroup;
}
export async function joinFirebaseGroup(joinCode: string) {
  const result = await getDocs(
    query(collection(firestore, "groups"), where("joinCode", "==", joinCode), limit(1)),
  );
  const group = result.docs[0];
  if (!group) throw new Error("Sellise koodiga gruppi ei leitud");
  const userId = uid();
  await Promise.all([
    setDoc(doc(firestore, "groups", group.id, "members", userId), { joinedAt: serverTimestamp() }),
    setDoc(doc(firestore, "users", userId, "groups", group.id), { joinedAt: serverTimestamp() }),
  ]);
  return {
    id: group.id,
    name: group.data().name as string,
    join_code: group.data().joinCode as string,
  } satisfies FirebaseGroup;
}
export async function listFirebasePoints(groupId: string): Promise<MapPointData[]> {
  const userId = uid();
  const result = await getDocs(
    query(
      collection(firestore, "points"),
      where("groupId", "==", groupId),
      orderBy("createdAt", "desc"),
    ),
  );
  return Promise.all(
    result.docs.map(async (p) => {
      const d = p.data();
      const visit = await getDoc(doc(firestore, "points", p.id, "visits", userId));
      return {
        id: p.id,
        title: d.title as string,
        description: (d.description as string | null) ?? null,
        imageUrl: null,
        lat: d.lat as number,
        lng: d.lng as number,
        aiStatus: "disabled",
        createdAt: d.createdAt?.toDate?.()?.toISOString?.() ?? new Date().toISOString(),
        mine: d.userId === userId,
        visited: visit.exists(),
        authorName: (d.authorName as string) ?? "Kasutaja",
      };
    }),
  );
}
export async function addFirebasePoint(
  groupId: string,
  title: string,
  lat: number,
  lng: number,
  authorName: string,
) {
  const p = await addDoc(collection(firestore, "points"), {
    groupId,
    userId: uid(),
    authorName,
    title: title.trim(),
    lat,
    lng,
    createdAt: serverTimestamp(),
  });
  return p.id;
}
export async function toggleFirebaseVisit(pointId: string, visited: boolean) {
  const ref = doc(firestore, "points", pointId, "visits", uid());
  if (visited) await setDoc(ref, { visitedAt: serverTimestamp() });
  else await deleteDoc(ref);
}
export async function updateFirebasePoint(
  pointId: string,
  values: { title?: string; description?: string },
) {
  await updateDoc(doc(firestore, "points", pointId), values);
}
export async function deleteFirebasePoint(pointId: string) {
  await deleteDoc(doc(firestore, "points", pointId));
}
export async function startFirebaseTrack() {
  const t = await addDoc(collection(firestore, "tracks"), {
    userId: uid(),
    startedAt: serverTimestamp(),
  });
  return t.id;
}
export async function appendFirebaseTrackPoints(
  trackId: string,
  points: { id: string; lat: number; lng: number; t: string }[],
) {
  if (!points.length) return;
  // One atomic, idempotent batch: retrying after a network interruption
  // overwrites the same point IDs instead of creating duplicate track points.
  // Firestore permits at most 500 writes per batch. Keep one write available
  // for the parent update so even a long offline backlog can recover safely.
  for (let offset = 0; offset < points.length; offset += 499) {
    const batch = writeBatch(firestore);
    for (const p of points.slice(offset, offset + 499)) {
      batch.set(doc(firestore, "tracks", trackId, "points", p.id), {
        lat: p.lat,
        lng: p.lng,
        recordedAt: p.t,
      });
    }
    batch.update(doc(firestore, "tracks", trackId), { updatedAt: serverTimestamp() });
    await batch.commit();
  }
}
export async function endFirebaseTrack(trackId: string) {
  await updateDoc(doc(firestore, "tracks", trackId), { endedAt: serverTimestamp() });
}
export async function listFirebaseTracks() {
  const result = await getDocs(
    query(
      collection(firestore, "tracks"),
      where("userId", "==", uid()),
      orderBy("startedAt", "desc"),
    ),
  );
  return Promise.all(
    result.docs.map(async (t) => {
      const points = await getDocs(
        query(collection(firestore, "tracks", t.id, "points"), orderBy("recordedAt", "asc")),
      );
      return {
        id: t.id,
        coverage: t.data().coverage === true,
        startedAt: t.data().startedAt?.toDate?.()?.toISOString?.() ?? new Date().toISOString(),
        points: points.docs.map(
          (p) => [p.data().lat as number, p.data().lng as number] as [number, number],
        ),
      };
    }),
  );
}
