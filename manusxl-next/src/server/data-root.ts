import { join } from "node:path";

const defaultDataRoot = ".manusxl-data";

export function dataPath(...segments: string[]) {
  const root = process.env.MANUSXL_DATA_DIR?.trim() || defaultDataRoot;
  return join(root, ...segments);
}
