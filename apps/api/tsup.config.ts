import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/main.ts'],
  format: ['esm'],
  target: 'node24',
  platform: 'node',
  sourcemap: true,
  clean: true,
  noExternal: [
    '@zyapp/contracts',
    '@zyapp/auth',
    '@zyapp/cloud-db',
    '@zyapp/domain',
    '@zyapp/sync-protocol'
  ]
})
