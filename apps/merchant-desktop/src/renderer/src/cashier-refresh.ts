import type {
  CashierMemberOption,
  CatalogItemSummary,
  DesktopApi,
  MonthlyCardDetails,
  SalesOrderSummary,
  WalletDetails
} from '@zyapp/contracts'

type CashierRefreshApi = Pick<
  DesktopApi,
  | 'listCatalogItems'
  | 'listRecentOrders'
  | 'listCashierMembers'
  | 'getWalletDetails'
  | 'getMonthlyCardDetails'
  | 'refreshCashierData'
>

export type CashierSnapshot = {
  catalog: CatalogItemSummary[]
  orders: SalesOrderSummary[]
  members: CashierMemberOption[]
  selectedMember: CashierMemberOption | null
  walletDetails: WalletDetails | null
  monthlyCard: MonthlyCardDetails | null
}

export async function refreshCashierSnapshot(
  api: CashierRefreshApi,
  selectedMemberId: string | null
): Promise<CashierSnapshot> {
  await api.refreshCashierData()
  const [catalog, orders, members] = await Promise.all([
    api.listCatalogItems(),
    api.listRecentOrders({ limit: 20 }),
    api.listCashierMembers()
  ])
  const selectedMember =
    members.find((member) => member.id === selectedMemberId) ?? null
  if (!selectedMember) {
    return {
      catalog,
      orders,
      members,
      selectedMember: null,
      walletDetails: null,
      monthlyCard: null
    }
  }
  const [walletDetails, monthlyCard] = await Promise.all([
    api.getWalletDetails({ memberId: selectedMember.id }),
    api.getMonthlyCardDetails({ memberId: selectedMember.id })
  ])
  return {
    catalog,
    orders,
    members,
    selectedMember,
    walletDetails,
    monthlyCard
  }
}
