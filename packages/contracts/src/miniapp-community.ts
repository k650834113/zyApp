export type CommunityGame = { id: string; name: string; imageUrl: string | null }
export type MeetupSummary = {
  id: string; revision: string; game: CommunityGame; title: string; date: string; time: string;
  duration: number; capacity: number; deadline: string; location: string; description: string;
  tags: string[]; participants?: Array<{memberId:string;name:string;avatarUrl:string|null}>; registrationClosed?: boolean; players: string[]; joined: boolean; owned: boolean;
  status: 'open' | 'confirmed' | 'cancelled';
}
export type PlayPlayer = { name: string; score: string; rank: number; team?: string; memberId?: string; avatarUrl?: string | null; outcome?: 'win' | 'loss' | 'draw' }
export type PlayOptions = { recordScores?: boolean; resultType?: 'single' | 'multiple' | 'ranking'; tableId?: string }
export type PlaySummary = PlayOptions & {
  id: string; revision: string; game: CommunityGame; date: string; duration: number;
  mode: string; players: PlayPlayer[]; note: string; visibility: '仅自己' | '参与者'; owned?: boolean;
  ranking: 'high' | 'low' | 'manual'; result: 'win' | 'loss' | 'draw' | null;
}
export type CommunityPage<T> = { items: T[]; hasMore: boolean }
export type CommunityFilters = { offset?: number; limit?: number; mine?: 'joined' | 'owned'; date?: string }
export type CreateMeetup = {
  requestId: string; gameId: string; title: string; date: string; time: string; duration: number;
  capacity: number; deadline: string; description: string; friendly: boolean;
}
export type SavePlay = PlayOptions & {
  requestId: string; id?: string; expectedRevision?: string; gameId: string; date: string;
  duration: number; mode: string; players: PlayPlayer[]; note: string;
  ranking: 'high' | 'low' | 'manual'; result: 'win' | 'loss' | 'draw' | null;
}
export type CommunityMember = { memberId: string; memberNumber: string; name: string; avatarUrl: string | null }
export type FriendRequest = { id: string; member: CommunityMember; incoming: boolean }
export type FriendsSnapshot = { friends: CommunityMember[]; requests: FriendRequest[] }
export type TableSnapshot = { id: string; expiresAt: string; closed: boolean; owned: boolean; members: CommunityMember[] }
export type CommunityInvite = { token: string; imageDataUrl: string; expiresAt: string }
export type FieldErrors = Record<string, string>
