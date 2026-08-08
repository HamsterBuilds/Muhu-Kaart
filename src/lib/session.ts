const CODE_KEY = "muhu.code";
const GROUP_KEY = "muhu.group";

export function loadCode(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(CODE_KEY);
}

export function saveCode(code: string) {
  window.localStorage.setItem(CODE_KEY, code);
}

export function clearCode() {
  window.localStorage.removeItem(CODE_KEY);
  window.localStorage.removeItem(GROUP_KEY);
}

export function loadGroup(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(GROUP_KEY);
}

export function saveGroup(id: string) {
  window.localStorage.setItem(GROUP_KEY, id);
}
