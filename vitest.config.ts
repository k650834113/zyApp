import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

const workspaceRoot = import.meta.dirname

export default defineConfig({
  resolve: {
    alias: {
      '@zyapp/contracts': resolve(workspaceRoot, 'packages/contracts/src/index.ts'),
      '@zyapp/domain': resolve(workspaceRoot, 'packages/domain/src/index.ts'),
      '@zyapp/auth': resolve(workspaceRoot, 'packages/auth/src/index.ts'),
      '@zyapp/module-registry': resolve(
        workspaceRoot,
        'packages/module-registry/src/index.ts'
      ),
      '@zyapp/local-db': resolve(workspaceRoot, 'packages/local-db/src/index.ts'),
      '@zyapp/cloud-db': resolve(workspaceRoot, 'packages/cloud-db/src/index.ts'),
      '@zyapp/observability': resolve(
        workspaceRoot,
        'packages/observability/src/index.ts'
      ),
      '@zyapp/sync-protocol': resolve(
        workspaceRoot,
        'packages/sync-protocol/src/index.ts'
      )
    }
  },
  test: {
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts'],
    environment: 'node',
    coverage: {
      reporter: ['text', 'html']
    }
  }
})
