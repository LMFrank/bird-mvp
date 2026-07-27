from __future__ import annotations

from collections import defaultdict
from typing import List, Tuple


def select_device(cuda: bool, mps: bool, force_cpu: bool) -> str:
  if force_cpu:
    return "cpu"
  if cuda:
    return "cuda"
  if mps:
    return "mps"
  return "cpu"


def prompt_templates(mode: str) -> List[str]:
  scientific = [
    "a photo of {sci}",
    "a photo of a {sci} bird",
    "a photo of the bird species {sci}",
    "a bird photo of {sci}",
  ]
  if mode == "single":
    return scientific[:1]
  if mode in ("scientific", "scientific-4"):
    return scientific
  return scientific + ["a photo of {zh}", "a photo of a {zh} bird"]


def normalize_label_rows(rows) -> List[Tuple[str, str]]:
  labels = []
  seen = set()
  for row in rows:
    if not row or len(row) < 2:
      continue
    name = str(row[0]).lstrip("\ufeff").strip()
    scientific = str(row[1]).strip()
    if name.lower() in ("zh", "name_zh", "chinese", "中文名"):
      continue
    if not name or not scientific:
      continue
    key = (name, scientific)
    if key not in seen:
      labels.append(key)
      seen.add(key)
  return labels


def normalize_captive_rows(rows):
  labels = []
  seen = set()
  for row in rows:
    if not row:
      continue
    scientific = str(row[0]).lstrip("\ufeff").strip()
    if scientific.lower() == "name_scientific":
      continue
    group = str(row[1]).strip() if len(row) > 1 else ""
    name_zh = str(row[2]).strip() if len(row) > 2 else ""
    if not scientific or scientific in seen:
      continue
    labels.append((name_zh or scientific, scientific, group))
    seen.add(scientific)
  return labels


def merge_label_sets(region_labels, captive_labels):
  merged = []
  seen = set()
  for name, scientific in region_labels:
    if scientific in seen:
      continue
    merged.append((name, scientific))
    seen.add(scientific)
  for name, scientific, _group in captive_labels:
    if scientific in seen:
      continue
    merged.append((name or scientific, scientific))
    seen.add(scientific)
  return merged


def decide_subject(predictions, detector_enabled, detector_found, non_bird_max_score):
  if detector_enabled and detector_found:
    return "bird", "bird_detected"
  if not detector_enabled:
    return "unknown", "detector_disabled"
  if float(non_bird_max_score) <= 0:
    return "unknown", "non_bird_threshold_disabled"
  top1 = float(predictions[0].get("score") or 0.0) if predictions else 0.0
  if top1 <= float(non_bird_max_score):
    return "non_bird", "no_bird_detection_low_bioclip"
  return "unknown", "no_bird_detection_high_bioclip"


def merge_predictions(
  sourced_predictions: List[Tuple[str, List[dict]]],
  topk: int,
  strategy: str = "max",
  roi_weight: float = 1.0,
) -> List[dict]:
  observations = defaultdict(list)
  labels = {}
  for source, predictions in sourced_predictions:
    weight = roi_weight if source == "roi" else 1.0
    for prediction in predictions:
      key = str(prediction.get("nameScientific") or prediction.get("nameZh") or "").strip()
      if not key:
        continue
      score = float(prediction.get("score") or 0.0)
      observations[key].append((score, weight))
      labels[key] = {
        "nameZh": prediction.get("nameZh"),
        "nameScientific": prediction.get("nameScientific"),
      }

  merged = []
  for key, values in observations.items():
    if strategy == "weighted_mean":
      score = sum(score * weight for score, weight in values) / sum(weight for _, weight in values)
    elif strategy == "vote":
      score = len(values) / max(1, len(sourced_predictions))
    else:
      score = max(score for score, _ in values)
    merged.append({**labels[key], "score": float(score)})
  merged.sort(key=lambda item: float(item["score"]), reverse=True)
  return merged[:max(1, int(topk))]
