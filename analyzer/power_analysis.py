"""
analyzer/power_analysis.py

Power analysis helper for the Continuous VLM-assisted Privacy Awareness study.

Study design (current repo):
  - Between-subjects: participants are assigned to ONE story and ONE mode ("human" vs "vlm")
  - Capacity is controlled by DynamoDB "story_capacity" rows (see `annotation_json/database initialization.csv`)
  - Pilot runs on a subset of stories (e.g., story_01..story_02), but the formal study can include more stories.

What this script does:
  1) Compute required sample size per condition for a 2-sided independent-groups comparison (default).
     - Uses a standard normal approximation for the two-sample t-test.
  2) Optionally estimate Cohen's d from a pilot participant-level CSV (mode + outcome).
  3) Convert "n per condition" into "max_assignments per story per mode" so you can size the full study.

Primary outcome:
  - You must pick a single participant-level outcome (one number per participant), e.g.:
      * #manual findings per participant
      * mean manual privacy_threat_score
      * mean share_willingness_score
    Export/compute that outcome for your pilot participants, then feed it via --pilot-csv.

    python analyzer\power_analysis.py --effect 0.5 --alpha 0.05 --power 0.8 --study-config annotation_json\study_config.json
    
No external dependencies (pure Python).

How to run (examples):
  - Use a planned/assumed standardized effect size (Cohen's d):
      python analyzer/power_analysis.py --effect 0.5 --alpha 0.05 --power 0.80

  - Estimate effect size from pilot outcome CSV (one row per participant):
      # pilot_outcome.csv:
      # mode,outcome
      # human,3.2
      # vlm,4.1
      python analyzer/power_analysis.py --pilot-csv pilot_outcome.csv --pilot-group-col mode --pilot-value-col outcome

  - Inflate for dropout (e.g., 10%):
      python analyzer/power_analysis.py --effect 0.5 --dropout-rate 0.10

  - Convert required n into per-story capacity (reads story count from study_config.json):
      python analyzer/power_analysis.py --effect 0.5 --study-config annotation_json/study_config.json

  - Emit DynamoDB capacity CSV lines (paste into your init CSV / seed process):
      python analyzer/power_analysis.py --effect 0.5 --study-label formal_1 --print-ddb-csv
"""

from __future__ import annotations

import argparse
import csv
import math
from dataclasses import dataclass
from pathlib import Path
from statistics import mean, stdev
from typing import Dict, Iterable, List, Optional, Sequence, Tuple


# ---- Normal distribution helpers (Acklam inverse CDF approximation) ----

def _norm_cdf(x: float) -> float:
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def _norm_ppf(p: float) -> float:
    """
    Inverse of the standard normal CDF (quantile function).
    Rational approximation by Peter John Acklam (public domain).
    """
    if not (0.0 < p < 1.0):
        raise ValueError("p must be in (0,1)")

    # Coefficients in rational approximations.
    a = [
        -3.969683028665376e01,
        2.209460984245205e02,
        -2.759285104469687e02,
        1.383577518672690e02,
        -3.066479806614716e01,
        2.506628277459239e00,
    ]
    b = [
        -5.447609879822406e01,
        1.615858368580409e02,
        -1.556989798598866e02,
        6.680131188771972e01,
        -1.328068155288572e01,
    ]
    c = [
        -7.784894002430293e-03,
        -3.223964580411365e-01,
        -2.400758277161838e00,
        -2.549732539343734e00,
        4.374664141464968e00,
        2.938163982698783e00,
    ]
    d = [
        7.784695709041462e-03,
        3.224671290700398e-01,
        2.445134137142996e00,
        3.754408661907416e00,
    ]

    plow = 0.02425
    phigh = 1.0 - plow

    if p < plow:
        q = math.sqrt(-2.0 * math.log(p))
        num = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5])
        den = ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1.0)
        return num / den
    if p > phigh:
        q = math.sqrt(-2.0 * math.log(1.0 - p))
        num = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5])
        den = ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1.0)
        return num / den

    q = p - 0.5
    r = q * q
    num = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q
    den = (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1.0)
    return num / den


# ---- Effect size + sample size ----

