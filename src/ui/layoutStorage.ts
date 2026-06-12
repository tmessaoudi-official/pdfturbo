export interface ILayoutStorage {
  load(key: string): string | null;
  save(key: string, value: string): void;
  clear(key: string): void;
}

export class LocalLayoutStorage implements ILayoutStorage {
  load(key: string): string | null {
    return localStorage.getItem(key);
  }
  save(key: string, value: string): void {
    localStorage.setItem(key, value);
  }
  clear(key: string): void {
    localStorage.removeItem(key);
  }
}
