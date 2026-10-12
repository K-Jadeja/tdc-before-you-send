"""What people say they want vs who they say yes to, on the Columbia speed-dating data.

Usage: python -I analyze.py <Speed Dating Data.csv>
"""

import sys
import warnings

import numpy as np
import pandas as pd
from scipy.stats import spearmanr
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score

warnings.filterwarnings("ignore")
rng = np.random.default_rng(0)

ATTR = ["attr", "sinc", "intel", "fun", "amb", "shar"]
NAMES = ["attractive", "sincere", "intelligent", "fun", "ambitious", "shared interests"]
STATED = [f"{a}1_1" for a in ATTR]

df = pd.read_csv(sys.argv[1], encoding="latin-1")
df = df.dropna(subset=["iid", "pid", "dec", "order"]).copy()
print(f"rows {len(df)}, people {df.iid.nunique()}, events {df.wave.nunique()}, yes rate {df.dec.mean():.1%}")

# --- A partner's "profile": how everyone ELSE who met them rated them (leave-one-out),
# so the chooser's own halo does not leak in. Also how often everyone else said yes to them.
by_partner = df.groupby("pid")
for a in ATTR:
    total, count = by_partner[a].transform("sum"), by_partner[a].transform("count")
    df["c_" + a] = (total - df[a].fillna(0)) / (count - df[a].notna().astype(int)).replace(0, np.nan)
df["popularity"] = (by_partner["dec"].transform("sum") - df["dec"]) / (by_partner["dec"].transform("count") - 1).replace(0, np.nan)
C = ["c_" + a for a in ATTR]
df = df.dropna(subset=C + ["popularity"]).copy()
df[C] = df.groupby("wave")[C].transform(lambda s: (s - s.mean()) / s.std())

# Stated importance, normalised per person (some events used a different scale).
stated = df.groupby("iid")[STATED].first()
stated = stated.div(stated.sum(axis=1), axis=0).dropna()
df = df[df.iid.isin(stated.index)].copy()

# ---------- A. What people say matters vs what moves their yes ----------
pooled = LogisticRegression(C=1e6, max_iter=1000).fit(df[C], df["dec"])
coef = pooled.coef_[0]
share = np.clip(coef, 0, None) / np.clip(coef, 0, None).sum()
print("\nA. stated importance vs what actually moves a yes (partner rated by other people)")
print(f"   {'':18}{'stated':>8}{'revealed':>10}{'coef':>8}")
for name, s, r, c in zip(NAMES, stated.mean(), share, coef):
    print(f"   {name:18}{s:8.0%}{r:10.0%}{c:8.2f}")

print("\n   do people who SAY a trait matters more respond to it more? (Spearman across people)")
for a, name in zip(ATTR, NAMES):
    sens = df.groupby("iid").apply(lambda g: g["c_" + a].corr(g["dec"]) if g["dec"].nunique() > 1 else np.nan).dropna()
    rho, p = spearmanr(stated.loc[sens.index, a + "1_1"], sens)
    print(f"   {name:18} rho {rho:+.2f}  (p={p:.3f}, n={len(sens)})")

