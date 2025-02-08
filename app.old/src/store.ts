/* Simple Application Store */

export class Store {
  private store: Record<string, unknown> = {};

  public set(key: string, value: unknown): void {
    this.store[key] = value;
    this.storeInLocalStorage();
  }

  public get(key: string): unknown {
    return this.store[key];
  }

  public remove(key: string): void {
    delete this.store[key]; // eslint-disable-line @typescript-eslint/no-dynamic-delete
    this.storeInLocalStorage();
  }

  public restoreFromLocalStorage(): void {
    const storeFromLocalStorage = localStorage.getItem("store");
    if (storeFromLocalStorage !== null) {
      this.store = JSON.parse(storeFromLocalStorage) as Record<string, unknown>;
    }
  }

  private storeInLocalStorage(): void {
    localStorage.setItem("store", JSON.stringify(this.store));
  }
}

export const store = new Store();
store.restoreFromLocalStorage();

(window as any)._store = store; // eslint-disable-line @typescript-eslint/no-explicit-any,@typescript-eslint/no-unsafe-member-access,no-underscore-dangle
