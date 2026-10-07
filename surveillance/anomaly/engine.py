"""Anomaly detection engine for weekly surveillance counts.

Input: a STANDARD WEEKLY TABLE with columns
    week_start (date), disease_key, location, count
Any source (CBS today, EMR/IDSR later) is converted to this table by an adapter;
the engine never needs to know where the data came from.

Three layers of checks per (disease, location) series:
  1. threshold   - count >= the disease's alert threshold (Alert Threshold Config)
  2. baseline    - count >= outbreak multiplier x recent average (previous 8 weeks)
  3. ears_c2/c3  - CDC EARS statistical methods adapted to weekly data
Two guards against alerts caused by reporting behaviour rather than disease:
  - warm-up      : statistical rules are off for a location's first WARMUP_WEEKS
                   weeks of reporting (threshold alerts still fire)
  - surge label  : if a location's total reports across all diseases jumped that
                   week AND several diseases rose together, alerts are labelled
                   "possible reporting surge - verify before acting" (not hidden)
Output: one row per flagged week with the rules that fired and a plain explanation.
"""
import numpy as np
import pandas as pd

BASELINE_WEEKS = 8      # weeks averaged for the baseline rule
MIN_HISTORY = 4         # minimum points inside a rolling window
WARMUP_WEEKS = 8        # a location's first N weeks of reporting: no statistical rules
EXPECTED_FLOOR = 0.5    # treat "usually zero" as 0.5 so multiplier rules still work
SD_FLOOR = 0.5          # avoid dividing by ~0 when a series is flat
MIN_COUNT_STAT = 2      # statistical/baseline rules need at least this many in the week
EARS_C2_LIMIT = 3.0
EARS_C3_LIMIT = 2.0
SURGE_MULTIPLIER = 2.0  # location total >= 2x its usual weekly total ...
SURGE_MIN_DISEASES = 3  # ... and at least this many diseases above their usual level


def complete_weeks(df):
    """Zero-fill missing weeks for each series.

    A location's series starts at the first week that location reported anything,
    so weeks before reporting began are not mistaken for true zeros.
    """
    df = df.copy()
    df["week_start"] = pd.to_datetime(df["week_start"])
    df = df.groupby(["disease_key", "location", "week_start"], as_index=False)["count"].sum()
    end = df["week_start"].max()
    loc_start = df.groupby("location")["week_start"].min()

    parts = []
    for (disease, loc), g in df.groupby(["disease_key", "location"]):
        weeks = pd.date_range(loc_start[loc], end, freq="7D")
        s = g.set_index("week_start")["count"].reindex(weeks, fill_value=0)
        parts.append(pd.DataFrame({"week_start": weeks, "disease_key": disease,
                                   "location": loc, "count": s.values,
                                   "weeks_reporting": range(len(weeks))}))
    return pd.concat(parts, ignore_index=True)


def _series_stats(x):
    """Rolling statistics for one series (index-aligned with x)."""
    prev = x.shift(1)
    base_mean = prev.rolling(BASELINE_WEEKS, min_periods=MIN_HISTORY).mean()

    # EARS C1: baseline = previous 7 weeks
    c1_mu = prev.rolling(7, min_periods=MIN_HISTORY).mean()
    c1_sd = prev.rolling(7, min_periods=MIN_HISTORY).std().clip(lower=SD_FLOOR)
    c1 = (x - c1_mu) / c1_sd

    # EARS C2: same, with a 2-week gap before the baseline (weeks t-3..t-9)
    lag = x.shift(3)
    c2_mu = lag.rolling(7, min_periods=MIN_HISTORY).mean()
    c2_sd = lag.rolling(7, min_periods=MIN_HISTORY).std().clip(lower=SD_FLOOR)
    c2 = (x - c2_mu) / c2_sd

    # EARS C3: accumulated C2 excess over this week and the 2 before it
    excess = (c2 - 1).clip(lower=0)
    c3 = excess + excess.shift(1).fillna(0) + excess.shift(2).fillna(0)
    return base_mean, c1, c2, c3


