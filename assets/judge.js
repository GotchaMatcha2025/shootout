/* Gotcha Shootout — the game rules, shared word for word by the page (github.com/GotchaMatcha2025/shootout, assets/judge.js)
   and the server (shootout-server, src/judge.js). The two copies must stay identical: the server's tests compare them byte for byte.
   Plain script: it puts one object, ShootJudge, on the global object (a <script> tag in the page; `import './judge.js'` in the Worker).
   World in metres: goal line z = 0, posts at x = ±3.66, bar at y = 2.44, penalty spot z = 11. */
(function (root) {
  'use strict';
  var GOAL = { half: 3.66, bar: 2.44, ball: 0.11, post: 0.06 };
  var LEVELS = ['EASY', 'MEDIUM', 'HARD'];
  var CODE_ABC = 'ACDEFHJKMNPRTUVWXY34679';   // no 0/O, 1/I/L, 2/Z, 5/S, 8/B: easy to read out
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  // how much a wayward shot is pulled back on target, by level (odds = the round's own odds, sent by the server at start)
  function assist(tx, ty, level, odds) {
    var h = odds.aimHelp[level];
    var cx = clamp(tx, -3.1, 3.1), cy = clamp(ty, 0.25, 2.15);
    return { tx: tx + (cx - tx) * h, ty: ty + (cy - ty) * h };
  }
  // one shot: a = the assisted aim, r = the server's draw for this shot (a number in [0, 1))
  function judge(a, level, r, odds) {
    var ax = Math.abs(a.tx), ty = a.ty, P = GOAL.half, B = GOAL.bar, band = GOAL.ball + GOAL.post;
    // the post and bar bands meet at the corner, so a ball clipping the outside corner is woodwork, never a goal (adversarial review 10)
    if (Math.abs(ax - P) <= band && ty < B + band) return { outcome: 'post', near: false };
    if (Math.abs(ty - B) <= band && ax < P + band) return { outcome: 'bar', near: false };
    if (ax > P + band) return { outcome: 'wide', near: ax - P < 0.75 };
    if (ty > B + band) return { outcome: 'over', near: ty - B < 0.7 };
    var corner = Math.min(1, Math.pow(ax / P, 1.3) * 0.75 + Math.min(1, ty / B) * 0.25);
    var cb = odds.cornerBonus;
    var p = clamp(odds.goalChance[level] * (1 - cb / 2 + cb * corner), 0.03, 0.985);
    return { outcome: r < p ? 'goal' : 'save', near: false, p: p };
  }
  // a whole round: aims = [{tx, ty}] as swiped (before assist); level = 0 for the free shot, else the shot's index
  function judgeRound(mode, aims, draws, odds) {
    return aims.map(function (aim, i) {
      var lv = mode === 'free' ? 0 : i, a = assist(aim.tx, aim.ty, lv, odds);
      return judge(a, lv, draws[i], odds);
    });
  }
  // the prize kind for a finished round
  function prizeKind(mode, goals) { return mode === 'free' ? 'free' : 'goals' + goals; }
  // where the keeper dives: a picture only, it never changes the result (r = any random source)
  function keeperPlan(outcome, a, r) {
    var s = a.tx >= 0 ? 1 : -1;
    if (outcome === 'save') return { hx: a.tx, hy: a.ty, touch: true };
    if (outcome === 'goal') {
      if (Math.abs(a.tx) < 1.1 || r() < 0.35) return { hx: -s * (1.7 + r() * 1.3), hy: 0.5 + r() * 1.3, wrong: true };   // wrong way
      var short = 0.2 + r() * 0.22;                                                                                        // fingertips
      return { hx: a.tx - s * short, hy: clamp(a.ty - 0.05, 0.3, 2.3) };
    }
    return { hx: s * Math.min(3.0, Math.abs(a.tx)) - s * 0.35, hy: clamp(a.ty, 0.3, 2.2) };
  }
  function validAim(a) {
    return !!a && typeof a === 'object' && typeof a.tx === 'number' && typeof a.ty === 'number' &&
      isFinite(a.tx) && isFinite(a.ty) && Math.abs(a.tx) <= 20 && a.ty >= -5 && a.ty <= 20;
  }

  /* nickname filter: the server runs the same check and has the last word. English, Singlish/Hokkien, Malay, Tamil, pinyin
     abbreviations, racial slurs, compounds and leet spellings (review flaw 4; code review G2). Real names that contain a bad part
     (DICKSON, HANCOCK, CUMMINGS…) are taken out by ALLOW before the parts are checked. */
  var BAD_PARTS = ['fuck', 'fuk', 'fck', 'phuck', 'shit', 'shyt', 'bitch', 'cunt', 'pussy', 'pussi', 'asshole', 'asshat', 'dumbass', 'jackass',
    'bastard', 'slut', 'whore', 'nigg', 'faggot', 'fagg', 'porn', 'penis', 'vagina', 'vagin', 'hitler', 'nazi', 'dick', 'dikhead', 'bigcock',
    'cocksuck', 'mycock', 'suckmy', 'tits', 'titt', 'titie', 'cumshot', 'cumslut', 'rapist', 'analsex', 'sexy', 'boner', 'kanina', 'kannina',
    'chibai', 'cheebye', 'chebye', 'nabei', 'nabeh', 'lanjiao', 'lanjiu', 'lanciao', 'pukimak', 'pundek', 'puki', 'butoh', 'lancau', 'tamade',
    'caonima', 'shabi', 'wocao', 'jibai', 'pantat', 'knnb', 'ccb', 'chaocb', 'niama', 'fcuk', 'phuk', 'fuq', 'fack', 'burit', 'pundai',
    'keling', 'kotek', 'chink', 'dildo', 'boob', 'horny', 'nude', 'jerkoff', 'wank', 'retard', 'molest', 'kimak', 'thevidiya', 'thevdiya',
    'thevidya', 'pondan', 'bapok', 'kafir', 'kkk', 'siegheil', 'pedo', 'tetek', 'pepek', 'jilat', 'sundal', 'paria', 'pariah', 'motherf', 'mthrf',
    'sexgod', 'killyou', 'killu', 'diulei', 'diunei', 'diulay', 'pukl', 'terrorist'];
  var BAD_WORDS = ['cb', 'knn', 'lj', 'sb', 'nmsl', 'kns', 'fk', 'cao', 'diu', 'ass', 'tmd', 'wtf', 'stfu', 'babi', 'sial', 'bodoh', 'sex',
    'rape', 'kill', 'cnm', 'kote', 'otha', 'nnb', 'paki', 'negro', 'nig', 'niga', 'nigas', 'fag', 'fags', 'hoe', 'cum', 'anal', 'cock', 'cibai', 'kys', 'heil', 'isis', 'cocks', 'mofo', 'spic'];
  var ALLOW = ['dickson', 'dickens', 'dickinson', 'dickie', 'hancock', 'peacock', 'babcock', 'hitchcock', 'woodcock', 'cockburn', 'cummings',
    'scunthorpe', 'matsushita', 'ashita', 'hashim', 'mashita'];
  function checkName(raw) {
    var name = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim();
    if (!name) return { ok: false, why: 'Type a nickname first.' };
    if (name.length > 12) return { ok: false, why: '12 letters at most.' };
    if (!/^[A-Za-z0-9 _.\-]+$/.test(name)) return { ok: false, why: 'Letters and numbers only, please.' };
    if (/1488/.test(name)) return { ok: false, why: "Pick another name. That one won't go on the big screen." };
    var leet = name.toLowerCase().replace(/0/g, 'o').replace(/1/g, 'i').replace(/3/g, 'e').replace(/4/g, 'a').replace(/5/g, 's')
      .replace(/7/g, 't').replace(/8/g, 'b').replace(/\$/g, 's').replace(/@/g, 'a');
    var tokens = leet.split(/[^a-z]+/).filter(Boolean);
    // an allowed real name counts only as a whole word: BIG DICKSON passes, BIGDICKSON doesn't
    var joined = tokens.map(function (t) { return ALLOW.indexOf(t) >= 0 ? '-' : t; }).join('');
    var squeezed = joined.replace(/(.)\1+/g, '$1');
    var bad = BAD_PARTS.some(function (w) { return joined.indexOf(w) >= 0 || squeezed.indexOf(w) >= 0; }) ||
      tokens.some(function (t) { return BAD_WORDS.indexOf(t) >= 0 || BAD_WORDS.indexOf(t.replace(/(.)\1+/g, '$1')) >= 0; }) ||
      BAD_WORDS.indexOf(joined.replace(/-/g, '')) >= 0;
    if (bad) return { ok: false, why: "Pick another name. That one won't go on the big screen." };
    return { ok: true, name: name.toUpperCase() };
  }

  root.ShootJudge = { GOAL: GOAL, LEVELS: LEVELS, CODE_ABC: CODE_ABC, clamp: clamp, assist: assist, judge: judge, judgeRound: judgeRound,
    prizeKind: prizeKind, keeperPlan: keeperPlan, validAim: validAim, checkName: checkName };
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this);
