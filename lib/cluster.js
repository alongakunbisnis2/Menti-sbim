const { normalize, displayText } = require("./normalize");

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      d[i][j] = Math.min(d[i-1][j]+1, d[i][j-1]+1, d[i-1][j-1] + (a[i-1]===b[j-1]?0:1));
  return d[m][n];
}
const simLev = (a,b) => {
  if (a===b) return 1;
  const max = Math.max(a.length,b.length);
  if (!max) return 0;
  return 1 - levenshtein(a,b)/max;
};
const simJaccard = (a,b) => {
  const A = new Set(a.split(" ")), B = new Set(b.split(" "));
  const inter = [...A].filter(x=>B.has(x)).length;
  const union = new Set([...A,...B]).size;
  return union ? inter/union : 0;
};
function similar(a,b) {
  if (!a || !b) return 0;
  if (a===b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.85;
  return Math.max(simJaccard(a,b), simLev(a,b)*0.9);
}

// answers: [{raw, normalized}]
// returns [{text, count, variants}]
function clusterAnswers(answers, threshold=0.72) {
  const groups = [];
  for (const ans of answers) {
    const norm = ans.normalized || normalize(ans.raw);
    if (!norm) continue;
    let best = null, bestScore = 0;
    for (const g of groups) {
      const s = similar(norm, g.key);
      if (s > bestScore) { bestScore = s; best = g; }
    }
    if (best && bestScore >= threshold) {
      best.count++;
      best.variants.push(ans.raw);
      // keep shortest readable display as label
      if (ans.raw.length < best.text.length) best.text = displayText(ans.raw);
    } else {
      groups.push({ key: norm, text: displayText(ans.raw), count: 1, variants: [ans.raw] });
    }
  }
  return groups.sort((a,b)=>b.count-a.count).map(({text,count,variants})=>({text,count,variants:variants.slice(0,5)}));
}

module.exports = { clusterAnswers, similar };
