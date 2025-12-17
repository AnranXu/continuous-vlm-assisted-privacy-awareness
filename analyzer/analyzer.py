"""
analyzer/analyzer.py

Lightweight analysis utilities for the Continuous VLM-assisted Privacy Awareness study.

The analyzer is designed to work with CSV exports from DynamoDB. Two formats are supported:

1) Long format (already normalized):
   Required columns: participant_id, mode, study_label (or study/study_id), phase, question_id, score
   (study_label is typically "pilot" or a formal label like "formal_1".)

2) DynamoDB item export (one row per item):
   Expected columns (any subset is ok):
     - item_type, pk, sk, participant_id, mode, study_label, study, study_id
     - answers (pre/post-study)
     - genai_usage (pre-study generative AI tool usage)
     - aiAnswers or ai_answers (post-study VLM only)
     - ai_responses, participant_findings, cross_clip_responses, cross_clip_manual_privacy (in-study clip annotations)

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
    """
    Return the *specific* study label used by the system (e.g. "pilot", "formal_1").

    Notes:
      - Lambdas in this repo use `studyLabel` like "pilot" or DEFAULT_FORMAL_STUDY (e.g. "formal_1").
      - Older exports may only have generic "formal"; we preserve it if that's all we can infer.
    """

    def _clean(v: str) -> str:
        return v.strip().lower()

    # 1) Prefer explicit columns if present (keeps "formal_1" vs "pilot").
    for key in ("study_label", "study", "studylabel"):
        val = row.get(key)
        if isinstance(val, str) and val.strip():
            return _clean(val)

    # 2) Parse study_id formats like "soups26_vlma_01:formal_1" or "soups26_vlma_01:pilot".
    study_id = str(row.get("study_id") or row.get("studyId") or row.get("studyid") or "").strip()
    if study_id:
        lowered = study_id.lower()
        if ":" in lowered:
            suffix = lowered.rsplit(":", 1)[-1]
            suffix = suffix.split("#", 1)[0].strip()
            if suffix:
                return suffix
        if "pilot" in lowered:
            return "pilot"
        m = re.search(r"\bformal_[a-z0-9]+\b", lowered)
        if m:
            return m.group(0)
        if "formal" in lowered:
            return "formal"

    # 3) As a last resort, infer from DynamoDB sk prefix when it looks like "<studyLabel>#..."
    sk = str(row.get("sk") or "").strip()
    if sk:
        prefix = sk.split("#", 1)[0].strip().lower()
        if ":" in prefix:
            prefix = prefix.rsplit(":", 1)[-1].strip()
        if prefix in {"pilot", "formal"} or prefix.startswith("formal_"):
            return prefix

    # Backward-compatible default.
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
IN_CROSS_MANUAL_KEYS = {
    "cross_privacy_threat_score": "cross_manual_privacy_threat_score",
    "cross_more_severe_score": "cross_manual_more_severe_score",
    "cross_ai_memory_comfort_score": "cross_manual_ai_memory_comfort_score",
}


def normalize_to_long(df):
    """
    Return a long-format DataFrame with columns:
      participant_id, mode, study_label, phase, question_id, score, source, item_id, privacy_type
    privacy_type is only populated for in-study items (manual/ai/cross), based on
    manual categories or AI information_types.
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
        out["privacy_type"] = out.get("privacy_type", None)
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
                "privacy_type",
            ]
        ]

    records: List[Dict[str, Any]] = []
    for _, row in df.iterrows():
        row_dict = {k.lower(): row[v] for k, v in colmap.items()}

        participant_id = str(_get(row, "participant_id") or _get(row, "participantId") or "").strip() or None
        mode = derive_mode(row_dict)
        study_label = derive_study_label(row_dict)
        phase = derive_phase(row_dict) or "unknown"

        def add_record(
            qid: str,
            score: Any,
            source: str,
            item_id: Optional[str] = None,
            privacy_type: Optional[str] = None,
        ):
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
                    "privacy_type": privacy_type,
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
        findings = parse_maybe_json(
            _get(row, "participant_findings") or _get(row, "participantFindings")
        )
        if isinstance(findings, list):
            for f in findings:
                if not isinstance(f, dict):
                    continue
                fid = f.get("finding_id") or f.get("findingId")
                cats = f.get("categories") or []
                if isinstance(cats, str):
                    cats = [cats]
                cats = [str(c).strip() for c in cats if c is not None and str(c).strip()]
                if not cats:
                    cats = [None]
                for raw_key, qid in IN_MANUAL_KEYS.items():
                    if raw_key in f:
                        for cat in cats:
                            add_record(
                                qid,
                                f.get(raw_key),
                                source="manual",
                                item_id=str(fid) if fid else None,
                                privacy_type=cat,
                            )

        # AI single-clip responses
        ai_responses = parse_maybe_json(_get(row, "ai_responses") or _get(row, "aiResponses"))
        if isinstance(ai_responses, list):
            for a in ai_responses:
                if not isinstance(a, dict):
                    continue
                det_id = a.get("det_id") or a.get("detId")
                types = a.get("information_types") or a.get("informationTypes") or []
                if isinstance(types, str):
                    types = [types]
                types = [str(t).strip() for t in types if t is not None and str(t).strip()]
                if not types:
                    types = [None]
                for raw_key, qid in IN_AI_KEYS.items():
                    if raw_key in a:
                        for t in types:
                            add_record(
                                qid,
                                a.get(raw_key),
                                source="ai",
                                item_id=str(det_id) if det_id else None,
                                privacy_type=t,
                            )

        # Cross-clip responses
        cross = parse_maybe_json(_get(row, "cross_clip_responses") or _get(row, "crossClipResponses"))
        if isinstance(cross, list):
            for c in cross:
                if not isinstance(c, dict):
                    continue
                tid = c.get("threat_id") or c.get("threatId")
                types = c.get("information_types") or c.get("informationTypes") or []
                if isinstance(types, str):
                    types = [types]
                types = [str(t).strip() for t in types if t is not None and str(t).strip()]
                if not types:
                    types = [None]
                for raw_key, qid in IN_CROSS_KEYS.items():
                    if raw_key in c:
                        for t in types:
                            add_record(
                                qid,
                                c.get(raw_key),
                                source="cross",
                                item_id=str(tid) if tid else None,
                                privacy_type=t,
                            )

        # Cross-clip manual privacy (human annotations inferred across clips)
        cross_manual = parse_maybe_json(
            _get(row, "cross_clip_manual_privacy")
            or _get(row, "crossClipManualPrivacy")
            or _get(row, "cross_clip_manual")
        )
        if isinstance(cross_manual, dict):
            # Record the top-level Yes/No choice so "No" responses are visible in analysis output.
            if isinstance(cross_manual.get("has_privacy"), bool):
                add_record(
                    "cross_manual_has_privacy",
                    1 if cross_manual.get("has_privacy") else 0,
                    source="cross_manual",
                    item_id=None,
                    privacy_type=None,
                )
            findings = cross_manual.get("findings") or []
            if isinstance(findings, dict):
                findings = [findings]
            if isinstance(findings, list):
                for f in findings:
                    if not isinstance(f, dict):
                        continue
                    fid = f.get("finding_id") or f.get("findingId") or f.get("id")
                    cats = f.get("categories") or []
                    if isinstance(cats, str):
                        cats = [cats]
                    cats = [str(c).strip() for c in cats if c is not None and str(c).strip()]
                    if not cats:
                        cats = [None]
                    for raw_key, qid in IN_CROSS_MANUAL_KEYS.items():
                        if raw_key in f:
                            for cat in cats:
                                add_record(
                                    qid,
                                    f.get(raw_key),
                                    source="cross_manual",
                                    item_id=str(fid) if fid else None,
                                    privacy_type=cat,
                                )

    out = pd.DataFrame.from_records(records)
    if out.empty:
        return out
    out["score"] = pd.to_numeric(out["score"], errors="coerce")
    out = out.dropna(subset=["score"])
    return out


