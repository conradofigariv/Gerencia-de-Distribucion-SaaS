const DB_KEY = "epec_seguimiento_db";

export type DbRow = Record<string, unknown>;

export const dbGet = (): DbRow[] => {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(DB_KEY) ?? "[]"); } catch { return []; }
};

export const dbAppend = (rows: DbRow[]): void => {
  localStorage.setItem(DB_KEY, JSON.stringify([...dbGet(), ...rows]));
};

export const dbDeleteRow = (index: number): void => {
  localStorage.setItem(DB_KEY, JSON.stringify(dbGet().filter((_, i) => i !== index)));
};

export const dbClear = (): void => { localStorage.removeItem(DB_KEY); };
