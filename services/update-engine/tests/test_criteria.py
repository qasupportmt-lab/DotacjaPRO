from app.criteria import analyze_criteria_text


def test_extracts_katowice_style_scoring_candidates():
    text = """
    Maksymalnie 3 pkt – posiadane kwalifikacje zawodowe związane z planowaną działalnością.
    Maksymalnie 3 pkt – ukończone kursy, szkolenia i certyfikaty.
    Maksymalnie 2 pkt – doświadczenie zawodowe w ramach stosunku pracy.
    Maksymalnie 1 pkt – doświadczenie w ramach umów cywilnoprawnych.
    Maksymalnie 4 pkt – analiza SWOT przedsięwzięcia.

    Wniosek może uzyskać pozytywną ocenę przy liczbie punktów nie niższej niż 20 punktów.
    Nie uzyskanie punktów w kryteriach 1 i 2 powoduje odstąpienie od dalszej oceny wniosku.
    """

    result = analyze_criteria_text(text, "Kryteria PUP")

    assert len(result["criteria"]) == 5
    assert result["criteria"][0]["maxPoints"] == 3.0
    assert result["criteria"][-1]["maxPoints"] == 4.0
    assert result["minimumPoints"] == 20.0
    assert result["maximumPoints"] == 13.0

    rules = result["blockingRulesJson"]["rules"]
    assert len(rules) == 1
    assert rules[0]["candidateCriterionNumbers"] == [1, 2]
    assert rules[0]["requiresVerification"] is True


def test_does_not_invent_criteria_when_pattern_is_missing():
    result = analyze_criteria_text(
        "Dokument opisuje warunki naboru, ale nie zawiera tabeli punktowej.",
        "Warunki"
    )

    assert result["criteria"] == []
    assert result["minimumPoints"] is None
    assert result["maximumPoints"] is None
