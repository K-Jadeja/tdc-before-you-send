const { FIELDS, checkProfile, trackRecord, similarHistory, secondLooks, parseFeedback, classifyRejection, backtest } = TDC;
const profilesById = Object.fromEntries(MOCK.profiles.map((p) => [p.id, p]));

const $ = (id) => document.getElementById(id);
const esc = (value) => String(value).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)}%` : '-');
const first = (name) => name.split(' ')[0];
const lower = (value) => String(value).toLowerCase();
const prefText = (pref) => (pref.field === 'age' ? `aged ${pref.min} to ${pref.max}` : `${lower(FIELDS[pref.field].label)}: ${lower(pref.allowed.join(' or '))}`);
const nameOf = (share) => profilesById[share.profileId].name;
const listNames = (list) => list.map(nameOf).join(', ');

let client, shares, share, sent;

// ---------- The three checks, in plain sentences that name both people ----------
function checks() {
  const match = profilesById[share.profileId], c = first(client.name), m = first(match.name);
  const { verdict, violations } = checkProfile(client, match);
  const clash = (v) => `${c} ${v.hard ? 'will only consider' : 'would prefer'} ${lower(FIELDS[v.field].label)}: ${lower(v.wanted)}. ${m}'s profile says ${lower(v.actual)}.`;

  let one;
  if (verdict === 'BLOCK') one = { tone: 'stop', answer: 'Yes.', detail: violations.filter((v) => v.hard).map(clash).join(' ') };
  else if (verdict === 'WARN') one = { tone: 'ask', answer: 'No, but it is a stretch.', detail: violations.map(clash).join(' ') };
  else one = { tone: 'go', answer: 'No.', detail: `${m} fits everything ${c} asked for.` };

  const record = trackRecord(MOCK.shares, share.profileId, share.day);
  const history = `${record.accepted} other client${record.accepted === 1 ? '' : 's'} said yes to ${m} before. ${m} said yes back to ${record.saidYes}.`;
  let two;
  if (!record.accepted) two = { tone: 'quiet', answer: 'Not known yet.', detail: `No client has said yes to ${m} before, so there is nothing to go on.` };
  else if (record.askFirst) two = { tone: 'ask', answer: 'Rarely.', detail: `${history} Ask ${m} first, before raising ${c}'s hopes.` };
  else if (record.accepted < 3) two = { tone: 'quiet', answer: 'Too early to say.', detail: history };
  else two = { tone: 'go', answer: 'Usually.', detail: history };

  const seen = similarHistory(shares, profilesById, share);
  const liked = seen.filter((s) => s.outcome === 'accepted'), refused = seen.filter((s) => s.outcome === 'rejected');
  let three;
  if (liked.length) three = { tone: 'go', answer: 'The opposite.', detail: `${c} said yes to someone very similar: ${listNames(liked)}.` };
  else if (refused.length) three = { tone: 'ask', answer: 'Yes.', detail: `${c} said no to someone very similar: ${listNames(refused)}. Check why before sending another like that.` };
  else three = { tone: 'quiet', answer: 'No.', detail: `Nobody like ${m} has been sent to ${c} before.` };

  let suggestion;
  if (verdict === 'BLOCK') suggestion = { tone: 'stop', text: 'Do not send this one.' };
  else if (record.askFirst) suggestion = { tone: 'ask', text: `Ask ${m} first.` };
  else if (liked.length) suggestion = { tone: 'go', text: 'A good sign. Send it.' };
  else suggestion = { tone: 'go', text: 'Nothing against it. Send it if it feels right.' };

  const whys = [
    `A profile that breaks a deal breaker gets a no. In the brief, about one email in four went against something the client had already said.`,
    `A meeting needs two yeses. If ${c} says yes and ${m} then says no, ${c} is let down for nothing. When someone rarely says yes back, ask them first and the client never has to hear about it. This check needs real history, so it is the one to confirm with real data.`,
    `A no without a real reason is often not final. The brief says clients turn people down, then accept someone very similar.`,
  ];
  const questions = [`Does ${m} break one of ${c}'s deal breakers?`, `Will ${m} say yes back?`, `Has ${c} refused someone like ${m} before?`];
  return { match, c, m, facts: [one, two, three], questions, whys, suggestion };
}

// What comes back after Send, and what the panel files away from it.
function aftermath(c, m, suggestion) {
  if (share.outcome === 'accepted') {
    const reply = `Yes, I would like to meet ${m}.`;
    return share.mutual
      ? { reply, system: `${nameOf(share)} also said yes. Contact details shared.`, tone: 'go', filed: `Both said yes. Saved to ${c}'s history and to ${m}'s.`, verdict: '' }
      : { reply, system: `${nameOf(share)} said no.`, tone: 'ask', filed: `${c} said yes, ${m} said no. Saved to ${m}'s history, so next time the panel says: ask ${m} first.`, verdict: suggestion.tone === 'ask' ? 'The panel saw this coming.' : '' };
  }
  const result = classifyRejection(client, profilesById[share.profileId], parseFeedback(share.feedback));
  const about = result.fields.map((f) => lower(FIELDS[f].label)).join(' and ');
  const filed = {
    already_stated: `Reason: ${about}. That was already in ${c}'s file, so this email could have been avoided.`,
    new_signal: `Reason: ${about}. That is not in ${c}'s file. The panel suggests adding it; you confirm, nothing changes on its own.`,
    unclear: `No real reason given. Saved as a soft no: someone similar may still be worth a second look.`,
  }[result.category];
  return { reply: share.feedback, system: '', tone: 'stop', filed, verdict: suggestion.tone === 'stop' ? 'The panel would have saved this email.' : '' };
}

