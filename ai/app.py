from __future__ import annotations

import csv
import hashlib
import io
import os
import threading
import time
from dataclasses import dataclass
from typing import List, Optional, Tuple

import torch
from fastapi import FastAPI, File, UploadFile
from fastapi.responses import JSONResponse
from PIL import Image
from pipeline import (
  decide_subject,
  merge_label_sets,
  merge_predictions,
  normalize_captive_rows,
  normalize_label_rows,
  prompt_templates,
  select_device,
)


@dataclass(frozen=True)
class BirdLabel:
  name_zh: str
  name_scientific: str


def _default_labels() -> List[BirdLabel]:
  return [
    BirdLabel("麻雀", "Passer montanus"),
    BirdLabel("喜鹊", "Pica pica"),
    BirdLabel("大山雀", "Parus major"),
    BirdLabel("白鹭", "Egretta garzetta"),
    BirdLabel("苍鹭", "Ardea cinerea"),
    BirdLabel("普通翠鸟", "Alcedo atthis"),
    BirdLabel("斑鸠", "Streptopelia decaocto"),
    BirdLabel("乌鸫", "Turdus merula"),
    BirdLabel("红嘴蓝鹊", "Urocissa erythroryncha"),
    BirdLabel("白头鹎", "Pycnonotus sinensis"),
  ]


def load_labels_from_csv(p: str) -> List[BirdLabel]:
  with open(p, "r", encoding="utf-8") as f:
    reader = csv.reader(f)
    return [BirdLabel(name, scientific) for name, scientific in normalize_label_rows(reader)]


def load_captive_from_csv(p: str):
  with open(p, "r", encoding="utf-8") as f:
    return normalize_captive_rows(csv.reader(f))


def _model_arch_for(model_id: str) -> str:
  mid = model_id.lower()
  if "bioclip-2" in mid:
    return "ViT-L-14"
  return "ViT-B-16"


