// Small UI helpers shared by the editor (src/editor.ts) and the read-only
// viewer (src/viewer.ts): the icon sprite reference, base64 codecs for moving
// logo bytes through JSON/localStorage, and the transient error toast.

// Build a <use> reference to an icon in the inline sprite (see index.html).
export function iconSvg(id: string, doc: Document = typeof document !== "undefined" ? document : (globalThis as any).document): SVGSVGElement {
  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "icon");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const use = doc.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#${id}`);
  svg.appendChild(use);
  return svg;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  const chunk = 0x8000; // avoid exceeding the argument limit of String.fromCharCode
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}

export function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes;
}

// Errors and status updates land in a transient bottom-right toast instead of the status bar:
// compiler and connection messages can be long and multi-line, and inlining
// them would reflow the bar. The toast is dismissable by mouse, its close button, or Escape.
// Returns a `toast(message, type?)` bound to the given container.
export type ToastType = "error" | "success" | "info" | "warning";

export interface Toaster {
  (message: string, type?: ToastType): void;
  clearErrors(): void;
  clear(type?: ToastType): void;
}

export function createToaster(toastsEl: HTMLElement): Toaster {
  function toast(message: string, type?: ToastType) {
    let resolvedType = type;
    if (!resolvedType) {
      if (/luotu|kopioitu|tallennettu|tuotu|onnistui|lisätty/i.test(message) && !/epäonnistui/i.test(message)) {
        resolvedType = "success";
      } else {
        resolvedType = "error";
      }
    }

    const doc = toastsEl.ownerDocument ?? (typeof document !== "undefined" ? document : (globalThis as any).document);
    const el = doc.createElement("div");
    el.className = `toast toast-${resolvedType}`;
    el.setAttribute("role", resolvedType === "error" ? "alert" : "status");

    const msg = doc.createElement("div");
    msg.className = "toast-message";
    msg.textContent = message;

    const close = doc.createElement("button");
    close.type = "button";
    close.className = "iconbtn toast-close";
    close.setAttribute("aria-label", "Sulje ilmoitus");
    close.title = "Sulje";
    close.appendChild(iconSvg("i-close", doc));

    let timer: any = 0;
    const remove = () => {
      clearTimeout(timer);
      el.classList.add("leaving");
      setTimeout(() => el.remove(), 300);
    };
    close.addEventListener("click", remove);
    el.addEventListener("keydown", (e) => {
      if (e.key === "Escape") remove();
    });
    // Auto-dismiss after a while; the fade is handled by the `.leaving` class.
    timer = setTimeout(remove, 10000);

    el.append(msg, close);
    toastsEl.appendChild(el);
  }

  toast.clearErrors = () => {
    const errorToasts = toastsEl.querySelectorAll(".toast-error, [role='alert']");
    for (const el of errorToasts) {
      el.remove();
    }
  };

  toast.clear = (type?: ToastType) => {
    const selector = type ? `.toast-${type}` : ".toast";
    const toasts = toastsEl.querySelectorAll(selector);
    for (const el of toasts) {
      el.remove();
    }
  };

  return toast;
}
