import {
  nearestHandle,
  normalizeRange,
  valueFromPosition,
  type RangeHandle
} from '../../services/range-values'

type TouchPoint = { clientX: number }
type TouchEvent = { touches: TouchPoint[]; changedTouches: TouchPoint[] }

Component({
  properties: {
    min: { type: Number, value: 0 },
    max: { type: Number, value: 5 },
    step: { type: Number, value: 1 },
    lower: { type: Number, value: 0 },
    upper: { type: Number, value: 5 },
    unit: { type: String, value: '' }
  },

  data: {
    lowerValue: 0,
    upperValue: 5,
    lowerPercent: 0,
    upperPercent: 100,
    activeHandle: 'lower' as RangeHandle,
    trackLeft: 0,
    trackWidth: 1
  },

  observers: {
    'min,max,step,lower,upper': function syncRange(
      min: number,
      max: number,
      step: number,
      lower: number,
      upper: number
    ) {
      this.updateRange(normalizeRange({ min, max, step, lower, upper }), false)
    }
  },

  lifetimes: {
    attached() {
      this.updateRange(
        normalizeRange({
          min: this.data.min,
          max: this.data.max,
          step: this.data.step,
          lower: this.data.lower,
          upper: this.data.upper
        }),
        false
      )
    }
  },

  methods: {
    updateRange(
      range: { lower: number; upper: number },
      emit: boolean
    ) {
      const span = this.data.max - this.data.min || 1
      this.setData({
        lowerValue: range.lower,
        upperValue: range.upper,
        lowerPercent: ((range.lower - this.data.min) / span) * 100,
        upperPercent: ((range.upper - this.data.min) / span) * 100
      })
      if (emit) this.triggerEvent('change', range)
    },

    start(event: TouchEvent) {
      const point = event.touches[0] ?? event.changedTouches[0]
      if (!point) return
      wx.createSelectorQuery()
        .in(this)
        .select('.range-track')
        .boundingClientRect((rect) => {
          if (!rect || Array.isArray(rect)) return
          const track = rect as { left: number; width: number }
          const value = valueFromPosition({
            x: point.clientX,
            left: track.left,
            width: track.width,
            min: this.data.min,
            max: this.data.max,
            step: this.data.step
          })
          const activeHandle = nearestHandle(
            value,
            this.data.lowerValue,
            this.data.upperValue,
            this.data.activeHandle
          )
          this.setData({
            activeHandle,
            trackLeft: track.left,
            trackWidth: track.width
          })
          this.moveValue(value)
        })
        .exec()
    },

    move(event: TouchEvent) {
      const point = event.touches[0] ?? event.changedTouches[0]
      if (!point) return
      this.moveValue(
        valueFromPosition({
          x: point.clientX,
          left: this.data.trackLeft,
          width: this.data.trackWidth,
          min: this.data.min,
          max: this.data.max,
          step: this.data.step
        })
      )
    },

    moveValue(value: number) {
      const range =
        this.data.activeHandle === 'lower'
          ? normalizeRange({
              min: this.data.min,
              max: this.data.upperValue,
              step: this.data.step,
              lower: value,
              upper: this.data.upperValue
            })
          : normalizeRange({
              min: this.data.lowerValue,
              max: this.data.max,
              step: this.data.step,
              lower: this.data.lowerValue,
              upper: value
            })
      this.updateRange(range, true)
    }
  }
})