class BioClipService:
  def __init__(self):
    self.model_id = os.environ.get("BIOCLIP_MODEL_ID", "imageomics/bioclip-2")
    self.device = select_device(
      cuda=torch.cuda.is_available(),
      mps=bool(getattr(torch.backends, "mps", None) and torch.backends.mps.is_available()),
      force_cpu=os.environ.get("FORCE_CPU") == "1",
    )
    self.labels_path = os.environ.get("BIRD_LABELS_PATH", "").strip()
    self.region_labels_dir = os.environ.get("BIRD_REGION_LABELS_DIR", "/models/regions").strip()
    self.captive_labels_path = os.environ.get(
      "BIRD_CAPTIVE_LABELS_PATH", "/models/captive.csv"
    ).strip()
    self.labels = self._load_labels()

    import open_clip

    self.arch = _model_arch_for(self.model_id)
    self.model, self.preprocess = open_clip.create_model_from_pretrained(f"hf-hub:{self.model_id}")
    self.model.to(self.device)
    self.model.eval()
    self.tokenizer = open_clip.get_tokenizer(self.arch)

    self.prompt_mode = os.environ.get("PROMPT_MODE", "mixed").strip().lower()
    self.prompt_templates = prompt_templates(self.prompt_mode)
    self.text_features = self._build_text_features(open_clip)
    self._region_cache = {}

  def _load_labels(self) -> List[BirdLabel]:
    p = self.labels_path
    if p and os.path.exists(p):
      return load_labels_from_csv(p)
    return _default_labels()

  def _labels_hash(self, labels: List[BirdLabel]) -> str:
    raw = "\n".join(f"{label.name_zh}\t{label.name_scientific}" for label in labels)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]

  def resolve_label_context(self, region: Optional[str]):
    normalized = "".join(ch for ch in str(region or "").upper() if ch.isalnum() or ch in ("-", "_"))
    if not normalized or normalized in ("WORLD", "GLOBAL", "DEFAULT"):
      return self.labels, self.text_features, "world", self._labels_hash(self.labels)
    cached = self._region_cache.get(normalized)
    if cached is not None:
      return cached
    candidates = [
      os.path.join(self.region_labels_dir, f"{normalized}.csv"),
      os.path.join(os.path.dirname(self.labels_path), f"labels.{normalized}.csv") if self.labels_path else "",
    ]
    path = next((candidate for candidate in candidates if candidate and os.path.exists(candidate)), None)
    if path is None:
      raise FileNotFoundError(f"Region labels not found for {normalized}")
    if not self.captive_labels_path or not os.path.exists(self.captive_labels_path):
      raise FileNotFoundError(f"Captive labels not found: {self.captive_labels_path}")
    region_labels = [
      (label.name_zh, label.name_scientific) for label in load_labels_from_csv(path)
    ]
    captive_labels = load_captive_from_csv(self.captive_labels_path)
    merged = merge_label_sets(region_labels, captive_labels)
    labels = [BirdLabel(name, scientific) for name, scientific in merged]
    if not labels:
      raise RuntimeError(f"Merged labels are empty for {normalized}+captive")
    import open_clip
    text_features = self._build_text_features(open_clip, labels)
    context = (
      labels,
      text_features,
      f"{normalized}+captive",
      self._labels_hash(labels),
    )
    self._region_cache[normalized] = context
    return context

  @torch.no_grad()
  def _build_text_features(self, open_clip, labels: Optional[List[BirdLabel]] = None):
    label_set = labels or self.labels
    n = len(label_set)
    if n == 0:
      raise RuntimeError("No labels loaded")

    batch_size = int(os.environ.get("TEXT_BATCH", "64"))

    probe_prompts = [self.prompt_templates[0].format(sci=label_set[0].name_scientific)]
    probe_tokens = self.tokenizer(probe_prompts)
    if isinstance(probe_tokens, torch.Tensor):
      probe_tokens = probe_tokens.to(self.device)
    probe_text = self.model.encode_text(probe_tokens)
    dim = int(probe_text.shape[-1])

    acc = torch.zeros((n, dim), dtype=torch.float32, device=self.device)
    for tpl in self.prompt_templates:
      prompts = [
        tpl.format(sci=l.name_scientific, zh=l.name_zh or l.name_scientific) for l in label_set
      ]
      tokens = self.tokenizer(prompts)
      if isinstance(tokens, torch.Tensor):
        tokens = tokens.to(self.device)

      for i in range(0, n, batch_size):
        t = tokens[i : i + batch_size]
        text = self.model.encode_text(t)
        text = text / text.norm(dim=-1, keepdim=True)
        acc[i : i + text.shape[0]] += text

    acc = acc / acc.norm(dim=-1, keepdim=True)
    return acc

  @torch.no_grad()
  def identify_image(
    self,
    img: Image.Image,
    topk: int = 5,
    labels: Optional[List[BirdLabel]] = None,
    text_features=None,
  ):
    label_set = labels or self.labels
    features = text_features if text_features is not None else self.text_features
    image = self.preprocess(img).unsqueeze(0).to(self.device)
    image_features = self.model.encode_image(image)
    image_features = image_features / image_features.norm(dim=-1, keepdim=True)

    scale = getattr(self.model, "logit_scale", None)
    if isinstance(scale, torch.Tensor):
      scale = float(scale.exp().detach().cpu().item())
    else:
      scale = 1.0

    logits = (image_features @ features.T).squeeze(0) * scale
    probs_all = torch.softmax(logits, dim=0)
    k = min(topk, probs_all.shape[0])
    vals, idx = torch.topk(probs_all, k)
    probs = vals.detach().cpu().tolist()
    idxs = idx.detach().cpu().tolist()
    preds = []
    for i, score in zip(idxs, probs):
      l = label_set[int(i)]
      preds.append({"nameZh": l.name_zh, "nameScientific": l.name_scientific, "score": float(score)})
    return preds

  @torch.no_grad()
  def image_embedding(self, img: Image.Image):
    image = self.preprocess(img).unsqueeze(0).to(self.device)
    image_features = self.model.encode_image(image)
    image_features = image_features / image_features.norm(dim=-1, keepdim=True)
    return image_features.squeeze(0).detach().to("cpu", dtype=torch.float32).tolist()

  @torch.no_grad()
  def identify_jpeg(self, jpg: bytes, topk: int = 5):
    img = Image.open(io.BytesIO(jpg)).convert("RGB")
    return self.identify_image(img, topk=topk)


@dataclass(frozen=True)
class DetectBox:
  x1: float
  y1: float
  x2: float
  y2: float
  score: float


