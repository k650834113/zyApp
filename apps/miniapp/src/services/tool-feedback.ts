type FeedbackTone = 'touch' | 'ready' | 'success' | 'roll' | 'coin'

type ToneNote = {
  frequency: number
  duration: number
  offset?: number
  volume?: number
}

let audioContext: WechatMiniprogram.WebAudioContext | null = null

function context(): WechatMiniprogram.WebAudioContext | null {
  try {
    if (!audioContext) audioContext = wx.createWebAudioContext()
    if (audioContext.state === 'suspended') void audioContext.resume()
    return audioContext
  } catch {
    return null
  }
}

function notesFor(tone: FeedbackTone, variant: number): ToneNote[] {
  const touchFrequency = 360 + (Math.abs(Math.trunc(variant)) % 8) * 48
  switch (tone) {
    case 'touch':
      return [{ frequency: touchFrequency, duration: 0.06, volume: 0.045 }]
    case 'ready':
      return [
        { frequency: 480, duration: 0.08, volume: 0.04 },
        { frequency: 620, duration: 0.08, offset: 0.08, volume: 0.045 }
      ]
    case 'success':
      return [
        { frequency: 523, duration: 0.11, volume: 0.05 },
        { frequency: 659, duration: 0.11, offset: 0.1, volume: 0.055 },
        { frequency: 784, duration: 0.16, offset: 0.2, volume: 0.06 }
      ]
    case 'roll':
      return [
        { frequency: 220, duration: 0.06, volume: 0.035 },
        { frequency: 280, duration: 0.06, offset: 0.07, volume: 0.04 },
        { frequency: 360, duration: 0.08, offset: 0.14, volume: 0.045 }
      ]
    case 'coin':
      return [
        { frequency: 1050, duration: 0.05, volume: 0.04 },
        { frequency: 1380, duration: 0.08, offset: 0.05, volume: 0.05 }
      ]
  }
}

export function playToolTone(tone: FeedbackTone, variant = 0): void {
  const audio = context()
  if (!audio) return
  try {
    const startAt = audio.currentTime + 0.01
    for (const note of notesFor(tone, variant)) {
      const oscillator = audio.createOscillator() as any
      const gain = audio.createGain() as any
      const noteStart = startAt + (note.offset ?? 0)
      const noteEnd = noteStart + note.duration
      oscillator.type = 'sine'
      oscillator.frequency.setValueAtTime(note.frequency, noteStart)
      gain.gain.setValueAtTime(0.0001, noteStart)
      gain.gain.exponentialRampToValueAtTime(note.volume ?? 0.05, noteStart + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.0001, noteEnd)
      oscillator.connect(gain)
      gain.connect(audio.destination)
      oscillator.start(noteStart)
      oscillator.stop(noteEnd + 0.01)
    }
  } catch {
    // Audio feedback is progressive enhancement; the tool remains fully usable without it.
  }
}
