import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
  watch
} from 'node:fs'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { build } from 'esbuild'
import {
  filterCustomerAppManifest,
  readBuildConfiguration
} from './build-configuration.mjs'

const root = resolve(import.meta.dirname, '..')
const workspaceRoot = resolve(root, '../..')
const publicEndpointsPath = join(
  workspaceRoot,
  'config',
  'public-endpoints.local.json'
)
const source = join(root, 'src')
const output = join(root, 'dist')
const watchMode = process.argv.includes('--watch')

function readPublicEndpoints() {
  if (!existsSync(publicEndpointsPath)) return {}
  return JSON.parse(readFileSync(publicEndpointsPath, 'utf8'))
}

function findTypeScriptFiles(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const filePath = join(directory, entry)
    return statSync(filePath).isDirectory()
      ? findTypeScriptFiles(filePath)
      : extname(entry) === '.ts' &&
          !entry.endsWith('.d.ts') &&
          !entry.endsWith('.test.ts')
        ? [filePath]
        : []
  })
}

function copyAssets(directory) {
  for (const entry of readdirSync(directory)) {
    const sourcePath = join(directory, entry)
    if (statSync(sourcePath).isDirectory()) {
      copyAssets(sourcePath)
      continue
    }
    if (!['.json', '.wxml', '.wxss', '.wxs'].includes(extname(entry))) continue
    const targetPath = join(output, relative(source, sourcePath))
    mkdirSync(dirname(targetPath), { recursive: true })
    cpSync(sourcePath, targetPath)
  }
}

function applyCustomerOnlyOutput() {
  const appManifestPath = join(output, 'app.json')
  const appManifest = JSON.parse(readFileSync(appManifestPath, 'utf8'))
  writeFileSync(
    appManifestPath,
    `${JSON.stringify(filterCustomerAppManifest(appManifest), null, 2)}\n`,
    'utf8'
  )
}

async function buildProject() {
  const { mode, configuration } = readBuildConfiguration(
    process.env,
    readPublicEndpoints()
  )
  rmSync(output, { recursive: true, force: true })
  await build({
    entryPoints: findTypeScriptFiles(source),
    outdir: output,
    outbase: source,
    platform: 'neutral',
    format: 'cjs',
    target: 'es2020',
    sourcemap: true,
    bundle: false,
    define: {
      __ZYAPP_MINIAPP_BUILD_CONFIG__: JSON.stringify(configuration)
    }
  })
  if (!existsSync(output)) mkdirSync(output, { recursive: true })
  copyAssets(source)
  if (configuration.customerOnly) applyCustomerOnlyOutput()
  console.log(`[miniapp] built ${mode} mode`)
}

await buildProject()

if (watchMode) {
  let rebuildTimer
  let rebuildChain = Promise.resolve()
  watch(source, { recursive: true }, () => {
    clearTimeout(rebuildTimer)
    rebuildTimer = setTimeout(() => {
      rebuildChain = rebuildChain
        .then(buildProject)
        .catch((error) => console.error('[miniapp] rebuild failed', error))
    }, 120)
  })
  console.log('[miniapp] watching src for changes')
  await new Promise(() => {})
}
