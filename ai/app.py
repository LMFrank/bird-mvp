from __future__ import annotations

import csv
import io
import os
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
  def identify_jpeg(self, jpg: bytes, topk: int = 5):
    img = Image.open(io.BytesIO(jpg)).convert("RGB")
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


app = FastAPI()
svc: Optional[BioClipService] = None


@app.on_event("startup")
def _startup():
  global svc
  svc = BioClipService()


@app.get("/health")
def health():
  if svc is None:
    return {"success": False, "error": "loading"}
  return {
    "success": True,
    "provider": "bioclip",
    "model": svc.model_id,
    "device": svc.device,
    "labels": len(svc.labels),
  }


@app.post("/identify")
async def identify(image: UploadFile = File(...)):
  if svc is None:
    return JSONResponse(status_code=503, content={"success": False, "error": "model not ready"})

  jpg = await image.read()
  try:
    preds = svc.identify_jpeg(jpg, topk=int(os.environ.get("TOPK", "5")))
    return {
      "success": True,
      "provider": "bioclip",
      "model": svc.model_id,
      "labelsCount": len(svc.labels),
      "promptCount": len(svc.prompt_templates),
      "predictions": preds,
    }
  except Exception as e:
    return JSONResponse(status_code=500, content={"success": False, "error": str(e)})

