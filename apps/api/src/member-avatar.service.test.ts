import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ApiConfig } from './config'
import { MemberAvatarService } from './member-avatar.service'

const temporaryDirectories: string[] = []

async function service() {
  const directory = await mkdtemp(join(tmpdir(), 'zyapp-avatar-'))
  temporaryDirectories.push(directory)
  return {
    directory,
    avatars: new MemberAvatarService({
      memberAvatarDirectory: directory,
      miniappPublicBaseUrl: 'https://judian.icu/test'
    } as ApiConfig)
  }
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  )
})

describe('MemberAvatarService', () => {
  it('stores a valid image atomically under a generated public URL', async () => {
    const { avatars, directory } = await service()
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])

    const stored = await avatars.store({
      buffer: jpeg,
      originalname: 'avatar.jpg',
      mimetype: 'image/jpeg',
      size: jpeg.length
    })

    expect(stored.publicUrl).toMatch(
      /^https:\/\/judian\.icu\/test\/v1\/public\/member-avatars\/[0-9a-f-]+\.jpg$/
    )
    expect(await readFile(join(directory, stored.fileName))).toEqual(jpeg)
  })

  it.each([
    {
      name: 'oversized files',
      file: {
        buffer: Buffer.alloc(2 * 1024 * 1024 + 1),
        originalname: 'avatar.jpg',
        mimetype: 'image/jpeg',
        size: 2 * 1024 * 1024 + 1
      }
    },
    {
      name: 'content whose magic bytes do not match an image',
      file: {
        buffer: Buffer.from('not-an-image'),
        originalname: 'avatar.png',
        mimetype: 'image/png',
        size: 12
      }
    }
  ])('rejects $name', async ({ file }) => {
    const { avatars } = await service()

    await expect(avatars.store(file)).rejects.toThrow()
  })

  it('serves only generated avatar file names', async () => {
    const { avatars } = await service()

    await expect(avatars.read('../secret.key')).rejects.toThrow(
      'Avatar was not found'
    )
  })
})
