import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  importBoardGameImage,
  readManagedBoardGameImage
} from './board-game-image'

describe('board-game image storage', () => {
  it('copies supported images into the managed directory and rejects escapes', () => {
    const directory = mkdtempSync(join(tmpdir(), 'zyapp-game-image-'))
    try {
      const sourceDirectory = join(directory, 'source')
      mkdirSync(sourceDirectory)
      const source = join(sourceDirectory, 'cover.png')
      writeFileSync(
        source,
        Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZsfcAAAAASUVORK5CYII=',
          'base64'
        )
      )
      const imported = importBoardGameImage(source, directory)
      expect(imported.previewDataUrl).toMatch(/^data:image\/png;base64,/)
      expect(readManagedBoardGameImage(imported.managedPath, directory)).toBe(
        imported.previewDataUrl
      )
      expect(() =>
        readManagedBoardGameImage(source, directory)
      ).toThrow('不属于')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
