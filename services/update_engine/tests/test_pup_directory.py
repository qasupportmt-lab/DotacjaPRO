from services.update_engine.app.pup_directory import parse_pup_directory


def test_parses_main_office_and_branch_municipalities():
    html = """
    <html><body>
      <h3>Powiatowy Urząd Pracy w Testowie</h3>
      <p>https://testowo.praca.gov.pl</p>
      <p>PUP w Testowie obsługuje gminy: Testowo, Nowa Gmina</p>
      <h4>Filia w Małym Mieście</h4>
      <p>PUP w Testowie filia obsługuje gminy: Małe Miasto</p>

      <h3>Powiatowy Urząd Pracy w Drugim Mieście</h3>
      <p>www.drugie-miasto.praca.gov.pl</p>
      <p>PUP w Drugim Mieście obsługuje gminy: Drugie Miasto</p>
    </body></html>
    """

    offices = parse_pup_directory(html)

    assert len(offices) == 2
    assert offices[0]["officialUrl"] == "https://testowo.praca.gov.pl"
    assert offices[0]["municipalities"] == ["Małe Miasto", "Nowa Gmina", "Testowo"]
    assert offices[1]["officialUrl"] == "https://www.drugie-miasto.praca.gov.pl"
    assert offices[1]["municipalities"] == ["Drugie Miasto"]
