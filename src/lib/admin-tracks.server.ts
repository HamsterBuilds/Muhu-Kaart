import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

let deleting = false;
export async function deleteServerTracks(request: Request): Promise<Response> {
  const reply = (message: string, status: number) => Response.json({message}, {status});
  if (request.method !== "POST") return reply("Method not allowed",405);
  const bearer = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!bearer) return reply("Sign in first",401);
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!projectId || (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON && !process.env.GOOGLE_APPLICATION_CREDENTIALS)) {
    return reply("Server administrator credentials have not been configured",503);
  }
  const app = getApps().find(a=>a.name === "track-admin") ?? initializeApp({
    projectId,
    credential: process.env.FIREBASE_SERVICE_ACCOUNT_JSON
      ? cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)) : applicationDefault(),
  },"track-admin");
  try {
    const token = await getAuth(app).verifyIdToken(bearer,true);
    if (token.email !== "hamsterbuildsee@gmail.com" || !token.email_verified || token.firebase.sign_in_provider !== "google.com") {
      return reply("Only the designated verified Google account may perform this action",403);
    }
  } catch { return reply("Invalid or expired sign-in",401); }
  if (Number(request.headers.get("content-length") ?? 0) > 1024) return reply("Invalid request",400);
  const body = await request.json().catch(()=>null);
  if (body?.confirmation !== "DELETE ALL TRACKS") return reply("Explicit confirmation required",400);
  if (deleting) return reply("A deletion is already running",409);
  deleting = true;
  try {
    const database = getFirestore(app);
    await database.recursiveDelete(database.collection("tracks"));
    await database.doc("tracks/_placeholder").set({});
    return reply("Server tracks deleted; local device copies were not changed",200);
  } catch {
    return reply("Deletion did not complete. Some tracks may have been deleted; retry to finish.",500);
  } finally { deleting = false; }
}
