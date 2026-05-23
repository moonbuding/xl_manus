import { cp, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const source = resolve("src/renderer.html");
const target = resolve("dist/renderer.html");

await mkdir(dirname(target), { recursive: true });
await cp(source, target);
