import type { MemberSelfServiceSummary } from '@zyapp/contracts'
import type { MiniappClient } from './types'

export async function saveOptionalAvatarProfile(
  client: Pick<
    MiniappClient,
    'updateMemberProfile' | 'updateMemberProfileWithAvatar'
  >,
  nickname: string,
  localAvatarPath: string,
  confirmDefaultAvatar: (error: Error) => Promise<boolean>
): Promise<MemberSelfServiceSummary> {
  if (!localAvatarPath) {
    return client.updateMemberProfile(nickname)
  }
  try {
    return await client.updateMemberProfileWithAvatar(
      nickname,
      localAvatarPath
    )
  } catch (cause) {
    const error =
      cause instanceof Error ? cause : new Error('头像上传失败')
    if (!(await confirmDefaultAvatar(error))) throw error
    return client.updateMemberProfile(nickname)
  }
}