def extract_free_text(df):
    """
    Extract free-text responses (e.g., post-study open response) from a DynamoDB export.

    Returns a DataFrame with:
      participant_id, mode, study_label, phase, item_type, story_id, free_text, word_count, char_count
    """
    pd = _require("pandas")

    if df is None or df.empty:
        return pd.DataFrame(
            columns=[
                "participant_id",
                "mode",
                "study_label",
                "phase",
                "item_type",
                "story_id",
                "free_text",
                "word_count",
                "char_count",
            ]
        )

    colmap = {c.lower(): c for c in df.columns}

    def _get(row, key, default=None):
        c = colmap.get(key)
        return row.get(c, default) if c else default

    records: List[Dict[str, Any]] = []
    for _, row in df.iterrows():
        row_dict = {k.lower(): row[v] for k, v in colmap.items()}
        participant_id = str(_get(row, "participant_id") or _get(row, "participantId") or "").strip() or None
        if not participant_id:
            continue

        phase = derive_phase(row_dict) or "unknown"
        item_type = str(_get(row, "item_type") or _get(row, "itemType") or "").strip() or None
        mode = derive_mode(row_dict)
        study_label = derive_study_label(row_dict)
        story_id = str(_get(row, "story_id") or _get(row, "storyId") or "").strip() or None

        free_text = _get(row, "free_text")
        if free_text is None:
            free_text = _get(row, "freeText")
        if free_text is None or (isinstance(free_text, float) and pd.isna(free_text)):
            continue

        text = str(free_text or "").strip()
        if not text:
            continue

        records.append(
            {
                "participant_id": participant_id,
                "mode": mode,
                "study_label": study_label,
                "phase": phase,
                "item_type": item_type,
                "story_id": story_id,
                "free_text": text,
                "word_count": count_words(text),
                "char_count": len(text),
            }
        )

    return pd.DataFrame.from_records(records)


