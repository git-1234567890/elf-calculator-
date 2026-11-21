import { initializeApp } from "firebase/app";
import {
  GoogleAuthProvider,
  User,
  getAuth,
  signInWithPopup,
  signOut,
} from "firebase/auth";
import {
  Timestamp,
  Unsubscribe,
  collection,
  doc,
  getDoc,
  getDocFromServer,
  getFirestore,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import firebaseConfig from "../../firebase-applet-config.json";

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

export enum OperationType {
  CREATE = "create",
  UPDATE = "update",
  DELETE = "delete",
  LIST = "list",
  GET = "get",
  WRITE = "write",
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error("Firestore Error: ", JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, "test", "connection"));
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("the client is offline")
    ) {
      console.error("Please check your Firebase configuration.");
    }
  }
}
testConnection();

export interface LeaderboardEntryRecord {
  id: string;
  uid: string;
  displayName: string;
  puzzleId: number;
  steps: number;
  parSteps: number;
  createdAtMs: number;
  updatedAtMs: number;
}

export async function signInWithGoogle(): Promise<User> {
  const provider = new GoogleAuthProvider();
  const cred = await signInWithPopup(auth, provider);
  return cred.user;
}

export async function signOutUser(): Promise<void> {
  await signOut(auth);
}

export function sanitizeDisplayName(raw?: string | null, uid?: string): string {
  const cleaned = (raw ?? "").trim().replace(/\s+/g, " ");
  if (cleaned.length >= 1) {
    return cleaned.slice(0, 60);
  }
  const suffix = uid ? uid.slice(0, 6) : "Elf";
  return `Elf ${suffix}`.slice(0, 60);
}

function toTimestampMs(val: unknown): number {
  if (val instanceof Timestamp) return val.toMillis();
  if (
    val &&
    typeof val === "object" &&
    "toMillis" in val &&
    typeof (val as { toMillis: () => number }).toMillis === "function"
  ) {
    return (val as { toMillis: () => number }).toMillis();
  }
  return Date.now();
}

export async function submitLeaderboardScore(params: {
  puzzleId: number;
  steps: number;
  parSteps: number;
  displayNameOverride?: string;
}): Promise<"created" | "updated" | "unchanged"> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error("Sign in with Google to publish scores to the leaderboard.");
  }
  if (!user.emailVerified) {
    throw new Error("A verified Google account email is required to submit scores.");
  }

  const puzzleId = Math.trunc(params.puzzleId);
  const steps = Math.trunc(params.steps);
  const parSteps = Math.max(1, Math.min(500, Math.trunc(params.parSteps)));

  if (puzzleId < 1 || puzzleId > 1000) {
    throw new Error("Only standard puzzles #1–#1000 can be submitted.");
  }
  if (steps < 1 || steps > 500) {
    throw new Error("Program length must be between 1 and 500 instructions.");
  }

  const uid = user.uid;
  const entryId = `${puzzleId}_${uid}`;
  const path = `leaderboardEntries/${entryId}`;
  const docRef = doc(db, "leaderboardEntries", entryId);
  const displayName = sanitizeDisplayName(
    params.displayNameOverride || user.displayName,
    uid
  );

  let existingSnap;
  try {
    existingSnap = await getDoc(docRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }

  if (!existingSnap.exists()) {
    try {
      await setDoc(docRef, {
        uid,
        displayName,
        puzzleId,
        steps,
        parSteps,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return "created";
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  } else {
    const existingData = existingSnap.data();
    const prevSteps =
      typeof existingData.steps === "number" ? existingData.steps : Infinity;
    const prevName =
      typeof existingData.displayName === "string"
        ? existingData.displayName
        : "";

    if (steps >= prevSteps && displayName === prevName) {
      return "unchanged";
    }

    const nextBestSteps = Math.min(prevSteps, steps);
    try {
      await updateDoc(docRef, {
        displayName,
        steps: nextBestSteps,
        parSteps,
        updatedAt: serverTimestamp(),
      });
      return "updated";
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  }
}

function mapSnapshotDoc(
  id: string,
  data: Record<string, unknown>
): LeaderboardEntryRecord | null {
  if (
    typeof data.uid !== "string" ||
    typeof data.displayName !== "string" ||
    typeof data.puzzleId !== "number" ||
    typeof data.steps !== "number" ||
    typeof data.parSteps !== "number"
  ) {
    return null;
  }
  return {
    id,
    uid: data.uid,
    displayName: data.displayName,
    puzzleId: data.puzzleId,
    steps: data.steps,
    parSteps: data.parSteps,
    createdAtMs: toTimestampMs(data.createdAt),
    updatedAtMs: toTimestampMs(data.updatedAt),
  };
}

export function subscribePuzzleLeaderboard(
  puzzleId: number,
  onData: (entries: LeaderboardEntryRecord[]) => void,
  onError: (err: Error) => void
): Unsubscribe {
  const path = "leaderboardEntries";
  const q = query(
    collection(db, path),
    where("puzzleId", "==", puzzleId),
    limit(100)
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const list: LeaderboardEntryRecord[] = [];
      snapshot.forEach((docSnap) => {
        const mapped = mapSnapshotDoc(docSnap.id, docSnap.data());
        if (mapped) list.push(mapped);
      });
      list.sort((a, b) => {
        if (a.steps !== b.steps) return a.steps - b.steps;
        return a.updatedAtMs - b.updatedAtMs;
      });
      onData(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export function subscribeGlobalLeaderboard(
  onData: (entries: LeaderboardEntryRecord[]) => void,
  onError: (err: Error) => void
): Unsubscribe {
  const path = "leaderboardEntries";
  const q = query(
    collection(db, path),
    where("puzzleId", ">=", 1),
    where("puzzleId", "<=", 1000),
    limit(300)
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const list: LeaderboardEntryRecord[] = [];
      snapshot.forEach((docSnap) => {
        const mapped = mapSnapshotDoc(docSnap.id, docSnap.data());
        if (mapped) list.push(mapped);
      });
      onData(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}
