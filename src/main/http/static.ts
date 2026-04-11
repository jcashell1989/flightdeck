import { join } from 'path'
import { app } from 'electron'
import { is } from '@electron-toolkit/utils'

/**
 * Returns the absolute path to the built mobile client root (out/mobile/).
 *
 * Dev: <project-root>/out/mobile/
 * Packaged: <resourcesPath>/app.asar.unpacked/out/mobile/
 *   (requires asarUnpack: ["out/mobile/**"] in electron-builder config)
 */
export function getMobileRoot(): string {
  if (is.dev) {
    // __dirname is out/main/ — go up two levels to project root
    return join(__dirname, '../../out/mobile')
  }
  return join(process.resourcesPath, 'app.asar.unpacked', 'out', 'mobile')
}
