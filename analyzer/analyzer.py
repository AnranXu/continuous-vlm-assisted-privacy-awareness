"""
analyzer/analyzer.py

Lightweight analysis utilities for the Continuous VLM-assisted Privacy Awareness study.

The analyzer is designed to work with CSV exports from DynamoDB. Two formats are supported:

1) Long format (already normalized):
   Required columns: participant_id, mode, study_label (or study/study_id), phase, question_id, score

2) DynamoDB item export (one row per item):
   Expected columns (any subset is ok):
     - item_type, pk, sk, participant_id, mode, study_label, study, study_id
     - answers (pre/post-study)
     - aiAnswers or ai_answers (post-study VLM only)
     - ai_responses, participant_findings, cross_clip_responses (in-study clip annotations)

Scores are treated as numeric. Seven-point Likert items are -3..3.
Post-study NASA-TLX items are 1..21; they are retained in the long table but filtered out
when summarizing 7-point Likert distributions.

Dependencies:
  - pandas, numpy
  - scipy (for tests)
  - matplotlib + seaborn (for plotting; optional)

Install example:
  pip install pandas numpy scipy matplotlib seaborn
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple


def _require(pkg: str):
    try:
        return __import__(pkg)
    except Exception as exc:  # pragma: no cover
        raise ImportError(
            f"Missing dependency '{pkg}'. Install it first, e.g. `pip install {pkg}`."
        ) from exc


def ddb_to_python(value: Any) -> Any:
    """
    Convert a DynamoDB AttributeValue-like structure into plain Python.
    Supports S, N, BOOL, L, M. If the value is already plain JSON, it's returned as-is.
    """
    if isinstance(value, list):
        return [ddb_to_python(v) for v in value]
    if not isinstance(value, dict):
        return value

    if "S" in value:
        return value["S"]
    if "N" in value:
        n = value["N"]
        try:
            return int(n) if re.fullmatch(r"-?\d+", str(n)) else float(n)
        except Exception:
            return n
    if "BOOL" in value:
        return bool(value["BOOL"])
    if "L" in value:
        return [ddb_to_python(v) for v in value["L"]]
    if "M" in value:
        return {k: ddb_to_python(v) for k, v in value["M"].items()}

    # Not an AttributeValue map; treat as plain dict.
    return {k: ddb_to_python(v) for k, v in value.items()}


def parse_maybe_json(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (list, dict)):
        return ddb_to_python(value)
    if isinstance(value, str):
        s = value.strip()
        if not s:
            return None
        try:
            return ddb_to_python(json.loads(s))
        except Exception:
            return None
    return None


def count_words(text: str) -> int:
    return len([w for w in str(text or "").strip().split() if w])


def derive_study_label(row: Mapping[str, Any]) -> str:
    for key in ("study_label", "study"):
        val = row.get(key)
        if isinstance(val, str) and val.strip():
            v = val.strip().lower()
            return "pilot" if v == "pilot" else "formal"
    study_id = str(row.get("study_id") or row.get("studyId") or "")
    if "pilot" in study_id.lower():
        return "pilot"
    return "formal"


def derive_mode(row: Mapping[str, Any]) -> str:
    for key in ("mode", "assigned_mode", "condition"):
        val = row.get(key)
        if isinstance(val, str) and val.strip():
            v = val.strip().lower()
            if v in {"human", "vlm"}:
                return v
    sk = str(row.get("sk") or "")
    if "#vlm" in sk.lower():
        return "vlm"
    if "#human" in sk.lower():
        return "human"
    return "unknown"


def derive_phase(row: Mapping[str, Any]) -> Optional[str]:
    item_type = str(row.get("item_type") or row.get("itemType") or "").lower()
    sk = str(row.get("sk") or "").lower()
    if "prestudy" in item_type or sk.endswith("#prestudy"):
        return "pre"
    if "poststudy" in item_type or sk.endswith("#poststudy"):
        return "post"
    if "clip_annotation" in item_type or "#clip_" in sk:
        return "in"
    return None


IN_MANUAL_KEYS = {
    "privacy_threat_score": "manual_privacy_threat_score",
    "share_willingness_score": "manual_share_willingness_score",
    "ai_memory_comfort_score": "manual_ai_memory_comfort_score",
}
IN_AI_KEYS = {
    "privacy_threat_score": "ai_privacy_threat_score",
    "share_willingness_score": "ai_share_willingness_score",
    "ai_memory_comfort_score": "ai_ai_memory_comfort_score",
    "trust_ai_score": "ai_trust_ai_score",
}
IN_CROSS_KEYS = {
    "cross_privacy_threat_score": "cross_privacy_threat_score",
    "cross_more_severe_score": "cross_more_severe_score",
    "cross_ai_memory_comfort_score": "cross_ai_memory_comfort_score",
}


def normalize_to_long(df):
    """
    Return a long-format DataFrame with columns:
      participant_id, mode, study_label, phase, question_id, score, source, item_id
    """
    pd = _require("pandas")
    import numpy as np  # noqa

    # Standardize column lookup to be case-insensitive.
    colmap = {c.lower(): c for c in df.columns}

    def _get(row, key, default=None):
        c = colmap.get(key)
        return row.get(c, default) if c else default

    # Already long?
    if {"question_id", "score"}.issubset(colmap):
        out = df.rename(
            columns={
                colmap["question_id"]: "question_id",
                colmap["score"]: "score",
                colmap.get("participant_id", "participant_id"): "participant_id",
                colmap.get("mode", "mode"): "mode",
                colmap.get("phase", "phase"): "phase",
                colmap.get("study_label", colmap.get("study", "study_label")): "study_label",
            }
        )
        if "study_label" not in out.columns:
            out["study_label"] = out.apply(lambda r: derive_study_label(r), axis=1)
        if "mode" not in out.columns:
            out["mode"] = out.apply(lambda r: derive_mode(r), axis=1)
        if "phase" not in out.columns:
            out["phase"] = out.apply(lambda r: derive_phase(r) or "unknown", axis=1)
        out["score"] = pd.to_numeric(out["score"], errors="coerce")
        out = out.dropna(subset=["score"])
        out["source"] = out.get("source", "long")
        out["item_id"] = out.get("item_id", None)
        return out[
            [
                "participant_id",
                "mode",
                "study_label",
                "phase",
                "question_id",
                "score",
                "source",
                "item_id",
            ]
        ]

    records: List[Dict[str, Any]] = []
    for _, row in df.iterrows():
        row_dict = {k.lower(): row[v] for k, v in colmap.items()}

        participant_id = str(_get(row, "participant_id") or _get(row, "participantId") or "").strip() or None
        mode = derive_mode(row_dict)
        study_label = derive_study_label(row_dict)
        phase = derive_phase(row_dict) or "unknown"

        def add_record(qid: str, score: Any, source: str, item_id: Optional[str] = None):
            try:
                s = float(score)
            except Exception:
                return
            records.append(
                {
                    "participant_id": participant_id,
                    "mode": mode,
                    "study_label": study_label,
                    "phase": phase,
                    "question_id": qid,
                    "score": s,
                    "source": source,
                    "item_id": item_id,
                }
            )

        # Pre/Post study answers (plain list of dicts)
        answers = parse_maybe_json(_get(row, "answers"))
        if isinstance(answers, list):
            for a in answers:
                if not isinstance(a, dict):
                    continue
                qid = a.get("question_id") or a.get("id") or a.get("questionId")
                if not qid:
                    continue
                add_record(str(qid), a.get("score"), source="answers")

        # Some exports store aiAnswers separately
        ai_answers = parse_maybe_json(_get(row, "aiAnswers") or _get(row, "ai_answers"))
        if isinstance(ai_answers, list):
            for a in ai_answers:
                if not isinstance(a, dict):
                    continue
                qid = a.get("question_id") or a.get("id") or a.get("questionId")
                if not qid:
                    continue
                add_record(str(qid), a.get("score"), source="ai_answers")

        if phase != "in":
            continue

        # In-study participant findings (manual)
        findings = parse_maybe_json(_get(row, "participant_findings") or _get(row, "participantFindings"))
        if isinstance(findings, list):
            for f in findings:
                if not isinstance(f, dict):
                    continue
                fid = f.get("finding_id") or f.get("findingId")
                for raw_key, qid in IN_MANUAL_KEYS.items():
                    if raw_key in f:
                        add_record(qid, f.get(raw_key), source="manual", item_id=str(fid) if fid else None)

        # AI single-clip responses
        ai_responses = parse_maybe_json(_get(row, "ai_responses") or _get(row, "aiResponses"))
        if isinstance(ai_responses, list):
            for a in ai_responses:
                if not isinstance(a, dict):
                    continue
                det_id = a.get("det_id") or a.get("detId")
                for raw_key, qid in IN_AI_KEYS.items():
                    if raw_key in a:
                        add_record(qid, a.get(raw_key), source="ai", item_id=str(det_id) if det_id else None)

        # Cross-clip responses
        cross = parse_maybe_json(_get(row, "cross_clip_responses") or _get(row, "crossClipResponses"))
        if isinstance(cross, list):
            for c in cross:
                if not isinstance(c, dict):
                    continue
                tid = c.get("threat_id") or c.get("threatId")
                for raw_key, qid in IN_CROSS_KEYS.items():
                    if raw_key in c:
                        add_record(qid, c.get(raw_key), source="cross", item_id=str(tid) if tid else None)

    out = pd.DataFrame.from_records(records)
    if out.empty:
        return out
    out["score"] = pd.to_numeric(out["score"], errors="coerce")
    out = out.dropna(subset=["score"])
    return out


def summarize_likert(
    long_df,
    scale: Tuple[int, int] = (-3, 3),
    group_cols: Sequence[str] = ("mode", "study_label", "phase"),
):
    """
    Summarize 7-point Likert items: distribution and mean per question and group.
    Returns a DataFrame with columns:
      group_cols + question_id + n + mean + std + count_-3 ... count_3
    """
    pd = _require("pandas")

    if long_df is None or long_df.empty:
        return pd.DataFrame()

    df = long_df.copy()
    df["score"] = pd.to_numeric(df["score"], errors="coerce")
    df = df.dropna(subset=["score"])
    df = df[(df["score"] >= scale[0]) & (df["score"] <= scale[1])]

    if df.empty:
        return pd.DataFrame()

    stats = (
        df.groupby([*group_cols, "question_id"])["score"]
        .agg(n="count", mean="mean", std="std")
        .reset_index()
    )

    dist = (
        df.groupby([*group_cols, "question_id", "score"])
        .size()
        .reset_index(name="count")
    )
    pivot = dist.pivot_table(
        index=[*group_cols, "question_id"],
        columns="score",
        values="count",
        fill_value=0,
    )
    pivot.columns = [f"count_{int(c)}" for c in pivot.columns]
    pivot = pivot.reset_index()

    out = stats.merge(pivot, on=[*group_cols, "question_id"], how="left")
    return out


def compare_groups(
    long_df,
    phases: Sequence[str] = ("pre", "in", "post"),
    group_col: str = "mode",
    study_col: str = "study_label",
    tests: Sequence[str] = ("kruskal", "ttest"),
):
    """
    Compare human vs VLM group differences per phase/question.
    Runs Kruskal–Wallis (k>=2 groups) and Welch t-test (only if k==2).

    Returns a DataFrame with one row per phase/question/(study_label).
    """
    pd = _require("pandas")
    try:
        stats = _require("scipy").stats
    except ImportError:  # pragma: no cover
        # Allow running summaries without scipy installed.
        return pd.DataFrame()

    if long_df is None or long_df.empty:
        return pd.DataFrame()

    df = long_df.copy()
    df["score"] = pd.to_numeric(df["score"], errors="coerce")
    df = df.dropna(subset=["score"])

    results: List[Dict[str, Any]] = []

    study_values = (
        sorted(df[study_col].dropna().unique().tolist())
        if study_col in df.columns
        else [None]
    )

    for study_val in study_values:
        d_study = df if study_val is None else df[df[study_col] == study_val]
        for phase in phases:
            d_phase = d_study[d_study["phase"] == phase]
            if d_phase.empty:
                continue
            for qid, sub in d_phase.groupby("question_id"):
                per_p = (
                    sub.groupby([group_col, "participant_id"])["score"]
                    .mean()
                    .reset_index()
                )
                groups = []
                labels = []
                for label, g in per_p.groupby(group_col):
                    vals = g["score"].dropna().to_numpy()
                    if len(vals) > 0:
                        labels.append(label)
                        groups.append(vals)
                if len(groups) < 2:
                    continue

                row_out: Dict[str, Any] = {
                    "study_label": study_val if study_val is not None else "all",
                    "phase": phase,
                    "question_id": qid,
                }
                for label, vals in zip(labels, groups):
                    row_out[f"n_{label}"] = int(len(vals))
                    row_out[f"mean_{label}"] = float(vals.mean())
                    row_out[f"std_{label}"] = float(vals.std(ddof=1)) if len(vals) > 1 else 0.0

                if "kruskal" in tests:
                    kw = stats.kruskal(*groups)
                    row_out["kruskal_H"] = float(kw.statistic)
                    row_out["kruskal_p"] = float(kw.pvalue)

                if "ttest" in tests and len(groups) == 2:
                    tt = stats.ttest_ind(groups[0], groups[1], equal_var=False, nan_policy="omit")
                    row_out["ttest_t"] = float(tt.statistic)
                    row_out["ttest_p"] = float(tt.pvalue)

                results.append(row_out)

    return pd.DataFrame(results)


def visualize(
    long_df,
    out_dir: str | Path,
    phases: Sequence[str] = ("pre", "in", "post"),
    scale: Tuple[int, int] = (-3, 3),
    study_col: str = "study_label",
    group_col: str = "mode",
):
    """
    Optional visualization of Likert distributions.
    Saves PNGs into out_dir. Requires matplotlib and seaborn.
    """
    pd = _require("pandas")
    sns = _require("seaborn")
    plt = _require("matplotlib.pyplot")

    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    if long_df is None or long_df.empty:
        return []

    df = long_df.copy()
    df["score"] = pd.to_numeric(df["score"], errors="coerce")
    df = df.dropna(subset=["score"])
    df = df[(df["score"] >= scale[0]) & (df["score"] <= scale[1])]

    saved = []
    study_values = (
        sorted(df[study_col].dropna().unique().tolist())
        if study_col in df.columns
        else ["all"]
    )

    for study_val in study_values:
        d_study = df if study_val == "all" else df[df[study_col] == study_val]
        for phase in phases:
            d_phase = d_study[d_study["phase"] == phase]
            if d_phase.empty:
                continue
            plt.figure(figsize=(max(8, d_phase["question_id"].nunique() * 0.8), 5))
            sns.violinplot(
                data=d_phase,
                x="question_id",
                y="score",
                hue=group_col,
                cut=0,
                inner="box",
            )
            plt.title(f"{phase} – {study_val} – 7-point Likert")
            plt.xticks(rotation=45, ha="right")
            plt.tight_layout()
            fname = out_dir / f"likert_{study_val}_{phase}.png"
            plt.savefig(fname, dpi=150)
            plt.close()
            saved.append(str(fname))
    return saved


def analyze_csv(
    csv_path: str | Path,
    out_dir: str | Path | None = None,
    group_cols: Sequence[str] = ("mode", "study_label", "phase"),
):
    """
    Convenience entrypoint:
      - loads CSV
      - normalizes to long
      - returns (long_df, summary_df, compare_df, plot_paths)
    """
    pd = _require("pandas")

    csv_path = Path(csv_path)
    df = pd.read_csv(csv_path)
    long_df = normalize_to_long(df)
    summary_df = summarize_likert(long_df, group_cols=group_cols)
    try:
        compare_df = compare_groups(long_df)
    except ImportError:
        compare_df = pd.DataFrame()

    plot_paths = []
    if out_dir is not None:
        try:
            plot_paths = visualize(long_df, out_dir)
        except ImportError:
            plot_paths = []

    return long_df, summary_df, compare_df, plot_paths


if __name__ == "__main__":  # pragma: no cover
    import argparse

    ap = argparse.ArgumentParser(description="Analyze DynamoDB CSV exports for the study.")
    ap.add_argument("csv", help="Path to CSV export")
    ap.add_argument("--out-dir", help="Directory to write plots (optional)")
    ap.add_argument("--summary-csv", help="Write summary table to CSV")
    ap.add_argument("--compare-csv", help="Write group comparison table to CSV")
    ap.add_argument("--long-csv", help="Write normalized long table to CSV")
    args = ap.parse_args()

    long_df, summary_df, compare_df, plots = analyze_csv(args.csv, out_dir=args.out_dir)

    if args.long_csv:
        long_df.to_csv(args.long_csv, index=False)
    if args.summary_csv:
        summary_df.to_csv(args.summary_csv, index=False)
    if args.compare_csv:
        compare_df.to_csv(args.compare_csv, index=False)

    print(f"Rows normalized: {len(long_df)}")
    print(f"Summary rows: {len(summary_df)}")
    print(f"Comparison rows: {len(compare_df)}")
    if plots:
        print("Plots saved:")
        for p in plots:
            print(" -", p)
