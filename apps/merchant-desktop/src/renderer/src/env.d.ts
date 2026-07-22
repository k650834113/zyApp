/// <reference types="vite/client" />

import type { DesktopApi } from '@zyapp/contracts'

declare global {
  interface Window {
    zyapp?: DesktopApi
  }
}

export {}
