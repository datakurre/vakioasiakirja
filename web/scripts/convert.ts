import { readFileSync } from "node:fs";
import { markdownToTypst, type ConvertOptions } from "../src/md-to-typst.ts";

// usage: convert.ts <file.md> [--logo <path>]
//
// In the browser the frontmatter `logo:` key is a filesystem path the editor
// cannot read, so logos are uploaded and passed through ConvertOptions.logoPath
// instead. On the command line --logo supplies that path directly; the docs
// build uses it to embed the same logo PDF the LaTeX and Markdown examples show.
const args = process.argv.slice(2);
const opts: ConvertOptions = {};
let file: string | undefined;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--logo") opts.logoPath = args[++i];
  else file = args[i];
}
if (file == null) {
  process.stderr.write("usage: convert.ts <file.md> [--logo <path>]\n");
  process.exit(2);
}
process.stdout.write(markdownToTypst(readFileSync(file, "utf8"), opts));
