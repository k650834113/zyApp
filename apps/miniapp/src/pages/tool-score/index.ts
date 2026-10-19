import { getMiniappClient } from '../../services/client'
import {communityApi,requireMember,chooseFriend,operationKey,inviteEnvironment,writeInviteImage,scanCommunityInvite} from '../../services/social'
import type {CommunityMember} from '@zyapp/contracts'
import { scoreTotals } from '../../services/tabletop-tools'
import {rememberScoreDraft} from '../../services/community-model'
import {openCommunityPage} from '../../services/community-page'
import { createShareAppMessage } from '../../services/share'

type ScorePlayer = { id: number; name: string; memberId?:string; avatarUrl?:string|null }
type ScoreRow = { id: number; values: string[] }
type IndexEvent = { currentTarget: { dataset: { index?: number | string } } }
type ScoreCellEvent = WechatMiniprogram.Input & {
  currentTarget: {
    dataset: { rowIndex?: number | string; playerIndex?: number | string }
  }
}
type NameEvent = WechatMiniprogram.Input & {
  currentTarget: { dataset: { index?: number | string } }
}

type StoredSheet = {
  players: ScorePlayer[]
  rows: ScoreRow[]
  tableId?:string
}

const storageKey = 'zyapp-tabletop-score-v2'
let nextPlayerId = 2
let nextRowId = 2
let pendingSheet: StoredSheet | null = null
let persistTimer: ReturnType<typeof setTimeout> | null = null

function defaultPlayers(): ScorePlayer[] {
  return [
    { id: 1, name: '玩家 1' }
  ]
}

function defaultRows(): ScoreRow[] {
  return [{ id: 1, values: [''] }]
}

function validStoredSheet(value: unknown): value is StoredSheet {
  if (!value || typeof value !== 'object') return false
  const sheet = value as Partial<StoredSheet>
  if (!Array.isArray(sheet.players) || sheet.players.length < 1 || sheet.players.length > 8) return false
  if (!Array.isArray(sheet.rows) || sheet.rows.length < 1 || sheet.rows.length > 100) return false
  if (sheet.tableId !== undefined && typeof sheet.tableId !== 'string') return false
  if (!sheet.players.every((player) =>
    player && typeof player.id === 'number' && typeof player.name === 'string'
  )) return false
  return sheet.rows.every((row) =>
    row &&
    typeof row.id === 'number' &&
    Array.isArray(row.values) &&
    row.values.length === sheet.players?.length &&
    row.values.every((cell) => typeof cell === 'string')
  )
}

function cleanScoreInput(raw: unknown): string {
  const source = String(raw ?? '').replace(/，/g, '.').slice(0, 16)
  const negative = source.startsWith('-')
  const unsigned = source.replace(/-/g, '').replace(/[^\d.]/g, '')
  const dotIndex = unsigned.indexOf('.')
  const integerPart = (dotIndex >= 0 ? unsigned.slice(0, dotIndex) : unsigned).slice(0, 7)
  const decimalPart = dotIndex >= 0 ? unsigned.slice(dotIndex + 1).replace(/\./g, '').slice(0, 4) : ''
  const decimal = dotIndex >= 0 ? `.${decimalPart}` : ''
  return `${negative ? '-' : ''}${integerPart}${decimal}`
}

function displayTotal(value: number): string {
  if (Number.isInteger(value)) return String(value)
  return value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')
}

function totalsFor(rows: readonly ScoreRow[], playerCount: number): string[] {
  return scoreTotals(rows.map((row) => row.values), playerCount).map(displayTotal)
}

function persistSheet(sheet: StoredSheet): void {
  try {
    wx.setStorageSync(storageKey, sheet)
  } catch {
    // Keep the live score usable even when local storage is unavailable.
  }
}

