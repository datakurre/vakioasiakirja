// Branding and white-labeling configuration for the SFS 2487 web editor.
// Supports custom colors, header title/subtitle, favicon, meta theme-color,
// and association SVG logo.

export interface BrandColors {
  headerBg?: string;
  headerText?: string;
  statusbarBg?: string;
  statusbarBorder?: string;
  accent?: string;
  focusOutline?: string;
  controlActiveBg?: string;
  previewBackdrop?: string;
  panelBg?: string;
}

export interface BundledLogo {
  path: string;
  name: string;
  svgText: string;
}

export interface BrandingConfig {
  title?: string;
  subtitle?: string;
  shortName?: string;
  themeColor?: string;
  colors?: BrandColors;
  defaultLogo?: BundledLogo;
}

// Default vector SVG logo for standard documents (Organisaatio Oy).
export const DEFAULT_ASSOCIATION_LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 50" width="240" height="50">
  <g transform="translate(10, 25)">
    <circle cx="10" cy="0" r="10" fill="#0288d1" fill-opacity="0.8" />
    <circle cx="20" cy="0" r="10" fill="#1976d2" fill-opacity="0.8" />
    <circle cx="30" cy="0" r="10" fill="#0d47a1" fill-opacity="0.8" />
    <text x="50" y="6" font-family="system-ui, -apple-system, sans-serif" font-size="18" font-weight="bold" fill="#0d47a1">Organisaatio Oy</text>
  </g>
</svg>`;

export const DEFAULT_BRANDING: BrandingConfig = {
  title: "SFS 2487:2024",
  subtitle: " – Markdown → PDF",
  shortName: "SFS 2487",
  themeColor: "#37474f",
  colors: {
    headerBg: "#37474f",
    headerText: "#ffffff",
    statusbarBg: "#263238",
    statusbarBorder: "#455a64",
    accent: "#1976d2",
    focusOutline: "#90caf9",
    controlActiveBg: "#546e7a",
    previewBackdrop: "#e0e0e0",
    panelBg: "#37474f",
  },
  defaultLogo: {
    path: "/logo.svg",
    name: "Organisaatio Oy (logo.svg)",
    svgText: DEFAULT_ASSOCIATION_LOGO_SVG,
  },
};

/**
 * Returns the active branding configuration, allowing overrides from
 * window.__ASSOCIATION_CONFIG__ (injected via association.config.ts or vite plugin).
 */
export function getActiveBranding(): BrandingConfig {
  if (typeof window !== "undefined" && (window as any).__ASSOCIATION_CONFIG__) {
    const custom = (window as any).__ASSOCIATION_CONFIG__ as Partial<BrandingConfig>;
    return {
      title: custom.title ?? DEFAULT_BRANDING.title,
      subtitle: custom.subtitle ?? DEFAULT_BRANDING.subtitle,
      shortName: custom.shortName ?? DEFAULT_BRANDING.shortName,
      themeColor: custom.themeColor ?? DEFAULT_BRANDING.themeColor,
      colors: {
        ...DEFAULT_BRANDING.colors,
        ...custom.colors,
      },
      defaultLogo: custom.defaultLogo ?? DEFAULT_BRANDING.defaultLogo,
    };
  }
  return DEFAULT_BRANDING;
}

/**
 * Applies branding colors to CSS custom properties and updates DOM title/meta tags.
 */
export function applyBranding(branding: BrandingConfig = getActiveBranding()): void {
  if (typeof document === "undefined") return;

  const root = document.documentElement;
  const colors = branding.colors || {};

  if (colors.headerBg) root.style.setProperty("--brand-header-bg", colors.headerBg);
  if (colors.headerText) root.style.setProperty("--brand-header-text", colors.headerText);
  if (colors.statusbarBg) root.style.setProperty("--brand-statusbar-bg", colors.statusbarBg);
  if (colors.statusbarBorder) root.style.setProperty("--brand-statusbar-border", colors.statusbarBorder);
  if (colors.accent) root.style.setProperty("--brand-accent", colors.accent);
  if (colors.focusOutline) root.style.setProperty("--brand-focus-outline", colors.focusOutline);
  if (colors.controlActiveBg) root.style.setProperty("--brand-control-active-bg", colors.controlActiveBg);
  if (colors.previewBackdrop) root.style.setProperty("--brand-preview-bg", colors.previewBackdrop);
  if (colors.panelBg) root.style.setProperty("--brand-panel-bg", colors.panelBg);

  if (branding.themeColor) {
    let metaTheme = document.querySelector('meta[name="theme-color"]');
    if (!metaTheme) {
      metaTheme = document.createElement("meta");
      metaTheme.setAttribute("name", "theme-color");
      document.head.appendChild(metaTheme);
    }
    metaTheme.setAttribute("content", branding.themeColor);
  }

  // Update header DOM elements
  const brandTitleEl = document.getElementById("brand-title");
  if (brandTitleEl && branding.title) {
    brandTitleEl.textContent = branding.title;
  }
  const brandSubtitleEl = document.getElementById("brand-subtitle");
  if (brandSubtitleEl && branding.subtitle !== undefined) {
    brandSubtitleEl.textContent = branding.subtitle;
  }

  if (branding.title) {
    document.title = `${branding.title}${branding.subtitle ? ` – ${branding.subtitle.replace(/^[–\- ]+/, "")}` : ""}`;
  }
}
