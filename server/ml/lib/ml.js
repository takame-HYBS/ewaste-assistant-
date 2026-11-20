// Small, dependency-free machine-learning toolkit: multinomial logistic regression (softmax) trained with
// Adam, plus the evaluation metrics used in the AI report. Pure JavaScript so anyone can re-train with `npm run ml:train`.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const gauss = (rnd) => {
  let u = 0;
  while (u === 0) u = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
};

export function softmax(z) {
  const m = Math.max(...z);
  const e = z.map((v) => Math.exp(v - m));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((v) => v / s);
}

// ---- Scaling: only 'numeric' columns are standardised; binary columns stay 0/1 -------------------------------
export function fitScaler(X, kinds) {
  const F = kinds.length;
  const mean = new Array(F).fill(0);
  const std = new Array(F).fill(1);
  kinds.forEach((kind, j) => {
    if (kind !== 'numeric') return;
    const col = X.map((r) => r[j]);
    const m = col.reduce((a, b) => a + b, 0) / col.length;
    const v = col.reduce((a, b) => a + (b - m) ** 2, 0) / col.length;
    mean[j] = m;
    std[j] = Math.sqrt(v) || 1;
  });
  return { mean, std };
}
export const applyScaler = (x, { mean, std }) => x.map((v, j) => (v - mean[j]) / std[j]);

// ---- Training --------------------------------------------------------------------------------------------------
export function trainSoftmax(X, y, K, { epochs = 400, lr = 0.1, l2 = 1e-3, sampleWeights = null } = {}) {
  const N = X.length;
  const F = X[0].length;
  const W = Array.from({ length: K }, () => new Float64Array(F));
  const b = new Float64Array(K);
  const mW = Array.from({ length: K }, () => new Float64Array(F));
  const vW = Array.from({ length: K }, () => new Float64Array(F));
  const mb = new Float64Array(K);
  const vb = new Float64Array(K);
  const sw = sampleWeights || new Array(N).fill(1);
  const total = sw.reduce((a, c) => a + c, 0);
  const b1 = 0.9, b2 = 0.999, eps = 1e-8;

  for (let ep = 1; ep <= epochs; ep++) {
    const gW = Array.from({ length: K }, () => new Float64Array(F));
    const gb = new Float64Array(K);
    for (let i = 0; i < N; i++) {
      const x = X[i];
      const z = new Array(K);
      for (let k = 0; k < K; k++) {
        let s = b[k];
        const w = W[k];
        for (let j = 0; j < F; j++) s += w[j] * x[j];
        z[k] = s;
      }
      const p = softmax(z);
      for (let k = 0; k < K; k++) {
        const err = (p[k] - (y[i] === k ? 1 : 0)) * sw[i];
        gb[k] += err;
        const g = gW[k];
        for (let j = 0; j < F; j++) g[j] += err * x[j];
      }
    }
    const c1 = 1 - b1 ** ep;
    const c2 = 1 - b2 ** ep;
    for (let k = 0; k < K; k++) {
      for (let j = 0; j < F; j++) {
        const g = gW[k][j] / total + l2 * W[k][j];
        mW[k][j] = b1 * mW[k][j] + (1 - b1) * g;
        vW[k][j] = b2 * vW[k][j] + (1 - b2) * g * g;
        W[k][j] -= (lr * (mW[k][j] / c1)) / (Math.sqrt(vW[k][j] / c2) + eps);
      }
      const g = gb[k] / total;
      mb[k] = b1 * mb[k] + (1 - b1) * g;
      vb[k] = b2 * vb[k] + (1 - b2) * g * g;
      b[k] -= (lr * (mb[k] / c1)) / (Math.sqrt(vb[k] / c2) + eps);
    }
  }
  return { weights: W.map((w) => Array.from(w)), bias: Array.from(b) };
}

export function predictProba(model, x) {
  const z = model.weights.map((w, k) => w.reduce((s, wj, j) => s + wj * x[j], model.bias[k]));
  return softmax(z);
}
export const argmax = (a) => a.reduce((bi, v, i) => (v > a[bi] ? i : bi), 0);

