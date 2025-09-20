import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

function detectPlatform() {
  const platform = process.platform
  const arch = process.arch
  
  if (platform === 'win32' && arch === 'x64') return 'windows-x64'
  if (platform === 'darwin' && arch === 'x64') return 'darwin-x64'
  if (platform === 'darwin' && arch === 'arm64') return 'darwin-arm64'
  if (platform === 'linux' && arch === 'x64') return 'linux-x64'
  
  throw new Error(`Unsupported platform: ${platform}-${arch}`)
}

export function getSlangcPath() {
  const platform = detectPlatform()
  const __dirname = path.dirname(fileURLToPath(import.meta.url))
  const rootDir = path.resolve(__dirname, '..')
  const slangcName = platform.startsWith('windows') ? 'slangc.exe' : 'slangc'
  return path.join(rootDir, 'platforms', platform, slangcName)
}
