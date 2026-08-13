import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { BoardGameEditorModal } from './BoardGameEditorModal'
import { defaultBoardGameEditor } from './board-game-editor'

function render(coverCacheError: string | null): string {
  return renderToStaticMarkup(createElement(BoardGameEditorModal, {
    busy: false,
    baseGames: [],
    coverCacheError,
    editor: {
      ...defaultBoardGameEditor(),
      bggId: '13',
      imageUrl: 'https://cf.geekdo-images.com/catan.jpg',
      coverSource: 'bgg'
    },
    onCancel: vi.fn(),
    onChange: vi.fn(),
    onImportImage: vi.fn(),
    onRetryCoverCache: vi.fn(),
    onSubmit: vi.fn(),
    onUseDefaultCoverAndSubmit: vi.fn()
  }))
}

describe('BoardGameEditorModal', () => {
  it('renders the wide two-pane editor with cover preview and BGG source', () => {
    const html = render(null)

    expect(html).toContain('game-editor-shell')
    expect(html).toContain('game-editor-source-pane')
    expect(html).toContain('game-editor-fields-pane')
    expect(html).toContain('封面预览')
    expect(html).toContain('BGG #13')
    expect(html).toContain('Powered by BGG')
    expect(html).not.toContain('重试缓存')
  })

  it('shows all explicit recovery actions after cover caching fails', () => {
    const html = render('BGG 封面缓存失败')

    expect(html).toContain('BGG 封面缓存失败')
    expect(html).toContain('重试缓存')
    expect(html).toContain('上传本地图片')
    expect(html).toContain('使用默认封面并保存')
  })
})
