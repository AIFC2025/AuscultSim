// Human Phonocardiogram (PCG) simulation (no maternal component)
// Port of user's Python idea: sinc-based S1/S2 with AWGN and optional murmurs/S3/S4

export type HeartSimOptions = {
  cycles?: number;
  fs?: number;
  hr?: number; // heart rate bpm
  awgnAmplitude?: number;
  rrStdFrac?: number; // arrhythmia control: 0..0.5 fraction of mean RR
  // Murmur/friction/enhancements
  systolicMurmur?: boolean;
  diastolicMurmur?: boolean;
  continuousMurmur?: boolean;
  friction?: boolean; // pericardial friction bursts
  s3s4?: boolean; // add S3/S4
};

export type HeartSimOutput = { t: number[]; y: number[] };

function linspace(start: number, end: number, n: number) {
  if (n <= 1) return [start];
  const arr = new Array<number>(n);
  const step = (end - start) / (n - 1);
  for (let i = 0; i < n; i++) arr[i] = start + i * step;
  return arr;
}
function sinc(x: number) {
  if (x === 0) return 1;
  const px = Math.PI * x;
  return Math.sin(px) / px;
}
function gaussian() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}
function onepole_lowpass(x: number[], fc: number, fs: number) {
  if (fc <= 0) return x.slice();
  const a = Math.exp((-2 * Math.PI * fc) / fs);
  const y = new Array<number>(x.length).fill(0);
  for (let i = 1; i < x.length; i++) y[i] = a * y[i - 1] + (1 - a) * x[i];
  return y;
}
function onepole_highpass(x: number[], fc: number, fs: number) {
  if (fc <= 0) return x.slice();
  const low = onepole_lowpass(x, fc, fs);
  const y = new Array<number>(x.length);
  for (let i = 0; i < x.length; i++) y[i] = x[i] - low[i];
  return y;
}
function simple_bandpass(x: number[], f_lo: number, f_hi: number, fs: number) {
  let y = x.slice();
  if (!(f_hi == null || f_hi >= fs / 2)) y = onepole_lowpass(y, f_hi, fs);
  if (!(f_lo == null || f_lo <= 0)) y = onepole_highpass(y, f_lo, fs);
  return y;
}

function generate_heart_sound(center_freq: number, duration: number, fs: number, amplitude: number) {
  const n = Math.max(1, Math.floor(fs * duration));
  const t = linspace(-duration / 2, duration / 2, n);
  const signal = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const x = 2 * center_freq * t[i];
    signal[i] = amplitude * sinc(x);
  }
  return signal;
}

export function simulateHeartDataset(opts: HeartSimOptions = {}): HeartSimOutput {
  const {
    cycles = 10,
    fs = 1000,
    hr = 75,
    awgnAmplitude = 0.06,
    rrStdFrac = 0.05,
    systolicMurmur = false,
    diastolicMurmur = false,
    continuousMurmur = false,
    friction = false,
    s3s4 = false,
  } = opts;

  const mean_rr = 60 / hr;
  const T: number[] = [];
  for (let k = 0; k < cycles; k++) T.push(Math.max(0.2, mean_rr + rrStdFrac * mean_rr * Math.random()));
  let total_duration = T.reduce((s, v) => s + v, 0) + 0.5;
  const nSamples = Math.max(1, Math.floor(fs * total_duration));
  const t = linspace(0, total_duration, nSamples);
  const y = new Array<number>(nSamples).fill(0);

  const SSID_sec = Math.max(0.02, (210 - 0.5 * hr) / 1000);
  let idx = 0;
  for (const rr of T) {
    const beat_len = Math.floor(rr * fs);
    const amp_s1 = 0.8 + 0.08 * gaussian();
    const amp_s2 = 0.5 + 0.08 * gaussian();
    const freq_s1 = 50 + 2 * gaussian();
    const freq_s2 = 60 + 2 * gaussian();
    const dur_s1 = Math.max(0.02, 0.08 + 0.01 * gaussian());
    const dur_s2 = Math.max(0.02, 0.05 + 0.01 * gaussian());
    const SSID = Math.max(0.02, SSID_sec + 0.01 * gaussian());

    const s1 = generate_heart_sound(freq_s1, dur_s1, fs, amp_s1);
    const s2 = generate_heart_sound(freq_s2, dur_s2, fs, amp_s2);

    const s1_start = idx;
    const s2_start = idx + Math.floor(SSID * fs);
    for (let i = 0; i < s1.length && s1_start + i < y.length; i++) y[s1_start + i] += s1[i];
    for (let i = 0; i < s2.length && s2_start + i < y.length; i++) y[s2_start + i] += s2[i];

    // Systolic murmur (between S1 and S2)
    if (systolicMurmur) {
      const m_start = s1_start + Math.floor(0.02 * fs);
      const m_end = Math.min(y.length, s2_start - Math.floor(0.01 * fs));
      if (m_end > m_start) {
        const len = m_end - m_start;
        const mur = new Array<number>(len).fill(0).map(() => gaussian());
        let mur2 = simple_bandpass(mur, 100, 400, fs);
        for (let i = 0; i < len; i++) {
          const w = Math.sin((Math.PI * i) / Math.max(1, len));
          y[m_start + i] += 0.2 * w * mur2[i];
        }
      }
    }

    // Diastolic murmur (after S2)
    if (diastolicMurmur) {
      const m_start = s2_start + Math.floor(0.01 * fs);
      const m_end = Math.min(y.length, idx + beat_len - Math.floor(0.02 * fs));
      if (m_end > m_start) {
        const len = m_end - m_start;
        const mur = new Array<number>(len).fill(0).map(() => gaussian());
        let mur2 = simple_bandpass(mur, 80, 300, fs);
        for (let i = 0; i < len; i++) {
          const w = Math.sin((Math.PI * (len - i)) / Math.max(1, len));
          y[m_start + i] += 0.18 * w * mur2[i];
        }
      }
    }

    // Continuous murmur across whole beat
    if (continuousMurmur) {
      const m_start = s1_start;
      const m_end = Math.min(y.length, idx + beat_len);
      const len = Math.max(0, m_end - m_start);
      if (len > 0) {
        const mur = new Array<number>(len).fill(0).map(() => gaussian());
        let mur2 = simple_bandpass(mur, 60, 250, fs);
        for (let i = 0; i < len; i++) y[m_start + i] += 0.08 * mur2[i];
      }
    }

    // Pericardial friction bursts
    if (friction) {
      for (const off of [0.05, 0.6]) {
        const center = idx + Math.floor(off * beat_len);
        const dur = Math.max(8, Math.floor(0.02 * fs));
        for (let k = 0; k < dur && center + k < y.length; k++) y[center + k] += 0.25 * Math.exp((-4 * k) / dur);
      }
    }

    // S3/S4 small extra pulses
    if (s3s4) {
      const s3_off = Math.floor(0.7 * beat_len);
      const s4_off = Math.floor(0.9 * beat_len);
      const s3 = generate_heart_sound(40, 0.04, fs, 0.25);
      const s4 = generate_heart_sound(45, 0.04, fs, 0.22);
      for (let i = 0; i < s3.length && idx + s3_off + i < y.length; i++) y[idx + s3_off + i] += s3[i];
      for (let i = 0; i < s4.length && idx + s4_off + i < y.length; i++) y[idx + s4_off + i] += s4[i];
    }

    idx += beat_len;
  }

  // AWGN
  for (let i = 0; i < y.length; i++) y[i] += awgnAmplitude * gaussian();

  return { t, y };
}
