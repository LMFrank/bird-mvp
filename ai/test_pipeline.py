import unittest

from pipeline import (
  decide_subject,
  merge_label_sets,
  merge_predictions,
  normalize_captive_rows,
  normalize_label_rows,
  prompt_templates,
  select_device,
)


class PipelineMergeTest(unittest.TestCase):
  def test_bom_header_is_not_loaded_as_a_species(self):
    rows = [["\ufeff中文名", "学名"], ["夜鹭", "Nycticorax nycticorax"]]
    self.assertEqual(normalize_label_rows(rows), [("夜鹭", "Nycticorax nycticorax")])

  def test_device_prefers_cuda_then_mps_and_honors_force_cpu(self):
    self.assertEqual(select_device(cuda=True, mps=True, force_cpu=False), "cuda")
    self.assertEqual(select_device(cuda=False, mps=True, force_cpu=False), "mps")
    self.assertEqual(select_device(cuda=True, mps=True, force_cpu=True), "cpu")

  def test_single_prompt_mode_has_one_reproducible_scientific_template(self):
    self.assertEqual(prompt_templates("single"), ["a photo of {sci}"])
    self.assertEqual(len(prompt_templates("scientific-4")), 4)

  def test_weighted_mean_rewards_consensus_not_one_lucky_crop(self):
    merged = merge_predictions(
      [
        ("full", [{"nameScientific": "A", "score": 0.6}, {"nameScientific": "B", "score": 0.4}]),
        ("roi", [{"nameScientific": "A", "score": 0.55}, {"nameScientific": "B", "score": 0.9}]),
        ("roi", [{"nameScientific": "A", "score": 0.58}, {"nameScientific": "B", "score": 0.1}]),
      ],
      topk=2,
      strategy="weighted_mean",
      roi_weight=1.2,
    )
    self.assertEqual(merged[0]["nameScientific"], "A")

  def test_captive_labels_merge_by_scientific_name_and_region_name_wins(self):
    captive = normalize_captive_rows([
      ["name_scientific", "group", "name_zh"],
      ["Ara macao", "parrot", "绯红金刚鹦鹉"],
      ["Egretta garzetta", "heron", "白鹭（圈养）"],
    ])
    merged = merge_label_sets(
      [("白鹭", "Egretta garzetta")],
      captive,
    )
    self.assertEqual(merged, [
      ("白鹭", "Egretta garzetta"),
      ("绯红金刚鹦鹉", "Ara macao"),
    ])

  def test_subject_decision_never_uses_no_detection_alone_as_non_bird_proof(self):
    self.assertEqual(
      decide_subject([{"score": 0.1}], True, False, 0.2),
      ("non_bird", "no_bird_detection_low_bioclip"),
    )
    self.assertEqual(
      decide_subject([{"score": 0.8}], True, False, 0.2),
      ("unknown", "no_bird_detection_high_bioclip"),
    )
    self.assertEqual(
      decide_subject([{"score": 0.01}], True, False, 0),
      ("unknown", "non_bird_threshold_disabled"),
    )


if __name__ == "__main__":
  unittest.main()