class DetectorService:
  def __init__(self):
    self.enabled = os.environ.get("DETECT_ENABLED", "1").strip().lower() not in ("0", "false", "no", "off")
    self.model_id = os.environ.get("DETECT_MODEL", "yolov8n.pt").strip() or "yolov8n.pt"
    self.conf = float(os.environ.get("DETECT_CONF", "0.25"))
    self.max_det = int(os.environ.get("DETECT_MAX_DET", "10"))
    self.class_id = int(os.environ.get("DETECT_CLASS_ID", "14"))
    self.imgsz = int(os.environ.get("DETECT_IMGSZ", "960"))
    self.error: Optional[str] = None
    if not self.enabled:
      self.model = None
      return
    try:
      from ultralytics import YOLO
      self.model = YOLO(self.model_id)
    except Exception as e:
      self.model = None
      self.enabled = False
      self.error = str(e)

  def detect(self, img: Image.Image) -> List[DetectBox]:
    if not self.enabled or self.model is None:
      return []
    res = self.model.predict(
      img,
      conf=self.conf,
      max_det=self.max_det,
      imgsz=self.imgsz,
      verbose=False,
    )
    if not res:
      return []
    r0 = res[0]
    boxes = getattr(r0, "boxes", None)
    if boxes is None:
      return []
    xyxy = getattr(boxes, "xyxy", None)
    conf = getattr(boxes, "conf", None)
    cls = getattr(boxes, "cls", None)
    if xyxy is None or conf is None or cls is None:
      return []
    out: List[DetectBox] = []
    xyxy_list = xyxy.detach().cpu().tolist()
    conf_list = conf.detach().cpu().tolist()
    cls_list = cls.detach().cpu().tolist()
    for b, s, c in zip(xyxy_list, conf_list, cls_list):
      if int(c) != int(self.class_id):
        continue
      x1, y1, x2, y2 = [float(v) for v in b]
      out.append(DetectBox(x1=x1, y1=y1, x2=x2, y2=y2, score=float(s)))
    return out


def _crop_box(img: Image.Image, box: DetectBox, pad: float) -> Image.Image:
  w, h = img.size
  x1 = float(box.x1)
  y1 = float(box.y1)
  x2 = float(box.x2)
  y2 = float(box.y2)
  cx = (x1 + x2) / 2
  cy = (y1 + y2) / 2
  bw = max(2.0, x2 - x1)
  bh = max(2.0, y2 - y1)
  bw *= float(pad)
  bh *= float(pad)
  nx1 = max(0, int(cx - bw / 2))
  ny1 = max(0, int(cy - bh / 2))
  nx2 = min(w, int(cx + bw / 2))
  ny2 = min(h, int(cy + bh / 2))
  if nx2 <= nx1 + 2 or ny2 <= ny1 + 2:
    return img
  return img.crop((nx1, ny1, nx2, ny2))


def _fallback_square_crops(img: Image.Image) -> List[Image.Image]:
  w, h = img.size
  side = max(32, int(min(w, h) * 0.6))
  x0 = 0
  y0 = 0
  x1 = max(0, w - side)
  y1 = max(0, h - side)
  xc = max(0, int((w - side) / 2))
  yc = max(0, int((h - side) / 2))
  crops = [
    img.crop((x0, y0, x0 + side, y0 + side)),
    img.crop((x1, y0, x1 + side, y0 + side)),
    img.crop((x0, y1, x0 + side, y1 + side)),
    img.crop((x1, y1, x1 + side, y1 + side)),
    img.crop((xc, yc, xc + side, yc + side)),
  ]
  return crops


app = FastAPI()
svc: Optional[BioClipService] = None
det: Optional[DetectorService] = None
svc_error: Optional[str] = None


@app.on_event("startup")
def _startup():
  global svc, det, svc_error
  svc = None
  det = None
  svc_error = None

  def _load():
    global svc, det, svc_error
    try:
      svc = BioClipService()
      det = DetectorService()
      svc_error = None
    except Exception as e:
      svc = None
      det = None
      svc_error = str(e)

  t = threading.Thread(target=_load, daemon=True)
  t.start()


@app.get("/health")
def health():
  if svc_error:
    return {"success": False, "error": svc_error}
  if svc is None:
    return {"success": False, "error": "loading"}
  return {
    "success": True,
    "provider": "bioclip",
    "model": svc.model_id,
    "device": svc.device,
    "labels": len(svc.labels),
    "detectEnabled": bool(det and det.enabled),
    "detectModel": det.model_id if det else None,
    "detectError": det.error if det else None,
    "captiveLabelsPath": svc.captive_labels_path,
    "nonBirdMaxScore": float(os.environ.get("NON_BIRD_MAX_SCORE", "0")),
  }


