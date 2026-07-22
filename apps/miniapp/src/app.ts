import { getMiniappClient } from './services/client'

App({
  globalData: {
    client: getMiniappClient()
  }
})
