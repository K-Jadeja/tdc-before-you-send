// Generates the mocked 30-day send log. Run: node data/generate.js
//
// From the brief: 1,000 profiles shared, 310 accepted, 210 contact details shared,
// matchmaker A at 44% and B at 21% acceptance, ~35% of rejections for reasons
// already in the client's preferences.
// Assumed (the brief does not say):
//   - A and B are the only matchmakers, which forces A = 435 sends and B = 565
//   - how the avoidable rejections split between them (25% of A's, 41% of B's)
//   - "contact details shared" means the other person also said yes
//   - profiles come from a shared pool of 360, so one profile reaches several clients
//   - clients are only sent profiles of the other gender (a simplification for the mock)
//   - profiles many clients accept say yes back less often (seen in real speed-dating data)
const fs = require('fs');
const path = require('path');
const { FIELDS, checkProfile } = require('../checker.js');

const TARGETS = {
  A: { clients: 17, shared: 435, accepted: 191, avoidable: 61 },
  B: { clients: 23, shared: 565, accepted: 119, avoidable: 181 },
};
const MUTUAL = 210;
const POOL_SIZE = 360;

// Seeded so the dataset is reproducible.
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(42);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
const shuffle = (arr) => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};
function weightedPick(items, weight) {
  const weights = items.map(weight);
  let roll = rand() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < items.length; i++) { roll -= weights[i]; if (roll <= 0) return items[i]; }
  return items[items.length - 1];
}

const NAMES = [
  'Aarav S.', 'Ananya R.', 'Kabir M.', 'Diya P.', 'Rohan K.', 'Isha T.', 'Vikram N.', 'Meera J.',
  'Arjun D.', 'Tara B.', 'Nikhil G.', 'Sana H.', 'Dev C.', 'Riya V.', 'Karan A.', 'Pooja L.',
  'Aditya W.', 'Neha F.', 'Sameer Q.', 'Kavya E.', 'Rahul Y.', 'Aditi Z.', 'Manav O.', 'Shreya U.',
  'Yash I.', 'Nisha S.', 'Varun R.', 'Priya M.', 'Ishaan P.', 'Simran K.', 'Aryan T.', 'Tanvi N.',
  'Kunal J.', 'Rhea D.', 'Siddharth B.', 'Anika G.', 'Harsh H.', 'Mira C.', 'Vivek V.', 'Zoya A.',
];

// How common each value is in the pool, in the order of FIELDS[field].values.
const POOL_MIX = {
  city: [26, 24, 22, 10, 10, 4, 4],
  diet: [50, 20, 30],
  smoking: [70, 20, 10],
  drinking: [35, 50, 15],
  children: [60, 30, 10],
  marital: [85, 15],
  education: [30, 55, 15],
};
const F_NAMES = ['Aisha', 'Bhavna', 'Charu', 'Deepika', 'Meenal', 'Gauri', 'Hema', 'Ira', 'Jaya', 'Kiara', 'Lata', 'Maya', 'Naina', 'Ojasvi', 'Pallavi', 'Radhika', 'Sakshi', 'Trisha', 'Uma', 'Vani', 'Yamini', 'Zara', 'Amrita', 'Bela', 'Chitra', 'Divya', 'Geeta', 'Juhi', 'Komal', 'Leela'];
const M_NAMES = ['Abhay', 'Bharat', 'Chirag', 'Deepak', 'Eshan', 'Gaurav', 'Hari', 'Imran', 'Jatin', 'Kartik', 'Lokesh', 'Mohit', 'Naveen', 'Omkar', 'Pranav', 'Rajat', 'Sahil', 'Tarun', 'Uday', 'Vishal', 'Yuvraj', 'Zubin', 'Amit', 'Anand', 'Dhruv', 'Girish', 'Jai', 'Keshav', 'Manish', 'Nitin'];
const INITIALS = 'ABCDGHJKLMNPRSTV';
const profiles = [];
const hidden = {}; // latent appeal and readiness: used to generate outcomes, never exported
for (let id = 1; id <= POOL_SIZE; id++) {
  const gender = id % 2 ? 'F' : 'M', k = Math.floor((id - 1) / 2);
  const name = (gender === 'F' ? F_NAMES : M_NAMES)[k % 30] + ' ' + INITIALS[Math.floor(k / 30) % INITIALS.length] + '.';
  const profile = { id, name, gender, age: int(25, 38) };
  for (const [field, mix] of Object.entries(POOL_MIX)) {
    profile[field] = weightedPick(FIELDS[field].values, (v) => mix[FIELDS[field].values.indexOf(v)]);
  }
  const appeal = rand();
  const readiness = Math.min(0.95, Math.max(0.05, 0.95 - 0.6 * appeal + (rand() - 0.5) * 0.3));
  hidden[id] = { appeal, readiness };
  profiles.push(profile);
}

