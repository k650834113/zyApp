import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MapLocationService } from './map-location.service'

const input = {name:'据点桌游',city:'襄阳市',address:'襄阳市樊城区谷山大厦A座'}
let directory: string | undefined
function configure(provider = 'tencent') {
  directory = mkdtempSync(join(tmpdir(),'zyapp-map-test-'))
  const path = join(directory,'key'); writeFileSync(path,'private-test-key')
  vi.stubEnv('MAP_LOCATION_KEY_FILE',path); vi.stubEnv('MAP_LOCATION_PROVIDER',provider)
}
afterEach(() => {vi.unstubAllGlobals();vi.unstubAllEnvs(); if(directory) rmSync(directory,{recursive:true,force:true}); directory=undefined})
describe('map location search', () => {
  it('requires configuration and does not call map services without a key', async () => {
    vi.stubEnv('MAP_LOCATION_KEY_FILE',''); const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher)
    await expect(new MapLocationService().search(input)).rejects.toThrow('尚未配置')
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('limits Tencent POI search to the requested city and preserves all candidate choices', async () => {
    configure();const fetcher=vi.fn().mockResolvedValue({ok:true,json:async()=>({status:0,data:[
      {id:'shop',title:'据点桌游',address:input.address,location:{lat:32.04,lng:112.14}},
      {id:'other',title:'同名店',address:'其他地址',location:{lat:32.05,lng:112.15}},
      {id:'invalid',title:'无坐标',location:{lat:100,lng:112}}
    ]})});vi.stubGlobal('fetch',fetcher)
    const result=await new MapLocationService().search(input)
    expect(result).toHaveLength(2);expect(result[0]!.location).toEqual({latitude:32.04,longitude:112.14})
    expect(result[0]).not.toHaveProperty('key')
    expect(new URL(fetcher.mock.calls[0]![0]).searchParams.get('boundary')).toBe('region(襄阳市,0)')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('parses Amap longitude/latitude in the correct order', async () => {
    configure('amap');vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({status:'1',pois:[{id:'shop',name:input.name,pname:'湖北省',cityname:'襄阳市',adname:'樊城区',address:'谷山大厦A座',location:'112.145678,32.045678'}]})}))
    expect((await new MapLocationService().search(input))[0]!.location).toEqual({longitude:112.145678,latitude:32.045678})
  })
  it('labels address fallback separately rather than pretending it is a shop POI', async () => {
    configure();vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce({ok:true,json:async()=>({status:0,data:[]})}).mockResolvedValueOnce({ok:true,json:async()=>({status:0,result:{location:{lat:32,lng:112}}})}))
    expect((await new MapLocationService().search(input))[0]!.kind).toBe('address')
  })
  it('does not expose provider errors or the key when search fails', async () => {
    configure();vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new Error('https://provider/?key=private-test-key')))
    await expect(new MapLocationService().search(input)).rejects.toThrow('地图搜索暂不可用')
  })
  it('rejects blank or oversized fields before making any external request', async () => {
    await expect(new MapLocationService().search({...input,city:''})).rejects.toThrow('有效')
    await expect(new MapLocationService().search({...input,address:'x'.repeat(301)})).rejects.toThrow('有效')
  })
})
