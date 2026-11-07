// Example association configuration for downstream web editor distribution.
// Copy this file to association.config.ts in your association repository.

export interface TemplateDefinition {
  id: string;
  title: string;
  description: string;
  doctype: string;
  filePath: string;
  logoSvg?: string;
  defaultFileName: string;
}

export interface AssociationConfig {
  meta: {
    title: string;
    subtitle: string;
    shortName: string;
    description: string;
    lang: string;
  };
  branding: {
    logoSvgPath: string;
    faviconPath: string;
    themeColor: string;
    colors: {
      headerBg: string;
      headerText: string;
      statusbarBg: string;
      statusbarBorder: string;
      accent: string;
      focusOutline: string;
      controlActiveBg: string;
      previewBackdrop: string;
      panelBg: string;
    };
  };
  associationDetails: {
    name: string;
    businessId?: string;
    addressLines: string[];
    email?: string;
    website?: string;
  };
  templates: TemplateDefinition[];
}

export const config: AssociationConfig = {
  meta: {
    title: "Malliyhdistys ry – Asiakirjat",
    subtitle: " – SFS 2487:2024 -asiakirjaeditori",
    shortName: "Malliyhdistys",
    description: "Malliyhdistys ry:n virallisten asiakirjojen laadintatyökalu.",
    lang: "fi",
  },
  branding: {
    logoSvgPath: "assets/logo.svg",
    faviconPath: "assets/favicon.svg",
    themeColor: "#1e3a8a",
    colors: {
      headerBg: "#1e3a8a",
      headerText: "#ffffff",
      statusbarBg: "#0f172a",
      statusbarBorder: "#334155",
      accent: "#2563eb",
      focusOutline: "#60a5fa",
      controlActiveBg: "#1d4ed8",
      previewBackdrop: "#e2e8f0",
      panelBg: "#1e293b",
    },
  },
  associationDetails: {
    name: "Malliyhdistys ry",
    businessId: "1234567-8",
    addressLines: ["Yhdistyskatu 1 A", "00100 Helsinki"],
    email: "hallitus@malliyhdistys.fi",
    website: "https://malliyhdistys.fi",
  },
  templates: [
    {
      id: "hallitus-poytakirja",
      title: "Hallituksen pöytäkirja",
      description: "SFS 2487:2024 -standardin mukainen kokouspöytäkirja.",
      doctype: "PÖYTÄKIRJA",
      filePath: "templates/hallitus-poytakirja.md",
      defaultFileName: "hallituksen-poytakirja.md",
    },
    {
      id: "syyskokous-kutsu",
      title: "Kokouskutsu ja esityslista",
      description: "Virallinen yhdistyskokouskutsu ja asialista.",
      doctype: "KOKOUSKUTSU",
      filePath: "templates/syyskokous-kutsu.md",
      defaultFileName: "syyskokous-kutsu.md",
    },
    {
      id: "toimintakertomus",
      title: "Toimintakertomus",
      description: "Monisivuinen vuosikertomus väliotsikoilla ja liitetaulukoilla.",
      doctype: "TOIMINTAKERTOMUS",
      filePath: "templates/toimintakertomus.md",
      defaultFileName: "toimintakertomus.md",
    },
    {
      id: "muistio",
      title: "Muistio",
      description: "Lyhyt sisäinen muistio tai tiedote.",
      doctype: "MUISTIO",
      filePath: "templates/muistio.md",
      defaultFileName: "muistio.md",
    },
  ],
};
