export function maxChatIdFromPath(pathname) {
  return /^\/(-?[1-9]\d{0,19})(?:\/|$)/.exec(pathname)?.[1] ?? null;
}
