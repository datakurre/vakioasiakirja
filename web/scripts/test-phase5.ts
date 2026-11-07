import assert from "node:assert/strict";
import test from "node:test";
import * as Y from "yjs";
import {
  handleCollabStatusError,
  renderCollabError,
  saveCollabToLocal,
  importLocalFileToCollab,
  openLocalFileInPersonal,
} from "../src/collab-editor.ts";
import { FileManager, createMemoryStorage, formatFileDate } from "../src/files.ts";

function setupMockDom() {
  const elements: Record<string, any> = {};
  const docListeners: Record<string, Function[]> = {};

  const createMockElement = (tag: string, initialId?: string) => {
    let currentId = initialId || "";
    let innerHtmlVal = "";
    const attrs: Record<string, string> = {};

    const el: any = {
      tagName: tag.toUpperCase(),
      hidden: false,
      style: {},
      className: "",
      textContent: "",
      children: [] as any[],
      dataset: {} as Record<string, string>,
      classList: {
        classes: new Set<string>(),
        add(c: string) {
          this.classes.add(c);
        },
        remove(c: string) {
          this.classes.delete(c);
        },
        contains(c: string) {
          return this.classes.has(c);
        },
        toggle(c: string, val?: boolean) {
          if (val === undefined) {
            if (this.classes.has(c)) this.classes.delete(c);
            else this.classes.add(c);
          } else if (val) {
            this.classes.add(c);
          } else {
            this.classes.delete(c);
          }
        },
      },
      setAttribute(name: string, val: string) {
        attrs[name] = String(val);
      },
      getAttribute(name: string) {
        return attrs[name] ?? null;
      },
      removeAttribute(name: string) {
        delete attrs[name];
      },
      hasAttribute(name: string) {
        return name in attrs;
      },
      appendChild(child: any) {
        this.children.push(child);
        return child;
      },
      contains(target: any) {
        if (target === this) return true;
        for (const child of this.children) {
          if (child.contains ? child.contains(target) : child === target) return true;
        }
        return false;
      },
      remove() {
        if (currentId && elements[currentId]) delete elements[currentId];
      },
      addEventListener(event: string, handler: Function) {
        this._listeners = this._listeners || {};
        this._listeners[event] = this._listeners[event] || [];
        this._listeners[event].push(handler);
      },
      click() {
        if (this._listeners?.click) {
          for (const h of this._listeners.click) h();
        }
      },
      focus() {
        (globalThis as any).document.activeElement = this;
      },
      showModal() {
        this.open = true;
        this.hidden = false;
        this.setAttribute("open", "");
      },
      close() {
        this.open = false;
        this.hidden = true;
        this.removeAttribute("open");
      },
    };

    Object.defineProperty(el, "id", {
      get() {
        return currentId;
      },
      set(val: string) {
        if (currentId && elements[currentId]) delete elements[currentId];
        currentId = val;
        if (val) elements[val] = el;
      },
    });

    Object.defineProperty(el, "innerHTML", {
      get() {
        return innerHtmlVal;
      },
      set(val: string) {
        innerHtmlVal = val;
        this.children = [];
        // If innerHTML contains id="...", register mock child elements
        const idMatches = val.matchAll(/id=["']([^"']+)["']/g);
        for (const match of idMatches) {
          const childId = match[1];
          if (!elements[childId]) {
            elements[childId] = createMockElement("div", childId);
          }
        }
      },
    });

    if (initialId) elements[initialId] = el;
    return el;
  };

  const body = createMockElement("body");
  const main = createMockElement("main");
  const banner = createMockElement("div", "viewer-banner");
  const status = createMockElement("div", "status");

  (globalThis as any).document = {
    body,
    activeElement: body,
    getElementById(id: string) {
      return elements[id] || null;
    },
    querySelector(sel: string) {
      if (sel === "main") return main;
      return null;
    },
    createElement(tag: string) {
      return createMockElement(tag);
    },
    addEventListener(event: string, handler: Function) {
      docListeners[event] = docListeners[event] || [];
      docListeners[event].push(handler);
    },
    dispatchEvent(event: any) {
      if (docListeners[event.type]) {
        for (const h of docListeners[event.type]) h(event);
      }
    },
  };

  (globalThis as any).window = {
    location: {
      hash: "#/edit/ROOM123/token1234567890123456",
      reload() {
        this.reloaded = true;
      },
      reloaded: false,
    },
    confirm: () => true,
    prompt: (_msg: string, def?: string) => def ?? "",
  };

  return { elements, body, main, banner, status, createMockElement };
}

