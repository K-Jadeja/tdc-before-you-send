// Run: node test.js
const assert = require('assert');
const MOCK = require('./data/mock.js');
const { checkProfile, trackRecord, similarity, secondLooks, parseFeedback, classifyRejection, backtest } = require('./checker.js');

const client = {
  prefs: [
    { field: 'age', hard: false, min: 27, max: 32 },
    { field: 'smoking', hard: true, allowed: ['Never'] },
  ],
};
const base = { age: 29, smoking: 'Never', city: 'Pune', diet: 'Vegetarian', drinking: 'Never', children: 'Open', marital: 'Never married', education: "Master's" };

// Fact 1: deal breakers
assert.strictEqual(checkProfile(client, base).verdict, 'OK');
assert.strictEqual(checkProfile(client, { ...base, age: 35 }).verdict, 'WARN');
assert.strictEqual(checkProfile(client, { ...base, smoking: 'Regularly' }).verdict, 'BLOCK');
assert.strictEqual(checkProfile(client, { ...base, age: 35, smoking: 'Regularly' }).violations.length, 2);

// Fact 2: the other side's track record only counts earlier days
const log = [
  { profileId: 7, day: 1, outcome: 'accepted', mutual: false },
  { profileId: 7, day: 2, outcome: 'accepted', mutual: false },
  { profileId: 7, day: 3, outcome: 'accepted', mutual: true },
  { profileId: 7, day: 4, outcome: 'rejected', mutual: null },
  { profileId: 7, day: 9, outcome: 'accepted', mutual: true },
];
assert.deepStrictEqual(trackRecord(log, 7, 5), { sent: 4, accepted: 3, saidYes: 1, askFirst: true });
assert.strictEqual(trackRecord(log, 7, 3).askFirst, false);
assert.strictEqual(trackRecord(log, 7, 10).askFirst, false);

// Fact 3: similarity and second look
assert.strictEqual(similarity(base, { ...base, age: 31 }), 8);
assert.strictEqual(similarity(base, { ...base, age: 35, city: 'Mumbai' }), 6);
const profilesById = { 1: base, 2: { ...base, age: 30 }, 3: { ...base, smoking: 'Regularly' } };
const history = [
  { id: 1, profileId: 1, day: 2, outcome: 'rejected' },
  { id: 2, profileId: 3, day: 3, outcome: 'rejected' },
  { id: 3, profileId: 2, day: 8, outcome: 'accepted' },
];
const looks = secondLooks(client, history, profilesById);
assert.strictEqual(looks.length, 1);
assert.strictEqual(looks[0].share.id, 1);

// Feedback parsing and reconciliation
assert.deepStrictEqual(parseFeedback('Smokes regularly. Not okay with smoking.'), ['smoking']);
assert.deepStrictEqual(parseFeedback('They are eggetarian. Food habits matter.'), ['diet']);
assert.deepStrictEqual(parseFeedback('Not my type.'), []);
assert.strictEqual(classifyRejection(client, { ...base, smoking: 'Regularly' }, ['smoking']).category, 'already_stated');
assert.strictEqual(classifyRejection(client, { ...base, city: 'Dubai' }, ['city']).category, 'new_signal');
assert.strictEqual(classifyRejection(client, base, []).category, 'unclear');

// The mocked log reproduces the numbers in the brief.
const stats = backtest(MOCK);
assert.strictEqual(stats.all.shared, 1000);
assert.strictEqual(stats.all.accepted, 310);
assert.strictEqual(stats.all.mutual, 210);
assert.strictEqual(Math.round((100 * stats.A.accepted) / stats.A.shared), 44);
assert.strictEqual(Math.round((100 * stats.B.accepted) / stats.B.shared), 21);
assert.strictEqual(Math.round((100 * stats.all.truthAvoidable) / stats.all.rejected), 35);
// A deal-breaker block must never have cost us an acceptance in the replay.
assert.strictEqual(stats.all.blockAccepted, 0);

const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)}%` : '-');
const s = stats.all;
console.log('all tests passed\n');
console.log(`sent ${s.shared}, accepted ${s.accepted} (${pct(s.accepted, s.shared)}), mutual yes ${s.mutual} (${pct(s.mutual, s.shared)})`);
console.log(`deal breakers: BLOCK ${s.block} (accepted anyway ${s.blockAccepted}), WARN ${s.warn} (accepted anyway ${s.warnAccepted})`);
console.log(`mutual-yes rate if blocked profiles are not sent: ${pct(s.mutual, s.shared - s.block)}`);
console.log(`other side: "ask first" on ${s.askFirst} sends; of those the client accepted, ${pct(s.askFirstMutual, s.askFirstAccepted)} were returned (${s.askFirstMutual}/${s.askFirstAccepted}) vs ${pct(s.otherMutual, s.otherAccepted)} for the rest`);
console.log(`second look: ${s.secondLook} of ${s.unclear} vague rejections have a similar profile the same client accepted later`);
console.log(`feedback: rejections ${s.rejected}: already stated ${s.already_stated}, new signal ${s.new_signal}, unclear ${s.unclear}`);
console.log(`labelled avoidable ${s.truthAvoidable}, found by keyword baseline ${s.truthAvoidableFound} (${pct(s.truthAvoidableFound, s.truthAvoidable)})`);
