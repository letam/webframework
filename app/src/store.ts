/* Simple Application Store */

export class Store {
  store: Record<string, unknown> = {};

  set(key: string, value: unknown): void {
    this.store[key] = value;
    this.storeInLocalStorage();
  }

  get(key: string): unknown {
    return this.store[key];
  }

  remove(key: string): void {
    delete this.store[key];
    this.storeInLocalStorage();
  }

  storeInLocalStorage(): void {
    localStorage.setItem("store", JSON.stringify(this.store));
  }

  restoreFromLocalStorage(): void {
    const storeFromLocalStorage = localStorage.getItem("store");
    if (storeFromLocalStorage) {
      this.store = JSON.parse(storeFromLocalStorage) as Record<string, unknown>;
    }
  }
}

export const store = new Store();
store.restoreFromLocalStorage();

(window as any)._store = store; // eslint-disable-line @typescript-eslint/no-explicit-any,@typescript-eslint/no-unsafe-member-access,no-underscore-dangle