function render() {
  const { match, c, m, facts, questions, whys, suggestion } = checks();
  const about = Object.keys(FIELDS).map((field) => (field === 'age' ? `${match.age} years old` : `${FIELDS[field].label}: ${match[field]}`));
  const letter = `<p>Hi ${esc(c)},</p><p>I think you should meet <b>${esc(match.name)}</b></p><ul>${about.map((line) => `<li>${esc(line)}</li>`).join('')}</ul><p>Shall I connect you two?</p>`;
  const after = aftermath(c, m, suggestion);

  $('letter').innerHTML = sent
    ? `<div class="msg mine"><div class="who">You, to ${esc(client.name)}</div>${letter}</div>` +
      `<div class="msg theirs"><div class="who"><span class="face">${esc(c[0])}</span>${esc(client.name)} replied</div><p>${esc(after.reply)}</p></div>` +
      (after.system ? `<div class="system ${after.tone}">${esc(after.system)}</div>` : '')
    : letter;
  $('send').hidden = sent; $('next').hidden = !sent;
  $('to').disabled = $('intro').disabled = sent;

  const hard = client.prefs.filter((p) => p.hard), soft = client.prefs.filter((p) => !p.hard);
  const looks = secondLooks(client, shares, profilesById);
  $('panel').innerHTML =
    `<div class="file"><div class="label">${esc(c)}'s file</div><p><b>Deal breakers:</b> ${esc(hard.map(prefText).join('; '))}.</p><p><b>Would prefer:</b> ${esc(soft.map(prefText).join('; '))}.</p></div>` +
    (sent
      ? `<div class="label">Filed from the reply</div><p class="filed ${after.tone}">${esc(after.filed)}</p>${after.verdict ? `<p class="verdict">${after.verdict}</p>` : ''}`
      : `<div class="label">Before you send ${esc(match.name)}</div>` +
        facts.map((fact, i) =>
          `<div class="fact ${fact.tone}"><span class="n">${i + 1}</span><div><div class="q">${esc(questions[i])} <b>${esc(fact.answer)}</b></div><div class="d">${esc(fact.detail)}</div><details class="why"><summary>Why this check?</summary>${esc(whys[i])}</details></div></div>`).join('') +
        `<div class="suggest ${suggestion.tone}">${esc(suggestion.text)}<span>You decide. You can send it anyway.</span></div>`) +
    `<div class="label">Worth a second look for ${esc(c)}</div>` +
    (looks.length
      ? '<ul class="looks">' + looks.slice(0, 3).map(({ share: old, twins }) => `<li><b>${esc(nameOf(old))}</b> ${esc(c)} said "${esc(old.feedback)}" and later said yes to ${esc(listNames(twins))}, who is very similar.</li>`).join('') + '</ul>'
      : '<p class="muted">Nobody yet.</p>');
}

function pickClient() {
  client = MOCK.clients.find((item) => item.id === Number($('to').value));
  shares = MOCK.shares.filter((s) => s.clientId === client.id);
  $('intro').innerHTML = shares.map((s) => `<option value="${s.id}">${esc(nameOf(s))}, ${profilesById[s.profileId].age}</option>`).join('');
  // Open on an email where the panel has something to say.
  const blocked = shares.find((s) => checkProfile(client, profilesById[s.profileId]).verdict === 'BLOCK');
  $('intro').value = (blocked || shares[0]).id;
  pickMatch();
}
function pickMatch() { share = shares.find((s) => s.id === Number($('intro').value)); sent = false; render(); }

function renderTotals() {
  const stats = backtest(MOCK), all = stats.all;
  const card = (big, text) => `<div class="stat"><b>${big}</b><span>${text}</span></div>`;
  $('totals').innerHTML = [
    card(`${all.mutual} of ${all.shared.toLocaleString()}`, 'emails ended with both people saying yes. That is 21 in 100, the number this panel is meant to raise.'),
    card(all.block, `emails broke a deal breaker. ${all.blockAccepted === 0 ? 'None' : all.blockAccepted} were accepted. Not sending them takes 21.0% to ${pct(all.mutual, all.shared - all.block)}.`),
    card(all.secondLook, 'times a client said no without a real reason, then yes to someone very similar.'),
    card(all.askFirst, 'emails where the match already had a record of rarely saying yes back. One invented month is too little history to judge this check; it needs the real inbox.'),
  ].join('');
}

$('to').innerHTML = ['A', 'B'].map((key) =>
  `<optgroup label="Matchmaker ${key}'s clients">` +
  MOCK.clients.filter((item) => item.matchmaker === key).map((item) => `<option value="${item.id}">${esc(item.name)}</option>`).join('') +
  '</optgroup>').join('');
// Open on the client with the most going on.
const interest = (item) => {
  const own = MOCK.shares.filter((s) => s.clientId === item.id);
  return secondLooks(item, own, profilesById).length * 3 + own.filter((s) => checkProfile(item, profilesById[s.profileId]).verdict === 'BLOCK').length;
};
$('to').value = MOCK.clients.reduce((best, item) => (interest(item) > interest(best) ? item : best)).id;
$('to').addEventListener('change', pickClient);
$('intro').addEventListener('change', pickMatch);
$('send').addEventListener('click', () => { sent = true; render(); });
$('next').addEventListener('click', () => {
  const index = shares.findIndex((s) => s.id === share.id);
  $('intro').value = shares[(index + 1) % shares.length].id;
  pickMatch();
});

renderTotals();
pickClient();
