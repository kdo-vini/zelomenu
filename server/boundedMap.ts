/** Eviction only discards a reusable cache entry, never authoritative state. */
export class BoundedMap<K, V> extends Map<K, V> {
  constructor(private readonly capacity: number) { super(); }
  override set(key: K, value: V): this {
    this.delete(key);
    super.set(key, value);
    while (this.size > this.capacity) this.delete(this.keys().next().value!);
    return this;
  }
}

/** A request keeps its loaded values even when another tenant evicts the shared cache. */
export class ScopedCache<K, V> {
  private readonly scope = new AsyncLocalStorage<Map<K, V>>();
  private readonly shared: BoundedMap<K, V>;
  constructor(capacity: number) { this.shared = new BoundedMap(capacity); }
  run<T>(callback: () => T): T { return this.scope.run(new Map(), callback); }
  set(key: K, value: V): void { this.shared.set(key, value); this.scope.getStore()?.set(key, value); }
  get(key: K): V | undefined { return this.scope.getStore()?.get(key) ?? this.shared.get(key); }
}
import { AsyncLocalStorage } from 'node:async_hooks';
