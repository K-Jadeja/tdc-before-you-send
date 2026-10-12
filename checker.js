// Core logic, shared by the browser UI, the mock-data generator and the tests.
(function (root) {
  const FIELDS = {
    age: { label: 'Age' },
    city: { label: 'City', values: ['Mumbai', 'Delhi NCR', 'Bengaluru', 'Pune', 'Hyderabad', 'Dubai', 'London'] },
    diet: { label: 'Diet', values: ['Vegetarian', 'Eggetarian', 'Non-vegetarian'] },
    smoking: { label: 'Smoking', values: ['Never', 'Occasionally', 'Regularly'] },
    drinking: { label: 'Drinking', values: ['Never', 'Socially', 'Regularly'] },
    children: { label: 'Children', values: ['Wants children', 'Open', "Doesn't want children"] },
    marital: { label: 'Marital status', values: ['Never married', 'Divorced'] },
    education: { label: 'Education', values: ["Bachelor's", "Master's", 'Doctorate'] },
  };

  // Tunable thresholds, kept in one place.
  const SIMILAR_AT = 7;        // of 8 details matching (age within 2 years) counts as "similar"
  const ASK_FIRST_MIN = 3;     // needs this many earlier client yeses before we judge the other side
  const ASK_FIRST_RATE = 1 / 3; // ...and a yes-back rate at or below this

  function violates(pref, profile) {
    const value = profile[pref.field];
    if (pref.field === 'age') return value < pref.min || value > pref.max;
    return !pref.allowed.includes(value);
  }

  function describePref(pref) {
    return pref.field === 'age' ? `${pref.min}-${pref.max}` : pref.allowed.join(' / ');
  }

  // Fact 1. Deal breakers block, softer preferences warn.
  function checkProfile(client, profile) {
    const violations = client.prefs
      .filter((pref) => violates(pref, profile))
      .map((pref) => ({ field: pref.field, hard: pref.hard, wanted: describePref(pref), actual: profile[pref.field] }));
    const verdict = violations.some((v) => v.hard) ? 'BLOCK' : violations.length ? 'WARN' : 'OK';
    return { verdict, violations };
  }

  // Fact 2. The other side: what happened the earlier times a client said yes to this profile.
  function trackRecord(shares, profileId, beforeDay) {
    const record = { sent: 0, accepted: 0, saidYes: 0 };
    for (const share of shares) {
      if (share.profileId !== profileId || share.day >= beforeDay) continue;
      record.sent++;
      if (share.outcome === 'accepted') { record.accepted++; if (share.mutual) record.saidYes++; }
    }
    record.askFirst = record.accepted >= ASK_FIRST_MIN && record.saidYes / record.accepted <= ASK_FIRST_RATE;
    return record;
  }

  function similarity(a, b) {
    let same = 0;
    for (const field of Object.keys(FIELDS)) same += field === 'age' ? Math.abs(a.age - b.age) <= 2 : a[field] === b[field];
    return same;
  }

  // Fact 3. This client's own history with similar profiles, before this send.
  function similarHistory(clientShares, profilesById, share) {
    const profile = profilesById[share.profileId];
    return clientShares.filter((other) =>
      other.day < share.day && other.id !== share.id && similarity(profile, profilesById[other.profileId]) >= SIMILAR_AT);
  }

  // Second look: a profile this client passed on without naming an attribute, similar to one
  // they accepted later. A vague "no" says little about a similar profile; a specific one is information.
  function secondLooks(client, clientShares, profilesById) {
    const out = [];
    for (const share of clientShares) {
      if (share.outcome !== 'rejected') continue;
      const profile = profilesById[share.profileId];
      if (checkProfile(client, profile).verdict === 'BLOCK' || parseFeedback(share.feedback).length) continue;
      const twins = clientShares.filter((other) =>
        other.outcome === 'accepted' && other.day > share.day && similarity(profile, profilesById[other.profileId]) >= SIMILAR_AT);
      if (twins.length) out.push({ share, twins });
    }
    return out;
  }

  // Free-text feedback -> which attribute(s) the client is objecting to.
  // Keyword baseline: it only catches explicit mentions. In production this is the one
  // step an LLM does, scored against this baseline on hand-labelled replies.
  const PATTERNS = {
    age: /\b(age|older|younger|too old|too young)\b/i,
    city: /\b(relocat\w*|based in|lives in|living in|abroad|same city)\b/i,
    diet: /\b(non[- ]?veg\w*|veg\w*|egg\w*|meat)\b/i,
    smoking: /\bsmok\w*/i,
    drinking: /\b(drink\w*|alcohol)\b/i,
    children: /\b(kids?|child(?:ren)?)\b/i,
    marital: /\b(divorc\w*|married before|second marriage)\b/i,
    education: /\b(degree|postgrad\w*|masters?|mba|phd|qualif\w*|educat\w*)\b/i,
  };

  function parseFeedback(text) {
    return Object.keys(PATTERNS).filter((field) => PATTERNS[field].test(text || ''));
  }

  // Compare the extracted reason with the preference record we already hold.
  //   already_stated - we knew, and sent the profile anyway (the avoidable rejections)
  //   new_signal     - not in the record: suggest it to the matchmaker, never auto-apply
  //   unclear        - no attribute given
  function classifyRejection(client, profile, fields) {
    if (!fields.length) return { category: 'unclear', fields: [] };
    const stated = fields.filter((field) => client.prefs.some((pref) => pref.field === field && violates(pref, profile)));
    if (stated.length) return { category: 'already_stated', fields: stated };
    return { category: 'new_signal', fields };
  }

  // Replay the whole send log through the three facts.
  function backtest(data) {
    const clientsById = Object.fromEntries(data.clients.map((c) => [c.id, c]));
    const profilesById = Object.fromEntries(data.profiles.map((p) => [p.id, p]));
    const emptyRow = () => ({
      shared: 0, accepted: 0, mutual: 0, rejected: 0,
      block: 0, blockAccepted: 0, blockMutual: 0, warn: 0, warnAccepted: 0,
      already_stated: 0, new_signal: 0, unclear: 0, truthAvoidable: 0, truthAvoidableFound: 0,
      askFirst: 0, askFirstAccepted: 0, askFirstMutual: 0, otherAccepted: 0, otherMutual: 0,
      secondLook: 0,
    });
    const out = { all: emptyRow() };
    for (const share of data.shares) {
      const client = clientsById[share.clientId];
      const profile = profilesById[share.profileId];
      const accepted = share.outcome === 'accepted';
      const { verdict } = checkProfile(client, profile);
      const record = trackRecord(data.shares, share.profileId, share.day);
      const category = accepted ? null : classifyRejection(client, profile, parseFeedback(share.feedback)).category;
      out[share.matchmaker] = out[share.matchmaker] || emptyRow();
      for (const row of [out.all, out[share.matchmaker]]) {
        row.shared++;
        if (verdict === 'BLOCK') { row.block++; if (accepted) row.blockAccepted++; if (share.mutual) row.blockMutual++; }
        if (verdict === 'WARN') { row.warn++; if (accepted) row.warnAccepted++; }
        if (record.askFirst) row.askFirst++;
        if (accepted) {
          row.accepted++;
          if (share.mutual) row.mutual++;
          if (record.askFirst) { row.askFirstAccepted++; if (share.mutual) row.askFirstMutual++; }
          else { row.otherAccepted++; if (share.mutual) row.otherMutual++; }
          continue;
        }
        row.rejected++;
        row[category]++;
        if (share.truth === 'avoidable') {
          row.truthAvoidable++;
          if (category === 'already_stated') row.truthAvoidableFound++;
        }
      }
    }
    for (const client of data.clients) {
      const looks = secondLooks(client, data.shares.filter((s) => s.clientId === client.id), profilesById).length;
      out.all.secondLook += looks;
      out[client.matchmaker].secondLook += looks;
    }
    return out;
  }

  const api = {
    FIELDS, SIMILAR_AT, violates, describePref, checkProfile, trackRecord, similarity, similarHistory, secondLooks,
    parseFeedback, classifyRejection, backtest,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TDC = api;
})(this);