const DEAL_BREAKER_FIELDS = ['smoking', 'drinking', 'children', 'diet', 'marital'];
function allowedFor(field) {
  switch (field) {
    case 'smoking': return pick([['Never'], ['Never', 'Occasionally']]);
    case 'drinking': return rand() < 0.3 ? ['Never'] : ['Never', 'Socially'];
    case 'children': return rand() < 0.2 ? ["Doesn't want children", 'Open'] : ['Wants children', 'Open'];
    case 'diet': return pick([['Vegetarian'], ['Vegetarian', 'Eggetarian']]);
    case 'marital': return ['Never married'];
    case 'education': return ["Master's", 'Doctorate'];
    case 'city': return shuffle(FIELDS.city.values.slice(0, 5)).slice(0, int(2, 3));
  }
}
function makeClient(id, matchmaker) {
  const min = int(25, 29);
  const prefs = [{ field: 'age', hard: false, min, max: min + int(7, 9) }];
  const pool = shuffle(DEAL_BREAKER_FIELDS.slice());
  const hardCount = int(1, 2);
  for (const field of pool.slice(0, hardCount)) prefs.push({ field, hard: true, allowed: allowedFor(field) });
  const softPool = shuffle(['city', 'education', ...pool.slice(hardCount)]);
  for (const field of softPool.slice(0, int(1, 2))) prefs.push({ field, hard: false, allowed: allowedFor(field) });
  return { id, name: NAMES[id - 1], gender: id % 2 ? 'M' : 'F', matchmaker, prefs };
}

// Values a client plausibly objects to when the field is NOT in their preferences.
const OBJECTIONABLE = {
  city: ['Dubai', 'London'],
  diet: ['Non-vegetarian'],
  smoking: ['Occasionally', 'Regularly'],
  drinking: ['Regularly'],
  children: ["Doesn't want children"],
  marital: ['Divorced'],
  education: ["Bachelor's"],
};
// Explicit phrasings name the attribute; oblique ones only hint at it.
const EXPLICIT = {
  age: ['Age is the issue here, {v} is outside what I am looking for.', 'The age gap is too much for me ({v}).'],
  city: ['Based in {v}. I am not looking to relocate.', 'Lives in {v}, I want someone in the same city as me.'],
  diet: ['They are {v}. Food habits matter a lot in my family.', 'Not comfortable with a {v} partner.'],
  smoking: ['Smokes {v}. Not okay with smoking.', 'I am not comfortable with a smoker.'],
  drinking: ['Drinks {v}, that does not work for me.', 'Not okay with the alcohol habits.'],
  children: ['We do not match on kids (profile says: {v}).', 'We differ on children.'],
  marital: ['Divorced. I am looking for someone never married.', 'Not open to someone who has been divorced.'],
  education: ['Was hoping for someone with a postgraduate degree.', 'Education level is not what I am looking for ({v}).'],
};
const OBLIQUE = {
  age: 'We are at very different life stages.',
  city: 'Long distance will not work for me.',
  diet: 'Our habits at the dinner table would clash.',
  smoking: 'Lifestyle habits are a concern, I am quite health-conscious.',
  drinking: 'Seems like a party lifestyle, not for me.',
  children: 'We want different things from family life.',
  marital: 'Their past relationship history would worry my parents.',
  education: 'Academically we are not on the same level.',
};
const REMINDERS = [' I had mentioned this.', ' This was in my preferences.', '', ''];
const NO_ATTRIBUTE = [
  'Did not feel drawn to the profile.', 'Photos did not click for me.', 'Nice profile but no spark, honestly.',
  'Not my type.', 'Our family backgrounds feel very different.', 'Their job involves too much travel.',
  'Seems very career-focused, I want someone more settled.', 'Interests do not overlap much.',
  'Not interested.', 'Pass.',
];
function fieldFeedback(field, profile, alreadyStated) {
  if (rand() < 0.15) return OBLIQUE[field];
  const text = pick(EXPLICIT[field]).replace('{v}', String(profile[field]).toLowerCase());
  return text + (alreadyStated ? pick(REMINDERS) : '');
}

