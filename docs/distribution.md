# Deploying the Web Editor for an Organization or Association

This guide explains how to package, brand, and independently deploy the **SFS 2487:2024 web editor** and its **Cloudflare signaling worker** for your own association or organization with your own GitHub and Cloudflare accounts.

---

## 1. Overview of the Distribution Model

The distribution provides a standalone, white-labeled web application and real-time collaboration backend:

- **Frontend SPA (`web/`)**: A fast, browser-only Markdown editor with live SFS 2487:2024 PDF compilation via Typst WebAssembly. It runs entirely client-side and is hosted on **Cloudflare Pages**.
- **Signaling & Collaboration Worker (`signaling/`)**: A lightweight Cloudflare Worker using Durable Objects (`Room` for WebRTC live preview broadcasts, `CollabRoom` for Yjs CRDT real-time collaborative editing) with persistent SQLite storage.
- **Branding & Theming**: Full control over top bar title, mobile theme color, favicon, CSS custom properties, and association vector SVG logos.
- **Selectable Templates**: Customizable document creation modal offering prefilled association templates (e.g., meeting minutes, invitations with agendas, reports, quotations) with bundled logos.
- **Strict CORS**: The signaling worker rejects any origin outside your own organization's domains.

---

## 2. Downstream Repository Layout

When setting up your association's repository (e.g. `yhdistys-asiakirjat`), structure it as follows:

```
yhdistys-asiakirjat/
├── .github/
│   └── workflows/
│       ├── deploy-pages.yml       # Automated Cloudflare Pages deployment
│       └── deploy-signaling.yml   # Automated Cloudflare Workers deployment
├── association.config.ts          # Central branding & templates configuration
├── templates/                     # Association Markdown document templates
│   ├── hallitus-poytakirja.md
│   ├── syyskokous-kutsu.md
│   ├── toimintakertomus.md
│   └── muistio.md
├── assets/                        # Brand assets
│   ├── logo.svg                   # Default vector logo for Typst documents
│   ├── favicon.svg                # Browser tab icon
│   └── icon-512.png               # Mobile PWA icon
├── web/                           # Standalone Vite Frontend SPA
│   ├── index.html
│   ├── vite.config.ts
│   ├── package.json
│   ├── public/
│   │   └── fonts/                 # Bundled TeX Gyre fonts
│   └── src/                       # Application source
└── signaling/                     # Cloudflare Worker Signaling & Yjs DO
    ├── wrangler.toml              # Worker bindings & migrations
    ├── package.json
    └── src/                       # Worker source
```

A complete reference configuration is provided in `association.config.example.ts` in the repository root.

---

## 3. Configuring Branding & Templates

### 3.1 `association.config.ts`

Create `association.config.ts` in your repository root to define brand identity, colors, and templates:

```typescript
export const config = {
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
      headerBg: "#1e3a8a",         // Top header bar
      headerText: "#ffffff",
      statusbarBg: "#0f172a",      // Bottom status bar
      statusbarBorder: "#334155",
      accent: "#2563eb",           // Buttons and active highlights
      focusOutline: "#60a5fa",     // Focus rings
      controlActiveBg: "#1d4ed8",  // Segmented control active pill
      previewBackdrop: "#e2e8f0",  // Page canvas background
      panelBg: "#1e293b",          // Drawer & dialog popovers
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
  ],
};
```

### 3.2 Hierarchical SVG Logo Resolution

The editor resolves logos hierarchically:

1. **User Upload**: If an editor uploads a custom image file via the toolbar, it takes immediate precedence and is cached in the browser's `localStorage`.
2. **Explicit Clear**: Clicking "Poista logo" suppresses all logos for users wishing to generate documents without a letterhead logo.
3. **Template SVG Logo**: If a template specifies `logoSvg`, selecting that template automatically mounts the template's vector logo.
4. **Association Default**: If no upload or template override exists, the association's vector SVG logo (`assets/logo.svg`) is automatically mounted into the Typst shadow virtual filesystem (`$typst.mapShadow("/logo.svg", bytes)`).

---

## 4. Deploying the Signaling Worker (Cloudflare Workers)

### 4.1 Configuring `signaling/wrangler.toml`

Customize the Worker name and restrict `ALLOWED_ORIGINS` strictly to your association's domain:

