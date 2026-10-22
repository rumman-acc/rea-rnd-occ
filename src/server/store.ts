import fs from "node:fs";
import path from "node:path";

/**
 * Document store behind the whole backend (SPEC-FULL ARC-F01).
 *
 * Every module owns the keys that start with its own prefix ("sales:", "sop:", ...).
 * `get` and `update` hand out deep copies, so callers never mutate shared state by
 * accident. A key is seeded lazily the first time it is read.
 *
 * Two implementations: in-memory (tests) and file-backed (the running app). Both sit
 * behind this interface so a database can replace them without touching modules.
 */
export interface Store {
  /** Deep copy of the stored value; seeds the key with `seed()` the first time. */
  get<T>(key: string, seed: () => T): T;
  /** Replace the value. */
  set<T>(key: string, value: T): void;
  /** Read-modify-write. `fn` mutates the draft (and may return a result); the draft is persisted. */
  update<T, R = void>(key: string, seed: () => T, fn: (draft: T) => R): R;
  has(key: string): boolean;
  keys(): string[];
  /** Drop everything (used by backup restore and tests). */
  clear(): void;
  /** Complete deep copy of all documents (used by backups). */
  snapshot(): Record<string, unknown>;
  /** Replace all documents with a snapshot. */
  restore(snapshot: Record<string, unknown>): void;
}

class MapStore implements Store {
  protected data = new Map<string, unknown>();

  protected persist(): void {}

  get<T>(key: string, seed: () => T): T {
    if (!this.data.has(key)) {
      this.data.set(key, structuredClone(seed()));
      this.persist();
    }
    return structuredClone(this.data.get(key) as T);
  }

  set<T>(key: string, value: T): void {
    this.data.set(key, structuredClone(value));
    this.persist();
  }

  update<T, R = void>(key: string, seed: () => T, fn: (draft: T) => R): R {
    const draft = this.get(key, seed);
    const result = fn(draft);
    this.data.set(key, structuredClone(draft));
    this.persist();
    return result;
  }

  has(key: string): boolean {
    return this.data.has(key);
  }

  keys(): string[] {
    return [...this.data.keys()].sort();
  }

  clear(): void {
    this.data.clear();
    this.persist();
  }

  snapshot(): Record<string, unknown> {
    return structuredClone(Object.fromEntries(this.data));
  }

  restore(snapshot: Record<string, unknown>): void {
    this.data = new Map(Object.entries(structuredClone(snapshot)));
    this.persist();
  }
}

export function createMemoryStore(): Store {
  return new MapStore();
}

class FileStore extends MapStore {
  constructor(private readonly file: string) {
    super();
    try {
      const raw = fs.readFileSync(file, "utf8");
      this.data = new Map(Object.entries(JSON.parse(raw) as Record<string, unknown>));
    } catch {
      // No file yet (or unreadable): start empty; modules seed lazily.
    }
  }

  protected override persist(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.data)));
    fs.renameSync(tmp, this.file);
  }
}

export function createFileStore(dir: string): Store {
  return new FileStore(path.join(dir, "store.json"));
}

type Holder = { __occStore?: Store };

/** Process-wide store. Survives dev hot reloads. Directory: APP_DATA_DIR or ./.data */
export function getStore(): Store {
  const g = globalThis as Holder;
  if (!g.__occStore) {
    g.__occStore = createFileStore(process.env.APP_DATA_DIR ?? path.join(process.cwd(), ".data"));
  }
  return g.__occStore;
}

/** Replace the process-wide store (tests). Pass undefined to reset. */
export function setStore(store: Store | undefined): void {
  (globalThis as Holder).__occStore = store;
}
