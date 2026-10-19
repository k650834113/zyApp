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
import { dirname, extname, join, relative, resolve, sep } from 'node:path'
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
const defaultOutput = join(root, 'dist')
const temporaryOutputRoot = join(root, '.tmp')

function readOutputDirectory(arguments_) {
  const optionIndex = arguments_.indexOf('--output-directory')
  if (optionIndex === -1) return defaultOutput

  const value = arguments_[optionIndex + 1]
  if (!value || value.startsWith('--')) {
    throw new Error('--output-directory requires a path')
  }
  const requestedOutput = resolve(root, value)
  if (!requestedOutput.startsWith(`${temporaryOutputRoot}${sep}`)) {
    throw new Error(
      '--output-directory must be inside apps/miniapp/.tmp'
    )
  }
  return requestedOutput
}

const output = readOutputDirectory(process.argv.slice(2))
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
    if (!['.json', '.wxml', '.wxss', '.wxs', '.png', '.jpg', '.jpeg', '.webp', '.svg'].includes(extname(entry))) continue
    const targetPath = join(output, relative(source, sourcePath))
    mkdirSync(dirname(targetPath), { recursive: true })
    const optimizedAsset = join(root, 'build-assets', relative(source, sourcePath))
    cpSync(existsSync(optimizedAsset) ? optimizedAsset : sourcePath, targetPath)
  }
}

function applyCustomerOnlyOutput() {
  const appManifestPath = join(output, 'app.json')
  const appManifest = JSON.parse(readFileSync(appManifestPath, 'utf8'))
  const customerManifest = filterCustomerAppManifest(appManifest)
  writeFileSync(
    appManifestPath,
    `${JSON.stringify(customerManifest, null, 2)}\n`,
    'utf8'
  )
  const approvedPageDirectories = new Set(
    customerManifest.pages
      .map((page) => page.split('/')[1])
      .filter(Boolean)
  )
  const pagesOutput = join(output, 'pages')
  for (const entry of readdirSync(pagesOutput, { withFileTypes: true })) {
    if (entry.isDirectory() && !approvedPageDirectories.has(entry.name)) {
      rmSync(join(pagesOutput, entry.name), { recursive: true, force: true })
    }
  }
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
    sourcemap: !configuration.customerOnly,
    minifySyntax: configuration.customerOnly,
    bundle: false,
    define: {
      __ZYAPP_UI_DEMO_ENABLED__: JSON.stringify(!configuration.customerOnly && mode === 'mock'),
      __ZYAPP_MINIAPP_BUILD_CONFIG__: JSON.stringify(configuration)
    }
  })
  if (!existsSync(output)) mkdirSync(output, { recursive: true })
  // Runtime workspace modules cannot be resolved by the miniapp loader.
  // Emit only the pure shared scoring rules at the local facade's path.
  await build({
    entryPoints: [join(workspaceRoot, 'packages/contracts/src/miniapp-play-rules.ts')],
    outfile: join(output, 'services/play-rules.js'),
    platform: 'neutral', format: 'cjs', target: 'es2020', bundle: true,
    sourcemap: !configuration.customerOnly, minifySyntax: configuration.customerOnly
  })
  copyAssets(source)
  // UI fixtures and the legacy mock seed must never ship in a customer release.
  if (configuration.customerOnly) {
    const rechargeTemplate = join(output, 'pages/recharge/index.wxml')
    writeFileSync(rechargeTemplate, readFileSync(rechargeTemplate, 'utf8').replace(
      /<button\s+wx:if="\{\{rechargeOrder\.providerMode === 'mock'[\s\S]*?<\/button>/g,
      ''
    ), 'utf8')
    for (const [name, stub] of Object.entries({
      'workspace-demo-client': 'exports.createWorkspaceDemoClient = () => { throw new Error("Mock unavailable in customer release") };',
      'community-demo-client': 'exports.createCommunityDemoClient = () => { throw new Error("Mock unavailable in customer release") };',
      'ui-demo': 'exports.getUiDemo = () => null; exports.getCommunityDemo = () => null;',
      'mock-client': 'exports.MockMiniappClient = class { constructor() { throw new Error("Mock unavailable in customer release") } };',
      'community-page': `
        const {getMiniappClient}=require('./client');
        exports.openCommunityPage=async function(page){
          try {
            if(!await getMiniappClient().getMemberSummary()){wx.navigateTo({url:'/pages/login/index'});return}
            wx.navigateTo({url:'/pages/'+page+'/index'});
          } catch {wx.showToast({title:'暂时无法读取账户，请重试',icon:'none'})}
        };
        exports.registerCommunityPage=require('./community-cloud-page').registerCloudCommunityPage;
      `
    })) {
      writeFileSync(join(output, 'services', name + '.js'), stub, 'utf8')
      const sourceMap = join(output, 'services', name + '.js.map')
      if (existsSync(sourceMap)) rmSync(sourceMap)
    }
  }
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