def summarize_free_text(
    free_text_df,
    group_cols: Sequence[str] = ("mode", "study_label", "phase"),
):
    """
    Summarize free-text responses by group.

    Returns a DataFrame with:
      group_cols + n + mean_word_count + median_word_count + mean_char_count + median_char_count
    """
    pd = _require("pandas")
    if free_text_df is None or free_text_df.empty:
        return pd.DataFrame()

    df = free_text_df.copy()
    for col in ("word_count", "char_count"):
        df[col] = pd.to_numeric(df[col], errors="coerce")
    df = df.dropna(subset=["word_count", "char_count"])
    if df.empty:
        return pd.DataFrame()

    agg = (
        df.groupby(list(group_cols))
        .agg(
            n=("free_text", "count"),
            mean_word_count=("word_count", "mean"),
            median_word_count=("word_count", "median"),
            mean_char_count=("char_count", "mean"),
            median_char_count=("char_count", "median"),
        )
        .reset_index()
    )
    return agg


def extract_genai_usage(df):
    """
    Extract generative-AI usage responses from a DynamoDB export.

    Returns a DataFrame with:
      participant_id, mode, study_label, phase, genai_tools, genai_frequency, genai_other_text, genai_used_any
    """
    pd = _require("pandas")

    if df is None or df.empty:
        return pd.DataFrame(
            columns=[
                "participant_id",
                "mode",
                "study_label",
                "phase",
                "genai_tools",
                "genai_frequency",
                "genai_other_text",
                "genai_used_any",
            ]
        )

    colmap = {c.lower(): c for c in df.columns}

    def _get(row, key, default=None):
        c = colmap.get(key)
        return row.get(c, default) if c else default

    records: List[Dict[str, Any]] = []
    for _, row in df.iterrows():
        row_dict = {k.lower(): row[v] for k, v in colmap.items()}
        participant_id = str(_get(row, "participant_id") or _get(row, "participantId") or "").strip() or None
        if not participant_id:
            continue

        raw = (
            _get(row, "genai_usage")
            or _get(row, "genAiUsage")
            or _get(row, "genaiUsage")
            or _get(row, "gen_ai_usage")
        )
        parsed = parse_maybe_json(raw)
        if not isinstance(parsed, dict):
            continue

        tools = parsed.get("tools") or []
        if isinstance(tools, str):
            tools = [tools]
        if not isinstance(tools, list):
            tools = []
        tools = [str(t).strip() for t in tools if t is not None and str(t).strip()]

        frequency = parsed.get("frequency")
        frequency = str(frequency).strip() if frequency is not None else ""

        other_text = parsed.get("other_text") if "other_text" in parsed else parsed.get("otherText")
        other_text = str(other_text).strip() if other_text is not None else ""

        used_any = parsed.get("used_any") if "used_any" in parsed else parsed.get("usedAny")
        if not isinstance(used_any, bool):
            used_any = None

        if not tools and not frequency and not other_text and used_any is None:
            continue

        records.append(
            {
                "participant_id": participant_id,
                "mode": derive_mode(row_dict),
                "study_label": derive_study_label(row_dict),
                "phase": derive_phase(row_dict) or "unknown",
                "genai_tools": tools,
                "genai_frequency": frequency or None,
                "genai_other_text": other_text or None,
                "genai_used_any": used_any,
            }
        )

    return pd.DataFrame.from_records(records)


