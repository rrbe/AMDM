// Pack PNG files into a single .ico (PNG-in-ICO; modern Windows supports it).
// usage: node mkico.js out.ico 16.png 32.png 48.png 64.png 128.png 256.png
const fs = require('fs')
const out = process.argv[2]
const files = process.argv.slice(3)
const imgs = files.map((f) => {
  const buf = fs.readFileSync(f)
  // PNG IHDR: width at byte 16, height at 20 (big-endian uint32)
  const w = buf.readUInt32BE(16)
  const h = buf.readUInt32BE(20)
  return { buf, w, h }
})
const HEADER = 6
const ENTRY = 16
let offset = HEADER + ENTRY * imgs.length
const dir = Buffer.alloc(HEADER + ENTRY * imgs.length)
dir.writeUInt16LE(0, 0) // reserved
dir.writeUInt16LE(1, 2) // type: icon
dir.writeUInt16LE(imgs.length, 4)
imgs.forEach((img, i) => {
  const o = HEADER + i * ENTRY
  dir.writeUInt8(img.w >= 256 ? 0 : img.w, o + 0)
  dir.writeUInt8(img.h >= 256 ? 0 : img.h, o + 1)
  dir.writeUInt8(0, o + 2) // palette
  dir.writeUInt8(0, o + 3) // reserved
  dir.writeUInt16LE(1, o + 4) // color planes
  dir.writeUInt16LE(32, o + 6) // bits per pixel
  dir.writeUInt32LE(img.buf.length, o + 8)
  dir.writeUInt32LE(offset, o + 12)
  offset += img.buf.length
})
fs.writeFileSync(out, Buffer.concat([dir, ...imgs.map((i) => i.buf)]))
console.log('wrote', out, '(' + imgs.map((i) => i.w).join(',') + ')')