test("handleCollabStatusError: HTTP 503 (Collab disabled) shows Finnish notice with return button", () => {
  setupMockDom();

  const handled = handleCollabStatusError(503);
  assert.equal(handled, true, "503 must be handled as an error");

  const errContainer = (globalThis as any).document.getElementById("collab-error-container");
  assert.ok(errContainer, "Error container must be rendered in DOM");
  assert.ok(
    errContainer.innerHTML.includes("Yhteistyöpalvelu on tilapäisesti pois käytöstä"),
    "Must display Finnish title indicating collab service is disabled",
  );
  assert.ok(
    errContainer.innerHTML.includes("Yhteistyöominaisuus ei ole käytettävissä"),
    "Must display Finnish explanation",
  );
  assert.ok(
    errContainer.innerHTML.includes("Palaa henkilökohtaiseen editoriin"),
    "Must offer button to return to personal editor",
  );

  const returnBtn = (globalThis as any).document.getElementById("return-personal-btn");
  assert.ok(returnBtn, "Return button element must exist");

  // Clicking return button redirects to personal editor
  returnBtn.click();
  assert.equal((globalThis as any).window.location.hash, "#/", "Hash must be reset to personal editor #/");
  assert.equal((globalThis as any).window.location.reloaded, true, "Window must reload");
});

test("handleCollabStatusError: HTTP 429 (Participant limit reached) shows Finnish capacity notice", () => {
  setupMockDom();

  const handled = handleCollabStatusError(429);
  assert.equal(handled, true, "429 must be handled as an error");

  const errContainer = (globalThis as any).document.getElementById("collab-error-container");
  assert.ok(errContainer, "Error container must be rendered in DOM");
  assert.ok(
    errContainer.innerHTML.includes("Huone on täynnä"),
    "Must display Finnish title indicating room is full",
  );
  assert.ok(
    errContainer.innerHTML.includes("enintään 20 osallistujaa"),
    "Must indicate 20-participant cap",
  );

  const returnBtn = (globalThis as any).document.getElementById("return-personal-btn");
  assert.ok(returnBtn, "Return button element must exist");
  returnBtn.click();
  assert.equal((globalThis as any).window.location.hash, "#/");
});

test("handleCollabStatusError: HTTP 404 & 401 handling", () => {
  setupMockDom();

  assert.equal(handleCollabStatusError(404), true);
  const err404 = (globalThis as any).document.getElementById("collab-error-container");
  assert.ok(err404.innerHTML.includes("Huonetta ei löydy"));

  assert.equal(handleCollabStatusError(401), true);
  const err401 = (globalThis as any).document.getElementById("collab-error-container");
  assert.ok(err401.innerHTML.includes("Virheellinen valtuutusavain"));

  // Status 200 should return false (not an error)
  assert.equal(handleCollabStatusError(200), false);
});

test("renderCollabError: direct invocation sets banner, status, and alert card", () => {
  setupMockDom();
  renderCollabError("Omavalintainen virheviesti", "Testiotsikko");

  const errContainer = (globalThis as any).document.getElementById("collab-error-container");
  assert.ok(errContainer);
  assert.ok(errContainer.innerHTML.includes("Testiotsikko"));
  assert.ok(errContainer.innerHTML.includes("Omavalintainen virheviesti"));

  const banner = (globalThis as any).document.getElementById("viewer-banner");
  assert.equal(banner.textContent, "Testiotsikko: Omavalintainen virheviesti");
});

