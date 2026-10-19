import type { PlayPlayer, SavePlay, FieldErrors } from './miniapp-community'

export function rankPlayPlayers(players: PlayPlayer[], mode: string, ranking: SavePlay['ranking'], recordScores = true): PlayPlayer[] {
  if (mode === '合作') return players.map(p => ({ ...p, rank: 1 }))
  if (ranking === 'manual' || !recordScores) return players.map(p => ({ ...p }))
  const units = mode === '团队' ? [...new Map(players.filter(p => p.team).map(p => [p.team!, p])).values()] : players
  const valid = units.filter(p => /^-?\d{1,9}(\.\d{1,4})?$/.test(p.score))
  const scores = valid.map(p => Number(p.score)).sort((a, b) => ranking === 'low' ? a - b : b - a)
  return players.map(p => ({ ...p, rank: /^-?\d{1,9}(\.\d{1,4})?$/.test(p.score) ? scores.indexOf(Number(p.score)) + 1 : 0 }))
}

export function playFieldErrors(input: Pick<SavePlay, 'players'|'mode'|'ranking'|'result'|'note'> & {recordScores?:boolean;resultType?:SavePlay['resultType']}): FieldErrors {
  const errors: FieldErrors = {}
  const scores = input.recordScores !== false
  const type = input.resultType ?? 'ranking'
  if (!input.players.length || input.players.length > 8) errors.players = '玩家人数为1–8人'
  const seen = new Set<string>()
  input.players.forEach((p, i) => {
    const path = `players.${i}`, label = `玩家${i + 1}`
    if (!p.name.trim() || p.name.trim().length > (p.memberId?40:12)) errors[path+'.name'] = `${label}的姓名不能为空且最多${p.memberId?40:12}字`
    if (scores && !/^-?\d{1,9}(\.\d{1,4})?$/.test(p.score)) errors[path+'.score'] = `${label}的得分须为最多9位整数和4位小数`
    if (input.mode === '团队' && (!p.team?.trim() || p.team.trim().length > 12)) errors[path+'.team'] = `${label}请选择队伍`
    if (p.memberId && seen.has(p.memberId)) errors[path+'.name'] = `${label}重复添加了同一会员`
    if (p.memberId) seen.add(p.memberId)
    if (input.mode !== '合作' && type === 'ranking' && (input.ranking === 'manual' || !scores) && (!Number.isInteger(p.rank) || p.rank < 1 || p.rank > 8)) errors[path+'.rank'] = `${label}的名次须为1–8`
    if (input.mode !== '合作' && type !== 'ranking' && !['win','loss','draw'].includes(p.outcome ?? '')) errors[path+'.outcome'] = `${label}请选择胜负结果`
  })
  if (input.mode === '团队') {
    const teams = new Map<string, PlayPlayer>()
    input.players.forEach((p,i) => {
      const prev = p.team ? teams.get(p.team) : undefined
      if (prev && scores && Number(prev.score) !== Number(p.score)) errors[`players.${i}.score`] = '同队玩家共享相同得分'
      if (prev && type !== 'ranking' && prev.outcome !== p.outcome) errors[`players.${i}.outcome`] = '同队玩家共享相同结果'
      if (prev && type === 'ranking' && (input.ranking === 'manual' || !scores) && prev.rank !== p.rank) errors[`players.${i}.rank`] = '同队玩家共享相同名次'
      if (p.team) teams.set(p.team, p)
    })
  }
  if (input.mode === '合作') {
    if (!input.result) errors.result = '请选择合作结果'
    if (scores && input.players.some(p => p.score !== input.players[0]?.score)) errors['players.0.score'] = '合作玩家共享同一得分'
  } else if (type !== 'ranking') {
    const units = input.mode === '团队' ? [...new Map(input.players.map(p => [p.team,p])).values()] : input.players
    const wins = units.filter(p => p.outcome === 'win').length
    const allDraw = units.every(p => p.outcome === 'draw')
    if (!allDraw && (type === 'single' ? wins !== 1 : wins < 1)) errors.resultType = type === 'single' ? '请选择一个获胜玩家或队伍，或设置全员平局' : '请至少选择一个获胜玩家或队伍，或设置全员平局'
    if (!allDraw && units.some(p => p.outcome === 'draw')) errors.resultType = '平局需设置全员平局'
  }
  if (input.note.trim().length > 200) errors.note = '本局备注最多200字'
  return errors
}
