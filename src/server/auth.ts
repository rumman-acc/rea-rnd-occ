import crypto from "node:crypto";
import type { Store } from "./store";
import { now, nowIso } from "./clock";

// Stub authentication (SPEC-FULL decision D8). A signed cookie and a seeded user list.
// This is demo-grade: do not use it to protect real data.

export const SESSION_COOKIE = "occ_session";
const SESSION_TTL_SECONDS = 8 * 60 * 60;

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

interface StoredUser extends SessionUser {
  salt: string;
  hash: string;
}

const USERS_KEY = "auth:users";
const RESETS_KEY = "auth:resets";

function secret(): string {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  if (process.env.NODE_ENV === "production") {
    throw new Error("AUTH_SECRET must be set in production");
  }
  return "dev-only-secret-change-me";
}

function hashPassword(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 32).toString("hex");
}

function seedUsers(): StoredUser[] {
  const mk = (id: string, email: string, name: string, role: string): StoredUser => {
    const salt = crypto.createHash("sha256").update(`seed:${id}`).digest("hex").slice(0, 16);
    return { id, email, name, role, salt, hash: hashPassword("demo1234", salt) };
  };
  return [
    mk("u-admin", "alex.morgan@example.com", "Alex Morgan", "Admin"),
    mk("u-planner", "pat.planner@example.com", "Pat Planner", "Planner"),
    mk("u-buyer", "bo.buyer@example.com", "Bo Buyer", "Buyer"),
  ];
}

export const DEMO_CREDENTIALS = { email: "alex.morgan@example.com", password: "demo1234" };

const publicUser = (u: StoredUser): SessionUser => ({ id: u.id, email: u.email, name: u.name, role: u.role });

export function authenticate(store: Store, email: string, password: string): SessionUser | null {
  const users = store.get(USERS_KEY, seedUsers);
  const u = users.find((x) => x.email.toLowerCase() === email.trim().toLowerCase());
  if (!u) return null;
  const a = Buffer.from(hashPassword(password, u.salt), "hex");
  const b = Buffer.from(u.hash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? publicUser(u) : null;
}

export function listUsers(store: Store): SessionUser[] {
  return store.get(USERS_KEY, seedUsers).map(publicUser);
}

const b64 = (s: string) => Buffer.from(s).toString("base64url");
const sign = (payload: string) => crypto.createHmac("sha256", secret()).update(payload).digest("base64url");

/** Cookie value for a signed-in user. */
export function createSessionValue(user: SessionUser, nowMs = Date.parse(nowIso())): string {
  const payload = b64(JSON.stringify({ user, exp: Math.floor(nowMs / 1000) + SESSION_TTL_SECONDS }));
  return `${payload}.${sign(payload)}`;
}

export function verifySessionValue(value: string | undefined, nowMs = now().getTime()): SessionUser | null {
  if (!value) return null;
  const [payload, sig] = value.split(".");
  if (!payload || !sig) return null;
  const expected = sign(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const { user, exp } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { user: SessionUser; exp: number };
    return exp * 1000 > nowMs ? user : null;
  } catch {
    return null;
  }
}

export function cookieFromHeader(header: string | null, name = SESSION_COOKIE): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return undefined;
}

export function getSessionUser(req: Request): SessionUser | null {
  return verifySessionValue(cookieFromHeader(req.headers.get("cookie")));
}

export function sessionCookieHeader(value: string, maxAge = SESSION_TTL_SECONDS): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

/** Password-reset tokens. There is no email delivery: the token is returned to the caller (demo only). */
export function createResetToken(store: Store, email: string): string | null {
  const user = store.get(USERS_KEY, seedUsers).find((x) => x.email.toLowerCase() === email.trim().toLowerCase());
  if (!user) return null;
  const token = crypto.randomBytes(16).toString("hex");
  store.update<Record<string, string>>(RESETS_KEY, () => ({}), (d) => {
    d[token] = user.id;
  });
  return token;
}

export function resetPassword(store: Store, token: string, password: string): boolean {
  const resets = store.get<Record<string, string>>(RESETS_KEY, () => ({}));
  const userId = resets[token];
  if (!userId) return false;
  store.update<StoredUser[]>(USERS_KEY, seedUsers, (users) => {
    const u = users.find((x) => x.id === userId);
    if (u) {
      u.salt = crypto.randomBytes(8).toString("hex");
      u.hash = hashPassword(password, u.salt);
    }
  });
  store.update<Record<string, string>>(RESETS_KEY, () => ({}), (d) => {
    delete d[token];
  });
  return true;
}
