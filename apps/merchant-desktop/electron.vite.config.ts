import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

const workspaceRoot = resolve(import.meta.dirname, '../..')
const publicEndpointsPath = resolve(
  workspaceRoot,
  'config/public-endpoints.local.json'
)

type PublicEndpointConfiguration = {
  desktopProductionApiBaseUrl: string
  desktopTestApiBaseUrl: string
  miniappTestApiBaseUrl: string
  miniappTestStoreId: string
}

function readPublicEndpoints(): PublicEndpointConfiguration {
  const empty: PublicEndpointConfiguration = {
    desktopProductionApiBaseUrl: '',
    desktopTestApiBaseUrl: '',
    miniappTestApiBaseUrl: '',
    miniappTestStoreId: ''
  }
  if (!existsSync(publicEndpointsPath)) return empty
  const parsed = JSON.parse(
    readFileSync(publicEndpointsPath, 'utf8')
  ) as Partial<PublicEndpointConfiguration>
  return Object.fromEntries(
    Object.keys(empty).map((key) => [
      key,
      typeof parsed[key as keyof PublicEndpointConfiguration] === 'string'
        ? parsed[key as keyof PublicEndpointConfiguration]?.trim()
        : ''
    ])
  ) as PublicEndpointConfiguration
}

const publicEndpointDefinitions = {
  __ZYAPP_PUBLIC_ENDPOINTS__: JSON.stringify(readPublicEndpoints())
}
const aliases = {
  '@zyapp/contracts': resolve(workspaceRoot, 'packages/contracts/src/index.ts'),
  '@zyapp/domain': resolve(workspaceRoot, 'packages/domain/src/index.ts'),
  '@zyapp/auth': resolve(workspaceRoot, 'packages/auth/src/index.ts'),
  '@zyapp/module-registry': resolve(workspaceRoot, 'packages/module-registry/src/index.ts'),
  '@zyapp/local-db': resolve(workspaceRoot, 'packages/local-db/src/index.ts'),
  '@zyapp/observability': resolve(workspaceRoot, 'packages/observability/src/index.ts')
}

export default defineConfig({
  main: {
    define: publicEndpointDefinitions,
    resolve: {
      alias: aliases
    },
    build: {
      rollupOptions: {
        external: ['electron', 'node:sqlite']
      }
    }
  },
  preload: {
    resolve: {
      alias: aliases
    },
    build: {
      rollupOptions: {
        external: ['electron']
      }
    }
  },
  renderer: {
    define: publicEndpointDefinitions,
    resolve: {
      alias: aliases
    },
    plugins: [react()]
  }
})
