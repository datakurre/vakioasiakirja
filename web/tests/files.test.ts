import test from "node:test";
import assert from "node:assert/strict";
import {
  FileManager,
  createMemoryStorage,
  FILE_STORAGE_KEYS,
  createSafeStorage,
} from "../src/files.ts";

test("FileManager: first-time setup initializes default asiakirja.md with seed", () => {
  const storage = createMemoryStorage();
  const seed = "# Oletusasiakirja\n\nTekstiä tähän.";
  const fm = new FileManager({ storage, defaultSeed: seed });

  const files = fm.listFiles();
  assert.equal(files.length, 1);
  assert.equal(files[0].name, "asiakirja.md");

  const active = fm.getActiveFile();
  assert.equal(active.id, files[0].id);
  assert.equal(active.name, "asiakirja.md");
  assert.equal(active.content, seed);

  // Storage should contain the index, active file ID, file content, and legacy doc key
  assert.ok(storage.getItem(FILE_STORAGE_KEYS.FILES_INDEX));
  assert.equal(storage.getItem(FILE_STORAGE_KEYS.ACTIVE_FILE_ID), active.id);
  assert.equal(storage.getItem(FILE_STORAGE_KEYS.FILE_CONTENT_PREFIX + active.id), seed);
  assert.equal(storage.getItem(FILE_STORAGE_KEYS.LEGACY_DOC), seed);
});

test("FileManager: migrates legacy single document from sfs2487.doc seamlessly", () => {
  const storage = createMemoryStorage();
  const legacyContent = "# Vanha pöytäkirja\n\nKokous alkoi klo 10:00.";
  storage.setItem(FILE_STORAGE_KEYS.LEGACY_DOC, legacyContent);

  const fm = new FileManager({ storage, defaultSeed: "# Default" });

  const files = fm.listFiles();
  assert.equal(files.length, 1);
  assert.equal(files[0].name, "asiakirja.md");

  const active = fm.getActiveFile();
  assert.equal(active.content, legacyContent);
  assert.equal(
    storage.getItem(FILE_STORAGE_KEYS.FILE_CONTENT_PREFIX + active.id),
    legacyContent
  );
  assert.equal(storage.getItem(FILE_STORAGE_KEYS.LEGACY_DOC), legacyContent);
});

test("FileManager: active file tracking and content saving", () => {
  const storage = createMemoryStorage();
  const fm = new FileManager({ storage, defaultSeed: "Alku" });

  const active = fm.getActiveFile();
  assert.equal(active.content, "Alku");

  // Save new content
  fm.saveActiveContent("Päivitetty teksti");
  assert.equal(fm.getActiveFile().content, "Päivitetty teksti");
  assert.equal(
    storage.getItem(FILE_STORAGE_KEYS.FILE_CONTENT_PREFIX + active.id),
    "Päivitetty teksti"
  );
  assert.equal(storage.getItem(FILE_STORAGE_KEYS.LEGACY_DOC), "Päivitetty teksti");
});

test("FileManager: file creation with unique name suggestion and custom naming", () => {
  const storage = createMemoryStorage();
  const fm = new FileManager({ storage, defaultSeed: "Pohja" });

  // Default initial is asiakirja.md
  assert.equal(fm.listFiles()[0].name, "asiakirja.md");

  // Create second file without name -> should suggest asiakirja-2.md
  const file2 = fm.createFile();
  assert.equal(file2.name, "asiakirja-2.md");
  assert.equal(file2.content, "Pohja");
  assert.equal(fm.getActiveFileId(), file2.id);
  assert.equal(fm.listFiles().length, 2);

  // Create third file with custom name and custom content
  const file3 = fm.createFile("kokouskutsu.md", "# Kokouskutsu");
  assert.equal(file3.name, "kokouskutsu.md");
  assert.equal(file3.content, "# Kokouskutsu");
  assert.equal(fm.getActiveFileId(), file3.id);
  assert.equal(fm.listFiles().length, 3);

  // Auto-appends .md if omitted
  const file4 = fm.createFile("muistio");
  assert.equal(file4.name, "muistio.md");
  assert.equal(fm.listFiles().length, 4);

  // Rejects duplicate file name
  assert.throws(
    () => fm.createFile("asiakirja.md"),
    /jo käytössä/
  );
  assert.throws(
    () => fm.createFile("muistio.md"),
    /jo käytössä/
  );
});

