import os
from pathlib import Path

from playwright.sync_api import sync_playwright


BASE_URL = os.environ.get("BIRD_E2E_BASE_URL", "http://127.0.0.1:3001")
BIRD_LIBRARY = os.environ.get("BIRD_E2E_BIRD_LIBRARY", "sample-photos")
REJECTION_LIBRARY = os.environ.get("BIRD_E2E_REJECTION_LIBRARY", "rejection-photos")
SCREENSHOT = Path(os.environ.get("BIRD_E2E_SCREENSHOT", "/tmp/bird-assets-e2e.png"))


with sync_playwright() as playwright:
  browser = playwright.chromium.launch(headless=True)
  page = browser.new_page(viewport={"width": 1680, "height": 1050}, device_scale_factor=1)
  page_errors = []
  page.on("pageerror", lambda error: page_errors.append(str(error)))

  page.goto(BASE_URL)
  page.wait_for_load_state("networkidle")
  page.get_by_text("物种资产", exact=True).wait_for()
  page.get_by_text("Field archive", exact=True).wait_for()

  library_select = page.locator("select").first
  options = library_select.locator("option").all_text_contents()
  bird_option = next((option for option in options if BIRD_LIBRARY in option), None)
  rejection_option = next((option for option in options if REJECTION_LIBRARY in option), None)
  assert bird_option, f"bird library option not found: {BIRD_LIBRARY}; options={options}"
  assert rejection_option, f"rejection library option not found: {REJECTION_LIBRARY}; options={options}"

  library_select.select_option(label=bird_option)
  page.wait_for_load_state("networkidle")
  page.get_by_text("88 张", exact=True).wait_for()
  page.get_by_text("45 张可定种鸟类真值", exact=False).wait_for()

  night_heron_asset = page.get_by_role("button").filter(has_text="夜鹭").first
  night_heron_asset.click()
  page.get_by_text("鸟种识别", exact=True).wait_for()
  page.get_by_text("夜鹭", exact=True).first.wait_for()
  page.get_by_text("人工结论：夜鹭（已确认）", exact=False).wait_for()

  page.get_by_role("button", name="重置").click()
  library_select.select_option(label=rejection_option)
  page.wait_for_load_state("networkidle")
  page.get_by_text("12 张", exact=True).wait_for()
  page.get_by_text("12 张拒识真值", exact=False).wait_for()

  SCREENSHOT.parent.mkdir(parents=True, exist_ok=True)
  page.screenshot(path=str(SCREENSHOT), full_page=True)
  assert not page_errors, f"browser javascript errors: {page_errors}"
  print("E2E_USER_FLOW_OK")
  print(f"SCREENSHOT={SCREENSHOT}")
  browser.close()
