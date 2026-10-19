import { useState } from 'react'
import type { MapLocationCandidate, MapLocationSearch } from '@zyapp/contracts'
import { getDesktopApi, readableError } from './api'

export function MapLocationPicker({name, address, location, onChange}: {
  name: string; address: string
  location: {latitude: number; longitude: number} | null | undefined
  onChange: (location: {latitude: number; longitude: number} | null) => void
}) {
  const [query, setQuery] = useState<MapLocationSearch>({name, address, city:''})
  const [results, setResults] = useState<MapLocationCandidate[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function search() {
    setBusy(true); setError(''); setResults([])
    try {
      const found = await getDesktopApi().searchMiniappLocation(query)
      setResults(found)
      if (!found.length) setError('未找到位置，请补充城市、门店名称或详细地址后重试。')
    } catch (reason) { setError(readableError(reason)) }
    finally { setBusy(false) }
  }
  return <fieldset disabled={busy}>
    <legend>到店导航</legend>
    <p>填写城市、门店名称和详细地址，搜索后选择正确的位置，再保存草稿并发布。</p>
    <div className="decoration-row">{(['city','name','address'] as const).map(key => <label key={key}>{{city:'所在城市',name:'地图中的门店名称',address:'详细地址'}[key]}<input maxLength={key === 'address' ? 300 : 100} value={query[key]} onChange={event => {setQuery({...query,[key]:event.target.value}); setResults([]); setError('')}} /></label>)}</div>
    <p>搜索文字只用于定位，门店展示资料请在“门店设置”修改。</p>
    <button type="button" className="secondary-button" disabled={!query.city.trim() || !query.name.trim() || !query.address.trim()} onClick={() => void search()}>{busy ? '正在搜索…' : '搜索地图位置'}</button>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    {results.map(row => <article className="decoration-item" key={`${row.provider}-${row.id}`}><strong>{row.name}</strong><p>{row.address}</p><p>{row.provider === 'tencent' ? '腾讯地图' : '高德地图'} · {row.kind === 'poi' ? '地图登记地点' : '地址解析结果，可能仅定位到楼宇或道路，请核对'}</p><button type="button" className="secondary-button" onClick={() => {onChange(row.location); setResults([])}}>使用此位置</button></article>)}
    <p>{location ? `已设置导航位置：${location.longitude.toFixed(6)}，${location.latitude.toFixed(6)}` : '尚未设置导航位置'}</p>
    <button type="button" className="text-button" onClick={() => onChange(null)}>清除导航位置</button>
  </fieldset>
}
