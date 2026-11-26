import type { NotesPage } from "./types";

export function notesPageKey(cursor: string | undefined, query: string, folderId: string | null | undefined) {
  return JSON.stringify([cursor ?? null, query.trim(), folderId === undefined, folderId ?? null]);
}

// Session-only summaries: bounded memory, short freshness window, no note bodies.
export class NotesPageCache {
  private pages = new Map<string, { data: NotesPage; expiresAt: number }>();
  private revision = 0;
  private pendingWrites = 0;

  get version() { return this.revision; }

  read(key: string, now = Date.now()) {
    const page = this.pages.get(key);
    if (this.pendingWrites || !page || page.expiresAt <= now) return undefined;
    return page.data;
  }

  write(key: string, data: NotesPage, version = this.revision, now = Date.now()) {
    if (this.pendingWrites || version !== this.revision) return;
    this.pages.delete(key);
    this.pages.set(key, { data, expiresAt: now + 60_000 });
    if (this.pages.size > 24) this.pages.delete(this.pages.keys().next().value!);
  }

  invalidate() {
    this.revision += 1;
    this.pages.clear();
  }

  async mutate<T>(operation: () => Promise<T>): Promise<T> {
    this.pendingWrites += 1;
    this.invalidate();
    try {
      return await operation();
    } finally {
      this.pendingWrites -= 1;
      this.invalidate();
    }
  }
}
