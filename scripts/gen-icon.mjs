#!/usr/bin/env node
/**
 * gen-icon.mjs — generate build/icon.png (1024×1024) programmatically.
 *
 * No external dependencies. Uses node:zlib for PNG compression and node:fs
 * to write the result. After running, use macOS `sips` to produce icon.icns.
 *
 * Design: dark Tokyo Night background (#1a1b26) with a "flight deck" dashboard
 * motif — three horizontal status bars in blue/purple, representing instrument
 * readouts. Simple, geometric, intentional.
 *
 * Usage:
 *   node scripts/gen-icon.mjs
 *   # macOS only: produces icon.icns via iconutil
 *   npm run gen-icon
 */

import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync, rmSync, cpSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BUILD_DIR = join(__dirname, '..', 'build')

const W = 1024
const H = 1024

// ── Colour palette ─────────────────────────────────────────────────────────
const BG   = [26,  27,  38, 255]  // #1a1b26  background
const BLUE = [122, 162, 247, 255] // #7aa2f7  primary bar
const PRP  = [187, 154, 247, 255] // #bb9af7  secondary bar
const CYAN = [125, 207, 255, 255] // #7dcfff  tertiary bar
const BG2  = [36,  40,  59, 255]  // #24283b  panel bg

// ── Canvas ─────────────────────────────────────────────────────────────────
const canvas = new Uint8Array(W * H * 4)

function px(x, y, [r, g, b, a]) {
  if (x < 0 || x >= W || y < 0 || y >= H) return
  const i = (y * W + x) * 4
  canvas[i]     = r
  canvas[i + 1] = g
  canvas[i + 2] = b
  canvas[i + 3] = a
}

function fillRect(x0, y0, x1, y1, color) {
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++)
      px(x, y, color)
}

function roundRect(x0, y0, x1, y1, r, color) {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const dx = Math.min(x - x0, x1 - 1 - x)
      const dy = Math.min(y - y0, y1 - 1 - y)
      if (dx < r && dy < r && (dx - r) ** 2 + (dy - r) ** 2 > r * r) continue
      px(x, y, color)
    }
  }
}

// ── Draw ───────────────────────────────────────────────────────────────────

// Background
fillRect(0, 0, W, H, BG)

// Rounded card (slightly lighter bg)
const cardX = 96, cardY = 96, cardX2 = W - 96, cardY2 = H - 96, cardR = 80
roundRect(cardX, cardY, cardX2, cardY2, cardR, BG2)

// Three dashboard bars (horizontal, left-aligned, varying widths)
const barX = 160
const barH = 56
const barR = 14

// Bar 1 — wide, blue (primary metric)
const b1Y = 340
const b1W = 620
roundRect(barX, b1Y, barX + b1W, b1Y + barH, barR, BLUE)

// Bar 2 — medium, purple (secondary)
const b2Y = b1Y + barH + 44
const b2W = 420
roundRect(barX, b2Y, barX + b2W, b2Y + barH, barR, PRP)

// Bar 3 — short, cyan (tertiary)
const b3Y = b2Y + barH + 44
const b3W = 280
roundRect(barX, b3Y, barX + b3W, b3Y + barH, barR, CYAN)

// Three small square indicators at top-left of card (like window traffic lights)
const dotY = 160, dotSize = 28, dotGap = 20
const dotColors = [
  [255, 95,  86, 255],   // red
  [255, 189, 46, 255],   // yellow
  [39,  201, 63, 255],   // green
]
let dotX = 160
for (const c of dotColors) {
  roundRect(dotX, dotY, dotX + dotSize, dotY + dotSize, dotSize / 2, c)
  dotX += dotSize + dotGap
}

// ── PNG encoding ───────────────────────────────────────────────────────────

function u32(n) {
  const b = new Uint8Array(4)
  b[0] = (n >> 24) & 0xff
  b[1] = (n >> 16) & 0xff
  b[2] = (n >> 8) & 0xff
  b[3] = n & 0xff
  return b
}

function crc32(data) {
  let crc = 0xffffffff
  for (const byte of data) {
    crc ^= byte
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const typeBytes = new TextEncoder().encode(type)
  const len = u32(data.length)
  const crcData = new Uint8Array(typeBytes.length + data.length)
  crcData.set(typeBytes)
  crcData.set(data, typeBytes.length)
  const checksum = u32(crc32(crcData))
  return Buffer.concat([len, typeBytes, data, checksum].map(Buffer.from))
}

// IHDR
const ihdr = new Uint8Array(13)
ihdr.set(u32(W), 0); ihdr.set(u32(H), 4)
ihdr[8] = 8   // bit depth
ihdr[9] = 6   // color type: RGBA
ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0

// IDAT: raw filter + pixels, zlib compressed
const raw = new Uint8Array(H * (1 + W * 4))
for (let y = 0; y < H; y++) {
  raw[y * (1 + W * 4)] = 0 // filter: None
  raw.set(canvas.slice(y * W * 4, (y + 1) * W * 4), y * (1 + W * 4) + 1)
}
const compressed = deflateSync(raw, { level: 6 })

// Assemble PNG
const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const png = Buffer.concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', compressed), chunk('IEND', new Uint8Array(0))])

mkdirSync(BUILD_DIR, { recursive: true })
const pngPath = join(BUILD_DIR, 'icon.png')
writeFileSync(pngPath, png)
console.log(`wrote ${pngPath} (${(png.length / 1024).toFixed(1)} KB)`)

// ── macOS: produce icon.icns via iconutil ──────────────────────────────────
try {
  const iconsetDir = join(BUILD_DIR, 'icon.iconset')
  mkdirSync(iconsetDir, { recursive: true })

  const sizes = [16, 32, 64, 128, 256, 512, 1024]
  for (const s of sizes) {
    const out = join(iconsetDir, `icon_${s}x${s}.png`)
    execSync(`sips -z ${s} ${s} "${pngPath}" --out "${out}"`, { stdio: 'pipe' })
    if (s <= 512) {
      const out2x = join(iconsetDir, `icon_${s}x${s}@2x.png`)
      const s2 = s * 2
      execSync(`sips -z ${s2} ${s2} "${pngPath}" --out "${out2x}"`, { stdio: 'pipe' })
    }
  }

  const icnsPath = join(BUILD_DIR, 'icon.icns')
  execSync(`iconutil -c icns "${iconsetDir}" -o "${icnsPath}"`, { stdio: 'pipe' })
  rmSync(iconsetDir, { recursive: true, force: true })
  console.log(`wrote ${icnsPath}`)
} catch (e) {
  console.warn('macOS iconutil not available — skipping .icns generation:', e.message)
}
