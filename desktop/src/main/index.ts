import { app, shell, BrowserWindow } from 'electron'
import { join, resolve } from 'path'
import { spawn, ChildProcess } from 'child_process'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'

// 사이드카 디렉토리: out/main/index.js → out/main → out → desktop → GeneralChat → server
const SERVER_DIR = resolve(__dirname, '../../../server')
const SIDECAR_PORT = 8765

let pythonProc: ChildProcess | null = null

function startPythonSidecar(): void {
  if (pythonProc) return
  console.log(`[main] spawning Python sidecar at ${SERVER_DIR}`)
  pythonProc = spawn(
    'uv',
    [
      'run',
      'uvicorn',
      'app.main:app',
      '--port',
      String(SIDECAR_PORT),
      '--host',
      '127.0.0.1',
      '--reload',
      '--reload-dir',
      'app'
    ],
    { cwd: SERVER_DIR, stdio: ['ignore', 'pipe', 'pipe'] }
  )
  pythonProc.stdout?.on('data', (d) => process.stdout.write(`[py] ${d}`))
  pythonProc.stderr?.on('data', (d) => process.stderr.write(`[py] ${d}`))
  pythonProc.on('exit', (code) => {
    console.log(`[main] Python sidecar exited with ${code}`)
    pythonProc = null
  })
}

function stopPythonSidecar(): void {
  if (!pythonProc) return
  console.log('[main] stopping Python sidecar')
  pythonProc.kill('SIGTERM')
  pythonProc = null
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#09090b',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.generalchat')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  startPythonSidecar()
  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', stopPythonSidecar)

app.on('window-all-closed', () => {
  stopPythonSidecar()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
