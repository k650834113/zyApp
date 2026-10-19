// Build derivatives only: preserve the generated source assets and composition.
import {createRequire} from 'node:module'
import {mkdirSync,statSync,writeFileSync} from 'node:fs'
import {resolve,dirname} from 'node:path'
const require=createRequire(import.meta.url)
const sharp=require(process.argv[2] || 'sharp')
const root=resolve(import.meta.dirname,'..')
const names=['activity-illustration-v1.png','guest-landscape-v1.png','login-illustration-v1.png','recommendations-hero-v1.png','tabletop-hero-v1.png']
const records=[]
for(const name of names){
  const source=resolve(root,'src/assets/images',name)
  const output=resolve(root,'build-assets/assets/images',name)
  mkdirSync(dirname(output),{recursive:true})
  const info=await sharp(source).resize({width:name.startsWith('login')?640:900,withoutEnlargement:true}).png({palette:true,colours:256,dither:1,compressionLevel:9}).toFile(output)
  records.push({name,sourceBytes:statSync(source).size,outputBytes:info.size,width:info.width,height:info.height})
}
writeFileSync(resolve(root,'build-assets/manifest.json'),JSON.stringify(records,null,2)+'\n')
console.log(JSON.stringify(records,null,2))
