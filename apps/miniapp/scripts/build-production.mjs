import { configureProductionBuildEnvironment } from './production-build-environment.mjs'

configureProductionBuildEnvironment(process.env)

await import('./build.mjs')
