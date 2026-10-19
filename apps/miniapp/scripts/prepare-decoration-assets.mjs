import { createRequire } from 'node:module'
const sharp = createRequire(import.meta.url)(process.argv[2] || 'sharp')
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
const root = resolve(import.meta.dirname, '..')
const records = {}
mkdirSync(resolve(root, 'build-assets/assets/images'), { recursive: true })
mkdirSync(resolve(root, 'build-assets/server'), { recursive: true })
for (const [kind, name, width] of [['hero', 'tabletop-editorial-v2', 1200], ['empty', 'tabletop-empty-v2', 480]]) {
  const output = resolve(root, `build-assets/assets/images/${name}.jpg`)
  await sharp(resolve(root, `../../output/miniapp-decoration/${name}.png`)).resize({width, withoutEnlargement:true}).jpeg({quality:82, mozjpeg:true}).toFile(output)
  const buffer = readFileSync(output)
  const fileName = createHash('sha256').update(buffer).digest('hex') + '.jpg'
  writeFileSync(resolve(root, 'build-assets/server', fileName), buffer)
  // The small local copy is also packaged as the network failure fallback.
  writeFileSync(resolve(root, `src/assets/images/${name}.jpg`), buffer)
  records[kind] = {fileName, bytes:buffer.length, local:`/assets/images/${name}.jpg`, url:`https://judian.icu/v1/public/board-game-covers/${fileName}`}
}
const logo = await sharp(resolve(root, '../../output/miniapp-decoration/store-logo-original.png')).trim().resize({width:400,withoutEnlargement:true}).png().toBuffer()
const logoName = createHash('sha256').update(logo).digest('hex') + '.png'
writeFileSync(resolve(root, 'src/assets/images/store-logo-v1.png'), logo)
writeFileSync(resolve(root, 'build-assets/server', logoName), logo)
records.logo = {fileName:logoName, bytes:logo.length, local:'/assets/images/store-logo-v1.png', url:`https://judian.icu/v1/public/board-game-covers/${logoName}`}
writeFileSync(resolve(root, 'build-assets/decoration-manifest.json'), JSON.stringify(records,null,2)+'\n')
writeFileSync(resolve(root, 'src/services/decoration-assets.ts'), 'export const decorationAssets = '+JSON.stringify(records,null,2)+' as const\n')
console.log(JSON.stringify(records,null,2))
