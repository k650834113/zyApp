import { MapLocationPicker } from './MapLocationPicker'
import { useEffect, useRef, useState } from 'react'
import type { ActivitySummary, BoardGameSummary, MiniappContentCommand, MiniappContentDraft, MiniappContentWorkspace } from '@zyapp/contracts'
import { getDesktopApi, readableError } from './api'
import { currentMiniappDraft } from './miniapp-current-content'
import { RecommendationGamePicker } from './RecommendationGamePicker'

type Draft = MiniappContentDraft
type ImageKey = 'homeHeroUrl' | 'recommendationHeroUrl' | 'storePhotoUrl'
const emptyDraft: Draft = { schemaVersion: 1 }
const sections = ['首页', '门店介绍', '活动海报', '店家推荐', '收费说明', '协议与帮助']

export function MiniappDecorationPage(): React.JSX.Element {
  const [workspace, setWorkspace] = useState<MiniappContentWorkspace | null>(null)
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [baseline, setBaseline] = useState<Draft>(emptyDraft)
  const [source, setSource] = useState<'current' | 'draft'>('current')
  const [section, setSection] = useState('首页')
  const [games, setGames] = useState<BoardGameSummary[]>([])
  const [expandedRecommendations, setExpandedRecommendations] = useState<Record<number, boolean>>({})
  const [activities, setActivities] = useState<ActivitySummary[]>([])
  const [history, setHistory] = useState<Array<{ revision: string; action: string; createdAt: string }>>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [confirm, setConfirm] = useState<'publish' | 'withdraw' | string | null>(null)
  const pending = useRef<{ json: string; command: MiniappContentCommand } | null>(null)
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline)
  const api = getDesktopApi()

  function accept(next: MiniappContentWorkspace, selected: 'current' | 'draft') {
    const content = selected === 'current' ? currentMiniappDraft(next) : next.draft ?? emptyDraft
    setWorkspace(next); setSource(selected); setDraft(content); setBaseline(content)
    setExpandedRecommendations({})
  }
  async function load(selected: 'current' | 'draft' = 'current') {
    setBusy(true); setError('')
    try {
      const [next, gameList, activityList, revisions] = await Promise.all([
        api.getMiniappContent(), api.listBoardGames(), api.listActivities(), api.getMiniappContentHistory()
      ])
      accept(next, selected); setGames(gameList); setActivities(activityList); setHistory(revisions)
      setNotice(selected === 'current' ? next.current ? '已读取小程序当前内容，可在此基础上修改并保存草稿。' : '当前服务器尚未提供实际内容读取，仅加载已发布装修配置；请更新API后重试。' : '已读取云端草稿，草稿尚未发布。')
    } catch (reason) { setError(readableError(reason)) }
    finally { setBusy(false) }
  }
  useEffect(() => { void load() }, [])
  useEffect(() => {
    const leave = (event: Event) => {
      if (!busy && (!dirty || window.confirm('页面有未保存的修改，确定离开？'))) (event as CustomEvent<() => void>).detail()
    }
    const navigate = (event: Event) => { if (busy || (dirty && !window.confirm('页面有未保存的修改，确定离开？'))) event.preventDefault() }
    const unload = (event: BeforeUnloadEvent) => { if (dirty || busy) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('zyapp:leave-decoration', leave)
    window.addEventListener('beforeunload', unload)
    window.addEventListener('zyapp:before-navigation', navigate)
    return () => { window.removeEventListener('zyapp:leave-decoration', leave); window.removeEventListener('beforeunload', unload); window.removeEventListener('zyapp:before-navigation', navigate) }
  }, [dirty, busy])

  async function execute(action: 'save' | 'publish' | 'withdraw' | 'restore', sourceRevision?: string) {
    if (!workspace || busy) return
    if (action === 'save' && source === 'current' && workspace.draft &&
      JSON.stringify(workspace.draft) !== JSON.stringify(baseline) &&
      !window.confirm('云端已有一份草稿。保存当前内容将替换该草稿，确定保存？')) return
    if (action === 'save' && draft.activityDisplays?.some(row => !row.activityId)) {
      setError('请为每条活动展示选择活动，或移除空白配置'); return
    }
    if (action === 'save' && draft.recommendationDisplays?.some(row => !row.gameId)) {
      setError('请为每条推荐展示选择桌游，或移除空白配置'); return
    }
    setBusy(true); setError(''); setNotice('')
    const content = { ...draft, ...(draft.activityDisplays ? { activityDisplays: draft.activityDisplays.map(row => ({
      ...row, tags: row.tags.map(tag => tag.trim()).filter(Boolean)
    })) } : {}) }
    const body = { expectedRevision: workspace.revision, action,
      ...(action === 'save' ? { content } : action === 'restore' ? { sourceRevision } : {}) }
    const json = JSON.stringify(body)
    const command = pending.current?.json === json ? pending.current.command
      : { ...body, requestId: crypto.randomUUID() } as MiniappContentCommand
    pending.current = { json, command }
    try {
      const next = await api.executeMiniappContent(command)
      accept({ ...next, ...(workspace.current ? {current:workspace.current} : {}) }, 'draft'); pending.current = null; setConfirm(null)
      setNotice(action === 'save' ? '草稿已保存，小程序仍展示上次发布内容' : action === 'publish' ? '内容已发布，小程序刷新后即可看到' : action === 'withdraw' ? '已撤下装修内容' : '历史内容已恢复为草稿，请检查后发布')
      if (action === 'publish' || action === 'withdraw') {
        try {
          const refreshed = await api.getMiniappContent()
          if (refreshed.current) accept({ ...next, current:refreshed.current }, 'draft')
        } catch { setNotice(current => `${current}；当前展示内容尚未刷新，请点击“读取小程序当前内容”重试。`) }
      }
      try { setHistory(await api.getMiniappContentHistory()) }
      catch { setNotice(current => `${current}；发布历史暂未刷新，可稍后重新读取`) }
    } catch (reason) { setError(`${readableError(reason)}。当前编辑内容已保留，可重试；如其他人已修改，请先核对最新云端草稿。`) }
    finally { setBusy(false) }
  }
  function field<K extends keyof Draft>(key: K, value: Draft[K]) { setDraft(current => ({ ...current, [key]: value })) }
  function textField(label: string, key: 'homeHeroTitle' | 'homeHeroSubtitle' | 'storeCaption' | 'storeFooter' | 'recommendationHeroTitle') {
    return <label>{label}<textarea maxLength={500} rows={2} value={draft[key] ?? ''} onChange={event => field(key, event.target.value)} /></label>
  }
  async function upload(set: (url: string) => void) {
    setBusy(true); setError('')
    try { const image = await api.uploadMiniappContentImage(); if (image) set(image.cachedUrl) }
    catch (reason) { setError(readableError(reason)) }
    finally { setBusy(false) }
  }
  function imageField(label: string, key: ImageKey) {
    return <div className="decoration-image-field"><strong>{label}</strong>
      {draft[key] ? <img src={draft[key]!} alt={label} /> : <span>未设置图片</span>}
      <div><button type="button" className="secondary-button" onClick={() => void upload(url => field(key, url))}>选择并上传图片</button>
      <button type="button" className="text-button" onClick={() => field(key, null)}>移除</button></div></div>
  }
  const pricing = draft.pricing ?? { rows: (workspace?.current?.pricing.rows ?? []).filter(row => row.label.trim() === '入场费'), extras: [], memberNote: '' }
  const activityOptions = [...activities, ...(workspace?.current?.home.activities ?? []).filter(row => !activities.some(item => item.id === row.id))]
  const gameOptions = [...games, ...(workspace?.current?.home.recommendedGames ?? []).filter(row => !games.some(item => item.id === row.id))]
  return <section className="panel decoration-panel">
    <div className="panel-heading"><div><h2>页面装修</h2><p>{source === 'current' ? '正在编辑小程序当前内容' : '正在编辑云端草稿'}{workspace?.published ? ` · 已发布 ${new Date(workspace.published.publishedAt).toLocaleString('zh-CN')}` : ' · 尚未发布装修内容'}{dirty ? ' · 有未保存修改' : ''}</p></div>
      <div className="cloud-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => { if (!dirty || window.confirm('放弃未保存修改并读取小程序当前内容？')) void load('current') }}>读取小程序当前内容</button>
        <button type="button" className="secondary-button" disabled={busy || !workspace?.draft} onClick={() => { if (!dirty || window.confirm('放弃未保存修改并读取云端草稿？')) void load('draft') }}>继续编辑草稿</button>
        <button type="button" className="secondary-button" disabled={busy || !workspace} onClick={() => void execute('save')}>保存草稿</button>
        <button type="button" className="primary-button" disabled={busy || dirty || source !== 'draft' || !workspace?.draft} onClick={() => setConfirm('publish')}>发布到小程序</button></div></div>
    {error ? <div className="form-error">{error}</div> : null}{notice ? <div className="success-banner">{notice}</div> : null}
    <p>修改后先保存草稿，再发布。收费说明中的文字只用于展示，实际收银金额在“收费目录”设置。</p>
    {workspace?.current ? <div className="decoration-item"><strong>当前门店：{workspace.current.home.store.name}</strong><p>地址：{workspace.current.home.store.address || '未设置'} · 电话：{workspace.current.home.store.contactPhone || '未设置'} · 营业时间：{workspace.current.home.store.businessHours}</p><p>读取时间：{new Date(workspace.current.readAt).toLocaleString('zh-CN')} · 当前展示 {workspace.current.home.activities.length} 个活动、{workspace.current.home.recommendedGames.length} 个推荐桌游</p><p>门店名称、地址、电话与营业时间来自门店设置；活动内容在“活动发布”修改，推荐桌游可在“店家推荐”添加并发布，也可在“桌游库存”设置推荐状态。</p></div> : null}
    <nav className="miniapp-control-tabs" aria-label="装修页面">{sections.map(item => <button type="button" key={item} className={section === item ? 'primary-button' : 'secondary-button'} onClick={() => setSection(item)}>{item}</button>)}</nav>
    <fieldset disabled={busy || !workspace} className="decoration-fields">
      {section === '首页' ? <>{workspace?.current?.home.activities.length ? <p>当前首页优先轮播活动：{workspace.current.home.activities.map(row => row.title).join('、')}。下方默认主图始终保留，并与进行中的活动封面共同轮播。</p> : null}{imageField('首页主图', 'homeHeroUrl')}{textField('首页标题', 'homeHeroTitle')}{textField('首页副标题', 'homeHeroSubtitle')}</> : null}
      {section === '门店介绍' ? <>{imageField('门店照片', 'storePhotoUrl')}{textField('门店介绍', 'storeCaption')}{textField('页脚文字', 'storeFooter')}
        <MapLocationPicker key={`${workspace?.current?.home.store.name}-${workspace?.current?.home.store.address}`} name={workspace?.current?.home.store.name ?? ''} address={workspace?.current?.home.store.address ?? ''} location={draft.location} onChange={location => field('location', location)} />
        <h3>联系方式</h3>{(draft.contacts ?? []).map((row, i) => <div className="decoration-row" key={row.id}>
          <label>名称<input maxLength={40} value={row.label} onChange={e => field('contacts', draft.contacts!.map((r, n) => n === i ? { ...r, label: e.target.value } : r))} /></label>
          <label>内容<input maxLength={200} value={row.value} onChange={e => field('contacts', draft.contacts!.map((r, n) => n === i ? { ...r, value: e.target.value } : r))} /></label>
          <label>点击操作<select value={row.action} onChange={e => field('contacts', draft.contacts!.map((r, n) => n === i ? { ...r, action: e.target.value as 'copy' | 'phone' } : r))}><option value="copy">复制内容</option><option value="phone">拨打电话</option></select></label>
          <button type="button" className="text-button" onClick={() => field('contacts', draft.contacts!.filter((_, n) => n !== i))}>移除</button></div>)}
        <button type="button" className="secondary-button" disabled={(draft.contacts?.length ?? 0) >= 12} onClick={() => field('contacts', [...(draft.contacts ?? []), { id: crypto.randomUUID(), label: '', value: '', action: 'copy' }])}>添加联系方式</button>
      </> : null}
      {section === '活动海报' ? <><p>先在“活动发布”编辑活动标题、摘要、正文和时间；在此单独配置横向封面与详情海报。封面用于首页轮播和活动列表，建议2:1；详情海报按原比例展示。保存草稿后发布，顾客刷新小程序即可看到。</p>
        {workspace?.current?.home.activities.map(activity => <article className="decoration-item" key={activity.id}><strong>{activity.title}</strong><p>{activity.summary}</p><p>{new Date(activity.startsAt).toLocaleString('zh-CN')} — {new Date(activity.endsAt).toLocaleString('zh-CN')}</p></article>)}
        {(draft.activityDisplays ?? []).map((row, i) => <section className="decoration-item" key={i}>
          <label>活动<select value={row.activityId} onChange={e => field('activityDisplays', draft.activityDisplays!.map((r, n) => n === i ? { ...r, activityId: e.target.value } : r))}><option value="">请选择活动</option>{activityOptions.map(a => <option value={a.id} key={a.id}>{a.title}</option>)}</select></label>
          <strong>活动封面（首页轮播与列表）</strong>
          {row.coverUrl ? <img className="decoration-poster" style={{aspectRatio:'2 / 1',objectFit:'contain'}} src={row.coverUrl} alt="活动封面" /> : <p>未配置封面时展示系统活动卡面，不裁切详情海报。</p>}
          <button type="button" className="secondary-button" onClick={() => void upload(url => field('activityDisplays', draft.activityDisplays!.map((r, n) => n === i ? { ...r, coverUrl: url } : r)))}>上传活动封面</button>
          <button type="button" className="text-button" onClick={() => field('activityDisplays', draft.activityDisplays!.map((r, n) => n === i ? { ...r, coverUrl: null } : r))}>移除活动封面</button>
          <strong>活动详情海报</strong>
          {row.posterUrl ? <img className="decoration-poster" src={row.posterUrl} alt="活动海报" /> : null}
          <button type="button" className="secondary-button" onClick={() => void upload(url => field('activityDisplays', draft.activityDisplays!.map((r, n) => n === i ? { ...r, posterUrl: url } : r)))}>上传海报</button>
          <button type="button" className="text-button" onClick={() => field('activityDisplays', draft.activityDisplays!.map((r, n) => n === i ? { ...r, posterUrl: null } : r))}>移除海报</button>
          <label>地点<input maxLength={100} value={row.locationText} onChange={e => field('activityDisplays', draft.activityDisplays!.map((r, n) => n === i ? { ...r, locationText: e.target.value } : r))} /></label>
          <label>标签（用逗号分隔）<input value={row.tags.join('，')} onChange={e => field('activityDisplays', draft.activityDisplays!.map((r, n) => n === i ? { ...r, tags: e.target.value.split(/[,，]/) } : r))} /></label>
          <button type="button" className="text-button" onClick={() => field('activityDisplays', draft.activityDisplays!.filter((_, n) => n !== i))}>移除此活动展示配置</button>
        </section>)}<button type="button" className="secondary-button" disabled={(draft.activityDisplays?.length ?? 0) >= 50} onClick={() => field('activityDisplays', [...(draft.activityDisplays ?? []), { activityId: '', posterUrl: null, locationText: '', tags: [] }])}>添加活动展示</button></> : null}
      {section === '店家推荐' ? <>{imageField('推荐页主图', 'recommendationHeroUrl')}{textField('推荐页标题', 'recommendationHeroTitle')}
        <p>添加桌游并保存、发布后即可加入小程序推荐列表；库存中已设为推荐的桌游也会展示。私密、停用、缺件或无可用库存的桌游不会展示。</p>
        <details className="decoration-fold"><summary>小程序当前展示（{workspace?.current?.home.recommendedGames.length ?? 0}款）</summary>
          <div className="decoration-fold-body">{workspace?.current?.home.recommendedGames.map(game => <article className="decoration-item recommendation-preview" key={game.id}>{game.imageUrl ? <img src={game.imageUrl} alt={game.name} /> : null}<div><strong>{game.name}</strong><p>{game.recommendationReason || game.customerNote || '暂未设置推荐理由'}</p></div></article>)}</div>
        </details>
        <div className="decoration-row"><strong>推荐配置（{draft.recommendationDisplays?.length ?? 0}款）</strong>
          <button type="button" className="secondary-button" onClick={() => setExpandedRecommendations(Object.fromEntries((draft.recommendationDisplays ?? []).map((_, i) => [i, true])))}>全部展开</button>
          <button type="button" className="secondary-button" onClick={() => setExpandedRecommendations(Object.fromEntries((draft.recommendationDisplays ?? []).map((_, i) => [i, false])))}>全部收起</button>
        </div>
        {(draft.recommendationDisplays ?? []).map((row, i) => <section className="decoration-item" key={i}>
          <button type="button" className="recommendation-toggle" aria-expanded={expandedRecommendations[i] ?? !row.gameId} aria-controls={`recommendation-editor-${i}`} onClick={() => setExpandedRecommendations(current => ({ ...current, [i]: !(current[i] ?? !row.gameId) }))}>
            <strong>{i + 1}. {gameOptions.find(game => game.id === row.gameId)?.name || '未选择桌游'}</strong><span>{(expandedRecommendations[i] ?? !row.gameId) ? '收起 ▴' : '展开编辑 ▾'}</span>
          </button>
          <div id={`recommendation-editor-${i}`} className="recommendation-editor" hidden={!(expandedRecommendations[i] ?? !row.gameId)}>
          <div><span>桌游</span><RecommendationGamePicker games={gameOptions} value={row.gameId} onChange={gameId => {
            setExpandedRecommendations(current => ({ ...current, [i]: true }))
            field('recommendationDisplays', draft.recommendationDisplays!.map((r, n) => n === i ? { ...r, gameId } : r))
          }} /></div>
          <div>推荐分页：{([{id:'two',label:'两人时光'},{id:'group',label:'朋友聚会'}]).map(scene => <label key={scene.id}><input type="checkbox" checked={row.sceneIds.includes(scene.id)} onChange={e => field('recommendationDisplays', draft.recommendationDisplays!.map((r,n) => n === i ? {...r,sceneIds:e.target.checked?[...new Set([...r.sceneIds,scene.id])]:r.sceneIds.filter(id=>id!==scene.id)} : r))}/>{scene.label}</label>)}</div>
          {(['reason', 'audience', 'badge'] as const).map(key => <label key={key}>{{reason:'推荐理由',audience:'适合人群',badge:'角标文字'}[key]}<textarea value={row[key]} maxLength={key === 'reason' ? 500 : key === 'audience' ? 200 : 40} onChange={e => field('recommendationDisplays', draft.recommendationDisplays!.map((r,n) => n === i ? {...r,[key]:e.target.value} : r))} /></label>)}
          <button type="button" className="text-button" onClick={() => {
            field('recommendationDisplays', draft.recommendationDisplays!.filter((_, n) => n !== i))
            setExpandedRecommendations(current => Object.fromEntries(Object.entries(current).filter(([key]) => Number(key) !== i).map(([key, value]) => [Number(key) > i ? Number(key) - 1 : Number(key), value])))
          }}>移除此推荐配置</button>
          </div>
        </section>)}<button type="button" className="secondary-button" disabled={(draft.recommendationDisplays?.length ?? 0) >= 50} onClick={() => {
          setExpandedRecommendations(current => ({ ...current, [draft.recommendationDisplays?.length ?? 0]: true }))
          field('recommendationDisplays', [...(draft.recommendationDisplays ?? []), { gameId: '', reason: '', audience: '', badge: '', sceneIds: [] }])
        }}>添加推荐桌游</button></> : null}
      {section === '收费说明' ? <><h3>收费展示表</h3>{workspace?.current ? <p>单人月卡：{(workspace.current.pricing.monthlyCard.priceFen / 100).toFixed(2)}元 · 有效期{workspace.current.pricing.monthlyCard.durationDays}天（来自月卡配置）</p> : null}<p>只添加希望在小程序展示的项目，移除的项目不会展示。未配置时仅展示默认入场费；项目价格读取真实收费配置；改价请到“收费目录”。</p>{pricing.rows.map((row, i) => <div className="decoration-row" key={i}><label>收费项目<select value={row.label} onChange={e => { const selected = workspace?.current?.pricing.rows.find(r => r.label === e.target.value); if (selected) field('pricing', {...pricing,rows:pricing.rows.map((r,n) => n === i ? {...selected} : r)}) }}><option value={row.label}>{row.label}</option>{(workspace?.current?.pricing.rows ?? []).filter(r => !pricing.rows.some(selected => selected.label === r.label)).map(r => <option key={r.label} value={r.label}>{r.label}</option>)}</select></label><label>普通价<input readOnly value={row.regular} /></label><label>会员价<input readOnly value={row.member} /></label><button type="button" className="text-button" onClick={() => field('pricing', {...pricing, rows:pricing.rows.filter((_,n) => n !== i)})}>移除</button></div>)}
        <button type="button" className="secondary-button" disabled={pricing.rows.length >= 30 || !workspace?.current?.pricing.rows.some(r => !pricing.rows.some(selected => selected.label === r.label))} onClick={() => { const next = workspace?.current?.pricing.rows.find(r => !pricing.rows.some(selected => selected.label === r.label)); if (next) field('pricing', {...pricing,rows:[...pricing.rows,{...next}]}) }}>选择收费项目</button>
        <button type="button" className="secondary-button" disabled={!workspace?.current} onClick={() => { field('pricing', {...pricing, rows:pricing.rows.map(row => workspace?.current?.pricing.rows.find(current => current.label === row.label) ?? row)}); setNotice('已更新所选项目的当前价格；已停用或不存在的项目请移除后再发布。') }}>更新所选项目价格</button>
        <label>会员说明<textarea maxLength={1000} value={pricing.memberNote} onChange={e => field('pricing',{...pricing,memberNote:e.target.value})} /></label>
        <h3>补充说明</h3>{pricing.extras.map((row,i) => <div className="decoration-item" key={i}>{(['label','value','note'] as const).map(key => <label key={key}>{{label:'标题',value:'内容',note:'备注'}[key]}<input value={row[key]} maxLength={key === 'note' ? 500 : 100} onChange={e => field('pricing',{...pricing,extras:pricing.extras.map((r,n) => n===i ? {...r,[key]:e.target.value} : r)})} /></label>)}<button type="button" className="text-button" onClick={() => field('pricing',{...pricing,extras:pricing.extras.filter((_,n) => n!==i)})}>移除</button></div>)}
        <button type="button" className="secondary-button" disabled={pricing.extras.length >= 20} onClick={() => field('pricing',{...pricing,extras:[...pricing.extras,{icon:'receipt',label:'',value:'',note:''}]})}>添加补充说明</button>
        <button type="button" className="text-button" onClick={() => field('pricing', null)}>使用系统默认收费说明</button>
      </> : null}
      {section === '协议与帮助' ? <>{(['agreement','privacy','help'] as const).map(key => {
        const doc = draft.documents?.find(row => row.key === key)
        const update = (patch: Partial<NonNullable<Draft['documents']>[number]>) => field('documents', [
          ...(draft.documents ?? []).filter(row => row.key !== key), { key, title: {agreement:'用户协议',privacy:'隐私政策',help:'使用帮助'}[key], version:'1', body:'', ...doc, ...patch, updatedAt:new Date().toISOString() }])
        return <section className="decoration-item" key={key}><h3>{{agreement:'用户协议',privacy:'隐私政策',help:'使用帮助'}[key]}</h3>
          <label>标题<input maxLength={100} value={doc?.title ?? ''} onChange={e => update({title:e.target.value})} /></label>
          <label>版本<input maxLength={80} value={doc?.version ?? ''} onChange={e => update({version:e.target.value})} /></label>
          <label>正文<textarea rows={12} maxLength={20000} value={doc?.body ?? ''} onChange={e => update({body:e.target.value})} /></label>
          <button type="button" className="text-button" onClick={() => field('documents',(draft.documents ?? []).filter(row => row.key !== key))}>使用默认内容</button></section>
      })}</> : null}
    </fieldset>
    <details className="decoration-history"><summary>发布记录与恢复</summary><p>恢复历史版本只会更新草稿，检查并发布后才影响小程序。</p>
      {history.map(row => <div className="decoration-row" key={row.revision}><span>{new Date(row.createdAt).toLocaleString('zh-CN')} · {{save:'保存草稿',publish:'发布',withdraw:'撤下',restore:'恢复草稿'}[row.action] ?? row.action}</span><button type="button" className="secondary-button" disabled={busy} onClick={() => setConfirm(row.revision)}>恢复为草稿</button></div>)}
      <button type="button" className="secondary-button" disabled={busy || !workspace?.published} onClick={() => setConfirm('withdraw')}>撤下当前装修内容</button></details>
    {confirm ? <div className="modal-backdrop"><section className="modal-card" role="dialog" aria-modal="true" aria-label="确认内容操作">
      <h2>{confirm === 'publish' ? '发布到小程序？' : confirm === 'withdraw' ? '撤下装修内容？' : '恢复历史内容为草稿？'}</h2>
      <p>{confirm === 'publish' ? '顾客刷新小程序后将看到已保存的图片、文字与说明。' : confirm === 'withdraw' ? '小程序将使用系统默认内容，已保存草稿仍保留。' : '当前草稿将被历史内容替换，已发布内容保持不变。'}</p>
      <div className="modal-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => setConfirm(null)}>取消</button><button type="button" className="primary-button" disabled={busy} onClick={() => void execute(confirm === 'publish' || confirm === 'withdraw' ? confirm : 'restore', confirm)}>确认</button></div>
    </section></div> : null}
  </section>
}