test("saveCollabToLocal: saves collaborative document to FileManager (updating active file)", () => {
  const storage = createMemoryStorage();
  const fileManager = new FileManager({ storage, defaultSeed: "# Alkuperäinen teksti" });
  const activeBefore = fileManager.getActiveFile();
  assert.equal(activeBefore.name, "asiakirja.md");

  const ydoc = new Y.Doc();
  const ytext = ydoc.getText("content");
  ytext.insert(0, "# Yhteistyöhuone\n\nTämä on yhteismuokkauksesta tallennettu teksti.");

  const toasts: string[] = [];
  const saved = saveCollabToLocal(fileManager, ytext, "ROOM123", {
    asNewFile: false,
    toast: (msg) => toasts.push(msg),
  });

  assert.equal(saved.id, activeBefore.id);
  assert.equal(saved.name, "asiakirja.md");
  assert.equal(fileManager.getActiveFile().content, "# Yhteistyöhuone\n\nTämä on yhteismuokkauksesta tallennettu teksti.");
  assert.equal(fileManager.getFileContent(saved.id), ytext.toString());
  assert.equal(storage.getItem("sfs2487.doc"), ytext.toString());
  assert.equal(toasts.length, 1);
  assert.ok(toasts[0].includes("asiakirja.md"));
});

test("saveCollabToLocal: saves collaborative document to FileManager as a new named file", () => {
  const storage = createMemoryStorage();
  const fileManager = new FileManager({ storage });

  const ydoc = new Y.Doc();
  const ytext = ydoc.getText("content");
  ytext.insert(0, "# Uusi pöytäkirjaluonnos\n\nKokous alkoi klo 10:00.");

  const toasts: string[] = [];
  const created = saveCollabToLocal(fileManager, ytext, "ROOMABC", {
    asNewFile: true,
    customName: "kokous-muistiinpanot.md",
    toast: (msg) => toasts.push(msg),
  });

  assert.equal(created.name, "kokous-muistiinpanot.md");
  const files = fileManager.listFiles();
  assert.equal(files.length, 2);
  assert.ok(files.some((f) => f.name === "kokous-muistiinpanot.md"));
  assert.equal(fileManager.getFileContent(created.id), ytext.toString());
  assert.equal(toasts.length, 1);
  assert.ok(toasts[0].includes("kokous-muistiinpanot.md"));

  // Default naming fallback when customName is not provided
  const createdDefault = saveCollabToLocal(fileManager, ytext, "ROOMABC", {
    asNewFile: true,
  });
  assert.equal(createdDefault.name, "yhteistyo-ROOMABC.md");
});

test("importLocalFileToCollab: replaces collaborative room ytext with local file content and triggers toast", () => {
  const storage = createMemoryStorage();
  const fileManager = new FileManager({ storage });
  const localFile = fileManager.createFile("paikallinen.md", "# Paikallinen raportti\n\nTämä korvaa huoneen sisällön.");

  const ydoc = new Y.Doc();
  const ytext = ydoc.getText("content");
  ytext.insert(0, "# Vanha huoneen teksti\n\nPoistuu korvauksessa.");

  let changeEvents = 0;
  ytext.observe(() => {
    changeEvents++;
  });

  const toasts: string[] = [];
  let panelClosed = false;

  importLocalFileToCollab(
    localFile,
    fileManager,
    ydoc,
    ytext,
    (msg) => toasts.push(msg),
    () => {
      panelClosed = true;
    },
  );

  assert.equal(ytext.toString(), "# Paikallinen raportti\n\nTämä korvaa huoneen sisällön.");
  assert.ok(changeEvents > 0, "Y.Text observe event must fire so all collaborators receive update");
  assert.equal(toasts.length, 1);
  assert.ok(toasts[0].includes("paikallinen.md"));
  assert.equal(panelClosed, true, "Drawer panel must close after import");
});

test("openLocalFileInPersonal: sets active file in FileManager and navigates to #/", () => {
  setupMockDom();
  const storage = createMemoryStorage();
  const fileManager = new FileManager({ storage });
  const file2 = fileManager.createFile("toinen.md", "# Toinen tiedosto");

  (globalThis as any).window.location.hash = "#/edit/ROOM_XYZ/TOKEN_ABC";

  openLocalFileInPersonal(file2, fileManager);

  assert.equal(fileManager.getActiveFileId(), file2.id);
  assert.equal((globalThis as any).window.location.hash, "#/");
});

