import assert from "node:assert/strict";
import test from "node:test";
import {
  handleCollabStatusError,
  renderCollabError,
} from "../src/collab-editor.ts";

function setupMockDom() {
  const elements: Record<string, any> = {};

  const createMockElement = (tag: string, initialId?: string) => {
    let currentId = initialId || "";
    let innerHtmlVal = "";
    const el: any = {
      tagName: tag.toUpperCase(),
      hidden: false,
      style: {},
      className: "",
      textContent: "",
      children: [] as any[],
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
      setAttribute(_name: string, _val: string) {},
      getAttribute(_name: string) {
        return null;
      },
      removeAttribute(_name: string) {},
      appendChild(child: any) {
        this.children.push(child);
        return child;
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
  };

  (globalThis as any).window = {
    location: {
      hash: "#/edit/ROOM123/token1234567890123456",
      reload() {
        this.reloaded = true;
      },
      reloaded: false,
    },
  };

  return { elements, body, main, banner, status };
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
