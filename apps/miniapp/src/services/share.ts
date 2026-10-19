const MINIAPP_NAME = '据点桌游'

export function createShareAppMessage(
  pageTitle: string
): WechatMiniprogram.Page.ICustomShareContent {
  return {
    title: `${MINIAPP_NAME}｜${pageTitle}`
  }
}