def summarize_genai_usage(genai_df):
    """
    Basic counts for generative-AI usage:
      - participants by frequency bucket
      - tool selection counts (tools exploded)
    """
    pd = _require("pandas")

    if genai_df is None or genai_df.empty:
        return pd.DataFrame(columns=["metric", "value", "count"])

    df = genai_df.copy()
    df = df[df["participant_id"].notna()]

    out: List[Dict[str, Any]] = []

    if "genai_frequency" in df.columns:
        freq_counts = (
            df.dropna(subset=["genai_frequency"])
            .groupby("genai_frequency")["participant_id"]
            .nunique()
            .reset_index(name="count")
        )
        for _, r in freq_counts.iterrows():
            out.append({"metric": "frequency", "value": r["genai_frequency"], "count": int(r["count"])})

    if "genai_tools" in df.columns:
        tools_series = df["genai_tools"].apply(
            lambda v: v if isinstance(v, list) else ([v] if isinstance(v, str) else [])
        )
        tools_df = df.assign(_tool=tools_series).explode("_tool")
        tools_df["_tool"] = tools_df["_tool"].astype(str).str.strip()
        tools_df = tools_df[(tools_df["_tool"].notna()) & (tools_df["_tool"] != "") & (tools_df["_tool"] != "nan")]
        tool_counts = tools_df.groupby("_tool")["participant_id"].nunique().reset_index(name="count")
        for _, r in tool_counts.iterrows():
            out.append({"metric": "tool", "value": r["_tool"], "count": int(r["count"])})

    return pd.DataFrame(out)


def _extract_clip_index_from_row(row: Mapping[str, Any]) -> Optional[int]:
    """
    Attempt to derive 1-based clip index from a DynamoDB export row.
    """
    raw = row.get("clip_index") if isinstance(row, dict) else None
    try:
        if raw is not None and str(raw).strip() != "":
            n = int(float(raw))
            return n if n >= 1 else None
    except Exception:
        pass
    sk = str(row.get("sk") or "")
    if "#clip_" in sk:
        try:
            tail = sk.split("#clip_")[-1]
            n = int(re.split(r"\D", tail, maxsplit=1)[0])
            return n if n >= 1 else None
        except Exception:
            return None
    return None


