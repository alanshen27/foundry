/** Per-viewport cache. It never shares a project's geometry across users or tabs. */
export class CadSceneCache<T> {
  private entries = new Map<string, { value: T; bytes: number }>();
  private bytes = 0;

  constructor(
    private readonly dispose: (value: T) => void,
    private readonly maxBytes = 64_000_000,
    private readonly maxEntries = 6,
  ) {}

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  owns(value: T): boolean {
    return [...this.entries.values()].some((entry) => entry.value === value);
  }

  /** The caller owns oversized values. Replaced/evicted cached values are disposed. */
  set(key: string, value: T, bytes: number): boolean {
    if (!Number.isFinite(bytes) || bytes < 0 || bytes > this.maxBytes) return false;
    const existing = this.entries.get(key);
    if (existing) {
      this.entries.delete(key);
      this.bytes -= existing.bytes;
      if (existing.value !== value) this.dispose(existing.value);
    }
    while (
      this.entries.size &&
      (this.entries.size >= this.maxEntries || this.bytes + bytes > this.maxBytes)
    ) {
      const [oldest, entry] = this.entries.entries().next().value!;
      this.entries.delete(oldest);
      this.bytes -= entry.bytes;
      this.dispose(entry.value);
    }
    this.entries.set(key, { value, bytes });
    this.bytes += bytes;
    return true;
  }

  clear(): void {
    for (const entry of this.entries.values()) this.dispose(entry.value);
    this.entries.clear();
    this.bytes = 0;
  }
}
