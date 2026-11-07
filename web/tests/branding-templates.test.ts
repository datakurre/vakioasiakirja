import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

import {
  DEFAULT_BRANDING,
  getActiveBranding,
  applyBranding,
  type BrandingConfig,
} from "../src/branding.ts";
import {
  BUILTIN_TEMPLATES,
  getDocumentTemplates,
  getTemplateById,
} from "../src/templates.ts";
import { TemplateManager } from "../src/template-manager.ts";

test("branding: getActiveBranding returns defaults when no override present", () => {
  const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>");
  (global as any).window = dom.window;
  (global as any).document = dom.window.document;

  const branding = getActiveBranding();
  assert.equal(branding.title, "SFS 2487:2024");
  assert.equal(branding.themeColor, "#37474f");
  assert.equal(branding.colors?.headerBg, "#37474f");
  assert.ok(branding.defaultLogo?.svgText.includes("<svg"));
});

test("branding: getActiveBranding picks up window.__ASSOCIATION_CONFIG__", () => {
  const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>");
  (global as any).window = dom.window;
  (global as any).document = dom.window.document;

  (dom.window as any).__ASSOCIATION_CONFIG__ = {
    title: "Yhdistys ry",
    subtitle: " – Asiakirjat",
    themeColor: "#1e3a8a",
    colors: {
      headerBg: "#1e3a8a",
      accent: "#2563eb",
    },
  };

  const branding = getActiveBranding();
  assert.equal(branding.title, "Yhdistys ry");
  assert.equal(branding.themeColor, "#1e3a8a");
  assert.equal(branding.colors?.headerBg, "#1e3a8a");
  // Inherits unchanged defaults
  assert.equal(branding.colors?.statusbarBg, DEFAULT_BRANDING.colors?.statusbarBg);
});

test("branding: applyBranding updates document title, meta tags and CSS custom properties", () => {
  const dom = new JSDOM(`
    <!doctype html>
    <html>
      <head>
        <title>Old Title</title>
        <meta name="theme-color" content="#000000" />
      </head>
      <body>
        <span id="brand-title">Old Title</span>
        <span id="brand-subtitle">Old Sub</span>
      </body>
    </html>
  `);
  (global as any).window = dom.window;
  (global as any).document = dom.window.document;

  const custom: BrandingConfig = {
    title: "Malliyhdistys ry",
    subtitle: " – Asiakirjaeditori",
    themeColor: "#0f766e",
    colors: {
      headerBg: "#0f766e",
      headerText: "#ffffff",
      statusbarBg: "#134e4a",
      accent: "#14b8a6",
    },
  };

  applyBranding(custom);

  assert.equal(dom.window.document.title, "Malliyhdistys ry – Asiakirjaeditori");
  const metaTheme = dom.window.document.querySelector('meta[name="theme-color"]');
  assert.equal(metaTheme?.getAttribute("content"), "#0f766e");

  assert.equal(dom.window.document.getElementById("brand-title")?.textContent, "Malliyhdistys ry");
  assert.equal(dom.window.document.getElementById("brand-subtitle")?.textContent, " – Asiakirjaeditori");

  const rootStyle = dom.window.document.documentElement.style;
  assert.equal(rootStyle.getPropertyValue("--brand-header-bg"), "#0f766e");
  assert.equal(rootStyle.getPropertyValue("--brand-statusbar-bg"), "#134e4a");
  assert.equal(rootStyle.getPropertyValue("--brand-accent"), "#14b8a6");
});

test("templates: builtin templates cover core document archetypes", () => {
  const templates = getDocumentTemplates();
  assert.ok(templates.length >= 6);

  const poytakirja = getTemplateById("poytakirja");
  assert.ok(poytakirja);
  assert.equal(poytakirja.doctype, "PÖYTÄKIRJA");
  assert.ok(poytakirja.content.includes("doctype:"));

  const kokouskutsu = getTemplateById("kokouskutsu");
  assert.ok(kokouskutsu);
  assert.equal(kokouskutsu.doctype, "KOKOUSKUTSU");

  const tarjous = getTemplateById("tarjous");
  assert.ok(tarjous);
  assert.equal(tarjous.doctype, "TARJOUS");

  const tyhja = getTemplateById("tyhja");
  assert.ok(tyhja);
  assert.equal(tyhja.doctype, "ASIAKIRJA");
});

test("template manager: renders cards and triggers onSelectTemplate", () => {
  const dom = new JSDOM(`
    <!doctype html>
    <html>
      <body>
        <dialog id="template-dialog">
          <button id="template-dialog-close"></button>
          <div id="template-dialog-grid"></div>
          <button id="template-dialog-cancel"></button>
        </dialog>
      </body>
    </html>
  `);
  (global as any).window = dom.window;
  (global as any).document = dom.window.document;

  const dialogEl = dom.window.document.getElementById("template-dialog") as HTMLDialogElement;
  const closeEl = dom.window.document.getElementById("template-dialog-close") as HTMLButtonElement;
  const cancelEl = dom.window.document.getElementById("template-dialog-cancel") as HTMLButtonElement;
  const gridEl = dom.window.document.getElementById("template-dialog-grid")!;

  // Mock showModal / close for jsdom
  let isModalOpen = false;
  dialogEl.showModal = () => { isModalOpen = true; (dialogEl as any).open = true; };
  dialogEl.close = () => { isModalOpen = false; (dialogEl as any).open = false; };

  let selectedTemplate: any = null;
  const mgr = new TemplateManager({
    dialogEl,
    closeEl,
    cancelEl,
    gridEl,
    onSelectTemplate: (tpl) => {
      selectedTemplate = tpl;
    },
  });

  const cards = gridEl.querySelectorAll(".template-card");
  assert.ok(cards.length >= 6, `Expected at least 6 template cards, got ${cards.length}`);

  mgr.open();
  assert.equal(isModalOpen, true);

  // Click on the kokouskutsu card
  const kokouskutsuBtn = gridEl.querySelector<HTMLButtonElement>('[data-template-id="kokouskutsu"]')!;
  assert.ok(kokouskutsuBtn);
  kokouskutsuBtn.click();

  assert.equal(isModalOpen, false);
  assert.ok(selectedTemplate);
  assert.equal(selectedTemplate.id, "kokouskutsu");
  assert.equal(selectedTemplate.doctype, "KOKOUSKUTSU");
});

test("templates: custom templates via window.__ASSOCIATION_TEMPLATES__ with custom logoSvg", () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  (global as any).window = dom.window;

  const customLogoSvg = '<svg id="custom-logo"><circle r="10" /></svg>';
  (dom.window as any).__ASSOCIATION_TEMPLATES__ = [
    {
      id: "custom-yhdistys-poytakirja",
      title: "Yhdistyksen virallinen pöytäkirja",
      description: "Yhdistyksen oma pöytäkirjapohja omalla logolla.",
      doctype: "PÖYTÄKIRJA",
      defaultFileName: "yhdistys-poytakirja.md",
      content: "---\ndoctype: Pöytäkirja\ntitle: Kokous\n---\n\n# 1. Avaus",
      logoSvg: customLogoSvg,
    },
  ];

  const templates = getDocumentTemplates();
  assert.equal(templates.length, 1);
  assert.equal(templates[0].id, "custom-yhdistys-poytakirja");
  assert.equal(templates[0].logoSvg, customLogoSvg);

  const tpl = getTemplateById("custom-yhdistys-poytakirja");
  assert.ok(tpl);
  assert.equal(tpl.logoSvg, customLogoSvg);
});
