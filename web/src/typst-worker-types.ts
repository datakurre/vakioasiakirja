export interface WorkerLogo {
  path: string;
  bytes: Uint8Array;
}

export type WorkerRequest =
  | { id: number; type: "render"; md: string; logo?: WorkerLogo }
  | { id: number; type: "pdf" };

export type WorkerResponse =
  | { id: number; type: "render_success"; svg: string }
  | { id: number; type: "render_error"; error: string; isConversionError?: boolean }
  | { id: number; type: "pdf_success"; pdf?: Uint8Array }
  | { id: number; type: "pdf_error"; error: string };
