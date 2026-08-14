import { createUserWithEmailAndPassword, GoogleAuthProvider, signInWithCredential, signInWithEmailAndPassword, signInWithPopup } from "firebase/auth";
import { Capacitor } from "@capacitor/core";
import { FirebaseAuthentication } from "@capacitor-firebase/authentication";
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, limit, orderBy, query, serverTimestamp, setDoc, updateDoc, where } from "firebase/firestore";
import { firebaseAuth, firestore } from "@/lib/firebase";

export type FirebaseUser = { id: string; name: string; email: string };
export type FirebaseGroup = { id: string; name: string; join_code: string };
export type MapPointData = { id: string; title: string; description: string | null; imageUrl: null; lat: number; lng: number; aiStatus: string; createdAt: string; mine: boolean; visited: boolean; authorName: string };
const uid = () => firebaseAuth.currentUser?.uid ?? (() => { throw new Error("Palun logi sisse"); })();
const code = () => String(Math.floor(100000 + Math.random() * 900000));

function toGoogleSignInError(error: unknown): Error {
  if (!(error instanceof Error)) return new Error("Google’i sisselogimine ebaõnnestus.");
  const message = error.message.trim();
  if (message.startsWith("10:") || message === "10" || /DEVELOPER_ERROR/i.test(message)) {
    return new Error(
      "Google’i sisselogimine pole Androidis õigesti seadistatud (viga 10). Kontrolli Firebase’i Google Sign-In seadistust, Androidi package name’i ning SHA-1/SHA-256 võtmeid.",
    );
  }
  return error;
}