def extract_manual_text(df):
    """
    Extract participants' manual text inputs from in-study annotations:
      - single-clip manual findings (participant_findings)
      - cross-clip manual privacy (cross_clip_manual_privacy)

    Returns a DataFrame with:
      participant_id, mode, study_label, phase, story_id, clip_index,
      source, kind, categories, description, other_text, clip_numbers,
      word_count, char_count
    """
    pd = _require("pandas")

    if df is None or df.empty:
        return pd.DataFrame(
            columns=[
                "participant_id",
                "mode",
                "study_label",
                "phase",
                "story_id",
                "clip_index",
                "source",
                "kind",
                "categories",
                "description",
                "other_text",
                "clip_numbers",
                "word_count",
                "char_count",
            ]
        )

    colmap = {c.lower(): c for c in df.columns}

    def _get(row, key, default=None):
        c = colmap.get(key)
        return row.get(c, default) if c else default

    records: List[Dict[str, Any]] = []
    for _, row in df.iterrows():
        row_dict = {k.lower(): row[v] for k, v in colmap.items()}
        participant_id = str(_get(row, "participant_id") or _get(row, "participantId") or "").strip() or None
        if not participant_id:
            continue
        mode = derive_mode(row_dict)
        study_label = derive_study_label(row_dict)
        phase = derive_phase(row_dict) or "unknown"
        if phase != "in":
            continue

        story_id = str(_get(row, "story_id") or _get(row, "storyId") or "").strip() or None
        clip_index = _extract_clip_index_from_row(row_dict)

        # Single-clip manual findings
        findings = parse_maybe_json(
            _get(row, "participant_findings") or _get(row, "participantFindings")
        )
        if isinstance(findings, list):
            for f in findings:
                if not isinstance(f, dict):
                    continue
                cats = f.get("categories") or []
                if isinstance(cats, str):
                    cats = [cats]
                cats = [str(c).strip() for c in cats if c is not None and str(c).strip()]
                cats_norm = ",".join(cats) if cats else ""

                desc = str(f.get("description") or "").strip()
                other_text = str(f.get("other_text") or "").strip()
                if not desc and not other_text:
                    continue

                kind = "no_privacy" if any(c.lower() == "none" for c in cats) else "finding"
                text_for_counts = desc if desc else other_text
                records.append(
                    {
                        "participant_id": participant_id,
                        "mode": mode,
                        "study_label": study_label,
                        "phase": phase,
                        "story_id": story_id,
                        "clip_index": clip_index,
                        "source": "manual_single",
                        "kind": kind,
                        "categories": cats_norm,
                        "description": desc,
                        "other_text": other_text,
                        "clip_numbers": "",
                        "word_count": count_words(text_for_counts),
                        "char_count": len(text_for_counts),
                    }
                )

        # Cross-clip manual privacy (human annotations inferred across clips)
        cross_manual = parse_maybe_json(
            _get(row, "cross_clip_manual_privacy")
            or _get(row, "crossClipManualPrivacy")
            or _get(row, "cross_clip_manual")
        )
        if isinstance(cross_manual, dict):
            has_privacy = cross_manual.get("has_privacy")
            no_desc = str(cross_manual.get("no_description") or "").strip()
            if has_privacy is False and no_desc:
                records.append(
                    {
                        "participant_id": participant_id,
                        "mode": mode,
                        "study_label": study_label,
                        "phase": phase,
                        "story_id": story_id,
                        "clip_index": clip_index,
                        "source": "manual_cross",
                        "kind": "no_privacy",
                        "categories": "",
                        "description": no_desc,
                        "other_text": "",
                        "clip_numbers": "",
                        "word_count": count_words(no_desc),
                        "char_count": len(no_desc),
                    }
                )

            findings = cross_manual.get("findings") or []
            if isinstance(findings, dict):
                findings = [findings]
            if isinstance(findings, list):
                for f in findings:
                    if not isinstance(f, dict):
                        continue
                    desc = str(f.get("description") or "").strip()
                    other_text = str(f.get("other_text") or "").strip()
                    cats = f.get("categories") or []
                    if isinstance(cats, str):
                        cats = [cats]
                    cats = [str(c).strip() for c in cats if c is not None and str(c).strip()]
                    cats_norm = ",".join(cats) if cats else ""
                    clip_nums = f.get("clip_numbers") or []
                    if isinstance(clip_nums, (int, float, str)):
                        clip_nums = [clip_nums]
                    clip_nums_norm = ",".join(
                        [str(int(float(n))) for n in clip_nums if str(n).strip() != ""]
                    )

                    if not desc and not other_text:
                        continue
                    text_for_counts = desc if desc else other_text
                    records.append(
                        {
                            "participant_id": participant_id,
                            "mode": mode,
                            "study_label": study_label,
                            "phase": phase,
                            "story_id": story_id,
                            "clip_index": clip_index,
                            "source": "manual_cross",
                            "kind": "finding",
                            "categories": cats_norm,
                            "description": desc,
                            "other_text": other_text,
                            "clip_numbers": clip_nums_norm,
                            "word_count": count_words(text_for_counts),
                            "char_count": len(text_for_counts),
                        }
                    )

    return pd.DataFrame.from_records(records)


