export type AudioStatus = "OFFLINE" | "REQUESTING" | "LIVE" | "ERROR";

export class AudioCapture {
  status: AudioStatus = "OFFLINE";
  error: string | null = null;
  sampleRate = 0;

  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private timeBuf: Float32Array | null = null;
  private freqBuf: Float32Array | null = null;

  get analyserNode(): AnalyserNode | null {
    return this.analyser;
  }

  async start(): Promise<void> {
    if (this.status === "LIVE" || this.status === "REQUESTING") return;
    this.status = "REQUESTING";
    this.error = null;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
        video: false,
      });
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.5;
      analyser.minDecibels = -100;
      analyser.maxDecibels = -20;
      source.connect(analyser);

      this.stream = stream;
      this.ctx = ctx;
      this.source = source;
      this.analyser = analyser;
      this.sampleRate = ctx.sampleRate;
      this.timeBuf = new Float32Array(analyser.fftSize);
      this.freqBuf = new Float32Array(analyser.frequencyBinCount);
      this.status = "LIVE";
    } catch (e) {
      this.status = "ERROR";
      this.error = e instanceof Error ? e.message : "mic denied";
      await this.stop();
    }
  }

  async stop(): Promise<void> {
    this.source?.disconnect();
    this.analyser?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    if (this.ctx && this.ctx.state !== "closed") await this.ctx.close();
    this.source = null;
    this.analyser = null;
    this.stream = null;
    this.ctx = null;
    this.timeBuf = null;
    this.freqBuf = null;
    if (this.status !== "ERROR") this.status = "OFFLINE";
  }

  /** Returns time + frequency (dB) buffers, or null if not live. */
  read(): { time: Float32Array; freqDb: Float32Array; sampleRate: number } | null {
    if (this.status !== "LIVE" || !this.analyser || !this.timeBuf || !this.freqBuf) {
      return null;
    }
    if (this.ctx?.state === "suspended") void this.ctx.resume();
    this.analyser.getFloatTimeDomainData(this.timeBuf as Float32Array<ArrayBuffer>);
    this.analyser.getFloatFrequencyData(this.freqBuf as Float32Array<ArrayBuffer>);
    return {
      time: this.timeBuf,
      freqDb: this.freqBuf,
      sampleRate: this.sampleRate,
    };
  }
}
