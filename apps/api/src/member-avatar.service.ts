import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException
} from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ApiConfig } from './config'
import { API_CONFIG } from './infrastructure.module'

const MAX_AVATAR_BYTES = 2 * 1024 * 1024
const FILE_NAME_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp)$/

export type MemberAvatarUpload = {
  buffer: Buffer
  originalname: string
  mimetype: string
  size: number
}

export type StoredMemberAvatar = {
  fileName: string
  publicUrl: string
  contentType: 'image/jpeg' | 'image/png' | 'image/webp'
}

function detectImage(
  buffer: Buffer
): Pick<StoredMemberAvatar, 'contentType'> & { extension: 'jpg' | 'png' | 'webp' } {
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return { extension: 'jpg', contentType: 'image/jpeg' }
  }
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    )
  ) {
    return { extension: 'png', contentType: 'image/png' }
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { extension: 'webp', contentType: 'image/webp' }
  }
  throw new BadRequestException('Avatar must be a JPEG, PNG, or WebP image')
}

@Injectable()
export class MemberAvatarService {
  private readonly directory: string
  private readonly publicBaseUrl: string

  constructor(@Inject(API_CONFIG) config: ApiConfig) {
    this.directory =
      config.memberAvatarDirectory ??
      `./var/member-avatars/${config.deploymentEnvironment}`
    this.publicBaseUrl =
      config.miniappPublicBaseUrl ?? 'https://localhost'
  }

  async store(file: MemberAvatarUpload): Promise<StoredMemberAvatar> {
    if (
      !Buffer.isBuffer(file?.buffer) ||
      file.buffer.length === 0 ||
      file.size !== file.buffer.length
    ) {
      throw new BadRequestException('Avatar upload is invalid')
    }
    if (file.size > MAX_AVATAR_BYTES) {
      throw new BadRequestException('Avatar must not exceed 2 MiB')
    }
    const detected = detectImage(file.buffer)
    const expectedMime =
      file.mimetype === 'image/jpg' ? 'image/jpeg' : file.mimetype
    if (expectedMime !== detected.contentType) {
      throw new BadRequestException('Avatar content does not match its media type')
    }

    await mkdir(this.directory, { recursive: true })
    const fileName = `${randomUUID()}.${detected.extension}`
    const destination = join(this.directory, fileName)
    const temporary = `${destination}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, file.buffer, { flag: 'wx' })
      await rename(temporary, destination)
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined)
      throw error
    }
    return {
      fileName,
      publicUrl:
        `${this.publicBaseUrl}/v1/public/member-avatars/${fileName}`,
      contentType: detected.contentType
    }
  }

  async read(fileName: string): Promise<{
    buffer: Buffer
    contentType: StoredMemberAvatar['contentType']
  }> {
    const match = FILE_NAME_PATTERN.exec(fileName)
    if (!match) {
      throw new NotFoundException('Avatar was not found')
    }
    const extension = match[1]
    const contentType =
      extension === 'jpg'
        ? 'image/jpeg'
        : extension === 'png'
          ? 'image/png'
          : 'image/webp'
    try {
      return {
        buffer: await readFile(join(this.directory, fileName)),
        contentType
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new NotFoundException('Avatar was not found')
      }
      throw error
    }
  }
}