Page({
  onShareAppMessage() {
    return createShareAppMessage('计分器')
  },

  data: {
    players: defaultPlayers(),
    rows: defaultRows(),
    totals: ['0'],
    tableWidth: 312,
    tableId:'',codePath:'',socialError:'',socialBusy:false,tableClosed:false,tableMembers:[] as CommunityMember[]
  },

  visible:false,restored:false,memberInitialized:false,selfPlayer:null as ScorePlayer|null,pollTimer:null as ReturnType<typeof setTimeout>|null,sequence:0,suppressed:new Set<string>(),
  onLoad() {
    try {
      const stored = wx.getStorageSync(storageKey) as unknown
      if (validStoredSheet(stored)) {
        this.restored=true
        this.setData({tableId:stored.tableId??''})
        nextPlayerId = Math.max(...stored.players.map((player) => player.id)) + 1
        nextRowId = Math.max(...stored.rows.map((row) => row.id)) + 1
        this.setSheet(stored.players, stored.rows, false)
      }
    } catch {
      // Storage failure should never block an in-progress tabletop game.
    }
  },

  onHide() {
    this.visible=false;this.sequence++;this.stopPolling()
    this.flushPersist()
  },

  onUnload() {
    this.visible=false;this.sequence++;this.stopPolling()
    this.flushPersist()
  },

  onShow(){this.visible=true;void this.initializeMember();void this.pollTable()},
  async initializeMember(){
    if(this.memberInitialized)return
    const sequence=this.sequence
    try{const member=await getMiniappClient().getMemberSummary();if(!member||!this.visible||sequence!==this.sequence)return
      this.selfPlayer={id:1,name:member.nickname,memberId:member.memberId,avatarUrl:member.avatarUrl};this.memberInitialized=true
      if(this.restored)return
      this.setSheet(this.data.players.map((p,i)=>i===0?{...p,...this.selfPlayer!}:p),this.data.rows)
    }catch{/* Guests can keep using the local tool. */}
  },
  stopPolling(){if(this.pollTimer)clearTimeout(this.pollTimer);this.pollTimer=null},
  async pollTable(){
    this.stopPolling();if(!this.visible||!this.data.tableId)return
    const sequence=this.sequence
    try{const table=await communityApi().getTable(this.data.tableId);if(!this.visible||sequence!==this.sequence)return
      if(!table.owned)throw new Error('请由同桌发起者计分')
      this.setData({tableClosed:table.closed,tableMembers:table.members,socialError:''})
      for(const member of table.members)if(!this.suppressed.has(member.memberId))this.addMember(member)
      if(table.closed)return
    }catch(e){if(this.visible&&sequence===this.sequence)this.setData({socialError:e instanceof Error?e.message:'同桌加载失败'})}
    if(this.visible&&sequence===this.sequence)this.pollTimer=setTimeout(()=>void this.pollTable(),4000)
  },
  addMember(member:CommunityMember){
    if(this.data.players.some(p=>p.memberId===member.memberId))return
    let index=this.data.players.findIndex((p,i)=>!p.memberId&&p.name===`玩家 ${i+1}`&&this.data.rows.every(r=>!r.values[i]))
    if(index>=0){this.setSheet(this.data.players.map((p,i)=>i===index?{...p,name:member.name,memberId:member.memberId,avatarUrl:member.avatarUrl}:p),this.data.rows);return}
    if(this.data.players.length>=8){this.setData({socialError:'计分表已满8人，请移除临时玩家后重试'});return}
    this.setSheet([...this.data.players,{id:nextPlayerId++,name:member.name,memberId:member.memberId,avatarUrl:member.avatarUrl}],this.data.rows.map(r=>({...r,values:[...r.values,'']})))
  },
  async socialRun(run:()=>Promise<void>){if(this.data.socialBusy)return;this.setData({socialBusy:true,socialError:''});try{await run()}catch(e){this.setData({socialError:e instanceof Error?e.message:'操作失败'})}finally{this.setData({socialBusy:false})}},
  async addFriend(){await this.socialRun(async()=>{const m=await chooseFriend(this.data.players.flatMap(p=>p.memberId?[p.memberId]:[]));if(m)this.addMember(m)})},
  async showTableCode(){await this.socialRun(async()=>{await requireMember();if(!this.data.tableId||this.data.tableClosed){const t=await communityApi().createTable(operationKey());this.suppressed.clear();this.setData({tableId:t.id,tableClosed:false});this.schedulePersist(this.data.players,this.data.rows)}
    const invite=await communityApi().createInvite({requestId:operationKey(),tableId:this.data.tableId,envVersion:inviteEnvironment()});this.setData({codePath:await writeInviteImage(invite.imageDataUrl)});void this.pollTable()
  })},
  async closeTable(){await this.socialRun(async()=>{await communityApi().closeTable(this.data.tableId,operationKey());this.stopPolling();this.setData({tableClosed:true,codePath:''})})},
  hideCode(){this.setData({codePath:''})},scan:scanCommunityInvite,
  async requestTableFriend(e:{currentTarget:{dataset:{id:string}}}){await this.socialRun(async()=>{await communityApi().friendCommand('request',{requestId:operationKey(),memberId:e.currentTarget.dataset.id});wx.showToast({title:'申请已发送',icon:'none'})})},
  schedulePersist(players: ScorePlayer[], rows: ScoreRow[]) {
    pendingSheet = { players, rows,...(this.data.tableId?{tableId:this.data.tableId}:{}) }
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = setTimeout(() => this.flushPersist(), 180)
  },

  flushPersist() {
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = null
    if (!pendingSheet) return
    persistSheet(pendingSheet)
    pendingSheet = null
  },

  setSheet(players: ScorePlayer[], rows: ScoreRow[], shouldPersist = true) {
    this.setData({
      players,
      rows,
      totals: totalsFor(rows, players.length),
      tableWidth: 124 + players.length * 188
    })
    if (shouldPersist) this.schedulePersist(players, rows)
  },

  inputName(event: NameEvent) {
    const index = Number(event.currentTarget.dataset.index)
    if (!Number.isSafeInteger(index) || !this.data.players[index]) return
    if(this.data.players[index]?.memberId)return
    const name = String(event.detail.value ?? '').slice(0, 12)
    const players = this.data.players.map((player, playerIndex) =>
      playerIndex === index ? { ...player, name } : player
    )
    this.setData({ [`players[${index}].name`]: name })
    this.schedulePersist(players, this.data.rows)
    return name
  },

  inputScore(event: ScoreCellEvent) {
    const rowIndex = Number(event.currentTarget.dataset.rowIndex)
    const playerIndex = Number(event.currentTarget.dataset.playerIndex)
    const row = this.data.rows[rowIndex]
    if (!row || !this.data.players[playerIndex]) return
    const value = cleanScoreInput(event.detail.value)
    const rows = this.data.rows.map((item, index) =>
      index === rowIndex
        ? { ...item, values: item.values.map((cell, cellIndex) => cellIndex === playerIndex ? value : cell) }
        : item
    )
    this.setData({
      [`rows[${rowIndex}].values[${playerIndex}]`]: value,
      totals: totalsFor(rows, this.data.players.length)
    })
    this.schedulePersist(this.data.players, rows)
    return value
  },

  addPlayer() {
    if (this.data.players.length >= 8) return
    const players = [
      ...this.data.players,
      { id: nextPlayerId++, name: `玩家 ${this.data.players.length + 1}` }
    ]
    const rows = this.data.rows.map((row) => ({ ...row, values: [...row.values, ''] }))
    this.setSheet(players, rows)
  },

  removePlayer(event: IndexEvent) {
    const index = Number(event.currentTarget.dataset.index)
    if (this.data.players.length <= 1 || !this.data.players[index]) return
    const removed=this.data.players[index];if(removed?.memberId)this.suppressed.add(removed.memberId)
    const players = this.data.players.filter((_, playerIndex) => playerIndex !== index)
    const rows = this.data.rows.map((row) => ({
      ...row,
      values: row.values.filter((_, playerIndex) => playerIndex !== index)
    }))
    this.setSheet(players, rows)
  },

  addRow() {
    if (this.data.rows.length >= 100) {
      wx.showToast({ title: '最多记录 100 行分值', icon: 'none' })
      return
    }
    const rows = [
      ...this.data.rows,
      { id: nextRowId++, values: this.data.players.map(() => '') }
    ]
    this.setSheet(this.data.players, rows)
  },

  removeRow(event: IndexEvent) {
    const index = Number(event.currentTarget.dataset.index)
    if (this.data.rows.length <= 1 || !this.data.rows[index]) return
    this.setSheet(
      this.data.players,
      this.data.rows.filter((_, rowIndex) => rowIndex !== index)
    )
  },

  finishGame(){
    if(this.data.socialBusy)return
    wx.showModal({
      title:'结束并重置',content:'是否保存本局？保存成功后重置；直接重置将不保存本局。',
      confirmText:'保存对局',cancelText:'直接重置',confirmColor:'#175540',
      success:result=>{
        if(result.confirm){
          rememberScoreDraft({...(this.data.tableId?{tableId:this.data.tableId}:{}),players:this.data.players.map((player,index)=>({name:player.name,...(player.memberId?{memberId:player.memberId,avatarUrl:player.avatarUrl??null}:{}),score:this.data.totals[index]??'0',rank:index+1})),onSaved:()=>this.resetGame()})
          void openCommunityPage('play-create')
        }else if(result.cancel)this.resetGame()
      }
    })
  },
  resetGame(){
    this.sequence++;this.stopPolling();this.suppressed.clear();this.restored=false
    this.setData({tableId:'',tableClosed:false,tableMembers:[],codePath:'',socialError:''})
    this.setSheet(this.selfPlayer?[{...this.selfPlayer}]:defaultPlayers(),defaultRows())
    this.flushPersist()
    if(this.visible)void this.initializeMember()
  },
  resetScores() {
    wx.showModal({
      title: '清空所有分值？',
      content: '玩家名称会保留，分值记录将恢复为一行空表格。',
      confirmText: '清空',
      confirmColor: '#a74e3f',
      success: (result) => {
        if (!result.confirm) return
        const rows = [{ id: nextRowId++, values: this.data.players.map(() => '') }]
        this.setSheet(this.data.players, rows)
      }
    })
  }
})
