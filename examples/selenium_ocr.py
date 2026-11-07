"""Use an already-authorized Selenium session with a local text-image fixture.
Requires selenium in the calling project. Does not submit forms.
"""
from pathlib import Path
from .client import SolverClient

def read_text_element(driver, image_css, key=None):
    key = key or (Path(__file__).resolve().parents[1] / '.local' / 'api-key').read_text().strip()
    element = driver.find_element('css selector', image_css)
    return SolverClient(key).solve({
        'type': 'ocr', 'image': element.screenshot_as_base64,
        'settings': {'mode': 'line', 'removeSpaces': True},
    })
