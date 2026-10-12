// Usage: node analyze.mjs <vectors.json>
import { readFileSync } from 'node:fs';
const { images, texts } = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const vec = (n) => images[`face-${String(n).padStart(2, '0')}.jpg`];
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);

// Labels assigned by eye from the contact sheet. Children are excluded from everything.
const children = [8, 15, 23, 29, 31, 41, 49, 59];
const adults = Array.from({ length: 60 }, (_, i) => i + 1).filter((n) => !children.includes(n));
const women = [1, 2, 3, 4, 5, 6, 7, 12, 13, 14, 16, 17, 18, 21, 22, 24, 25, 28, 32, 33, 34, 35, 39, 43, 45, 46, 48, 50, 51, 53, 54, 55];
const traits = {
  glasses: { pool: adults, pos: [10, 20, 33, 36, 39, 60], probe: 'glasses' },
  'long hair (women only)': { pool: women, pos: [1, 4, 5, 7, 13, 14, 16, 17, 22, 32, 35, 45, 46, 48], probe: 'long_hair' },
  'broad smile': { pool: adults, pos: [1, 2, 4, 5, 9, 10, 12, 13, 16, 18, 19, 20, 22, 24, 25, 28, 30, 35, 43, 44, 45, 47, 50, 53, 54, 55, 56, 58], probe: 'smiling' },
};

let seed = 7;
const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const sample = (arr, k) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a.slice(0, k); };
const mean = (ns) => { const m = new Array(768).fill(0); for (const n of ns) vec(n).forEach((x, i) => { m[i] += x / ns.length; }); return m; };
// Probability a random positive outscores a random negative. 0.5 is chance, 1.0 is perfect.
const auc = (scores, pos, neg) => { let w = 0; for (const p of pos) for (const n of neg) w += scores[p] > scores[n] ? 1 : scores[p] === scores[n] ? 0.5 : 0; return w / (pos.length * neg.length); };

// Few-shot "taste": k accepted and k rejected examples, score everything else.
function fewShot(pool, pos, k, trials = 300) {
  const neg = pool.filter((n) => !pos.includes(n));
  let total = 0;
  for (let t = 0; t < trials; t++) {
    const a = sample(pos, k), r = sample(neg, k);
    const ma = mean(a), mr = mean(r);
    const taste = ma.map((x, i) => x - mr[i]);
    const scores = {};
    for (const n of pool) scores[n] = dot(vec(n), taste);
    total += auc(scores, pos.filter((n) => !a.includes(n)), neg.filter((n) => !r.includes(n)));
  }
  return total / trials;
}

for (const [name, { pool, pos, probe }] of Object.entries(traits)) {
  const neg = pool.filter((n) => !pos.includes(n));
  const scores = {};
  for (const n of pool) scores[n] = dot(vec(n), texts[probe]);
  console.log(`\n${name}: ${pos.length} with, ${neg.length} without`);
  console.log(`  text probe ("${probe}")        AUC ${auc(scores, pos, neg).toFixed(2)}`);
  for (const k of [2, 3, 5]) if (pos.length > k + 1) console.log(`  taste from ${k} yes + ${k} no     AUC ${fewShot(pool, pos, k).toFixed(2)}`);
  // Control: the same procedure on a random split of the same size.
  const fake = sample(pool, pos.length);
  console.log(`  control (random labels, k=3)  AUC ${fewShot(pool, fake, 3).toFixed(2)}`);
}

const sims = [];
for (let i = 0; i < adults.length; i++) for (let j = i + 1; j < adults.length; j++) sims.push(dot(vec(adults[i]), vec(adults[j])));
sims.sort((a, b) => a - b);
console.log(`\npairwise similarity between different adult faces: min ${sims[0].toFixed(2)}, median ${sims[sims.length >> 1].toFixed(2)}, max ${sims[sims.length - 1].toFixed(2)}`);
