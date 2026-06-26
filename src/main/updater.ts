import { app, ipcMain, type BrowserWindow } from 'electron'

// Auto-update wiring (electron-updater). Mirrors AxiBridge's UX: the renderer
// shows a small pill that reflects checking -> downloading(%) -> "Restart to
// update". electron-builder publishes to the GitHub release, which is where
// autoUpdater looks for new versions.
//
// electron-updater is imported lazily inside the function: it touches Electron
// internals at load time and throws outside an Electron runtime, so a static
// import would break unit tests that import the main module.
export function setupAutoUpdates(getWindow: () => BrowserWindow | null): void {
  // No-op outside a real Electron runtime (e.g. unit tests that import the main
  // module): loading electron-updater there throws on app.getVersion().
  if (!app || typeof app.getVersion !== 'function') return
  void import('electron-updater')
    .then(({ default: electronUpdater }) => {
    const { autoUpdater } = electronUpdater
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true

    const send = (channel: string, payload?: unknown): void =>
      getWindow()?.webContents.send(channel, payload)

    autoUpdater.on('checking-for-update', () => send('update:status', 'checking'))
    autoUpdater.on('update-available', (info) => send('update:available', { version: info.version }))
    autoUpdater.on('update-not-available', () => send('update:status', 'none'))
    autoUpdater.on('download-progress', (p) => send('update:progress', { percent: p.percent }))
    autoUpdater.on('update-downloaded', (info) =>
      send('update:downloaded', { version: info.version })
    )
    autoUpdater.on('error', (err) =>
      send('update:error', { message: err instanceof Error ? err.message : String(err) })
    )

    ipcMain.handle('update:check', async () => {
      if (!app.isPackaged) return { ok: false, error: 'Updates only run in a packaged build.' }
      try {
        await autoUpdater.checkForUpdates()
        return { ok: true }
      } catch (e) {
        return { ok: false, error: (e as Error).message }
      }
    })

    ipcMain.handle('update:restart', () => autoUpdater.quitAndInstall())

    // Check on launch and every 6 hours (packaged only — dev has no feed).
    if (app.isPackaged) {
      void autoUpdater.checkForUpdates().catch(() => {})
      setInterval(() => void autoUpdater.checkForUpdates().catch(() => {}), 6 * 60 * 60 * 1000)
    }
  })
    .catch(() => {})
}