```toml
name = "yhdistys-signaling"
main = "src/index.ts"
compatibility_date = "2026-06-15"

[vars]
ALLOWED_ORIGINS = "https://asiakirjat.yhdistys.fi, http://localhost:5173"
COLLAB_ENABLED = "true"

[[durable_objects.bindings]]
name = "ROOMS"
class_name = "Room"

[[durable_objects.bindings]]
name = "COLLAB_ROOMS"
class_name = "CollabRoom"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["Room"]

[[migrations]]
tag = "v2"
new_sqlite_classes = ["CollabRoom"]
```

> [!IMPORTANT]
> When `ALLOWED_ORIGINS` is set, upstream defaults (`datakurre.github.io`) are strictly excluded. Only the domains you list in `ALLOWED_ORIGINS` can establish WebSockets or request TURN credentials.

### 4.2 Deploying the Worker

Deploy directly using Wrangler:

```bash
cd signaling
npm ci
npx wrangler deploy
```

In your Cloudflare dashboard, bind a custom subdomain (e.g. `signaling.yhdistys.fi`) under **Workers & Pages → yhdistys-signaling → Settings → Domains & Routes**.

---

## 5. Deploying the Web Editor (Cloudflare Pages)

### 5.1 Project Setup on Cloudflare Pages

1. Log in to the Cloudflare dashboard and navigate to **Workers & Pages → Create application → Pages → Connect to Git**.
2. Select your association's repository.
3. Configure the build settings:
   - **Framework preset**: `None` (or `Vite`)
   - **Build command**: `cd web && npm ci && npm run build`
   - **Build output directory**: `web/dist`
   - **Root directory**: `/`
4. Add environment variables under **Settings → Environment variables**:
   - `VITE_COLLAB_URL`: `https://signaling.yhdistys.fi`
   - `VITE_SIGNALING_URL`: `https://signaling.yhdistys.fi`
5. Under **Custom domains**, attach your editor subdomain (e.g. `asiakirjat.yhdistys.fi`).

---

## 6. Automated GitHub Actions CI/CD

Create two workflows in `.github/workflows/` so every commit to `main` automatically deploys frontend and backend updates.

### 6.1 GitHub Repository Secrets

Add the following under **Settings → Secrets and variables → Actions** in your GitHub repository:
- `CLOUDFLARE_API_TOKEN`: Cloudflare API token with `Cloudflare Pages:Edit` and `Workers Scripts:Edit` permissions.
- `CLOUDFLARE_ACCOUNT_ID`: Your Cloudflare Account ID (found on the Workers dashboard overview).

### 6.2 `.github/workflows/deploy-pages.yml`

```yaml
name: Deploy Cloudflare Pages
on:
  push:
    branches: [main]
    paths:
      - 'web/**'
      - 'templates/**'
      - 'assets/**'
      - 'association.config.ts'

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: 'npm'
          cache-dependency-path: 'web/package-lock.json'
      - run: cd web && npm ci && npm run build
        env:
          VITE_COLLAB_URL: https://signaling.yhdistys.fi
          VITE_SIGNALING_URL: https://signaling.yhdistys.fi
      - uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: pages deploy web/dist --project-name=yhdistys-asiakirjat
```

### 6.3 `.github/workflows/deploy-signaling.yml`

```yaml
name: Deploy Signaling Worker
on:
  push:
    branches: [main]
    paths:
      - 'signaling/**'

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: 'npm'
          cache-dependency-path: 'signaling/package-lock.json'
      - run: cd signaling && npm ci
      - uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          workingDirectory: 'signaling'
          command: deploy
```

---

## 7. Testing Locally

To run and verify the entire stack locally before deploying:

1. **Start the Signaling Worker**:
   ```bash
   cd signaling
   npm run dev
   # Worker starts on http://localhost:8787
   ```

2. **Start the Web Editor**:
   ```bash
   cd web
   npm run dev
   # Vite development server starts on http://localhost:5173
   ```

3. Open `http://localhost:5173` in your browser.
   - Click the file manager icon in the bottom right toolbar, then **"Uusi tiedosto"**. The template selector dialog will open displaying your association templates.
   - Test PDF preview generation, SVG logo rendering, and the **"Jaa"** collaborative editing workflow.
