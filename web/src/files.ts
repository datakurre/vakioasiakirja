// Local file manager for SFS 2487 documents: multi-file management,
// localStorage persistence, legacy doc migration, and active file tracking.

export interface FileMeta {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

export interface DocumentFile extends FileMeta {
  content: string;
}

export interface StorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const FILE_STORAGE_KEYS = {
  FILES_INDEX: "sfs2487.files",
  ACTIVE_FILE_ID: "sfs2487.activeFileId",
  LEGACY_DOC: "sfs2487.doc",
  FILE_CONTENT_PREFIX: "sfs2487.file.",
} as const;

/**
 * Creates an in-memory storage adapter, useful for tests or fallback.
 */
export function createMemoryStorage(): StorageAdapter {
  const store = new Map<string, string>();
  return {
    getItem(key: string): string | null {
      return store.has(key) ? store.get(key)! : null;
    },
    setItem(key: string, value: string): void {
      store.set(key, String(value));
    },
    removeItem(key: string): void {
      store.delete(key);
    },
  };
}

/**
 * Wraps a storage adapter with in-memory fallback in case localStorage
 * throws (e.g. QuotaExceededError or SecurityError in sandboxed contexts).
 */
export function createSafeStorage(underlying?: StorageAdapter): StorageAdapter {
  const mem = new Map<string, string>();
  return {
    getItem(key: string): string | null {
      try {
        if (underlying) {
          const val = underlying.getItem(key);
          if (val !== null) return val;
        }
      } catch {
        /* ignore */
      }
      return mem.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      try {
        if (underlying) underlying.setItem(key, value);
      } catch {
        /* quota or disabled */
      }
      mem.set(key, value);
    },
    removeItem(key: string): void {
      try {
        if (underlying) underlying.removeItem(key);
      } catch {
        /* ignore */
      }
      mem.delete(key);
    },
  };
}

export interface FileManagerOptions {
  storage?: StorageAdapter;
  defaultSeed?: string;
}

export class FileManager {
  private storage: StorageAdapter;
  private defaultSeed: string;
  private files: FileMeta[] = [];
  private activeId: string = "";

  private indexDirty = false;
  private persistTimer: any = null;

  constructor(options?: FileManagerOptions) {
    const rawStorage =
      options?.storage ??
      (typeof localStorage !== "undefined" ? localStorage : undefined);
    this.storage = createSafeStorage(rawStorage);
    this.defaultSeed = options?.defaultSeed ?? "";
    this.init();
  }

  private init(): void {
    const rawIndex = this.storage.getItem(FILE_STORAGE_KEYS.FILES_INDEX);
    if (rawIndex) {
      try {
        const parsed = JSON.parse(rawIndex);
        if (Array.isArray(parsed) && parsed.length > 0) {
          this.files = parsed.map((item: any) => ({
            id: String(item.id),
            name: String(item.name || "asiakirja.md"),
            createdAt: Number(item.createdAt) || Date.now(),
            updatedAt: Number(item.updatedAt) || Date.now(),
          }));

          // Recover any content embedded in index entries if sfs2487.file.<id> is missing
          for (const item of parsed) {
            const key = FILE_STORAGE_KEYS.FILE_CONTENT_PREFIX + item.id;
            if (item.content && this.storage.getItem(key) === null) {
              this.storage.setItem(key, String(item.content));
            }
          }
        }
      } catch {
        this.files = [];
      }
    }

    // Migration from legacy single document or first-time setup
    if (this.files.length === 0) {
      const legacyDoc = this.storage.getItem(FILE_STORAGE_KEYS.LEGACY_DOC);
      const initialContent = legacyDoc !== null ? legacyDoc : this.defaultSeed;
      const initialId = this.generateId();
      const now = Date.now();
      const initialFile: FileMeta = {
        id: initialId,
        name: "asiakirja.md",
        createdAt: now,
        updatedAt: now,
      };
      this.files = [initialFile];
      this.storage.setItem(
        FILE_STORAGE_KEYS.FILE_CONTENT_PREFIX + initialId,
        initialContent
      );
      this.persistIndex();
      this.storage.setItem(FILE_STORAGE_KEYS.ACTIVE_FILE_ID, initialId);
      this.storage.setItem(FILE_STORAGE_KEYS.LEGACY_DOC, initialContent);
      this.activeId = initialId;
      return;
    }

    // Validate or restore active file ID
    const storedActiveId = this.storage.getItem(FILE_STORAGE_KEYS.ACTIVE_FILE_ID);
    if (storedActiveId && this.files.some((f) => f.id === storedActiveId)) {
      this.activeId = storedActiveId;
    } else {
      this.activeId = this.files[0].id;
      this.storage.setItem(FILE_STORAGE_KEYS.ACTIVE_FILE_ID, this.activeId);
    }
  }

  listFiles(): FileMeta[] {
    return [...this.files];
  }

  getActiveFileId(): string {
    return this.activeId;
  }

  getFileContent(id: string): string {
    const content = this.storage.getItem(FILE_STORAGE_KEYS.FILE_CONTENT_PREFIX + id);
    if (content !== null) return content;
    if (id === this.activeId) {
      const doc = this.storage.getItem(FILE_STORAGE_KEYS.LEGACY_DOC);
      if (doc !== null) return doc;
    }
    return this.defaultSeed;
  }

  getFile(id: string): DocumentFile | undefined {
    const meta = this.files.find((f) => f.id === id);
    if (!meta) return undefined;
    return {
      ...meta,
      content: this.getFileContent(meta.id),
    };
  }

  getActiveFile(): DocumentFile {
    const meta = this.files.find((f) => f.id === this.activeId) ?? this.files[0];
    return {
      ...meta,
      content: this.getFileContent(meta.id),
    };
  }

