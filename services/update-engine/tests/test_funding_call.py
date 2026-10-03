from datetime import datetime
from zoneinfo import ZoneInfo

from app.funding_call import analyze_funding_call_page, discover_call_pages

WARSAW = ZoneInfo("Europe/Warsaw")


def test_single_day_pup_call_is_only_a_draft_candidate():
    html = """
    <html><body>
      <h1>Nabór wniosków - działalność</h1>
      <p>Powiatowy Urząd Pracy ogłasza nabór wniosków o dofinansowanie
      podjęcia działalności gospodarczej.</p>
      <p>Termin naboru wniosków – w dniu 15.06.2026 r.</p>
    </body></html>
    """

    result = analyze_funding_call_page(
        html,
        "https://katowice.praca.gov.pl/nabor-dzialalnosc",
        now=datetime(2026, 6, 15, 12, 0, tzinfo=WARSAW),
    )

    assert result["candidateStatus"] == "OPEN"
    assert result["opensAt"].startswith("2026-06-15T00:00:00")
    assert result["closesAt"].startswith("2026-06-15T23:59:59")


def test_past_call_candidate_is_closed():
    html = """
    <h1>Dofinansowanie działalności</h1>
    <p>Termin naboru wniosków - w dniu 04.03.2026 r.</p>
    """
    result = analyze_funding_call_page(
        html,
        "https://example.praca.gov.pl/nabor",
        now=datetime(2026, 10, 3, 8, 0, tzinfo=WARSAW),
    )
    assert result["candidateStatus"] == "CLOSED"


def test_discovers_only_same_host_relevant_call_pages():
    html = """
    <a href="/nabor-dzialalnosc">Nabór - działalność gospodarcza</a>
    <a href="/staze">Nabór na staże</a>
    <a href="https://evil.example/nabor">Nabór zewnętrzny</a>
    """
    pages = discover_call_pages(html, "https://pup.example/")
    assert len(pages) == 1
    assert pages[0]["url"] == "https://pup.example/nabor-dzialalnosc"
