import { Test } from '@nestjs/testing'
import { describe, expect, it } from 'vitest'
import {
  POSTGRES_POOL,
  REDIS_CLIENT
} from '../infrastructure.module'
import { DeviceAuthGuard } from '../device-auth.guard'
import {
  BOARD_GAME_METADATA_ADAPTER,
  type BoardGameMetadataAdapter
} from './bgg-adapter'
import { BoardGameMetadataController } from './board-game-metadata.controller'
import { BoardGameMetadataService } from './board-game-metadata.service'
import { BggRequestGate } from './request-gate'

describe('board-game metadata dependency wiring', () => {
  it('resolves the service request gate through an explicit runtime token', async () => {
    const adapter: BoardGameMetadataAdapter = {
      source: 'bgg',
      enabled: true,
      imagesEnabled: false,
      search: async () => [],
      details: async (externalId) => ({
        source: 'bgg',
        externalId,
        primaryName: 'Fixture Game',
        alternateNames: [],
        yearPublished: null,
        minPlayers: 1,
        maxPlayers: 1,
        minMinutes: null,
        maxMinutes: null,
        complexityRating: null,
        categories: [],
        mechanics: [],
        thumbnailUrl: null,
        imageUrl: null,
        sourceUrl: `https://boardgamegeek.com/boardgame/${externalId}`,
        fetchedAt: '2026-08-06T00:00:00.000Z'
      })
    }
    const module = await Test.createTestingModule({
      providers: [
        BoardGameMetadataService,
        BggRequestGate,
        { provide: POSTGRES_POOL, useValue: { query: async () => ({ rows: [] }) } },
        { provide: REDIS_CLIENT, useValue: {} },
        { provide: BOARD_GAME_METADATA_ADAPTER, useValue: adapter }
      ]
    }).compile()

    expect(module.get(BoardGameMetadataService)).toBeInstanceOf(
      BoardGameMetadataService
    )
    await module.close()
  })

  it('resolves the controller service through an explicit runtime token', async () => {
    const parameterTypes = Reflect.getMetadata(
      'design:paramtypes',
      BoardGameMetadataController
    )
    Reflect.deleteMetadata('design:paramtypes', BoardGameMetadataController)
    try {
      const module = await Test.createTestingModule({
          controllers: [BoardGameMetadataController],
          providers: [
            {
              provide: BoardGameMetadataService,
              useValue: {
                status: async () => ({
                  source: 'bgg',
                  enabled: true,
                  imagesEnabled: false
                }),
                search: async () => [],
                details: async (externalId: string) => ({ externalId })
              }
            }
          ]
        })
        .overrideGuard(DeviceAuthGuard)
        .useValue({ canActivate: () => true })
        .compile()

      const controller = module.get(BoardGameMetadataController)
      await expect(
        controller.status(
          {
            zyappDevice: {
              tenantId: '11111111-1111-4111-8111-111111111111',
              storeId: '22222222-2222-4222-8222-222222222222',
              deviceId: '33333333-3333-4333-8333-333333333333',
              environment: 'test'
            }
          } as never,
          '44444444-4444-4444-8444-444444444444'
        )
      ).resolves.toEqual({
        source: 'bgg',
        enabled: true,
        imagesEnabled: false
      })
      await module.close()
    } finally {
      if (parameterTypes !== undefined) {
        Reflect.defineMetadata(
          'design:paramtypes',
          parameterTypes,
          BoardGameMetadataController
        )
      }
    }
  })
})
