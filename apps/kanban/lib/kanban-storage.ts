type StorageReader = {
  getItem(key: string): string | null;
};

type StorageWriter = {
  setItem(key: string, value: string): void;
};

export function getBrowserStorage(): Storage | null {
  if (typeof window === "undefined") return null;

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readStorageValue(storage: StorageReader | null, key: string): string | null {
  if (!storage) return null;

  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

export function readJsonStorage(storage: StorageReader | null, key: string): unknown {
  const value = readStorageValue(storage, key);
  if (value === null) return null;

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function readStorageChoice<T extends string>(
  storage: StorageReader | null,
  key: string,
  choices: readonly T[],
  fallback: T
): T {
  const value = readStorageValue(storage, key);
  return value !== null && choices.some((choice) => choice === value) ? (value as T) : fallback;
}

export function writeStorageValue(storage: StorageWriter | null, key: string, value: string): boolean {
  if (!storage) return false;

  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}
