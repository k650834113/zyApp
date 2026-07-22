import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'

const app = await NestFactory.createApplicationContext(AppModule)
app.enableShutdownHooks()
