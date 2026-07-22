import {
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Res,
  StreamableFile
} from '@nestjs/common'
import { DesktopUpdateService } from './desktop-update.service'

type PassthroughResponse = {
  status(code: number): unknown
  setHeader(name: string, value: string): unknown
}

@Controller('desktop-updates/windows')
export class DesktopUpdateController {
  constructor(
    @Inject(DesktopUpdateService)
    private readonly updates: DesktopUpdateService
  ) {}

  @Get(':fileName')
  file(
    @Param('fileName') fileName: string,
    @Headers('range') range: string | undefined,
    @Res({ passthrough: true }) response: PassthroughResponse
  ): StreamableFile {
    const file = this.updates.open(fileName, range)
    response.status(file.statusCode)
    response.setHeader('Accept-Ranges', 'bytes')
    response.setHeader('Content-Type', file.contentType)
    response.setHeader('Content-Length', String(file.contentLength))
    response.setHeader('Cache-Control', file.cacheControl)
    if (file.contentRange) {
      response.setHeader('Content-Range', file.contentRange)
    }
    return new StreamableFile(file.stream)
  }
}