// ---- Splitting ----------------------------------------------------------------------------------------------------
function shuffle(arr, rnd) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Returns {train, test}: index arrays, with every class split in the same proportion.
export function stratifiedSplit(y, testFraction, rnd) {
  const byClass = new Map();
  y.forEach((c, i) => { if (!byClass.has(c)) byClass.set(c, []); byClass.get(c).push(i); });
  const train = [], test = [];
  for (const idx of byClass.values()) {
    const s = shuffle(idx, rnd);
    const nTest = Math.round(s.length * testFraction);
    test.push(...s.slice(0, nTest));
    train.push(...s.slice(nTest));
  }
  return { train, test };
}

export function stratifiedFolds(y, k, rnd) {
  const folds = Array.from({ length: k }, () => []);
  const byClass = new Map();
  y.forEach((c, i) => { if (!byClass.has(c)) byClass.set(c, []); byClass.get(c).push(i); });
  for (const idx of byClass.values()) shuffle(idx, rnd).forEach((v, n) => folds[n % k].push(v));
  return folds;
}

// ---- Metrics ------------------------------------------------------------------------------------------------------
export const accuracy = (yTrue, yPred) => yTrue.filter((t, i) => t === yPred[i]).length / yTrue.length;

export function confusionMatrix(yTrue, yPred, K) {
  const m = Array.from({ length: K }, () => new Array(K).fill(0));
  yTrue.forEach((t, i) => { m[t][yPred[i]]++; });
  return m;
}

export function perClass(cm) {
  return cm.map((row, k) => {
    const tp = row[k];
    const fn = row.reduce((a, b) => a + b, 0) - tp;
    const fp = cm.reduce((a, r) => a + r[k], 0) - tp;
    const precision = tp + fp ? tp / (tp + fp) : 0;
    const recall = tp + fn ? tp / (tp + fn) : 0;
    const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
    return { precision, recall, f1, support: tp + fn };
  });
}
export const macroF1 = (pc) => pc.reduce((a, c) => a + c.f1, 0) / pc.length;

export function topKAccuracy(yTrue, probs, k) {
  let hit = 0;
  yTrue.forEach((t, i) => {
    const order = probs[i].map((p, c) => [p, c]).sort((a, b) => b[0] - a[0]).slice(0, k).map((x) => x[1]);
    if (order.includes(t)) hit++;
  });
  return hit / yTrue.length;
}

// Expected calibration error: how far stated confidence is from actual accuracy (lower is better).
export function calibration(yTrue, probs, bins = 10) {
  const rows = Array.from({ length: bins }, () => ({ n: 0, conf: 0, hit: 0 }));
  yTrue.forEach((t, i) => {
    const c = argmax(probs[i]);
    const conf = probs[i][c];
    const b = Math.min(bins - 1, Math.floor(conf * bins));
    rows[b].n++; rows[b].conf += conf; rows[b].hit += c === t ? 1 : 0;
  });
  let ece = 0;
  const table = rows.map((r, b) => {
    if (r.n) ece += (r.n / yTrue.length) * Math.abs(r.hit / r.n - r.conf / r.n);
    return { bin: `${b * 10}-${(b + 1) * 10}%`, n: r.n, confidence: r.n ? r.conf / r.n : null, accuracy: r.n ? r.hit / r.n : null };
  });
  return { ece, table };
}

// Area under the ROC curve for a binary score (rank-based).
export function auc(scores, positives) {
  const idx = scores.map((s, i) => [s, i]).sort((a, b) => a[0] - b[0]);
  let rankSum = 0, nPos = 0;
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avgRank = (i + j) / 2 + 1;
    for (let t = i; t <= j; t++) if (positives[idx[t][1]]) { rankSum += avgRank; nPos++; }
    i = j + 1;
  }
  const nNeg = scores.length - nPos;
  return nPos && nNeg ? (rankSum - (nPos * (nPos + 1)) / 2) / (nPos * nNeg) : null;
}

export function bootstrapCI(correct, rnd, reps = 1000) {
  const n = correct.length;
  const stats = [];
  for (let r = 0; r < reps; r++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += correct[Math.floor(rnd() * n)];
    stats.push(s / n);
  }
  stats.sort((a, b) => a - b);
  return [stats[Math.floor(reps * 0.025)], stats[Math.floor(reps * 0.975)]];
}
