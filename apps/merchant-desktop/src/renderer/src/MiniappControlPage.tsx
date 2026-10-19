import { useState } from 'react'
import type { SessionUser } from '@zyapp/contracts'
import { BoardGamePage } from './BoardGamePage'
import { ActivityPage } from './ActivityPage'
import { AnnouncementPage } from './AnnouncementPage'
import { MiniappDecorationPage } from './MiniappDecorationPage'

export function MiniappControlPage({ session }: { session: SessionUser }): React.JSX.Element {
  const tabs = [
    ...(session.permissions.includes('content.manage') ? [{ id: 'decoration', label: '当前内容与装修' }] : []),
    ...(session.permissions.includes('content.read') ? [
      { id: 'games', label: '桌游库存' }, { id: 'announcements', label: '公告管理' }] : []),
    ...(session.permissions.includes('activity.read') ? [{ id: 'activities', label: '活动发布' }] : [])
  ]
  const [tab, setTab] = useState(tabs[0]?.id ?? '')
  return <>
    <header className="page-header"><div><p className="eyebrow">顾客看到的小程序内容</p><h1>小程序控制</h1>
      <p>读取小程序当前展示内容，在此基础上修改、保存草稿并发布。</p></div></header>
    <nav className="miniapp-control-tabs" aria-label="小程序控制子页面">{tabs.map(item =>
      <button key={item.id} type="button" aria-current={tab === item.id ? 'page' : undefined}
        className={tab === item.id ? 'primary-button' : 'secondary-button'} onClick={() => {
          if (tab === 'decoration') window.dispatchEvent(new CustomEvent('zyapp:leave-decoration', { detail: () => setTab(item.id) }))
          else setTab(item.id)
        }}>{item.label}</button>)}</nav>
    {tab === 'games' ? <BoardGamePage session={session} /> : null}
    {tab === 'activities' ? <ActivityPage session={session} /> : null}
    {tab === 'announcements' ? <AnnouncementPage session={session} /> : null}
    {tab === 'decoration' ? <MiniappDecorationPage /> : null}
  </>
}