def summarize_manual_text(
    manual_text_df,
    group_cols: Sequence[str] = ("mode", "study_label", "phase", "source", "kind"),
):
    """
    Summarize extracted manual text by group.
    """
    pd = _require("pandas")
    if manual_text_df is None or manual_text_df.empty:
        return pd.DataFrame()

    df = manual_text_df.copy()
    df["word_count"] = pd.to_numeric(df.get("word_count"), errors="coerce")
    df["char_count"] = pd.to_numeric(df.get("char_count"), errors="coerce")
    df = df.dropna(subset=["word_count", "char_count"])
    if df.empty:
        return pd.DataFrame()

    agg = (
        df.groupby(list(group_cols))
        .agg(
            n=("description", "count"),
            participants=("participant_id", "nunique"),
            mean_word_count=("word_count", "mean"),
            median_word_count=("word_count", "median"),
            mean_char_count=("char_count", "mean"),
            median_char_count=("char_count", "median"),
        )
        .reset_index()
    )
    return agg


def summarize_in_study_types(
    long_df,
    scale: Tuple[int, int] = (-3, 3),
    group_cols: Sequence[str] = ("mode", "study_label"),
    sources: Sequence[str] = ("manual", "ai", "cross", "cross_manual"),
    drop_none: bool = True,
):
    """
    In-study summary by privacy type/category.

    Returns a DataFrame with:
      group_cols + source + privacy_type + question_id + n + mean + std + count_-3..count_3
    Scores are filtered to the 7-point Likert range.
    """
    pd = _require("pandas")

    if long_df is None or long_df.empty:
        return pd.DataFrame()

    df = long_df.copy()
    df = df[df["phase"] == "in"]
    df = df[df["source"].isin(list(sources))]
    df["score"] = pd.to_numeric(df["score"], errors="coerce")
    df = df.dropna(subset=["score"])
    df = df[(df["score"] >= scale[0]) & (df["score"] <= scale[1])]

    if "privacy_type" not in df.columns:
        df["privacy_type"] = None
    if drop_none:
        df = df[df["privacy_type"].notna()]
        df = df[df["privacy_type"].str.lower() != "none"]

    if df.empty:
        return pd.DataFrame()

    stats = (
        df.groupby([*group_cols, "source", "privacy_type", "question_id"])["score"]
        .agg(n="count", mean="mean", std="std")
        .reset_index()
    )

    dist = (
        df.groupby([*group_cols, "source", "privacy_type", "question_id", "score"])
        .size()
        .reset_index(name="count")
    )
    pivot = dist.pivot_table(
        index=[*group_cols, "source", "privacy_type", "question_id"],
        columns="score",
        values="count",
        fill_value=0,
    )
    pivot.columns = [f"count_{int(c)}" for c in pivot.columns]
    pivot = pivot.reset_index()

    return stats.merge(
        pivot, on=[*group_cols, "source", "privacy_type", "question_id"], how="left"
    )


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
    in_type_summary_df = summarize_in_study_types(long_df)
    free_text_df = extract_free_text(df)
    free_text_summary_df = summarize_free_text(free_text_df)
    manual_text_df = extract_manual_text(df)
    manual_text_summary_df = summarize_manual_text(manual_text_df)
    genai_usage_df = extract_genai_usage(df)
    genai_usage_summary_df = summarize_genai_usage(genai_usage_df)

    plot_paths = []
    if out_dir is not None:
        try:
            plot_paths = visualize(long_df, out_dir)
        except ImportError:
            plot_paths = []

    return (
        long_df,
        summary_df,
        compare_df,
        in_type_summary_df,
        free_text_df,
        free_text_summary_df,
        manual_text_df,
        manual_text_summary_df,
        genai_usage_df,
        genai_usage_summary_df,
        plot_paths,
    )


