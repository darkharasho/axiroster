// Tiny runtime flag so renderer components can branch on web vs Electron without
// reaching into globals. The web entry (main-web.tsx) sets it true before render;
// the Electron entry leaves it false.
let web = false

export function setWeb(value: boolean): void {
  web = value
}

export function isWeb(): boolean {
  return web
}
