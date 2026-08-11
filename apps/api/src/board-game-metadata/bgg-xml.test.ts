import { describe, expect, it } from 'vitest'
import { parseBggSearchXml, parseBggThingXml } from './bgg-xml'

describe('BGG XML parsing', () => {
  it('normalizes board-game search candidates and alternate names', () => {
    const result = parseBggSearchXml(`
      <items total="1">
        <item type="boardgame" id="13">
          <name type="primary" value="Catan"/>
          <name type="alternate" value="卡坦岛"/>
          <yearpublished value="1995"/>
        </item>
      </items>
    `)

    expect(result).toEqual([{
      source: 'bgg',
      externalId: '13',
      primaryName: 'Catan',
      alternateNames: ['卡坦岛'],
      yearPublished: 1995
    }])
  })

  it('uses the matched alternate name when a search result omits its primary name', () => {
    const result = parseBggSearchXml(`
      <items total="1">
        <item type="boardgame" id="134277">
          <name type="alternate" value="The 7 Wonders of Catan"/>
          <yearpublished value="2012"/>
        </item>
      </items>
    `)

    expect(result).toEqual([{
      source: 'bgg',
      externalId: '134277',
      primaryName: 'The 7 Wonders of Catan',
      alternateNames: [],
      yearPublished: 2012
    }])
  })

  it('rounds complexity, maps Chinese labels and never returns descriptions', () => {
    const details = parseBggThingXml(`
      <items>
        <item type="boardgame" id="13">
          <name type="primary" value="Catan"/>
          <name type="alternate" value="卡坦岛"/>
          <description>This text must never leave the adapter.</description>
          <yearpublished value="1995"/>
          <minplayers value="3"/>
          <maxplayers value="4"/>
          <minplaytime value="60"/>
          <maxplaytime value="120"/>
          <thumbnail>https://example.com/catan-thumb.jpg</thumbnail>
          <image>https://example.com/catan.jpg</image>
          <link type="boardgamecategory" value="Economic"/>
          <link type="boardgamemechanic" value="Trading"/>
          <statistics><ratings><averageweight value="2.29"/></ratings></statistics>
        </item>
      </items>
    `, { imagesEnabled: true, fetchedAt: '2026-08-03T00:00:00.000Z' })

    expect(details).toMatchObject({
      source: 'bgg',
      externalId: '13',
      primaryName: 'Catan',
      alternateNames: ['卡坦岛'],
      yearPublished: 1995,
      minPlayers: 3,
      maxPlayers: 4,
      minMinutes: 60,
      maxMinutes: 120,
      complexityRating: 2.3,
      categories: ['经营'],
      mechanics: ['交易'],
      thumbnailUrl: 'https://example.com/catan-thumb.jpg',
      imageUrl: 'https://example.com/catan.jpg',
      sourceUrl: 'https://boardgamegeek.com/boardgame/13'
    })
    expect(JSON.stringify(details)).not.toContain('description')
  })

  it('rejects malformed or non-board-game items', () => {
    expect(() => parseBggSearchXml('<items><item type="rpg" id="13"/></items>'))
      .toThrow(/board.?game/i)
    expect(() => parseBggThingXml('<items><item type="boardgame" id="0"/></items>'))
      .toThrow(/id/i)
  })

  it('treats zero play time as unknown instead of an unsavable duration', () => {
    const details = parseBggThingXml(`
      <items>
        <item type="boardgame" id="13">
          <name type="primary" value="Catan"/>
          <minplayers value="3"/>
          <maxplayers value="4"/>
          <minplaytime value="0"/>
          <maxplaytime value="0"/>
        </item>
      </items>
    `)
    expect(details.minMinutes).toBeNull()
    expect(details.maxMinutes).toBeNull()
  })
})
