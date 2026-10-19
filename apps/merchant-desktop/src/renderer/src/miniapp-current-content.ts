import type { MiniappContentDraft, MiniappContentWorkspace } from '@zyapp/contracts'

export function currentMiniappDraft(workspace: MiniappContentWorkspace): MiniappContentDraft {
  const home = workspace.current?.home
  const published = home ? home.content : workspace.published
  const source: MiniappContentDraft & { revision?: string; publishedAt?: string } =
    published?.schemaVersion === 1 ? published : { schemaVersion: 1 }
  const { revision: _revision, publishedAt: _publishedAt, ...content } = source
  if (!home) return content
  return {
    ...content,
    homeHeroTitle: content.homeHeroTitle || home.store.name,
    recommendationHeroTitle: content.recommendationHeroTitle || '店家推荐',
    pricing: content.pricing ?? {
      rows: (workspace.current?.pricing.rows ?? []).filter(row => row.label.trim() === '入场费'),
      extras: [], memberNote: ''
    },
    activityDisplays: [...(content.activityDisplays ?? []).filter(row => !home.activities.some(activity => activity.id === row.activityId)), ...home.activities.map(activity => ({
      activityId: activity.id, posterUrl: activity.posterUrl ?? null,
      ...(activity.coverUrl !== undefined ? { coverUrl: activity.coverUrl } :
        content.activityDisplays?.find(row => row.activityId === activity.id)?.coverUrl !== undefined ?
          { coverUrl: content.activityDisplays.find(row => row.activityId === activity.id)!.coverUrl } : {}),
      locationText: activity.locationText ?? '', tags: activity.tags ?? []
    }))],
    recommendationDisplays: [...(content.recommendationDisplays ?? []).filter(row => !home.recommendedGames.some(game => game.id === row.gameId)), ...home.recommendedGames.map(game => ({
      gameId: game.id, reason: game.recommendationReason || game.customerNote || '',
      audience: game.recommendationAudience || '', badge: game.recommendationBadge || '',
      sceneIds: game.recommendationSceneIds ?? []
    }))]
  }
}