def detect(df, thresholds=None, multiplier=2.5, default_threshold=1):
    """Run all checks. Returns (scored_table, alerts)."""
    thresholds = thresholds or {}
    full = complete_weeks(df).sort_values(["disease_key", "location", "week_start"])

    out = []
    for _, g in full.groupby(["disease_key", "location"], sort=False):
        g = g.copy()
        x = g["count"].astype(float)
        base_mean, c1, c2, c3 = _series_stats(x)
        g["baseline_mean"] = base_mean.round(2)
        g["c1"], g["c2"], g["c3"] = c1.round(2), c2.round(2), c3.round(2)
        out.append(g)
    scored = pd.concat(out, ignore_index=True)

    scored = _flag_surges(scored)

    thr = scored["disease_key"].map(lambda k: thresholds.get(k, default_threshold))
    expected = scored["baseline_mean"].clip(lower=EXPECTED_FLOOR)
    enough = (scored["count"] >= MIN_COUNT_STAT) & (scored["weeks_reporting"] >= WARMUP_WEEKS)

    scored["threshold"] = thr
    scored["r_threshold"] = scored["count"] >= thr
    scored["r_baseline"] = scored["baseline_mean"].notna() & enough & (scored["count"] >= multiplier * expected)
    scored["r_ears_c2"] = enough & (scored["c2"] > EARS_C2_LIMIT)
    scored["r_ears_c3"] = enough & (scored["c3"] > EARS_C3_LIMIT)

    anomaly = scored[["r_baseline", "r_ears_c2", "r_ears_c3"]].any(axis=1)
    scored["level"] = np.select([anomaly, scored["r_threshold"]], ["outbreak", "alert"], default="")

    alerts = scored[scored["level"] != ""].copy()
    alerts["rules"] = alerts.apply(_rules, axis=1)
    alerts["explanation"] = alerts.apply(lambda r: _explain(r, multiplier), axis=1)
    cols = ["week_start", "disease_key", "location", "count", "baseline_mean", "threshold",
            "c1", "c2", "c3", "level", "rules", "possible_reporting_surge", "explanation"]
    alerts = alerts[cols].sort_values(["week_start", "level", "disease_key"], ascending=[True, False, True])
    return scored, alerts.reset_index(drop=True)


def _flag_surges(scored):
    """Mark location-weeks where reporting as a whole jumped, not just one disease."""
    up = (scored["count"] > 0) & (scored["count"] > scored["baseline_mean"].fillna(0))
    loc = (scored.assign(up=up)
           .groupby(["location", "week_start"], as_index=False)
           .agg(total=("count", "sum"), rising=("up", "sum"))
           .sort_values(["location", "week_start"]))
    loc["usual_total"] = loc.groupby("location")["total"].transform(
        lambda t: t.shift(1).rolling(BASELINE_WEEKS, min_periods=MIN_HISTORY).mean())
    loc["possible_reporting_surge"] = (
        loc["usual_total"].notna()
        & (loc["total"] >= SURGE_MULTIPLIER * loc["usual_total"].clip(lower=1))
        & (loc["rising"] >= SURGE_MIN_DISEASES)
    )
    return scored.merge(loc[["location", "week_start", "possible_reporting_surge"]],
                        on=["location", "week_start"], how="left")


def _rules(r):
    names = [("threshold", r.r_threshold), ("baseline", r.r_baseline),
             ("ears_c2", r.r_ears_c2), ("ears_c3", r.r_ears_c3)]
    return ",".join(n for n, hit in names if hit)


def _explain(r, multiplier):
    parts = [f"{int(r['count'])} signal(s) in week of {r.week_start:%Y-%m-%d}"]
    if pd.notna(r.baseline_mean):
        parts.append(f"usual {r.baseline_mean:.1f}/week")
    if r.r_threshold:
        parts.append(f"at/above alert threshold ({int(r.threshold)})")
    if r.r_baseline:
        ratio = r["count"] / max(r.baseline_mean, EXPECTED_FLOOR)
        parts.append(f"{ratio:.1f}x the usual level (outbreak multiplier {multiplier})")
    if r.r_ears_c2 or r.r_ears_c3:
        parts.append("statistically unusual (EARS)")
    if r.possible_reporting_surge:
        parts.append("POSSIBLE REPORTING SURGE - several diseases rose together at this location; verify before acting")
    return "; ".join(parts)
