import type { Pool, PoolClient } from '@zyapp/cloud-db'

export type ResolvedRechargeGiftTier = {
  id: string
  principalFen: number
  giftFen: number
}

type TemplateRow = {
  id: string
  payload_json: unknown
  override_payload_json: unknown
}

type ProjectedTierRow = {
  id: string
  principal_fen: number | string
  gift_fen: number | string
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }
  return value as Record<string, unknown>
}

function safeInteger(value: unknown, name: string): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${name} must be a safe integer`)
  }
  return parsed
}

function normalizeTiers(
  values: Array<{
    id: string
    principalFen: unknown
    giftFen: unknown
  }>
): ResolvedRechargeGiftTier[] {
  const principals = new Set<number>()
  const tiers = values.map((value) => {
    const principalFen = safeInteger(
      value.principalFen,
      'tier.principalFen'
    )
    const giftFen = safeInteger(value.giftFen, 'tier.giftFen')
    if (principalFen <= 0) {
      throw new Error('tier.principalFen must be positive')
    }
    if (giftFen < 0) {
      throw new Error('tier.giftFen must be non-negative')
    }
    if (principals.has(principalFen)) {
      throw new Error('tier.principalFen values must be unique')
    }
    principals.add(principalFen)
    return {
      id: value.id,
      principalFen,
      giftFen
    }
  })
  return tiers.sort((left, right) => left.principalFen - right.principalFen)
}

export async function resolveRechargeGiftRules(
  queryable: Pool | PoolClient,
  tenantId: string,
  storeId: string
): Promise<ResolvedRechargeGiftTier[]> {
  const template = await queryable.query<TemplateRow>(
    `SELECT template.id::text, template.payload_json,
            override.payload_json override_payload_json
     FROM cloud_merchant_business_template template
     LEFT JOIN cloud_store_business_template_override override
       ON override.tenant_id = template.tenant_id
      AND override.store_id = $2 AND override.template_id = template.id
      AND override.active = TRUE
     WHERE template.tenant_id = $1
       AND template.template_type = 'recharge_gift_tier'
       AND template.active = TRUE
     ORDER BY template.created_at, template.id LIMIT 1`,
    [tenantId, storeId]
  )
  const templateRow = template.rows[0]
  if (templateRow) {
    const resolvedPayload = {
      ...record(templateRow.payload_json),
      ...record(templateRow.override_payload_json)
    }
    const rawTiers = resolvedPayload.tiers
    if (rawTiers === undefined) return []
    if (!Array.isArray(rawTiers)) {
      throw new Error('recharge gift template tiers must be an array')
    }
    return normalizeTiers(
      rawTiers.map((value, index) => {
        const tier = record(value)
        return {
          id: `${templateRow.id}:${index}`,
          principalFen: tier.principalFen,
          giftFen: tier.giftFen
        }
      })
    )
  }

  const projected = await queryable.query<ProjectedTierRow>(
    `SELECT id, principal_fen, gift_fen
     FROM cloud_recharge_gift_tier
     WHERE tenant_id = $1 AND store_id = $2 AND active = TRUE
     ORDER BY principal_fen`,
    [tenantId, storeId]
  )
  return normalizeTiers(
    projected.rows.map((tier) => ({
      id: tier.id,
      principalFen: tier.principal_fen,
      giftFen: tier.gift_fen
    }))
  )
}
