import os

from app.legal_pack import LEGAL_VERSION, checkout_allowed, legal_identity_complete, legal_pack_text


def _clear_legal_env(monkeypatch):
    for name in [
        "LEGAL_OPERATOR_TYPE",
        "LEGAL_OPERATOR_REQUIRES_REPRESENTATIVE",
        "LEGAL_TAX_CLASSIFICATION_CONFIRMED",
        "LEGAL_NIP_REQUIRED",
        "LEGAL_SELLER_NAME",
        "LEGAL_SELLER_ADDRESS",
        "LEGAL_SELLER_EMAIL",
        "LEGAL_SELLER_NIP",
        "LEGAL_REPRESENTATIVE_NAME",
        "LEGAL_REPRESENTATIVE_EMAIL",
    ]:
        monkeypatch.delenv(name, raising=False)


def test_unregistered_activity_does_not_require_nip_by_itself(monkeypatch):
    _clear_legal_env(monkeypatch)
    monkeypatch.setenv("LEGAL_OPERATOR_TYPE", "UNREGISTERED_ACTIVITY")
    monkeypatch.setenv("LEGAL_SELLER_NAME", "Test Seller")
    monkeypatch.setenv("LEGAL_SELLER_ADDRESS", "Test Address")
    monkeypatch.setenv("LEGAL_SELLER_EMAIL", "seller@example.com")
    monkeypatch.setenv("LEGAL_TAX_CLASSIFICATION_CONFIRMED", "true")

    assert legal_identity_complete() is True
    assert checkout_allowed() is True
    assert "NIP: nie jest wymagany przez sam fakt" in legal_pack_text()


def test_representative_gate_blocks_checkout(monkeypatch):
    _clear_legal_env(monkeypatch)
    monkeypatch.setenv("LEGAL_OPERATOR_TYPE", "UNREGISTERED_ACTIVITY")
    monkeypatch.setenv("LEGAL_OPERATOR_REQUIRES_REPRESENTATIVE", "true")
    monkeypatch.setenv("LEGAL_SELLER_NAME", "Test Seller")
    monkeypatch.setenv("LEGAL_SELLER_ADDRESS", "Test Address")
    monkeypatch.setenv("LEGAL_SELLER_EMAIL", "seller@example.com")
    monkeypatch.setenv("LEGAL_TAX_CLASSIFICATION_CONFIRMED", "true")

    assert legal_identity_complete() is False
    assert checkout_allowed() is False

    monkeypatch.setenv("LEGAL_REPRESENTATIVE_NAME", "Representative")
    assert legal_identity_complete() is True
    assert checkout_allowed() is True


def test_tax_classification_gate_blocks_checkout(monkeypatch):
    _clear_legal_env(monkeypatch)
    monkeypatch.setenv("LEGAL_OPERATOR_TYPE", "UNREGISTERED_ACTIVITY")
    monkeypatch.setenv("LEGAL_SELLER_NAME", "Test Seller")
    monkeypatch.setenv("LEGAL_SELLER_ADDRESS", "Test Address")
    monkeypatch.setenv("LEGAL_SELLER_EMAIL", "seller@example.com")
    monkeypatch.setenv("LEGAL_REPRESENTATIVE_NAME", "Representative")
    monkeypatch.setenv("LEGAL_OPERATOR_REQUIRES_REPRESENTATIVE", "true")

    assert legal_identity_complete() is True
    assert checkout_allowed() is False
    assert LEGAL_VERSION == "2026-10-04.1"