test("FileManager: file switching updates activeId and syncs content", () => {
  const storage = createMemoryStorage();
  const fm = new FileManager({ storage, defaultSeed: "Seed 1" });

  const file1 = fm.getActiveFile();
  const file2 = fm.createFile("tarjous.md", "Tarjousdokumentti");

  assert.equal(fm.getActiveFileId(), file2.id);

  // Switch back to file 1
  const switched = fm.setActiveFile(file1.id);
  assert.equal(switched.id, file1.id);
  assert.equal(fm.getActiveFileId(), file1.id);
  assert.equal(storage.getItem(FILE_STORAGE_KEYS.ACTIVE_FILE_ID), file1.id);
  assert.equal(storage.getItem(FILE_STORAGE_KEYS.LEGACY_DOC), file1.content);
});

test("FileManager: file renaming validates names and checks for collisions", () => {
  const storage = createMemoryStorage();
  const fm = new FileManager({ storage, defaultSeed: "Alku" });
  const file1 = fm.getActiveFile();
  const file2 = fm.createFile("poytakirja.md", "Sisältö");

  // Valid rename
  const renamed = fm.renameFile(file1.id, "uusi-nimi.md");
  assert.equal(renamed.name, "uusi-nimi.md");
  assert.equal(fm.getFile(file1.id)?.name, "uusi-nimi.md");

  // Auto-appends .md if omitted
  const autoExt = fm.renameFile(file1.id, "muistio");
  assert.equal(autoExt.name, "muistio.md");

  // Rejects empty name
  assert.throws(() => fm.renameFile(file1.id, "   "), /tyhjä/);

  // Rejects collision with another file
  assert.throws(
    () => fm.renameFile(file1.id, "poytakirja.md"),
    /jo käytössä/
  );
});

test("FileManager: file deletion handling (non-active, active, and last remaining)", () => {
  const storage = createMemoryStorage();
  const fm = new FileManager({ storage, defaultSeed: "Seed" });

  const file1 = fm.getActiveFile();
  const file2 = fm.createFile("tiedosto-2.md", "Content 2");
  const file3 = fm.createFile("tiedosto-3.md", "Content 3");

  assert.equal(fm.getActiveFileId(), file3.id);
  assert.equal(fm.listFiles().length, 3);

  // 1. Delete non-active file (file2)
  const delNonActive = fm.deleteFile(file2.id);
  assert.equal(delNonActive.deletedId, file2.id);
  assert.equal(delNonActive.activeFile.id, file3.id);
  assert.equal(fm.getActiveFileId(), file3.id);
  assert.equal(fm.listFiles().length, 2);
  assert.equal(storage.getItem(FILE_STORAGE_KEYS.FILE_CONTENT_PREFIX + file2.id), null);

  // 2. Delete active file (file3) -> should switch active to remaining file
  const delActive = fm.deleteFile(file3.id);
  assert.equal(delActive.deletedId, file3.id);
  assert.equal(delActive.activeFile.id, file1.id);
  assert.equal(fm.getActiveFileId(), file1.id);
  assert.equal(fm.listFiles().length, 1);

  // 3. Delete last remaining file -> should create fresh default file
  const delLast = fm.deleteFile(file1.id);
  assert.equal(delLast.deletedId, file1.id);
  assert.notEqual(delLast.activeFile.id, file1.id);
  assert.equal(delLast.activeFile.name, "asiakirja.md");
  assert.equal(fm.listFiles().length, 1);
  assert.equal(fm.getActiveFileId(), delLast.activeFile.id);
});

test("FileManager: resetActiveFile resets content to seed", () => {
  const storage = createMemoryStorage();
  const fm = new FileManager({ storage, defaultSeed: "Oletus" });

  fm.saveActiveContent("Muokattu sisältö");
  assert.equal(fm.getActiveFile().content, "Muokattu sisältö");

  fm.resetActiveFile("Palautettu");
  assert.equal(fm.getActiveFile().content, "Palautettu");
  assert.equal(storage.getItem(FILE_STORAGE_KEYS.LEGACY_DOC), "Palautettu");
});

test("createSafeStorage: gracefully falls back to memory if storage throws", () => {
  const failingStorage = {
    getItem() {
      throw new Error("SecurityError");
    },
    setItem() {
      throw new Error("QuotaExceededError");
    },
    removeItem() {
      throw new Error("SecurityError");
    },
  };

  const safe = createSafeStorage(failingStorage);
  safe.setItem("testKey", "testValue");
  assert.equal(safe.getItem("testKey"), "testValue");
  safe.removeItem("testKey");
  assert.equal(safe.getItem("testKey"), null);
});
