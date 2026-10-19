import { decorationAssets } from '../../services/decoration-assets'
Component({
  properties: {
    kind: { type: String, value: 'empty' },
    src: { type: String, value: '' },
    mode: { type: String, value: 'aspectFit' }
  },
  data: { imageUrl: '', local: '', failed: false },
  lifetimes: {
    attached() {
      const asset = this.data.kind === 'hero' ? decorationAssets.hero : this.data.kind === 'logo' ? decorationAssets.logo : decorationAssets.empty
      this.setData({ imageUrl: this.data.src || asset.url, local: asset.local, failed: false })
    }
  },
  observers: {
    'kind, src'(kind: string, src: string) {
      const asset = kind === 'hero' ? decorationAssets.hero : kind === 'logo' ? decorationAssets.logo : decorationAssets.empty
      this.setData({ imageUrl: src || asset.url, local: asset.local, failed: false })
    }
  },
  methods: {
    imageError() {
      if (!this.data.failed) this.setData({ imageUrl: this.data.local, failed: true })
    }
  }
})