test("formatFileDate: formats today timestamps as HH:MM and older dates as D.M.", () => {
  const now = new Date();
  now.setHours(14, 30, 0, 0);
  assert.equal(formatFileDate(now.getTime()), "14:30");

  const older = new Date(2025, 2, 18, 10, 0, 0); // March 18, 2025
  assert.equal(formatFileDate(older.getTime()), "18.3.");

  assert.equal(formatFileDate(0), "");
});

test("Collab file drawer interaction: toggle, escape, and save local actions", () => {
  const dom = setupMockDom();
  const storage = createMemoryStorage();
  const fileManager = new FileManager({ storage, defaultSeed: "# Oma luonnos" });

  const filesToggle = dom.createMockElement("button", "files-toggle");
  const filesPanel = dom.createMockElement("div", "files-panel");
  filesPanel.hidden = true;
  const filesClose = dom.createMockElement("button", "files-close");
  const filesSaveCollab = dom.createMockElement("button", "files-save-collab");
  filesSaveCollab.hidden = true;
  const filesList = dom.createMockElement("ul", "files-list");
  const collabSaveLocalBtn = dom.createMockElement("button", "collab-save-local-btn");

  const ydoc = new Y.Doc();
  const ytext = ydoc.getText("content");
  ytext.insert(0, "# Yhteistyöasiakirja");

  const toasts: string[] = [];
  const toast = (m: string) => toasts.push(m);

  // Wire drawer toggling
  const syncFilesControls = () => {
    const open = !filesPanel.hidden;
    filesToggle.setAttribute("aria-expanded", String(open));
    filesToggle.setAttribute("aria-pressed", String(open));
  };

  const openFilesPanel = () => {
    filesPanel.hidden = false;
    syncFilesControls();
  };

  const closeFilesPanel = () => {
    filesPanel.hidden = true;
    syncFilesControls();
  };

  filesToggle.addEventListener("click", () => {
    if (filesPanel.hidden) openFilesPanel();
    else closeFilesPanel();
  });
  filesClose.addEventListener("click", () => closeFilesPanel());

  // Test opening drawer
  assert.equal(filesPanel.hidden, true);
  filesToggle.click();
  assert.equal(filesPanel.hidden, false);
  assert.equal(filesToggle.getAttribute("aria-expanded"), "true");

  // Test closing drawer
  filesClose.click();
  assert.equal(filesPanel.hidden, true);
  assert.equal(filesToggle.getAttribute("aria-expanded"), "false");

  // Test Escape keydown closes drawer
  openFilesPanel();
  assert.equal(filesPanel.hidden, false);
  (globalThis as any).document.addEventListener("keydown", (e: any) => {
    if (e.key === "Escape" && !filesPanel.hidden) {
      closeFilesPanel();
    }
  });
  (globalThis as any).document.dispatchEvent({ type: "keydown", key: "Escape" });
  assert.equal(filesPanel.hidden, true);

  // Test banner button saves to FileManager
  collabSaveLocalBtn.addEventListener("click", () => {
    saveCollabToLocal(fileManager, ytext, "ROOM999", { asNewFile: false, toast });
  });
  collabSaveLocalBtn.click();
  assert.equal(fileManager.getActiveFile().content, "# Yhteistyöasiakirja");
  assert.ok(toasts.some((t) => t.includes("asiakirja.md")));

  // Test files-save-collab saves as new file
  filesSaveCollab.addEventListener("click", () => {
    saveCollabToLocal(fileManager, ytext, "ROOM999", {
      asNewFile: true,
      customName: "tallennettu-huone.md",
      toast,
    });
  });
  filesSaveCollab.click();
  assert.ok(fileManager.listFiles().some((f) => f.name === "tallennettu-huone.md"));

  // Verify file list rendering in drawer
  for (const file of fileManager.listFiles()) {
    const li = dom.createMockElement("li");
    li.textContent = file.name;
    filesList.appendChild(li);
  }
  assert.ok(filesList.children.length >= 2);
});

