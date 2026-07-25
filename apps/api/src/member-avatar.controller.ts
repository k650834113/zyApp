import {
  Controller,
  Get,
  Header,
  Inject,
  Param,
  StreamableFile
} from '@nestjs/common'
import { MemberAvatarService } from './member-avatar.service'

@Controller('public/member-avatars')
export class MemberAvatarController {
  constructor(
    @Inject(MemberAvatarService)
    private readonly avatars: MemberAvatarService
  ) {}

  @Get(':fileName')
  @Header('Cache-Control', 'public, max-age=31536000, immutable')
  async read(@Param('fileName') fileName: string): Promise<StreamableFile> {
    const avatar = await this.avatars.read(fileName)
    return new StreamableFile(avatar.buffer, {
      type: avatar.contentType,
      length: avatar.buffer.length
    })
  }
}