@app.post("/identify")
async def identify(image: UploadFile = File(...), region: Optional[str] = None):
  if svc is None:
    return JSONResponse(status_code=503, content={"success": False, "error": "model not ready"})

  started = time.perf_counter()
  jpg = await image.read()
  try:
    topk = int(os.environ.get("TOPK", "5"))
    img = Image.open(io.BytesIO(jpg)).convert("RGB")
    labels, text_features, label_set, labels_hash = svc.resolve_label_context(region)
    embedding = svc.image_embedding(img)

    boxes: List[DetectBox] = det.detect(img) if det is not None else []
    ranked_boxes = sorted(
      boxes,
      key=lambda b: (max(1.0, (b.x2 - b.x1) * (b.y2 - b.y1)) * b.score),
      reverse=True,
    )
    top_boxes = ranked_boxes[:max(1, int(os.environ.get("DETECT_TOP_BOXES", "1")))]
    chosen: Optional[DetectBox] = top_boxes[0] if top_boxes else None

    sourced_preds = []
    if chosen is not None:
      pads = [1.25, 1.6]
      sourced_preds.append(("full", svc.identify_image(img, topk=topk, labels=labels, text_features=text_features)))
      crops = [_crop_box(img, box, pad) for box in top_boxes for pad in pads]
      for crop in crops[:max(0, int(os.environ.get("DETECT_MAX_CROPS", "3")) - 1)]:
        sourced_preds.append(("roi", svc.identify_image(crop, topk=topk, labels=labels, text_features=text_features)))
      mode = "detect"
    else:
      sourced_preds.append(("full", svc.identify_image(img, topk=topk, labels=labels, text_features=text_features)))
      if os.environ.get("DETECT_FALLBACK_CROPS", "1").strip().lower() not in ("0", "false", "no", "off"):
        for c in _fallback_square_crops(img)[: max(0, int(os.environ.get("DETECT_FALLBACK_MAX", "4")))]:
          sourced_preds.append(("fallback", svc.identify_image(c, topk=topk, labels=labels, text_features=text_features)))
      mode = "fallback"

    fusion_strategy = os.environ.get("FUSION_STRATEGY", "max").strip().lower()
    roi_weight = float(os.environ.get("FUSION_ROI_WEIGHT", "1.2"))
    preds = merge_predictions(
      sourced_preds,
      topk=topk,
      strategy=fusion_strategy,
      roi_weight=roi_weight,
    )
    non_bird_max_score = float(os.environ.get("NON_BIRD_MAX_SCORE", "0"))
    subject_decision, decision_reason = decide_subject(
      preds,
      bool(det and det.enabled),
      bool(boxes),
      non_bird_max_score,
    )
    image_area = max(1.0, float(img.size[0] * img.size[1]))
    best_box_area_ratio = (
      max(0.0, (chosen.x2 - chosen.x1) * (chosen.y2 - chosen.y1)) / image_area
      if chosen
      else 0.0
    )
    pipeline_config = {
      "model": svc.model_id,
      "labelsHash": labels_hash,
      "labelSet": label_set,
      "promptMode": svc.prompt_mode,
      "detector": {
        "enabled": bool(det and det.enabled),
        "model": det.model_id if det else None,
        "imgsz": det.imgsz if det else None,
        "topBoxes": len(top_boxes),
        "found": bool(boxes),
        "nonBirdMaxScore": non_bird_max_score,
      },
      "fusion": {"strategy": fusion_strategy, "roiWeight": roi_weight},
    }
    return {
      "success": True,
      "provider": "bioclip",
      "model": svc.model_id,
      "labelsCount": len(labels),
      "labelSet": label_set,
      "labelsHash": labels_hash,
      "promptCount": len(svc.prompt_templates),
      "predictions": preds,
      "subjectDecision": subject_decision,
      "decisionReason": decision_reason,
      "embedding": embedding,
      "elapsedMs": (time.perf_counter() - started) * 1000,
      "detectorEnabled": bool(det and det.enabled),
      "detectorFound": bool(boxes),
      "pipelineConfig": pipeline_config,
      "roi": {
        "mode": mode,
        "boxes": [{"x1": b.x1, "y1": b.y1, "x2": b.x2, "y2": b.y2, "score": b.score} for b in boxes[:10]],
        "chosen": {"x1": chosen.x1, "y1": chosen.y1, "x2": chosen.x2, "y2": chosen.y2, "score": chosen.score} if chosen else None,
        "boxCount": len(boxes),
        "bestBoxAreaRatio": best_box_area_ratio,
        "bestBoxScore": chosen.score if chosen else 0.0,
      },
    }
  except Exception as e:
    return JSONResponse(status_code=500, content={"success": False, "error": str(e)})
