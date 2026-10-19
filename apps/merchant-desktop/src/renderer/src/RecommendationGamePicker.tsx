import { useId, useRef, useState } from 'react'

export function RecommendationGamePicker({ games, value, onChange }: {
  games: Array<{ id: string; name: string }>
  value: string
  onChange: (id: string) => void
}): React.JSX.Element {
  const [query, setQuery] = useState('')
  const dropdown = useRef<HTMLDetailsElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const id = useId()
  const matches = games.filter(game => game.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  return <details className="recommendation-picker" ref={dropdown}
    onToggle={event => { if (event.currentTarget.open) { setQuery(''); search.current?.focus() } }}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false }}
    onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); if (dropdown.current) dropdown.current.open = false; dropdown.current?.querySelector('summary')?.focus() } }}>
    <summary aria-label="选择推荐桌游">{games.find(game => game.id === value)?.name || '请选择桌游（可搜索）'}</summary>
    <div className="recommendation-picker-menu">
      <label htmlFor={id}>搜索桌游</label>
      <input ref={search} id={id} type="search" placeholder="输入桌游名称筛选" value={query} onChange={event => setQuery(event.target.value)} />
      <div className="recommendation-picker-results" aria-label="匹配的桌游">
        {matches.map(game => <button type="button" key={game.id} aria-pressed={game.id === value} onClick={() => {
          onChange(game.id)
          if (dropdown.current) dropdown.current.open = false
          dropdown.current?.querySelector('summary')?.focus()
        }}>{game.name}{game.id === value ? '（已选）' : ''}</button>)}
        {!matches.length ? <p>未找到匹配的桌游，请更换关键词。</p> : null}
      </div>
    </div>
  </details>
}