@dataclass(frozen=True)
class PilotSummary:
    group_a: str
    group_b: str
    n_a: int
    n_b: int
    mean_a: float
    mean_b: float
    sd_a: float
    sd_b: float
    pooled_sd: float
    cohens_d: float
    hedges_g: float


def _pooled_sd(sd_a: float, sd_b: float, n_a: int, n_b: int) -> float:
    if n_a < 2 or n_b < 2:
        raise ValueError("Need at least 2 observations per group to compute SD/pooled SD.")
    df = (n_a - 1) + (n_b - 1)
    return math.sqrt(((n_a - 1) * sd_a * sd_a + (n_b - 1) * sd_b * sd_b) / df)


def estimate_cohens_d_from_pilot(
    csv_path: Path,
    *,
    group_col: str = "mode",
    value_col: str = "outcome",
    group_a: str = "human",
    group_b: str = "vlm",
) -> PilotSummary:
    values: Dict[str, List[float]] = {group_a: [], group_b: []}
    with csv_path.open("r", newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        if not reader.fieldnames:
            raise ValueError("Pilot CSV has no header row.")
        for row in reader:
            g = (row.get(group_col) or "").strip().lower()
            if g not in {group_a.lower(), group_b.lower()}:
                continue
            raw = (row.get(value_col) or "").strip()
            if raw == "":
                continue
            try:
                y = float(raw)
            except ValueError:
                continue
            key = group_a if g == group_a.lower() else group_b
            values[key].append(y)

    a = values[group_a]
    b = values[group_b]
    if len(a) < 2 or len(b) < 2:
        raise ValueError(
            f"Need at least 2 numeric rows per group after filtering; got {group_a}={len(a)}, {group_b}={len(b)}."
        )

    mean_a = mean(a)
    mean_b = mean(b)
    sd_a = stdev(a)
    sd_b = stdev(b)
    pooled = _pooled_sd(sd_a, sd_b, len(a), len(b))
    if pooled == 0:
        raise ValueError("Pooled SD is 0; the outcome has no variance in the pilot.")

    d = (mean_b - mean_a) / pooled

    # Small sample bias correction: Hedges' g = J * d, where J ≈ 1 - 3/(4*df - 1)
    df = (len(a) + len(b) - 2)
    j = 1.0 - (3.0 / (4.0 * df - 1.0)) if df > 1 else 1.0
    g = j * d

    return PilotSummary(
        group_a=group_a,
        group_b=group_b,
        n_a=len(a),
        n_b=len(b),
        mean_a=mean_a,
        mean_b=mean_b,
        sd_a=sd_a,
        sd_b=sd_b,
        pooled_sd=pooled,
        cohens_d=d,
        hedges_g=g,
    )


def required_n_per_group_independent(
    *,
    effect_size_d: float,
    alpha: float = 0.05,
    power: float = 0.80,
    two_sided: bool = True,
    allocation_ratio: float = 1.0,  # n_B / n_A
) -> Tuple[int, int]:
    """
    Approximate sample size for an independent-groups comparison (two-sample t-test),
    using a standard normal approximation.
    """
    if effect_size_d <= 0:
        raise ValueError("effect_size_d must be > 0")
    if not (0 < alpha < 1):
        raise ValueError("alpha must be in (0,1)")
    if not (0 < power < 1):
        raise ValueError("power must be in (0,1)")
    if allocation_ratio <= 0:
        raise ValueError("allocation_ratio must be > 0")

    alpha_tail = alpha / 2.0 if two_sided else alpha
    z_alpha = _norm_ppf(1.0 - alpha_tail)
    z_power = _norm_ppf(power)
    z_sum_sq = (z_alpha + z_power) ** 2

    r = allocation_ratio
    n_a = ((1.0 + r) / r) * (2.0 * z_sum_sq) / (effect_size_d**2) / 2.0
    # The above simplifies to: n_a = (1+r)/r * z_sum_sq / d^2
    n_a = ((1.0 + r) / r) * z_sum_sq / (effect_size_d**2)
    n_b = r * n_a
    return int(math.ceil(n_a)), int(math.ceil(n_b))


def required_n_paired(
    *,
    effect_size_dz: float,
    alpha: float = 0.05,
    power: float = 0.80,
    two_sided: bool = True,
) -> int:
    if effect_size_dz <= 0:
        raise ValueError("effect_size_dz must be > 0")
    if not (0 < alpha < 1):
        raise ValueError("alpha must be in (0,1)")
    if not (0 < power < 1):
        raise ValueError("power must be in (0,1)")
    alpha_tail = alpha / 2.0 if two_sided else alpha
    z_alpha = _norm_ppf(1.0 - alpha_tail)
    z_power = _norm_ppf(power)
    n = ((z_alpha + z_power) / effect_size_dz) ** 2
    return int(math.ceil(n))


def apply_dropout(n: int, dropout_rate: float) -> int:
    if not (0.0 <= dropout_rate < 1.0):
        raise ValueError("dropout-rate must be in [0,1)")
    if dropout_rate == 0:
        return n
    return int(math.ceil(n / (1.0 - dropout_rate)))


def story_capacity_per_mode(n_per_mode: int, story_count: int) -> int:
    if story_count <= 0:
        raise ValueError("story_count must be >= 1")
    return int(math.ceil(n_per_mode / story_count))


def load_story_ids_from_study_config(path: Path) -> List[str]:
    import json

    data = json.loads(path.read_text(encoding="utf-8"))
    stories = data.get("stories") or []
    out: List[str] = []
    for s in stories:
        sid = (s or {}).get("storyId")
        if isinstance(sid, str) and sid.strip():
            out.append(sid.strip())
    if not out:
        raise ValueError(f"No stories found in {path}")
    return out


def emit_ddb_capacity_csv_lines(
    *,
    study_label: str,
    story_ids: Sequence[str],
    max_assignments_per_story_per_mode: int,
    modes: Sequence[str] = ("human", "vlm"),
) -> List[str]:
    header = '"pk","sk","analysis_filename","assigned_count","item_type","max_assignments","mode","story_id","study"'
    lines = [header]
    for story_id in story_ids:
        for mode in modes:
            sk = f"{study_label}#{story_id}#{mode}"
            analysis_filename = f"{story_id}.json"
            lines.append(
                f'"soups26_vlm_assignment_story","{sk}","{analysis_filename}","0","story_capacity","{max_assignments_per_story_per_mode}","{mode}","{story_id}","{study_label}"'
            )
    return lines


def main(argv: Optional[Sequence[str]] = None) -> int:
    p = argparse.ArgumentParser(
        description="Power analysis + study sizing (human vs VLM) for this repo’s assignment design."
    )
    p.add_argument("--design", choices=["independent", "paired"], default="independent")
    p.add_argument("--alpha", type=float, default=0.05)
    p.add_argument("--power", type=float, default=0.80)
    p.add_argument("--one-sided", action="store_true", help="Use a one-sided test (default is two-sided).")
    p.add_argument("--allocation-ratio", type=float, default=1.0, help="n_vlm / n_human (default 1).")
    p.add_argument("--dropout-rate", type=float, default=0.0, help="Inflate n for expected dropout (e.g., 0.10).")

    # Effect size inputs (either direct or estimated from pilot CSV)
    p.add_argument("--effect", type=float, default=None, help="Effect size (Cohen's d for independent; dz for paired).")
    p.add_argument("--pilot-csv", type=Path, default=None, help="Pilot CSV with columns like mode,outcome.")
    p.add_argument("--pilot-group-col", default="mode")
    p.add_argument("--pilot-value-col", default="outcome")
    p.add_argument("--pilot-group-a", default="human")
    p.add_argument("--pilot-group-b", default="vlm")
    p.add_argument("--use-hedges-g", action="store_true", help="Use Hedges' g from pilot instead of Cohen's d.")

    # Convert to per-story capacity for the repo's assignment scheme
    p.add_argument("--stories", type=int, default=None, help="Number of stories in the full study.")
    p.add_argument(
        "--study-config",
        type=Path,
        default=Path("annotation_json/study_config.json"),
        help="Path to a study_config.json to read story IDs from.",
    )
    p.add_argument("--study-label", default="formal_1", help='Used in DynamoDB sk, e.g. "formal_1" or "pilot".')
    p.add_argument("--print-ddb-csv", action="store_true", help="Print DynamoDB capacity CSV lines to stdout.")

    args = p.parse_args(list(argv) if argv is not None else None)

    two_sided = not args.one_sided

    pilot_summary: Optional[PilotSummary] = None
    effect = args.effect
    if effect is None and args.pilot_csv is not None:
        pilot_summary = estimate_cohens_d_from_pilot(
            args.pilot_csv,
            group_col=args.pilot_group_col,
            value_col=args.pilot_value_col,
            group_a=args.pilot_group_a,
            group_b=args.pilot_group_b,
        )
        effect = pilot_summary.hedges_g if args.use_hedges_g else pilot_summary.cohens_d

    if effect is None:
        raise SystemExit("Provide --effect or --pilot-csv to estimate an effect size.")

    abs_effect = abs(float(effect))
    if abs_effect <= 0:
        raise SystemExit("Effect size must be non-zero.")

    if args.design == "independent":
        n_human, n_vlm = required_n_per_group_independent(
            effect_size_d=abs_effect,
            alpha=args.alpha,
            power=args.power,
            two_sided=two_sided,
            allocation_ratio=args.allocation_ratio,
        )
        n_human = apply_dropout(n_human, args.dropout_rate)
        n_vlm = apply_dropout(n_vlm, args.dropout_rate)
        n_total = n_human + n_vlm
    else:
        n = required_n_paired(
            effect_size_dz=abs_effect,
            alpha=args.alpha,
            power=args.power,
            two_sided=two_sided,
        )
        n = apply_dropout(n, args.dropout_rate)
        n_human = n_vlm = 0
        n_total = n

    story_ids: Optional[List[str]] = None
    story_count: Optional[int] = args.stories
    try:
        story_ids = load_story_ids_from_study_config(args.study_config)
        if story_count is None:
            story_count = len(story_ids)
    except Exception:
        if story_count is None:
            story_count = None

    print("=== Power analysis (normal approx) ===")
    print(f"design: {args.design}")
    print(f"alpha: {args.alpha} ({'two-sided' if two_sided else 'one-sided'})")
    print(f"power: {args.power}")
    print(f"effect size: {abs_effect:.4f} ({'Hedges g' if args.use_hedges_g else 'Cohen d/dz'})")
    if args.dropout_rate:
        print(f"dropout-rate: {args.dropout_rate:.2%} (inflated)")
    if pilot_summary:
        print("--- Pilot summary used to estimate effect ---")
        print(
            f"{pilot_summary.group_a}: n={pilot_summary.n_a}, mean={pilot_summary.mean_a:.4f}, sd={pilot_summary.sd_a:.4f}"
        )
        print(
            f"{pilot_summary.group_b}: n={pilot_summary.n_b}, mean={pilot_summary.mean_b:.4f}, sd={pilot_summary.sd_b:.4f}"
        )
        print(f"pooled_sd: {pilot_summary.pooled_sd:.4f}")
        print(f"cohens_d: {pilot_summary.cohens_d:.4f}")
        print(f"hedges_g: {pilot_summary.hedges_g:.4f}")

    print("--- Required sample size ---")
    if args.design == "independent":
        print(f"n_per_group (human): {n_human}")
        print(f"n_per_group (vlm):   {n_vlm}  (allocation ratio n_vlm/n_human={args.allocation_ratio:g})")
        print(f"n_total:             {n_total}")
    else:
        print(f"n_total_pairs:       {n_total}")

    if args.design == "independent" and story_count:
        per_story = story_capacity_per_mode(max(n_human, n_vlm), story_count)
        implied_total = per_story * story_count * 2
        print("--- Convert to per-story capacity (repo assignment model) ---")
        print(f"stories:                     {story_count}")
        print(f"max_assignments per story/mode: {per_story}")
        print(f"implied total capacity:      {implied_total} (>= {n_total})")

        if args.print_ddb_csv:
            if not story_ids:
                story_ids = [f"story_{i:02d}" for i in range(1, story_count + 1)]
            print("--- DynamoDB capacity CSV (paste/append) ---")
            for line in emit_ddb_capacity_csv_lines(
                study_label=args.study_label,
                story_ids=story_ids,
                max_assignments_per_story_per_mode=per_story,
            ):
                print(line)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