# ---------- B. Predicting later choices from earlier information ----------
df = df.sort_values(["iid", "order"])
df["n"] = df.groupby("iid")["dec"].transform("count")
df["rank"] = df.groupby("iid").cumcount()
df["history"] = df["rank"] < (df["n"] // 2)
hist, test = df[df.history], df[~df.history].copy()

population = LogisticRegression(C=1e6, max_iter=1000).fit(hist[C], hist["dec"])
test["s_population"] = population.decision_function(test[C])
test["s_stated"] = (test[C].to_numpy() * stated.loc[test.iid].to_numpy()).sum(axis=1)
test["s_popularity"] = test["popularity"]

taste = {}
for iid, g in hist.groupby("iid"):
    yes, no = g[g.dec == 1][C], g[g.dec == 0][C]
    if len(yes) and len(no):
        taste[iid] = (yes.mean() - no.mean()).to_numpy()
test["s_personal"] = [float(np.dot(row, taste[i])) if i in taste else np.nan for i, row in zip(test.iid, test[C].to_numpy())]
test["s_personal_or_population"] = test["s_personal"].fillna(test["s_population"])


def per_person_auc(col):
    out = []
    for _, g in test.groupby("iid"):
        g = g.dropna(subset=[col])
        if g["dec"].nunique() == 2:
            out.append(roc_auc_score(g["dec"], g[col]))
    out = np.array(out)
    boot = [rng.choice(out, len(out)).mean() for _ in range(2000)]
    return out.mean(), np.percentile(boot, 2.5), np.percentile(boot, 97.5), len(out)


print("\nB. ranking a person's LATER dates using only their EARLIER ones (per-person AUC, 0.50 = coin flip)")
print(f"   history dates per person: median {int(hist.groupby('iid').size().median())}; people with a usable personal taste: {len(taste)} of {df.iid.nunique()}")
labels = {
    "s_stated": "what they said they want (stated weights)",
    "s_personal": "their own earlier yes/no choices",
    "s_population": "what people in general respond to",
    "s_personal_or_population": "own choices, general weights if none",
    "s_popularity": "how often others said yes to that partner",
}
for col, label in labels.items():
    m, lo, hi, n = per_person_auc(col)
    print(f"   {label:44} {m:.3f}  [{lo:.3f}, {hi:.3f}]  n={n}")

# ---------- C. Do people soften as the evening goes on? ----------
df["pos"] = df["rank"] / (df["n"] - 1).clip(lower=1)
early = df[df.pos <= 1 / 3].groupby("iid")["dec"].mean()
late = df[df.pos >= 2 / 3].groupby("iid")["dec"].mean()
diff = (late - early).dropna()
boot = [rng.choice(diff.to_numpy(), len(diff)).mean() for _ in range(2000)]
print("\nC. yes rate through the evening")
print(f"   first third {early.mean():.1%}, last third {late.mean():.1%}, change per person {diff.mean():+.1%} [{np.percentile(boot, 2.5):+.1%}, {np.percentile(boot, 97.5):+.1%}]")

# ---------- D. Near-identical partners, different answers ----------
rows = []
for _, g in df.groupby("iid"):
    x, d = g[C + ["popularity"]].to_numpy(), g["dec"].to_numpy()
    x = np.column_stack([x[:, :6], (x[:, 6] - df.popularity.mean()) / df.popularity.std()])
    for i in range(len(g)):
        for j in range(i + 1, len(g)):
            rows.append((np.linalg.norm(x[i] - x[j]), d[i] != d[j]))
pairs = pd.DataFrame(rows, columns=["dist", "differ"])
lo_cut, hi_cut = pairs.dist.quantile(0.1), pairs.dist.quantile(0.9)
print("\nD. same person, two partners: how often do the two answers differ?")
print(f"   most similar 10% of pairs   {pairs[pairs.dist <= lo_cut].differ.mean():.1%}")
print(f"   all pairs                   {pairs.differ.mean():.1%}")
print(f"   least similar 10% of pairs  {pairs[pairs.dist >= hi_cut].differ.mean():.1%}")

# ---------- E. Follow-ups ----------
print("\nE. follow-ups (same later-dates test)")
X = test[C].to_numpy()
test["s_equal"] = X.sum(axis=1)
m, lo, hi, n = per_person_auc("s_equal")
print(f"   {'equal weights on every trait':44} {m:.3f}  [{lo:.3f}, {hi:.3f}]  n={n}")

# Someone else's stated weights: if this scores the same as a person's own, their own carry no personal signal.
ids = stated.index.to_numpy()
shuffled = []
for _ in range(20):
    other = pd.Series(rng.permutation(ids), index=ids)
    test["s_tmp"] = (X * stated.loc[other.loc[test.iid].to_numpy()].to_numpy()).sum(axis=1)
    shuffled.append(per_person_auc("s_tmp")[0])
print(f"   {'a random other person stated weights':44} {np.mean(shuffled):.3f}  (20 shuffles, range {min(shuffled):.3f}-{max(shuffled):.3f})")

# General model with the profile's popularity added.
F = C + ["popularity"]
general = LogisticRegression(C=1e6, max_iter=1000).fit(hist[F], hist["dec"])
test["s_general"] = general.decision_function(test[F])
m, lo, hi, n = per_person_auc("s_general")
print(f"   {'general: traits + popularity':44} {m:.3f}  [{lo:.3f}, {hi:.3f}]  n={n}")

# Personal adjustment on top of the general model: per-person logistic fit on their history,
# pulled toward the general weights with strength lam (bigger = trust the general model more).
w0 = np.append(general.coef_[0], general.intercept_[0])
def fit_person(g, lam):
    A = np.column_stack([g[F].to_numpy(), np.ones(len(g))])
    y, w = g["dec"].to_numpy(), w0.copy()
    for _ in range(25):
        p = 1 / (1 + np.exp(-A @ w))
        grad = A.T @ (p - y) + lam * (w - w0)
        H = A.T @ (A * (p * (1 - p))[:, None]) + lam * np.eye(len(w))
        w = w - np.linalg.solve(H, grad)
    return w
for lam in [1, 3, 10, 30]:
    ws = {iid: fit_person(g, lam) for iid, g in hist.groupby("iid")}
    A = np.column_stack([test[F].to_numpy(), np.ones(len(test))])
    test["s_tmp"] = [float(a @ ws[i]) if i in ws else np.nan for i, a in zip(test.iid, A)]
    test["s_tmp"] = test["s_tmp"].fillna(test["s_general"])
    m, lo, hi, n = per_person_auc("s_tmp")
    print(f"   {'general + personal adjustment, lam=' + str(lam):44} {m:.3f}  [{lo:.3f}, {hi:.3f}]  n={n}")

# Paired gain of the best-looking adjustment over the general model, person by person.
def aucs(col):
    return {i: roc_auc_score(g["dec"], g[col]) for i, g in test.groupby("iid") if g["dec"].nunique() == 2}
ws = {iid: fit_person(g, 10) for iid, g in hist.groupby("iid")}
test["s_adj"] = [float(a @ ws[i]) for i, a in zip(test.iid, np.column_stack([test[F].to_numpy(), np.ones(len(test))]))]
a_gen, a_adj = aucs("s_general"), aucs("s_adj")
gain = np.array([a_adj[i] - a_gen[i] for i in a_gen])
boot = [rng.choice(gain, len(gain)).mean() for _ in range(2000)]
print(f"   paired gain of lam=10 over general: {gain.mean():+.3f} [{np.percentile(boot, 2.5):+.3f}, {np.percentile(boot, 97.5):+.3f}]")

# ---------- F. The other side: mutual yes ----------
# generosity = how often the partner says yes to OTHER people (leave-one-out on the partner's own decisions).
by_chooser = df.groupby("iid")["dec"]
gen = ((by_chooser.transform("sum") - df["dec"]) / (by_chooser.transform("count") - 1)).rename("g")
lookup = pd.DataFrame({"iid": df.iid, "pid": df.pid, "g": gen})
# partner p's generosity excluding their decision about chooser i = row where iid==p and pid==i
test = test.merge(lookup.rename(columns={"iid": "pid", "pid": "iid", "g": "generosity"}), on=["iid", "pid"], how="left")
test["s_reciprocal"] = test["popularity"] * test["generosity"]
print("\nF. the other side (later dates only)")
print(f"   yes from the chooser {test.dec.mean():.1%}; mutual yes {test.match.mean():.1%}; so {1 - test.match.sum() / test.dec.sum():.0%} of yeses are not returned")
pp = df.groupby("pid").agg(pop=("dec", "mean")).join(df.groupby("iid").agg(yes=("dec", "mean")), how="inner")
rho, p = spearmanr(pp["pop"], pp["yes"])
print(f"   are popular people pickier? popularity vs own yes-rate: rho {rho:+.2f} (p={p:.3g}, n={len(pp)})")
def per_person_auc_target(col, target):
    out = [roc_auc_score(g[target], g[col]) for _, g in test.dropna(subset=[col]).groupby("iid") if g[target].nunique() == 2]
    return np.mean(out), len(out)
for col, label in [("popularity", "partner popularity"), ("generosity", "how readily the partner says yes"), ("s_reciprocal", "popularity x readiness")]:
    m, n = per_person_auc_target(col, "match")
    print(f"   predicting a MUTUAL yes from {label:36} {m:.3f}  n={n}")
top = test.sort_values(["iid", "popularity"], ascending=[True, False]).groupby("iid").head(3)
rec = test.sort_values(["iid", "s_reciprocal"], ascending=[True, False]).groupby("iid").head(3)
print(f"   if each person were shown only their top 3: by popularity -> chooser yes {top.dec.mean():.1%}, mutual {top.match.mean():.1%}")
print(f"   {'':49}by popularity x readiness -> chooser yes {rec.dec.mean():.1%}, mutual {rec.match.mean():.1%}")
