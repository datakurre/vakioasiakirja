/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Base URL of the signaling Worker (see signaling/). Empty disables sharing.
  readonly VITE_SIGNALING_URL?: string;
  // Base URL of the collaborative editing service (see signaling/). Falls back to VITE_SIGNALING_URL.
  readonly VITE_COLLAB_URL?: string;
}

declare module "markdown-it-deflist" {
  import type MarkdownIt from "markdown-it";
  const plugin: (md: MarkdownIt) => void;
  export default plugin;
}

declare module "markdown-it-footnote" {
  import type MarkdownIt from "markdown-it";
  const plugin: (md: MarkdownIt) => void;
  export default plugin;
}