export async function registerFirebaseUser(name: string, email: string, password: string) {
  const credential = await createUserWithEmailAndPassword(firebaseAuth, email.trim(), password);
  await setDoc(doc(firestore, "users", credential.user.uid), { name: name.trim(), email: email.trim(), createdAt: serverTimestamp() });
  return { id: credential.user.uid, name: name.trim(), email: email.trim() } satisfies FirebaseUser;
}
export async function loginFirebaseUser(email: string, password: string) {
  const credential = await signInWithEmailAndPassword(firebaseAuth, email.trim(), password);
  const data = (await getDoc(doc(firestore, "users", credential.user.uid))).data();
  return { id: credential.user.uid, name: (data?.name as string | undefined) ?? "Kasutaja", email: credential.user.email ?? email } satisfies FirebaseUser;
}
export async function loginWithGoogle() {
  if (Capacitor.isNativePlatform()) {
    try {
      const result = await FirebaseAuthentication.signInWithGoogle({ skipNativeAuth: true, useCredentialManager: false });
      const idToken = result.credential?.idToken;
      // A missing token usually means the Android OAuth client/SHA-1 is not configured.
      if (!idToken) throw new Error("Google’i sisselogimise token puudub. Kontrolli Androidi Google OAuth seadistust.");
      const credential = await signInWithCredential(firebaseAuth, GoogleAuthProvider.credential(idToken));
      const ref = doc(firestore, "users", credential.user.uid);
      const existing = await getDoc(ref);
      if (!existing.exists()) await setDoc(ref, { name: credential.user.displayName ?? "Kasutaja", email: credential.user.email ?? "", createdAt: serverTimestamp() });
      const data = existing.data();
      return { id: credential.user.uid, name: (data?.name as string | undefined) ?? credential.user.displayName ?? "Kasutaja", email: credential.user.email ?? "" } satisfies FirebaseUser;
    } catch (error) {
      throw toGoogleSignInError(error);
    }
  }
  const credential = await signInWithPopup(firebaseAuth, new GoogleAuthProvider());
  const ref = doc(firestore, "users", credential.user.uid);
  const existing = await getDoc(ref);
  if (!existing.exists()) await setDoc(ref, { name: credential.user.displayName ?? "Kasutaja", email: credential.user.email ?? "", createdAt: serverTimestamp() });
  const data = existing.data();
  return { id: credential.user.uid, name: (data?.name as string | undefined) ?? credential.user.displayName ?? "Kasutaja", email: credential.user.email ?? "" } satisfies FirebaseUser;
}
export async function listFirebaseGroups() {
  const memberships = await getDocs(collection(firestore, "users", uid(), "groups"));
  const groups = await Promise.all(memberships.docs.map(async (m) => { const snap = await getDoc(doc(firestore, "groups", m.id)); const d = snap.data(); return d ? { id: snap.id, name: d.name as string, join_code: d.joinCode as string } : null; }));
  return groups.filter((g): g is FirebaseGroup => !!g);
}
export async function createFirebaseGroup(name: string) {
  const ownerId = uid(); const joinCode = code();
  const group = await addDoc(collection(firestore, "groups"), { name: name.trim(), joinCode, ownerId, createdAt: serverTimestamp() });
  await Promise.all([setDoc(doc(firestore, "groups", group.id, "members", ownerId), { joinedAt: serverTimestamp() }), setDoc(doc(firestore, "users", ownerId, "groups", group.id), { joinedAt: serverTimestamp() })]);
  return { id: group.id, name: name.trim(), join_code: joinCode } satisfies FirebaseGroup;
}
export async function joinFirebaseGroup(joinCode: string) {
  const result = await getDocs(query(collection(firestore, "groups"), where("joinCode", "==", joinCode), limit(1))); const group = result.docs[0];
  if (!group) throw new Error("Sellise koodiga gruppi ei leitud"); const userId = uid();
  await Promise.all([setDoc(doc(firestore, "groups", group.id, "members", userId), { joinedAt: serverTimestamp() }), setDoc(doc(firestore, "users", userId, "groups", group.id), { joinedAt: serverTimestamp() })]);
  return { id: group.id, name: group.data().name as string, join_code: group.data().joinCode as string } satisfies FirebaseGroup;
}
export async function listFirebasePoints(groupId: string): Promise<MapPointData[]> {
  const userId = uid(); const result = await getDocs(query(collection(firestore, "points"), where("groupId", "==", groupId), orderBy("createdAt", "desc")));
  return Promise.all(result.docs.map(async (p) => { const d = p.data(); const visit = await getDoc(doc(firestore, "points", p.id, "visits", userId)); return { id: p.id, title: d.title as string, description: (d.description as string | null) ?? null, imageUrl: null, lat: d.lat as number, lng: d.lng as number, aiStatus: "disabled", createdAt: d.createdAt?.toDate?.()?.toISOString?.() ?? new Date().toISOString(), mine: d.userId === userId, visited: visit.exists(), authorName: (d.authorName as string) ?? "Kasutaja" }; }));
}
export async function addFirebasePoint(groupId: string, title: string, lat: number, lng: number, authorName: string) { const p = await addDoc(collection(firestore, "points"), { groupId, userId: uid(), authorName, title: title.trim(), lat, lng, createdAt: serverTimestamp() }); return p.id; }
export async function toggleFirebaseVisit(pointId: string, visited: boolean) { const ref = doc(firestore, "points", pointId, "visits", uid()); if (visited) await setDoc(ref, { visitedAt: serverTimestamp() }); else await deleteDoc(ref); }
export async function updateFirebasePoint(pointId: string, values: { title?: string; description?: string }) { await updateDoc(doc(firestore, "points", pointId), values); }
export async function deleteFirebasePoint(pointId: string) { await deleteDoc(doc(firestore, "points", pointId)); }
export async function startFirebaseTrack() { const t = await addDoc(collection(firestore, "tracks"), { userId: uid(), startedAt: serverTimestamp() }); return t.id; }
export async function appendFirebaseTrackPoints(trackId: string, points: { lat: number; lng: number; t: string }[]) { await Promise.all(points.map((p) => addDoc(collection(firestore, "tracks", trackId, "points"), { lat: p.lat, lng: p.lng, recordedAt: p.t }))); }
export async function endFirebaseTrack(trackId: string) { await updateDoc(doc(firestore, "tracks", trackId), { endedAt: serverTimestamp() }); }
export async function listFirebaseTracks() { const result = await getDocs(query(collection(firestore, "tracks"), where("userId", "==", uid()), orderBy("startedAt", "desc"), limit(20))); return Promise.all(result.docs.map(async (t) => { const points = await getDocs(query(collection(firestore, "tracks", t.id, "points"), orderBy("recordedAt", "asc"))); return { id: t.id, startedAt: t.data().startedAt?.toDate?.()?.toISOString?.() ?? new Date().toISOString(), points: points.docs.map((p) => [p.data().lat as number, p.data().lng as number] as [number, number]) }; })); }