if __name__ == "__main__":  # pragma: no cover
    import argparse

    ap = argparse.ArgumentParser(description="Analyze DynamoDB CSV exports for the study.")
    ap.add_argument("csv", help="Path to CSV export")
    ap.add_argument("--out-dir", help="Directory to write plots (optional)")
    ap.add_argument("--summary-csv", help="Write summary table to CSV")
    ap.add_argument("--compare-csv", help="Write group comparison table to CSV")
    ap.add_argument("--in-types-csv", help="Write in-study type summary to CSV")
    ap.add_argument("--long-csv", help="Write normalized long table to CSV")
    ap.add_argument("--free-text-csv", help="Write extracted free-text responses to CSV")
    ap.add_argument("--free-text-summary-csv", help="Write free-text summary stats to CSV")
    ap.add_argument("--manual-text-csv", help="Write extracted manual text inputs to CSV")
    ap.add_argument("--manual-text-summary-csv", help="Write manual text summary stats to CSV")
    ap.add_argument("--genai-usage-csv", help="Write extracted GenAI usage responses to CSV")
    ap.add_argument("--genai-usage-summary-csv", help="Write GenAI usage summary counts to CSV")
    args = ap.parse_args()

    (
        long_df,
        summary_df,
        compare_df,
        in_type_summary_df,
        free_text_df,
        free_text_summary_df,
        manual_text_df,
        manual_text_summary_df,
        genai_usage_df,
        genai_usage_summary_df,
        plots,
    ) = analyze_csv(
        args.csv, out_dir=args.out_dir
    )

    if args.long_csv:
        long_df.to_csv(args.long_csv, index=False)
    if args.summary_csv:
        summary_df.to_csv(args.summary_csv, index=False)
    if args.compare_csv:
        compare_df.to_csv(args.compare_csv, index=False)
    if args.in_types_csv:
        in_type_summary_df.to_csv(args.in_types_csv, index=False)
    if args.free_text_csv:
        free_text_df.to_csv(args.free_text_csv, index=False)
    if args.free_text_summary_csv:
        free_text_summary_df.to_csv(args.free_text_summary_csv, index=False)
    if args.manual_text_csv:
        manual_text_df.to_csv(args.manual_text_csv, index=False)
    if args.manual_text_summary_csv:
        manual_text_summary_df.to_csv(args.manual_text_summary_csv, index=False)
    if args.genai_usage_csv:
        genai_usage_df.to_csv(args.genai_usage_csv, index=False)
    if args.genai_usage_summary_csv:
        genai_usage_summary_df.to_csv(args.genai_usage_summary_csv, index=False)

    print(f"Rows normalized: {len(long_df)}")
    print(f"Summary rows: {len(summary_df)}")
    print(f"Comparison rows: {len(compare_df)}")
    print(f"In-study type summary rows: {len(in_type_summary_df)}")
    print(f"Free-text rows: {len(free_text_df)}")
    print(f"Free-text summary rows: {len(free_text_summary_df)}")
    print(f"Manual-text rows: {len(manual_text_df)}")
    print(f"Manual-text summary rows: {len(manual_text_summary_df)}")
    print(f"GenAI usage rows: {len(genai_usage_df)}")
    print(f"GenAI usage summary rows: {len(genai_usage_summary_df)}")
    if plots:
        print("Plots saved:")
        for p in plots:
            print(" -", p)
