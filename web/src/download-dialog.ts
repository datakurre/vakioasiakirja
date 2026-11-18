import { exportToDocx, downloadDocxFile } from "./docx.ts";
import type { ToastType } from "./ui.ts";

export interface DownloadDialogOptions {
  dialogEl?: HTMLDialogElement | null;
  getMarkdown: () => string;
  getFilenameBase: () => string;
  onDownloadPdf: () => Promise<void> | void;
  toast?: (message: string, type?: ToastType) => void;
  fail?: (message: string) => void;
}

export function downloadMarkdownFile(content: string, fileName: string): void {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export class DownloadDialog {
  private dialog: HTMLDialogElement | null;
  private closeBtn: HTMLButtonElement | null;
  private cancelBtn: HTMLButtonElement | null;
  private pdfBtn: HTMLButtonElement | null;
  private docxBtn: HTMLButtonElement | null;
  private mdBtn: HTMLButtonElement | null;
  private options: DownloadDialogOptions;

  constructor(options: DownloadDialogOptions) {
    this.options = options;
    this.dialog =
      options.dialogEl ??
      (document.getElementById("download-dialog") as HTMLDialogElement | null);
    this.closeBtn =
      (this.dialog?.querySelector("#download-dialog-close") as HTMLButtonElement | null) ??
      (document.getElementById("download-dialog-close") as HTMLButtonElement | null);
    this.cancelBtn =
      (this.dialog?.querySelector("#download-dialog-cancel") as HTMLButtonElement | null) ??
      (document.getElementById("download-dialog-cancel") as HTMLButtonElement | null);
    this.pdfBtn =
      (this.dialog?.querySelector("#download-format-pdf") as HTMLButtonElement | null) ??
      (document.getElementById("download-format-pdf") as HTMLButtonElement | null);
    this.docxBtn =
      (this.dialog?.querySelector("#download-format-docx") as HTMLButtonElement | null) ??
      (document.getElementById("download-format-docx") as HTMLButtonElement | null);
    this.mdBtn =
      (this.dialog?.querySelector("#download-format-md") as HTMLButtonElement | null) ??
      (document.getElementById("download-format-md") as HTMLButtonElement | null);

    this.bindEvents();
  }

  private bindEvents(): void {
    this.closeBtn?.addEventListener("click", () => this.close());
    this.cancelBtn?.addEventListener("click", () => this.close());

    this.dialog?.addEventListener("click", (e) => {
      if (e.target === this.dialog) {
        this.close();
      }
    });

    this.dialog?.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        this.close();
      }
    });

    this.dialog?.addEventListener("cancel", (e) => {
      e.preventDefault();
      this.close();
    });

    this.pdfBtn?.addEventListener("click", async () => {
      this.close();
      try {
        await this.options.onDownloadPdf();
      } catch (err) {
        this.options.fail?.(err instanceof Error ? err.message : String(err));
      }
    });

    this.docxBtn?.addEventListener("click", () => {
      this.close();
      try {
        const md = this.options.getMarkdown();
        const baseName = this.options.getFilenameBase() || "asiakirja";
        const docxBytes = exportToDocx(md);
        downloadDocxFile(docxBytes, `${baseName}.docx`);
        this.options.toast?.(`Asiakirja ladattu Word-muodossa (${baseName}.docx).`, "success");
      } catch (err) {
        this.options.fail?.(err instanceof Error ? err.message : String(err));
      }
    });

    this.mdBtn?.addEventListener("click", () => {
      this.close();
      try {
        const md = this.options.getMarkdown();
        const baseName = this.options.getFilenameBase() || "asiakirja";
        downloadMarkdownFile(md, `${baseName}.md`);
        this.options.toast?.(`Asiakirja ladattu Markdown-muodossa (${baseName}.md).`, "success");
      } catch (err) {
        this.options.fail?.(err instanceof Error ? err.message : String(err));
      }
    });
  }

  open(): void {
    if (!this.dialog) return;
    if (typeof this.dialog.showModal === "function") {
      if (!this.dialog.open) {
        this.dialog.showModal();
      }
    } else {
      this.dialog.setAttribute("open", "");
    }
    this.pdfBtn?.focus();
  }

  close(): void {
    if (!this.dialog) return;
    if (typeof this.dialog.close === "function") {
      if (this.dialog.open) {
        this.dialog.close();
      }
    } else {
      this.dialog.removeAttribute("open");
    }
  }

  isOpen(): boolean {
    return Boolean(this.dialog?.open);
  }
}
