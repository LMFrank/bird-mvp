from __future__ import annotations

import csv
import io
import os
import threading
from dataclasses import dataclass
from typing import List, Optional, Tuple

import torch
from fastapi import FastAPI, File, UploadFile
from fastapi.responses import JSONResponse
from PIL import Image


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
  labels: List[BirdLabel] = []
  with open(p, "r", encoding="utf-8") as f:
    reader = csv.reader(f)
    for row in reader:
      if not row:
        continue
      if len(row) >= 2 and row[0].strip() and row[1].strip():
        if row[0].strip().lower() in ("zh", "name_zh", "chinese", "中文名"):
          continue
        labels.append(BirdLabel(row[0].strip(), row[1].strip()))
  dedup = {}
  for l in labels:
    dedup[(l.name_zh, l.name_scientific)] = l
  return list(dedup.values())


def _model_arch_for(model_id: str) -> str:
  mid = model_id.lower()
  if "bioclip-2" in mid:
    return "ViT-L-14"
  return "ViT-B-16"


class BioClipService:
  def __init__(self):
    self.model_id = os.environ.get("BIOCLIP_MODEL_ID", "imageomics/bioclip-2")
    self.device = "cuda" if torch.cuda.is_available() and os.environ.get("FORCE_CPU") != "1" else "cpu"
    self.labels = self._load_labels()

    import open_clip

    self.arch = _model_arch_for(self.model_id)
    self.model, self.preprocess = open_clip.create_model_from_pretrained(f"hf-hub:{self.model_id}")
    self.model.to(self.device)
    self.model.eval()
    self.tokenizer = open_clip.get_tokenizer(self.arch)

    self.prompt_templates = [
      "a photo of {sci}",
      "a photo of a {sci} bird",
      "a photo of the bird species {sci}",
      "a bird photo of {sci}",
      "a photo of {zh}",
      "a photo of a {zh} bird",
    ]
    self.text_features = self._build_text_features(open_clip)

  def _load_labels(self) -> List[BirdLabel]:
    p = os.environ.get("BIRD_LABELS_PATH", "").strip()
    if p and os.path.exists(p):
      return load_labels_from_csv(p)
    return _default_labels()

  @torch.no_grad()
  def _build_text_features(self, open_clip):
    n = len(self.labels)
    if n == 0:
      raise RuntimeError("No labels loaded")

    batch_size = int(os.environ.get("TEXT_BATCH", "64"))

    probe_prompts = [self.prompt_templates[0].format(sci=self.labels[0].name_scientific)]
    probe_tokens = self.tokenizer(probe_prompts)
    if isinstance(probe_tokens, torch.Tensor):
      probe_tokens = probe_tokens.to(self.device)
    probe_text = self.model.encode_text(probe_tokens)
    dim = int(probe_text.shape[-1])

    acc = torch.zeros((n, dim), dtype=torch.float32, device=self.device)
    for tpl in self.prompt_templates:
      prompts = [
        tpl.format(sci=l.name_scientific, zh=l.name_zh or l.name_scientific) for l in self.labels
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
  def identify_image(self, img: Image.Image, topk: int = 5):
    image = self.preprocess(img).unsqueeze(0).to(self.device)
    image_features = self.model.encode_image(image)
    image_features = image_features / image_features.norm(dim=-1, keepdim=True)

    scale = getattr(self.model, "logit_scale", None)
    if isinstance(scale, torch.Tensor):
      scale = float(scale.exp().detach().cpu().item())
    else:
      scale = 1.0

    logits = (image_features @ self.text_features.T).squeeze(0) * scale
    probs_all = torch.softmax(logits, dim=0)
    k = min(topk, probs_all.shape[0])
    vals, idx = torch.topk(probs_all, k)
    probs = vals.detach().cpu().tolist()
    idxs = idx.detach().cpu().tolist()
    preds = []
    for i, score in zip(idxs, probs):
      l = self.labels[int(i)]
      preds.append({"nameZh": l.name_zh, "nameScientific": l.name_scientific, "score": float(score)})
    return preds

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
    res = self.model.predict(img, conf=self.conf, max_det=self.max_det, verbose=False)
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


def _merge_predictions(list_of_preds: List[List[dict]], topk: int) -> List[dict]:
  best = {}
  for preds in list_of_preds:
    for p in preds:
      if not isinstance(p, dict):
        continue
      key = str(p.get("nameScientific") or p.get("nameZh") or "").strip()
      if not key:
        continue
      score = float(p.get("score") or 0.0)
      prev = best.get(key)
      if prev is None or score > float(prev.get("score") or 0.0):
        best[key] = {"nameZh": p.get("nameZh"), "nameScientific": p.get("nameScientific"), "score": score}
  merged = list(best.values())
  merged.sort(key=lambda x: float(x.get("score") or 0.0), reverse=True)
  return merged[: max(1, int(topk))]


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
  }


@app.post("/identify")
async def identify(image: UploadFile = File(...)):
  if svc is None:
    return JSONResponse(status_code=503, content={"success": False, "error": "model not ready"})

  jpg = await image.read()
  try:
    topk = int(os.environ.get("TOPK", "5"))
    img = Image.open(io.BytesIO(jpg)).convert("RGB")

    boxes: List[DetectBox] = det.detect(img) if det is not None else []
    chosen: Optional[DetectBox] = None
    if boxes:
      chosen = max(boxes, key=lambda b: (max(1.0, (b.x2 - b.x1) * (b.y2 - b.y1)) * b.score))

    preds_list: List[List[dict]] = []
    if chosen is not None:
      pads = [1.25, 1.6]
      crops = [_crop_box(img, chosen, p) for p in pads]
      crops.insert(0, img)
      for c in crops[: max(1, int(os.environ.get("DETECT_MAX_CROPS", "3")))]:
        preds_list.append(svc.identify_image(c, topk=topk))
      mode = "detect"
    else:
      preds_list.append(svc.identify_image(img, topk=topk))
      if os.environ.get("DETECT_FALLBACK_CROPS", "1").strip().lower() not in ("0", "false", "no", "off"):
        for c in _fallback_square_crops(img)[: max(0, int(os.environ.get("DETECT_FALLBACK_MAX", "4")))]:
          preds_list.append(svc.identify_image(c, topk=topk))
      mode = "fallback"

    preds = _merge_predictions(preds_list, topk=topk)
    return {
      "success": True,
      "provider": "bioclip",
      "model": svc.model_id,
      "labelsCount": len(svc.labels),
      "promptCount": len(svc.prompt_templates),
      "predictions": preds,
      "roi": {
        "mode": mode,
        "boxes": [{"x1": b.x1, "y1": b.y1, "x2": b.x2, "y2": b.y2, "score": b.score} for b in boxes[:10]],
        "chosen": {"x1": chosen.x1, "y1": chosen.y1, "x2": chosen.x2, "y2": chosen.y2, "score": chosen.score} if chosen else None,
      },
    }
  except Exception as e:
    return JSONResponse(status_code=500, content={"success": False, "error": str(e)})
