import importlib.util
from pathlib import Path

MODULE_PATH = Path(__file__).resolve().parents[1] / "app" / "official_attachments.py"

spec = importlib.util.spec_from_file_location("dotacjapro_official_attachments", MODULE_PATH)
module = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(module)
discover_official_attachments = module.discover_official_attachments


def test_discovers_only_same_host_official_document_links():
    html = """
    <html><body>
      <a href="/documents/123/wniosek.docx/abc">Wniosek 2026.docx</a>
      <a href="https://katowice.praca.gov.pl/files/regulamin.pdf">Regulamin.pdf</a>
      <a href="https://example.com/fake-form.pdf">Zewnętrzny PDF</a>
      <a href="/aktualnosci">Zwykła strona</a>
    </body></html>
    """

    items = discover_official_attachments(
        html,
        "https://katowice.praca.gov.pl/nabor/123",
    )

    assert len(items) == 2
    urls = {item["url"] for item in items}
    assert "https://katowice.praca.gov.pl/documents/123/wniosek.docx/abc" in urls
    assert "https://katowice.praca.gov.pl/files/regulamin.pdf" in urls
    assert "https://example.com/fake-form.pdf" not in urls