// Picks a pool profile this client has not been sent yet that fits the kind of outcome.
function makeShare(client, kind, sentTo) {
  const fresh = profiles.filter((p) => !sentTo.has(p.id) && p.gender !== client.gender);
  const checked = fresh.map((profile) => ({ profile, violations: checkProfile(client, profile).violations }));
  const clean = checked.filter((c) => !c.violations.length);
  const likeable = (c) => hidden[c.profile.id].appeal ** 2 + 0.02;
  const unlikeable = (c) => (1 - hidden[c.profile.id].appeal) ** 2 + 0.02;

  if (kind === 'accepted') {
    // Some accepted profiles miss a soft preference: soft misses must warn, not block.
    const stretch = checked.filter((c) => c.violations.length && !c.violations.some((v) => v.hard));
    const from = rand() < 0.12 && stretch.length ? stretch : clean;
    if (!from.length) return null;
    return { profile: weightedPick(from, likeable).profile, outcome: 'accepted', feedback: null, truth: 'accepted', truthField: null };
  }
  if (kind === 'avoidable') {
    const hard = checked.filter((c) => c.violations.some((v) => v.hard));
    const soft = checked.filter((c) => c.violations.length && !c.violations.some((v) => v.hard));
    const from = rand() < 0.6 && hard.length ? hard : soft.length ? soft : hard;
    if (!from.length) return null;
    const chosen = pick(from);
    const field = (chosen.violations.find((v) => v.hard) || chosen.violations[0]).field;
    return { profile: chosen.profile, outcome: 'rejected', feedback: fieldFeedback(field, chosen.profile, true), truth: 'avoidable', truthField: field };
  }
  if (!clean.length) return null;
  if (rand() < 0.25) {
    const open = Object.keys(OBJECTIONABLE).filter((f) => !client.prefs.some((p) => p.field === f));
    const flagged = clean.filter((c) => open.some((f) => OBJECTIONABLE[f].includes(c.profile[f])));
    if (flagged.length) {
      const profile = weightedPick(flagged, unlikeable).profile;
      const field = pick(open.filter((f) => OBJECTIONABLE[f].includes(profile[f])));
      return { profile, outcome: 'rejected', feedback: fieldFeedback(field, profile, false), truth: 'new_signal', truthField: field };
    }
  }
  return { profile: weightedPick(clean, unlikeable).profile, outcome: 'rejected', feedback: pick(NO_ATTRIBUTE), truth: 'no_attribute', truthField: null };
}

const clients = [];
const shares = [];
for (const [matchmaker, target] of Object.entries(TARGETS)) {
  const own = [];
  for (let i = 0; i < target.clients; i++) own.push(makeClient(clients.length + own.length + 1, matchmaker));
  clients.push(...own);
  const sent = new Map(own.map((c) => [c.id, new Set()]));
  const kinds = shuffle([
    ...Array(target.accepted).fill('accepted'),
    ...Array(target.avoidable).fill('avoidable'),
    ...Array(target.shared - target.accepted - target.avoidable).fill('other'),
  ]);
  for (const kind of kinds) {
    let share = null, client = null;
    for (let attempt = 0; attempt < 200 && !share; attempt++) {
      client = pick(own);
      share = makeShare(client, kind, sent.get(client.id));
    }
    if (!share) throw new Error(`no profile fits a "${kind}" send for matchmaker ${matchmaker}`);
    sent.get(client.id).add(share.profile.id);
    const { profile, ...rest } = share;
    shares.push({ clientId: client.id, profileId: profile.id, matchmaker, day: int(1, 30), mutual: null, ...rest });
  }
}

// Of the accepted sends, exactly MUTUAL are returned; readier profiles are likelier to say yes back.
const accepted = shares.filter((s) => s.outcome === 'accepted');
accepted
  .map((share) => ({ share, key: rand() ** (1 / hidden[share.profileId].readiness) }))
  .sort((a, b) => b.key - a.key)
  .forEach(({ share }, i) => { share.mutual = i < MUTUAL; });

shares.sort((a, b) => a.day - b.day || a.clientId - b.clientId);
shares.forEach((share, i) => { share.id = i + 1; });

const json = JSON.stringify({ clients, profiles, shares });
fs.writeFileSync(
  path.join(__dirname, 'mock.js'),
  `// Generated by data/generate.js. Mocked data, not real clients.\nconst MOCK = ${json};\nif (typeof module !== 'undefined' && module.exports) module.exports = MOCK;\n`,
);
console.log(`Wrote ${clients.length} clients, ${profiles.length} profiles and ${shares.length} sends.`);
