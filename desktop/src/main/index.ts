import { app, shell, BrowserWindow } from 'electron'
import { join, resolve } from 'path'
import { spawn, ChildProcess } from 'child_process'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'

// dev 모드 사이드카 디렉토리: out/main/index.js → out/main → out → desktop → GeneralChat → server
const DEV_SERVER_DIR = resolve(__dirname, '../../../server')
const SIDECAR_PORT = 8765

let pythonProc: ChildProcess | null = null

interface SpawnConfig {
  command: string
  args: string[]
  cwd: string
}

/** dev = uv run uvicorn, prod = 패키지 안의 PyInstaller 산출 사이드카 */
function getSidecarSpawnConfig(): SpawnConfig {
  if (app.isPackaged) {
    // prod: process.resourcesPath/sidecar/generalchat-server/generalchat-server[.exe]
    const exeName =
      process.platform === 'win32' ? 'generalchat-server.exe' : 'generalchat-server'
    const sidecarDir = join(process.resourcesPath, 'sidecar', 'generalchat-server')
    return {
      command: join(sidecarDir, exeName),
      args: ['--port', String(SIDECAR_PORT), '--host', '127.0.0.1'],
      cwd: sidecarDir
    }
  }
  // dev: uv 명령 (호스트 PATH 의 uv)
  return {
    command: 'uv',
    args: [
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
    cwd: DEV_SERVER_DIR
  }
}

function startPythonSidecar(): void {
  if (pythonProc) return
  const cfg = getSidecarSpawnConfig()
  console.log(`[main] spawning sidecar: ${cfg.command} (cwd=${cfg.cwd})`)
  pythonProc = spawn(cfg.command, cfg.args, {
    cwd: cfg.cwd,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  pythonProc.stdout?.on('data', (d) => process.stdout.write(`[py] ${d}`))
  pythonProc.stderr?.on('data', (d) => process.stderr.write(`[py] ${d}`))
  pythonProc.on('exit', (code) => {
    console.log(`[main] sidecar exited with ${code}`)
    pythonProc = null
  })
  pythonProc.on('error', (err) => {
    console.error(`[main] sidecar spawn error: ${err}`)
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
