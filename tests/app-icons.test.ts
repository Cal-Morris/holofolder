import { describe, test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import sharp from "sharp"
import manifest from "../app/manifest"

const root = path.join(process.cwd(), "public")

describe("install icon exports", () => {
  test("installed app icons use an opaque near-black background", async () => {
    const pngs = (manifest().icons ?? []).filter(icon => icon.type === "image/png").map(icon => icon.src.replace(/^\/app\//, ""))
    for (const name of [...pngs, "holofolder-apple-touch-icon.png"]) {
      const { data } = await sharp(path.join(root, name)).removeAlpha().extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true })
      assert.deepEqual([...data], [7, 7, 10], name)
    }
  })
  test("every manifest icon exists with its declared size and supported purpose", async () => {
    const icons = manifest().icons ?? []
    assert.ok(icons.some(icon => icon.purpose === "any" && icon.type === "image/svg+xml"))
    assert.ok(icons.some(icon => icon.purpose === "monochrome"))
    for (const icon of icons) {
      assert.ok(["any", "maskable", "monochrome"].includes(icon.purpose ?? "any"))
      const file = path.join(root, icon.src.replace(/^\/app(?=\/|$)/, ""))
      await fs.access(file)
      if (icon.type === "image/png") {
        const meta = await sharp(file).metadata()
        assert.equal(`${meta.width}x${meta.height}`, icon.sizes)
        assert.equal(meta.hasAlpha, false)
      }
    }
  })
  test("maskable artwork stays inside the safe circle and the favicon has multiple sizes", async () => {
    const { data, info } = await sharp(path.join(root, "pwa-holo-cards-maskable-512.png")).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    const background = [...data.subarray(0, 3)]
    for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
      if (Math.hypot(x - 255.5, y - 255.5) <= 205) continue
      const offset = (y * info.width + x) * info.channels
      assert.ok(background.every((value, channel) => Math.abs(value - data[offset + channel]) <= 2), `art outside safe zone at ${x},${y}`)
    }
    const ico = await fs.readFile(path.join(root, "holo-cards-favicon.ico"))
    assert.equal(ico.readUInt16LE(2), 1)
    assert.equal(ico.readUInt16LE(4), 4)
    assert.deepEqual([0, 1, 2, 3].map(index => ico[6 + index * 16]), [16, 32, 48, 64])
  })
  test("old maskable install URLs retain the maskable artwork", async () => {
    for (const size of [192, 512]) {
      const expected = await fs.readFile(path.join(root, `pwa-holo-cards-maskable-${size}.png`))
      for (const name of [`pwa-${size}x${size}.png`, `pwa-holo-card-${size}.png`]) {
        assert.deepEqual(await fs.readFile(path.join(root, name)), expected)
      }
    }
  })

  test("logo and appearance SVGs embed the canonical framed card without external requests", async () => {
    const master = await sharp("assets/brand/holo-card-master.png").trim().resize(512, 512, { fit: "inside" })
      .flatten({ background: "#07070a" }).raw().toBuffer({ resolveWithObject: true })
    let canonical: Buffer | undefined
    for (const name of ["mark", "icon", "light", "dark", "glass", "maskable", "monochrome"]) {
      const data = await fs.readFile(path.join(root, `holo-cards-${name}.svg`))
      assert.doesNotMatch(data.toString(), /https?:\/\/(?!www\.w3\.org)/)
      if (name !== "monochrome") {
        const encoded = data.toString().match(/data:image\/png;base64,([^"\s]+)/)?.[1]
        assert.ok(encoded, name)
        const png = Buffer.from(encoded, "base64")
        canonical ??= png
        assert.ok(png.equals(canonical), `${name} embeds the same artwork as mark`)
        const embedded = await sharp(png).flatten({ background: "#07070a" }).raw().toBuffer({ resolveWithObject: true })
        assert.equal(embedded.info.width, master.info.width)
        assert.equal(embedded.info.height, master.info.height)
        assert.equal(embedded.info.channels, master.info.channels)
        // Palette quantization varies across native platforms. Compare visible RGB
        // against the unquantized master (measured RMSE 2.15 on a 0–255 scale).
        let squaredError = 0
        for (let i = 0; i < embedded.data.length; i++) squaredError += (embedded.data[i] - master.data[i]) ** 2
        const rmse = Math.sqrt(squaredError / embedded.data.length)
        assert.ok(rmse < 3, `${name} differs from the master: RGB RMSE ${rmse}`)
      }
      for (const size of [32, 1024]) {
        const { info } = await sharp(data).resize(size, size).png().toBuffer({ resolveWithObject: true })
        assert.equal(info.width, size)
        assert.equal(info.height, size)
      }
    }
  })

})
