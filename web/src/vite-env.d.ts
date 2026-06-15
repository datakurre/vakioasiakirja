/// <reference types="vite/client" />

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
