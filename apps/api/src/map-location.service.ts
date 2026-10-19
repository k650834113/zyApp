import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common'
import { readFileSync } from 'node:fs'
import type { MapLocationCandidate, MapLocationSearch } from '@zyapp/contracts'

function text(value: unknown, limit: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > limit) throw new BadRequestException('请填写有效的门店名称、城市和详细地址')
  return value.trim()
}
function point(latitude: unknown, longitude: unknown) {
  if (typeof latitude !== 'number' || typeof longitude !== 'number' || !Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180 || (latitude === 0 && longitude === 0)) return null
  return {latitude, longitude}
}

@Injectable()
export class MapLocationService {
  async search(input: unknown): Promise<MapLocationCandidate[]> {
    const body = input as Partial<MapLocationSearch> | null
    const name = text(body?.name, 100), city = text(body?.city, 100), address = text(body?.address, 300)
    if (/[(),]/.test(city)) throw new BadRequestException('请填写城市名称，例如襄阳市')
    const provider = process.env.MAP_LOCATION_PROVIDER || 'tencent'
    if (provider !== 'tencent' && provider !== 'amap') throw new ServiceUnavailableException('地图服务配置有误，请联系管理员')
    let key: string
    try { key = readFileSync(process.env.MAP_LOCATION_KEY_FILE || '', 'utf8').trim() }
    catch { throw new ServiceUnavailableException('尚未配置地图搜索服务，请联系管理员配置地图 WebService Key') }
    if (!key || /\s/.test(key)) throw new ServiceUnavailableException('地图服务密钥文件无效，请联系管理员')
    const request = async (path: string, params: Record<string,string>) => {
      const url = new URL(path, provider === 'tencent' ? 'https://apis.map.qq.com' : 'https://restapi.amap.com')
      url.search = new URLSearchParams({...params,key}).toString()
      try {
        const response = await fetch(url, {signal:AbortSignal.timeout(5000),redirect:'error'})
        if (!response.ok) throw new Error('HTTP')
        const data = await response.json()
        if (provider === 'tencent' ? data.status !== 0 : data.status !== '1') throw new Error('Provider')
        return data
      } catch { throw new ServiceUnavailableException('地图搜索暂不可用，请检查密钥权限或稍后重试') }
    }
    const found = provider === 'tencent'
      ? await request('/ws/place/v1/search', {keyword:name,boundary:`region(${city},0)`,page_size:'10'})
      : await request('/v3/place/text', {keywords:name,city,citylimit:'true',offset:'10',extensions:'base'})
    const candidates: MapLocationCandidate[] = []
    const rows = provider === 'tencent' ? found.data : found.pois
    for (const row of Array.isArray(rows) ? rows : []) {
      if (!row || (provider === 'amap' && !/^\s*-?\d+(\.\d+)?,-?\d+(\.\d+)?\s*$/.test(String(row.location)))) continue
      const coords = provider === 'tencent' ? [row.location?.lng,row.location?.lat] : String(row.location).split(',').map(Number)
      const location = point(coords[1],coords[0])
      if (!location || !row.id || typeof (row.title ?? row.name) !== 'string') continue
      const fullAddress = provider === 'tencent' ? row.address : [row.pname,row.cityname,row.adname,row.address].filter(v => typeof v === 'string').join('')
      candidates.push({id:String(row.id),name:row.title ?? row.name,address:typeof fullAddress === 'string' ? fullAddress : '',location,provider,kind:'poi'})
    }
    // Address resolution is offered explicitly as a fallback, never silently
    // substituted for a shop POI or automatically published.
    if (candidates.length) return candidates.slice(0,10)
    const resolved = provider === 'tencent'
      ? await request('/ws/geocoder/v1/', {address,region:city})
      : await request('/v3/geocode/geo', {address,city})
    const row = provider === 'tencent' ? resolved.result : resolved.geocodes?.[0]
    if (provider === 'amap' && !/^\s*-?\d+(\.\d+)?,-?\d+(\.\d+)?\s*$/.test(String(row?.location))) return []
    const coords = provider === 'tencent' ? [row?.location?.lng,row?.location?.lat] : String(row?.location).split(',').map(Number)
    const location = point(coords[1],coords[0])
    return location ? [{id:'address',name,address:row?.formatted_address || address,location,provider,kind:'address'}] : []
  }
}
