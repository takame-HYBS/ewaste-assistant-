// Optional photo helper: suggests the device type from a photo using a pretrained image classifier (MobileNet v2,
// trained on ImageNet) that runs entirely in the browser. The photo is not uploaded for this step.
//
// Limits: it is a general-purpose model, not trained on damaged electronics, and ImageNet has no "tablet" class, so
// tablets are guessed from similar classes. It only ever SUGGESTS a type; the user confirms. If the model cannot load
// (for example, no internet), the caller shows a message and the user picks the type manually.
let modelPromise = null;

function loadModel() {
  if (!modelPromise) {
    modelPromise = (async () => {
      const tf = await import('@tensorflow/tfjs');
      const mobilenet = await import('@tensorflow-models/mobilenet');
      await tf.ready();
      return mobilenet.load({ version: 2, alpha: 1.0 });
    })().catch((err) => {
      modelPromise = null; // allow a retry later
      throw err;
    });
  }
  return modelPromise;
}

// ImageNet class names mapped to the app's device categories.
const GROUPS = [
  ['phone', /cellular|mobile phone|cellphone|smartphone|ipod/i],
  ['laptop', /laptop|notebook/i],
  ['tablet', /hand-held computer|tablet|slate/i],
  ['peripheral', /mouse|keyboard|remote control|joystick|speaker|headphone|earphone|headset|modem|printer|webcam|charger|power/i],
];

export async function suggestCategory(file) {
  const model = await loadModel();
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const predictions = await model.classify(img, 5);
    const scores = {};
    for (const p of predictions) {
      for (const [key, pattern] of GROUPS) {
        if (pattern.test(p.className)) scores[key] = (scores[key] || 0) + p.probability;
      }
    }
    const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
    return {
      category: best && best[1] >= 0.15 ? best[0] : null,
      confidence: best ? best[1] : 0,
      seen: predictions.slice(0, 3).map((p) => p.className.split(',')[0]),
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}
