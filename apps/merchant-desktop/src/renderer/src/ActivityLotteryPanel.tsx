import {useEffect,useRef,useState} from 'react'
import type {ActivitySummary,LotteryCommand,LotteryConfig,LotteryEntry,LotteryMember,LotteryWorkspace} from '@zyapp/contracts'
import {getDesktopApi,readableError} from './api'

function beijing(value:string){return new Date(Date.parse(value)+8*3600000).toISOString().slice(0,16)}
function display(value:string){return beijing(value).replace('T',' ')}
function initial(activity:ActivitySummary):LotteryConfig{
  return {startsAt:activity.startsAt,closesAt:activity.endsAt,drawAt:activity.endsAt,multipleEntries:false,repeatWinners:false,rules:'到店联系工作人员报名，奖品由门店手动发放。',prizes:[{id:crypto.randomUUID(),name:'一等奖',description:'',count:1}]}
}
function exportCsv(name:string,rows:(string|number)[][]){
  const csv='\ufeff'+rows.map(row=>row.map(cell=>'"'+String(cell).replace(/^[=+@\-\t\r]/,"'$&").replaceAll('"','""')+'"').join(',')).join('\r\n')
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=name+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
}
export function ActivityLotteryPanel({activity,canManage,onClose}:{activity:ActivitySummary;canManage:boolean;onClose:()=>void}){
  const [state,setState]=useState<LotteryWorkspace|null>(null),[config,setConfig]=useState<LotteryConfig>(()=>initial(activity))
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[phone,setPhone]=useState(''),[member,setMember]=useState<LotteryMember|null>(null),[query,setQuery]=useState(''),[visibleCount,setVisibleCount]=useState(50)
  const [change,setChange]=useState<LotteryEntry|null>(null),[reason,setReason]=useState(''),[confirmDraw,setConfirmDraw]=useState(false)
  const pending=useRef<{payload:string;requestId:string}|null>(null),lookup=useRef(0),[clock,setClock]=useState(Date.now())
  useEffect(()=>{const timer=setInterval(()=>setClock(Date.now()),1000);return()=>clearInterval(timer)},[])
  async function load(){setBusy(true);setError('');try{const value=await getDesktopApi().getLottery(activity.id);setState(value);setConfig(value.config??initial(activity))}catch(e){setError(readableError(e))}finally{setBusy(false)}}
  useEffect(()=>{void load();return()=>{lookup.current++}},[activity.id])
  async function execute(command:Omit<LotteryCommand,'requestId'>){
    if(busy)return;const payload=JSON.stringify(command)
    if(pending.current?.payload!==payload)pending.current={payload,requestId:crypto.randomUUID()}
    setBusy(true);setError('');setNotice('')
    try{const next=await getDesktopApi().executeLottery({...command,requestId:pending.current!.requestId} as LotteryCommand);setState(next);setConfig(next.config!);pending.current=null;setChange(null);setConfirmDraw(false);setReason('');setNotice('操作成功，已保存至云端')}catch(e){setError(readableError(e))}finally{setBusy(false)}
  }
  function send(command:({action:'configure';config:LotteryConfig}|{action:'register';memberId:string}|{action:'entry-status';entryId:string;active:boolean;reason:string}|{action:'draw'})){
    if(state)void execute({...command,activityId:activity.id,expectedRevision:state.revision})
  }
  async function find(){const sequence=++lookup.current;setBusy(true);setError('');setMember(null);try{const m=await getDesktopApi().findLotteryMember(activity.id,phone.trim());if(sequence===lookup.current){setMember(m);if(!m)setError('未找到有效会员，请先办理会员')}}catch(e){if(sequence===lookup.current)setError(readableError(e))}finally{setBusy(false)}}
  const open=!!state?.config&&!state.result&&clock>=Date.parse(state.config.startsAt)&&clock<Date.parse(state.config.closesAt)
  const configEditable=canManage&&!state?.result&&(!state?.config||clock<Date.parse(state.config.closesAt))
  const valid=state?.entries.filter(e=>e.active)??[],entries=state?.entries.filter(e=>[e.phone,e.name,e.memberNumber].some(v=>v.includes(query.trim())))??[]
  return <div className="modal-backdrop"><section className="modal-card lottery-panel" role="dialog" aria-modal="true" aria-label="活动报名与抽奖">
    <header className="form-heading"><h2>{activity.title} · 报名与抽奖</h2><p>时间均为北京时间；报名和开奖需要在线。奖品手动发放。</p><button type="button" disabled={busy} onClick={onClose}>关闭</button> <button type="button" disabled={busy} onClick={()=>void load()}>刷新云端数据</button></header>
    {error&&<div className="form-error" role="alert">{error}</div>}{notice&&<div className="success-banner">{notice}</div>}
    {!state?<p>{busy?'正在读取…':'暂不可用，请确认活动已同步至云端后刷新。'}</p>:<>
      <h3>抽奖配置</h3>
      {state.rulesLocked&&<p>已有报名：报名次数、重复中奖规则及时间已锁定。</p>}
      <fieldset disabled={busy||!configEditable}>
        {(['startsAt','closesAt','drawAt'] as const).map(key=><label key={key}>{{startsAt:'报名开始',closesAt:'报名截止',drawAt:'可开奖时间'}[key]}<input type="datetime-local" value={beijing(config[key])} disabled={state.rulesLocked} onChange={e=>{if(e.target.value)setConfig({...config,[key]:e.target.value+':00+08:00'})}}/></label>)}
        <label>报名次数<select value={config.multipleEntries?'multiple':'once'} disabled={state.rulesLocked} onChange={e=>setConfig({...config,multipleEntries:e.target.value==='multiple'})}><option value="once">每人限一次</option><option value="multiple">允许多次报名，每次增加一个机会</option></select></label>
        <label>重复中奖<select value={config.repeatWinners?'repeat':'once'} disabled={state.rulesLocked} onChange={e=>setConfig({...config,repeatWinners:e.target.value==='repeat'})}><option value="once">同一会员最多中奖一次</option><option value="repeat">允许凭不同报名机会重复中奖</option></select></label>
        <label>活动规则<textarea maxLength={5000} value={config.rules} onChange={e=>setConfig({...config,rules:e.target.value})}/></label>
        <p>按下列顺序一次抽完全部奖项；名额不足时保留空缺。</p>
        {config.prizes.map((p,i)=><div className="lottery-prize" key={p.id}><strong>第{i+1}个奖项</strong><input aria-label="奖项名称" placeholder="奖项名称" value={p.name} maxLength={100} onChange={e=>setConfig({...config,prizes:config.prizes.map((v,n)=>n===i?{...v,name:e.target.value}:v)})}/><input aria-label="奖品说明" placeholder="奖品说明" value={p.description} maxLength={500} onChange={e=>setConfig({...config,prizes:config.prizes.map((v,n)=>n===i?{...v,description:e.target.value}:v)})}/><label>名额<input type="number" min={1} max={1000} value={p.count} onChange={e=>setConfig({...config,prizes:config.prizes.map((v,n)=>n===i?{...v,count:Number(e.target.value)}:v)})}/></label><button type="button" disabled={i===0} onClick={()=>{const prizes=[...config.prizes];[prizes[i-1],prizes[i]]=[prizes[i]!,prizes[i-1]!];setConfig({...config,prizes})}}>上移</button><button type="button" disabled={config.prizes.length===1} onClick={()=>setConfig({...config,prizes:config.prizes.filter(v=>v.id!==p.id)})}>移除</button></div>)}
        <button type="button" disabled={config.prizes.length>=50} onClick={()=>setConfig({...config,prizes:[...config.prizes,{id:crypto.randomUUID(),name:'',description:'',count:1}]})}>添加奖项</button> <button type="button" onClick={()=>send({action:'configure',config})}>保存抽奖配置</button>
      </fieldset>
      {!canManage&&<p>仅店长可配置奖项和开奖，工作人员可登记、作废及恢复报名。</p>}
      <h3>报名登记 · {valid.length}次有效报名 / {new Set(valid.map(e=>e.memberId)).size}位会员</h3>
      <p>{!state.config?'请先由店长保存配置':state.result?'已开奖，名单已冻结':open?'报名进行中':'尚未开始或报名已截止'}</p>
      <div><input aria-label="会员手机号" placeholder="完整会员手机号" maxLength={11} value={phone} disabled={busy||!open} onChange={e=>{lookup.current++;setPhone(e.target.value);setMember(null)}}/><button type="button" disabled={busy||!open} onClick={()=>void find()}>查找会员</button></div>
      {member&&<p>{member.name} · {member.memberNumber} · {member.phone} <button type="button" disabled={busy||!open} onClick={()=>send({action:'register',memberId:member.memberId})}>确认登记一次报名</button></p>}
      <input aria-label="搜索报名" placeholder="按手机号、昵称、会员编号筛选" value={query} onChange={e=>{setQuery(e.target.value);setVisibleCount(50)}}/>
      <button type="button" disabled={busy} onClick={()=>exportCsv(activity.title+'-报名名单',[
        ['报名ID','会员编号','昵称','手机号','报名时间（北京时间）','登记员工','状态','变更记录'],...state.entries.map(e=>[e.id,e.memberNumber,e.name,e.phone,display(e.createdAt),e.actorId,e.active?'有效':'已作废',e.changes.map(c=>`${display(c.at)} ${c.actorId} ${c.active?'恢复':'作废'}：${c.reason}`).join('；')])])}>导出全部报名</button>
      <div className="lottery-table"><table><thead><tr><th>会员</th><th>手机号</th><th>报名时间</th><th>操作员工 / 状态</th><th>操作与历史</th></tr></thead><tbody>{entries.slice(0,visibleCount).map(e=><tr key={e.id}><td>{e.name}<br/>{e.memberNumber}</td><td>{e.phone}</td><td>{display(e.createdAt)}</td><td>{e.actorId}<br/>{e.active?'有效':'已作废'}</td><td><button type="button" disabled={busy||!open} onClick={()=>{setChange(e);setReason('')}}>{e.active?'作废':'恢复'}</button>{e.changes.map((c,i)=><p key={i}>{display(c.at)} {c.active?'恢复':'作废'}：{c.reason}（{c.actorId}）</p>)}</td></tr>)}</tbody></table>{!entries.length&&<p>暂无匹配记录</p>}{visibleCount<entries.length&&<button type="button" onClick={()=>setVisibleCount(n=>n+50)}>加载更多（已显示{Math.min(visibleCount,entries.length)}/{entries.length}）</button>}</div>
      {change&&<div className="lottery-confirm"><h3>{change.active?'作废':'恢复'} {change.name} 的本次报名</h3><input aria-label="操作原因" placeholder="填写原因" value={reason} maxLength={500} onChange={e=>setReason(e.target.value)}/><button type="button" disabled={busy||!reason.trim()} onClick={()=>send({action:'entry-status',entryId:change.id,active:!change.active,reason})}>确认</button><button type="button" disabled={busy} onClick={()=>setChange(null)}>取消</button></div>}
      {canManage&&!state.result&&<button type="button" className="primary-button" disabled={busy||!state.config||clock<Date.parse(state.config.drawAt)||clock<Date.parse(state.config.closesAt)} onClick={()=>setConfirmDraw(true)}>手动开奖 · 一次抽完全部奖项</button>}
      {confirmDraw&&state.config&&<div className="lottery-confirm"><h3>确认开奖</h3><p>有效报名 {valid.length} 次，{new Set(valid.map(e=>e.memberId)).size} 位会员。{state.config.multipleEntries?'允许多次报名':'每人限一次报名'}；{state.config.repeatWinners?'允许重复中奖':'每位会员最多中奖一次'}。</p><ol>{state.config.prizes.map(p=><li key={p.id}>{p.name} · {p.description} · {p.count}名</li>)}</ol><p>开奖后冻结名单和结果，不可重抽。</p><button type="button" disabled={busy} onClick={()=>send({action:'draw'})}>确认并开奖</button><button type="button" disabled={busy} onClick={()=>setConfirmDraw(false)}>取消</button></div>}
      {state.result&&<section><h3>中奖结果 · {display(state.result.drawnAt)}</h3><p>开奖员工：{state.result.actorId}</p><button type="button" onClick={()=>exportCsv(activity.title+'-中奖名单',[
        ['奖项','奖品','会员编号','昵称','手机号','报名机会ID','开奖时间（北京时间）'],...state.result!.prizes.flatMap(p=>p.winners.map(w=>[p.name,p.description,w.memberNumber,w.name,w.phone,w.entryId,display(state.result!.drawnAt)])),...state.result!.prizes.filter(p=>p.vacancies>0).map(p=>[p.name,p.description,'',`空缺${p.vacancies}名`,'','',display(state.result!.drawnAt)])])}>导出中奖名单</button>{state.result.prizes.map(p=><div key={p.id}><h4>{p.name} · {p.description}</h4>{p.winners.map(w=><p key={w.entryId}>{w.name} · {w.memberNumber} · {w.phone}</p>)}{p.vacancies>0&&<p>空缺 {p.vacancies} 名</p>}</div>)}</section>}
    </>}
  </section></div>
}
