from app.submission_instruction import analyze_submission_instruction


def test_extracts_explicit_submission_methods_without_inventing_others():
    html = """
    <html><body>
      <p>Wnioski można składać osobiście w siedzibie urzędu,
      ul. Testowa 10, 40-001 Katowice, lub pocztą.</p>
      <p>Termin naboru w dniu 15.06.2026 r.</p>
      <p>Wniosek należy podpisać we wszystkich wskazanych miejscach.</p>
      <a href="https://www.praca.gov.pl/eurzad/index.eup">Złóż elektronicznie</a>
    </body></html>
    """

    result = analyze_submission_instruction(
        html,
        "https://katowice.praca.gov.pl/nabor",
        "Powiatowy Urząd Pracy w Katowicach",
    )

    assert result is not None
    methods = result["instruction"]["methods"]
    assert "IN_PERSON" in methods
    assert "POSTAL" in methods
    assert "ELECTRONIC" in methods
    assert result["instruction"]["electronicUrl"] == "https://www.praca.gov.pl/eurzad/index.eup"
    assert "15.06.2026" in result["instruction"]["deadlineText"]


def test_returns_none_when_page_contains_no_submission_method():
    html = "<p>Informacja o projekcie i kryteriach.</p>"
    result = analyze_submission_instruction(
        html,
        "https://pup.example/info",
        "PUP Test",
    )
    assert result is None
