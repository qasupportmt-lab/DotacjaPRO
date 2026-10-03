from app.teryt import parse_simc, parse_terc


TERC = """WOJ;POW;GMI;RODZ;NAZWA;NAZDOD;STAN_NA
24;;;;ŚLĄSKIE;województwo;2026-01-01
24;75;;;Katowice;miasto na prawach powiatu;2026-01-01
24;75;01;1;Katowice;gmina miejska;2026-01-01
24;16;;;zawierciański;powiat;2026-01-01
24;16;06;3;Pilica;gmina miejsko-wiejska;2026-01-01
24;16;06;4;Pilica;miasto;2026-01-01
24;16;06;5;Pilica;obszar wiejski;2026-01-01
""".encode("utf-8")

SIMC = """WOJ;POW;GMI;RODZ_GMI;RM;MZ;NAZWA;SYM;SYMPOD;STAN_NA
24;75;01;1;96;1;Katowice;0937699;;2026-01-01
24;16;06;4;96;1;Pilica;0942630;;2026-01-01
24;16;06;5;01;1;Sławniów;0224310;;2026-01-01
""".encode("utf-8")


def test_parses_terc_hierarchy_and_normalizes_voivodeship():
    municipalities = parse_terc(TERC, "text/csv")
    by_code = {item["tercCode"]: item for item in municipalities}

    assert by_code["2475011"]["municipality"] == "Katowice"
    assert by_code["2475011"]["voivodeship"] == "śląskie"
    assert by_code["2416063"]["county"] == "zawierciański"


def test_simc_maps_urban_rural_parts_to_parent_gmina():
    municipalities = parse_terc(TERC, "text/csv")
    known = {item["tercCode"] for item in municipalities}
    localities = parse_simc(SIMC, known, "text/csv")
    by_simc = {item["simcCode"]: item for item in localities}

    assert by_simc["0937699"]["municipalityTercCode"] == "2475011"
    assert by_simc["0942630"]["municipalityTercCode"] == "2416063"
    assert by_simc["0224310"]["municipalityTercCode"] == "2416063"
