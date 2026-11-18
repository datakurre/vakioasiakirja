// Template modal dialog manager for selecting document archetypes.

import { getDocumentTemplates, type DocumentTemplate } from "./templates.ts";

export interface TemplateDialogOptions {
  dialogEl: HTMLDialogElement;
  closeEl: HTMLButtonElement;
  cancelEl: HTMLButtonElement;
  replaceEl?: HTMLButtonElement | null;
  gridEl: HTMLElement;
  onSelectTemplate: (template: DocumentTemplate) => void;
  onReplace?: () => void;
}

export class TemplateManager {
  private dialogEl: HTMLDialogElement;
  private closeEl: HTMLButtonElement;
  private cancelEl: HTMLButtonElement;
  private replaceEl?: HTMLButtonElement | null;
  private gridEl: HTMLElement;
  private onSelectTemplate: (template: DocumentTemplate) => void;
  private onReplace?: () => void;

  constructor(options: TemplateDialogOptions) {
    this.dialogEl = options.dialogEl;
    this.closeEl = options.closeEl;
    this.cancelEl = options.cancelEl;
    this.replaceEl =
      options.replaceEl ??
      (options.dialogEl.querySelector("#template-dialog-replace") as HTMLButtonElement | null);
    this.gridEl = options.gridEl;
    this.onSelectTemplate = options.onSelectTemplate;
    this.onReplace = options.onReplace;

    this.init();
  }

  private init(): void {
    this.closeEl.addEventListener("click", () => this.close());
    this.cancelEl.addEventListener("click", () => this.close());
    this.replaceEl?.addEventListener("click", () => {
      this.close();
      this.onReplace?.();
    });

    this.dialogEl.addEventListener("click", (event) => {
      // Backdrop click closes dialog
      if (event.target === this.dialogEl) {
        this.close();
      }
    });

    this.renderTemplates();
  }

  renderTemplates(): void {
    const templates = getDocumentTemplates();
    this.gridEl.innerHTML = "";

    for (const t of templates) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "template-card";
      card.setAttribute("data-template-id", t.id);
      card.setAttribute("role", "listitem");

      const badge = document.createElement("span");
      badge.className = "template-badge";
      badge.textContent = t.doctype;

      const title = document.createElement("h3");
      title.className = "template-card-title";
      title.textContent = t.title;

      const desc = document.createElement("p");
      desc.className = "template-card-desc";
      desc.textContent = t.description;

      if (t.logoSvg) {
        const logo = document.createElement("img");
        logo.className = "template-card-logo";
        logo.alt = "";
        logo.setAttribute("aria-hidden", "true");
        logo.src = `data:image/svg+xml,${encodeURIComponent(t.logoSvg)}`;
        card.appendChild(logo);
      }
      card.appendChild(badge);
      card.appendChild(title);
      card.appendChild(desc);

      card.addEventListener("click", () => {
        this.close();
        this.onSelectTemplate(t);
      });

      this.gridEl.appendChild(card);
    }
  }

  open(): void {
    if (typeof this.dialogEl.showModal === "function") {
      this.dialogEl.showModal();
    } else {
      (this.dialogEl as any).setAttribute("open", "");
    }
  }

  close(): void {
    if (typeof this.dialogEl.close === "function") {
      this.dialogEl.close();
    } else {
      (this.dialogEl as any).removeAttribute("open");
    }
  }

  isOpen(): boolean {
    return this.dialogEl.open;
  }
}
