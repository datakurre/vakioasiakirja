// Template modal dialog manager for selecting document archetypes.

import { getDocumentTemplates, type DocumentTemplate } from "./templates.ts";

export interface TemplateDialogOptions {
  dialogEl: HTMLDialogElement;
  closeEl: HTMLButtonElement;
  cancelEl: HTMLButtonElement;
  gridEl: HTMLElement;
  onSelectTemplate: (template: DocumentTemplate) => void;
}

export class TemplateManager {
  private dialogEl: HTMLDialogElement;
  private closeEl: HTMLButtonElement;
  private cancelEl: HTMLButtonElement;
  private gridEl: HTMLElement;
  private onSelectTemplate: (template: DocumentTemplate) => void;

  constructor(options: TemplateDialogOptions) {
    this.dialogEl = options.dialogEl;
    this.closeEl = options.closeEl;
    this.cancelEl = options.cancelEl;
    this.gridEl = options.gridEl;
    this.onSelectTemplate = options.onSelectTemplate;

    this.init();
  }

  private init(): void {
    this.closeEl.addEventListener("click", () => this.close());
    this.cancelEl.addEventListener("click", () => this.close());

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
