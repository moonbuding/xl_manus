export function createId(prefix: string) {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${random}`;
}

export function byteSize(value: string) {
  return new TextEncoder().encode(value).length;
}
