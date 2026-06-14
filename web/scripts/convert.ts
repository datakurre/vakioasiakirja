import { readFileSync } from "node:fs";
import { markdownToTypst } from "../src/md-to-typst.ts";
const file = process.argv[2];
process.stdout.write(markdownToTypst(readFileSync(file, "utf8")));
