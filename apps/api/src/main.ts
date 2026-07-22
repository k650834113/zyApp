import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
import { API_CONFIG } from './infrastructure.module'
import type { ApiConfig } from './config'
import { redirectLegacyDesktopUpdate } from './desktop-update-legacy'

const app = await NestFactory.create(AppModule)
const config = app.get<ApiConfig>(API_CONFIG)
app.enableShutdownHooks()
app.use('/desktop-updates/windows', redirectLegacyDesktopUpdate)
app.setGlobalPrefix('v1')
await app.listen(config.port, '0.0.0.0')