  setActiveFile(id: string): DocumentFile {
    const meta = this.files.find((f) => f.id === id);
    if (!meta) {
      throw new Error(`Tiedostoa id:llä "${id}" ei löytynyt.`);
    }
    this.activeId = id;
    this.storage.setItem(FILE_STORAGE_KEYS.ACTIVE_FILE_ID, id);
    const content = this.getFileContent(id);
    this.storage.setItem(FILE_STORAGE_KEYS.LEGACY_DOC, content);
    this.persistIndex();
    return {
      ...meta,
      content,
    };
  }

  saveActiveContent(content: string): void {
    if (!this.activeId) return;
    this.storage.setItem(
      FILE_STORAGE_KEYS.FILE_CONTENT_PREFIX + this.activeId,
      content
    );
    this.storage.setItem(FILE_STORAGE_KEYS.LEGACY_DOC, content);
    const file = this.files.find((f) => f.id === this.activeId);
    if (file) {
      file.updatedAt = Date.now();
      this.schedulePersistIndex();
    }
  }

  createFile(name?: string, content?: string): DocumentFile {
    let fileName: string;
    if (name && name.trim()) {
      let trimmed = name.trim();
      if (!trimmed.includes(".")) {
        trimmed += ".md";
      }
      const collision = this.files.find(
        (f) => f.name.toLowerCase() === trimmed.toLowerCase()
      );
      if (collision) {
        throw new Error(`Tiedostonimi "${trimmed}" on jo käytössä.`);
      }
      fileName = trimmed;
    } else {
      fileName = this.suggestFileName();
    }
    const fileContent = content !== undefined ? content : this.defaultSeed;
    const id = this.generateId();
    const now = Date.now();
    const meta: FileMeta = {
      id,
      name: fileName,
      createdAt: now,
      updatedAt: now,
    };
    this.files.push(meta);
    this.storage.setItem(FILE_STORAGE_KEYS.FILE_CONTENT_PREFIX + id, fileContent);
    this.persistIndex();
    this.setActiveFile(id);
    return {
      ...meta,
      content: fileContent,
    };
  }

  renameFile(id: string, newName: string): FileMeta {
    let trimmed = newName.trim();
    if (!trimmed) {
      throw new Error("Tiedostonimi ei voi olla tyhjä.");
    }
    if (!trimmed.includes(".")) {
      trimmed += ".md";
    }
    const meta = this.files.find((f) => f.id === id);
    if (!meta) {
      throw new Error(`Tiedostoa id:llä "${id}" ei löytynyt.`);
    }
    const collision = this.files.find(
      (f) => f.id !== id && f.name.toLowerCase() === trimmed.toLowerCase()
    );
    if (collision) {
      throw new Error(`Tiedostonimi "${trimmed}" on jo käytössä.`);
    }
    meta.name = trimmed;
    meta.updatedAt = Date.now();
    this.persistIndex();
    return { ...meta };
  }

  deleteFile(id: string): { activeFile: DocumentFile; deletedId: string } {
    const index = this.files.findIndex((f) => f.id === id);
    if (index === -1) {
      throw new Error(`Tiedostoa id:llä "${id}" ei löytynyt.`);
    }

    if (this.files.length === 1) {
      // Last remaining file: create fresh default file so a valid file always exists
      this.deleteFileInternal(id);
      const fresh = this.createFile("asiakirja.md", this.defaultSeed);
      return { activeFile: fresh, deletedId: id };
    }

    const wasActive = this.activeId === id;
    this.deleteFileInternal(id);

    if (wasActive) {
      const newActiveMeta = this.files[Math.min(index, this.files.length - 1)];
      const activeFile = this.setActiveFile(newActiveMeta.id);
      return { activeFile, deletedId: id };
    }

    return { activeFile: this.getActiveFile(), deletedId: id };
  }

  resetActiveFile(seed?: string): DocumentFile {
    const content = seed !== undefined ? seed : this.defaultSeed;
    this.saveActiveContent(content);
    return this.getActiveFile();
  }

  suggestFileName(base = "asiakirja.md"): string {
    const existing = new Set(this.files.map((f) => f.name.toLowerCase()));
    if (!existing.has(base.toLowerCase())) return base;
    const extMatch = base.match(/^(.*?)(\.[^.]*)?$/);
    const nameWithoutExt = extMatch ? extMatch[1] : base;
    const ext = extMatch && extMatch[2] ? extMatch[2] : "";
    let counter = 2;
    while (existing.has(`${nameWithoutExt}-${counter}${ext}`.toLowerCase())) {
      counter++;
    }
    return `${nameWithoutExt}-${counter}${ext}`;
  }

  private deleteFileInternal(id: string) {
    this.files = this.files.filter((f) => f.id !== id);
    this.storage.removeItem(FILE_STORAGE_KEYS.FILE_CONTENT_PREFIX + id);
    this.persistIndex();
  }

  private schedulePersistIndex(): void {
    this.indexDirty = true;
    if (this.persistTimer !== null) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      if (this.indexDirty) {
        this.persistIndex();
      }
    }, 1000);
    if (typeof this.persistTimer?.unref === "function") {
      this.persistTimer.unref();
    }
  }

  private persistIndex(): void {
    if (this.persistTimer !== null) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    this.indexDirty = false;
    this.storage.setItem(FILE_STORAGE_KEYS.FILES_INDEX, JSON.stringify(this.files));
  }

  private generateId(): string {
    return (
      "f-" +
      Date.now().toString(36) +
      "-" +
      Math.random().toString(36).slice(2, 7)
    );
  }
}
