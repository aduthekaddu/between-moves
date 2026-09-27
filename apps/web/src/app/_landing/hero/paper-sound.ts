/**
 * Paper sounds, synthesised rather than sampled: a card piece set down on card, a rubber
 * stamp, a knuckle on the table. Off until someone asks for them.
 */
export class PaperSound {
  private context: AudioContext | null = null;
  private noise: AudioBuffer | null = null;
  private enabled = false;

  get on(): boolean {
    return this.enabled;
  }

  enable() {
    if (this.context === null) {
      this.context = new AudioContext();
      const length = Math.floor(this.context.sampleRate * 0.4);
      this.noise = this.context.createBuffer(1, length, this.context.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    }
    void this.context.resume();
    this.enabled = true;
  }

  disable() {
    this.enabled = false;
  }

  private burst(frequency: number, q: number, decay: number, gain: number, type: BiquadFilterType) {
    const context = this.context;
    if (context === null || this.noise === null || !this.enabled) return;
    const source = context.createBufferSource();
    source.buffer = this.noise;
    const filter = context.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = q;
    const envelope = context.createGain();
    const now = context.currentTime;
    envelope.gain.setValueAtTime(gain, now);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + decay);
    source.connect(filter).connect(envelope).connect(context.destination);
    source.start(now, Math.random() * 0.2);
    source.stop(now + decay + 0.02);
  }

  private thump(frequency: number, decay: number, gain: number) {
    const context = this.context;
    if (context === null || !this.enabled) return;
    const oscillator = context.createOscillator();
    oscillator.type = 'sine';
    const now = context.currentTime;
    oscillator.frequency.setValueAtTime(frequency * 1.6, now);
    oscillator.frequency.exponentialRampToValueAtTime(frequency, now + decay * 0.5);
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(gain, now);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + decay);
    oscillator.connect(envelope).connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + decay + 0.02);
  }

  /** A folded piece set down on the board. */
  tock() {
    this.burst(2600 + Math.random() * 600, 1.4, 0.05, 0.5, 'bandpass');
    this.thump(170, 0.06, 0.35);
  }

  /** The rubber stamp, pressed hard. */
  stamp() {
    this.burst(700, 0.8, 0.12, 0.7, 'lowpass');
    this.thump(95, 0.14, 0.6);
  }

  /** A knuckle rapping the table. */
  tap() {
    this.burst(420, 0.9, 0.09, 0.45, 'lowpass');
    this.thump(120, 0.1, 0.5);
  }
}
