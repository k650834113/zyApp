import { wheelColors, wheelSlots, wheelStopAngle, type WheelItem } from '../../services/wheel'
import { createShareAppMessage } from '../../services/share'

type InputEvent = { detail: { value: string }; currentTarget: { dataset: { id: number; field: string } } }

Page({
  data: {
    items: [{ id: 1, name: '项目 A', count: 1 }, { id: 2, name: '项目 B', count: 1 }, { id: 3, name: '项目 C', count: 1 }] as WheelItem[],
    colors: wheelColors,
    total: 3, angle: 0, transition: 'none',
    phase: 'idle', selectedId: -1, selectedSlot: -1, result: '', error: ''
  },
  spinTimer: null as ReturnType<typeof setInterval> | null,
  stopTimer: null as ReturnType<typeof setTimeout> | null,
  nextId: 4,
  onReady() { this.drawWheel() },
  onShareAppMessage() { return createShareAppMessage('自定义转盘') },
  onHide() { this.cancelSpin() },
  onUnload() { this.cancelSpin() },
  cancelSpin() {
    if (this.spinTimer) clearInterval(this.spinTimer)
    if (this.stopTimer) clearTimeout(this.stopTimer)
    this.spinTimer = null
    this.stopTimer = null
    if (this.data.phase !== 'idle') {
      this.setData({ phase: 'idle', angle: 0, transition: 'none', selectedId: -1, selectedSlot: -1, result: '' })
    }
  },
  refresh() {
    let error = ''
    let total = 0
    try { total = wheelSlots(this.data.items).length } catch (cause) { error = (cause as Error).message }
    this.setData({ total, error, selectedId: -1, selectedSlot: -1, result: '', angle: 0, transition: 'none' }, () => this.drawWheel())
  },
  editItem(event: InputEvent) {
    if (this.data.phase !== 'idle') return
    const { id, field } = event.currentTarget.dataset
    const items = this.data.items.map(item => item.id !== Number(id) ? item : {
      ...item,
      ...(field === 'name' ? { name: event.detail.value } : { count: /^\d+$/.test(event.detail.value) ? Number(event.detail.value) : 0 })
    })
    this.setData({ items }, () => this.refresh())
  },
  addItem() {
    if (this.data.phase !== 'idle') return
    if (this.data.items.length >= 12) { wx.showToast({ title: '最多添加 12 个项目', icon: 'none' }); return }
    this.setData({ items: [...this.data.items, { id: this.nextId++, name: '', count: 1 }] }, () => this.refresh())
  },
  removeItem(event: { currentTarget: { dataset: { id: number } } }) {
    if (this.data.phase !== 'idle') return
    this.setData({ items: this.data.items.filter(item => item.id !== Number(event.currentTarget.dataset.id)) }, () => this.refresh())
  },
  toggleSpin() {
    if (this.data.phase === 'stopping') return
    if (this.data.phase === 'running') {
      if (this.spinTimer) clearInterval(this.spinTimer)
      this.spinTimer = null
      const slots = wheelSlots(this.data.items)
      const slot = Math.floor(Math.random() * slots.length)
      this.setData({ phase: 'stopping', transition: 'transform 1800ms cubic-bezier(0.12, 0.7, 0.15, 1)', angle: wheelStopAngle(this.data.angle, slot, slots.length) })
      this.stopTimer = setTimeout(() => {
        const selectedId = slots[slot] as number
        const result = this.data.items.find(item => item.id === selectedId)?.name ?? ''
        this.setData({ phase: 'idle', selectedId, selectedSlot: slot, result }, () => this.drawWheel())
        wx.vibrateShort({ type: 'medium' })
        this.stopTimer = null
      }, 1800)
      return
    }
    if (this.data.error || !this.data.total) return
    this.setData({ phase: 'running', selectedId: -1, selectedSlot: -1, result: '', transition: 'none', angle: this.data.angle % 360 }, () => this.drawWheel())
    this.spinTimer = setInterval(() => this.setData({ angle: this.data.angle + 15 }), 30)
  },
  drawWheel() {
    const ctx = wx.createCanvasContext('wheel', this)
    const size = 300
    const center = size / 2
    ctx.clearRect(0, 0, size, size)
    if (!this.data.total) { ctx.setFillStyle('#e5e8df'); ctx.beginPath(); ctx.arc(center, center, 146, 0, Math.PI * 2); ctx.fill(); ctx.draw(); return }
    const slots = wheelSlots(this.data.items)
    const step = Math.PI * 2 / slots.length
    slots.forEach((id, index) => {
      const itemIndex = this.data.items.findIndex(item => item.id === id)
      const start = -Math.PI / 2 + index * step
      ctx.beginPath()
      ctx.moveTo(center, center)
      ctx.arc(center, center, 146, start, start + step)
      ctx.closePath()
      ctx.setFillStyle(index === this.data.selectedSlot ? '#ffb521' : wheelColors[itemIndex % wheelColors.length] as string)
      ctx.fill()
      ctx.setStrokeStyle(index === this.data.selectedSlot ? '#87450b' : '#fffdf9')
      ctx.setLineWidth(index === this.data.selectedSlot ? 4 : 1)
      ctx.stroke()
      ctx.save()
      ctx.translate(center, center)
      ctx.rotate(start + step / 2)
      ctx.setFillStyle('#203d30')
      ctx.setFontSize(slots.length > 24 ? 9 : 12)
      ctx.setTextAlign('right')
      const name = this.data.items[itemIndex]?.name ?? ''
      ctx.fillText(name.length > 6 ? name.slice(0, 5) + '…' : name, 133, 4)
      ctx.restore()
    })
    ctx.draw()
  }
})
