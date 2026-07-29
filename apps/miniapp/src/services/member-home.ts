import type {
  MemberRechargeConfiguration,
  MemberSelfServiceHistory
} from '@zyapp/contracts'

type MemberHomeClient = {
  getHistory(): Promise<MemberSelfServiceHistory>
  getRechargeConfiguration(): Promise<MemberRechargeConfiguration>
}

export async function loadMemberHomeDetails(
  client: MemberHomeClient,
  rechargeEnabled: boolean
): Promise<{
  history: MemberSelfServiceHistory
  rechargeConfiguration: MemberRechargeConfiguration | null
}> {
  const [history, rechargeConfiguration] = await Promise.all([
    client.getHistory(),
    rechargeEnabled ? client.getRechargeConfiguration() : Promise.resolve(null)
  ])
  return { history, rechargeConfiguration }
}
