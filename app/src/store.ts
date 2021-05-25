export class Store {
  store: Record<string, unknown> = {};

  set(key: string, value: unknown): void {
    this.store[key] = value;
  }

  get(key: string): unknown {
    return this.store[key];
  }
}

export const store = new Store();

(window as any)._store = store; // eslint-disable-line
