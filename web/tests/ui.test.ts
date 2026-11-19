import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createToaster } from "../src/ui.ts";

test("Toaster: creates toasts with proper classes and roles", () => {
  const dom = new JSDOM(`<!DOCTYPE html><html><body><div id="toasts"></div></body></html>`);
  const toastsEl = dom.window.document.getElementById("toasts")!;
  const toast = createToaster(toastsEl);

  toast("Tallennettu onnistuneesti", "success");
  assert.equal(toastsEl.children.length, 1);
  const successToast = toastsEl.firstElementChild as HTMLElement;
  assert.ok(successToast.classList.contains("toast-success"));
  assert.equal(successToast.getAttribute("role"), "status");

  toast("Virheellinen otsake", "error");
  assert.equal(toastsEl.children.length, 2);
  const errorToast = toastsEl.lastElementChild as HTMLElement;
  assert.ok(errorToast.classList.contains("toast-error"));
  assert.equal(errorToast.getAttribute("role"), "alert");
});

test("Toaster: clearErrors() removes error toasts while preserving success and info toasts", () => {
  const dom = new JSDOM(`<!DOCTYPE html><html><body><div id="toasts"></div></body></html>`);
  const toastsEl = dom.window.document.getElementById("toasts")!;
  const toast = createToaster(toastsEl);

  toast("Tallennus onnistui", "success");
  toast("Virhe frontmatterissa: unclosed quote", "error");
  toast("Huomio: luonnos tila", "info");
  assert.equal(toastsEl.children.length, 3);

  toast.clearErrors();

  assert.equal(toastsEl.children.length, 2);
  const remainingClasses = Array.from(toastsEl.children).map((el) => el.className);
  assert.ok(remainingClasses.some((c) => c.includes("toast-success")));
  assert.ok(remainingClasses.some((c) => c.includes("toast-info")));
  assert.ok(!remainingClasses.some((c) => c.includes("toast-error")));
});

test("Toaster: clear() removes all or typed toasts", () => {
  const dom = new JSDOM(`<!DOCTYPE html><html><body><div id="toasts"></div></body></html>`);
  const toastsEl = dom.window.document.getElementById("toasts")!;
  const toast = createToaster(toastsEl);

  toast("Eka", "info");
  toast("Toka", "info");
  toast("Kolmas", "success");
  assert.equal(toastsEl.children.length, 3);

  toast.clear("info");
  assert.equal(toastsEl.children.length, 1);
  assert.ok(toastsEl.firstElementChild?.classList.contains("toast-success"));

  toast.clear();
  assert.equal(toastsEl.children.length, 0);
});
