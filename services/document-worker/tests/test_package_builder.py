import hashlib
import json
import zipfile
from io import BytesIO

import app.package_builder as package_builder


def test_build_package_contains_documents_instruction_and_manifest(monkeypatch):
    files = {
        "doc/a": b"FORM A",
        "doc/b": b"FORM B",
    }

    monkeypatch.setattr(
        package_builder,
        "get_bytes",
        lambda key: files[key],
    )

    payload = {
        "job": {
            "id": "package-1",
            "caseId": "case-123",
            "recipientEmail": "user@example.com",
        },
        "fundingCall": {
            "id": "call-1",
            "title": "Nabór PUP 2026",
            "officialUrl": "https://urzad.example/nabor",
            "institutionName": "Powiatowy Urząd Pracy",
            "institutionUrl": "https://urzad.example",
            "opensAt": None,
            "closesAt": None,
        },
        "submissionInstruction": {
            "id": "instruction-1",
            "version": 2,
            "instruction": {
                "institutionName": "Powiatowy Urząd Pracy",
                "methods": ["IN_PERSON", "ELECTRONIC"],
                "address": "ul. Testowa 1",
                "electronicUrl": "https://urzad.example/e-dokumenty",
                "deadlineText": "do 15 czerwca 2026 r.",
                "requiredCopies": 1,
                "signatureInstructions": "Podpisz w oznaczonych miejscach.",
            },
            "sourceUrl": "https://urzad.example/nabor",
            "sourceHash": "a" * 64,
            "verifiedAt": "2026-06-01T10:00:00Z",
        },
        "documents": [
            {
                "renderJobId": "render-1",
                "storageKey": "doc/a",
                "outputName": "wniosek.pdf",
                "outputSha256": hashlib.sha256(b"FORM A").hexdigest(),
                "mimeType": "application/pdf",
                "sourceSha256": "b" * 64,
                "formCode": "WNIOSEK",
            },
            {
                "renderJobId": "render-2",
                "storageKey": "doc/b",
                "outputName": "zalacznik.docx",
                "outputSha256": hashlib.sha256(b"FORM B").hexdigest(),
                "mimeType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                "sourceSha256": "c" * 64,
                "formCode": "ZALACZNIK",
            },
        ],
    }

    content, digest, name = package_builder.build_package(payload)

    assert name.endswith(".zip")
    assert digest == hashlib.sha256(content).hexdigest()

    with zipfile.ZipFile(BytesIO(content)) as archive:
        names = set(archive.namelist())
        assert "01_dokumenty/wniosek.pdf" in names
        assert "01_dokumenty/zalacznik.docx" in names
        assert "00_INSTRUKCJA_ZLOZENIA.html" in names
        assert "00_INSTRUKCJA_ZLOZENIA.txt" in names
        assert "00_WARUNKI_LICENCJA_RODO.html" in names
        assert "00_WARUNKI_LICENCJA_RODO.txt" in names
        assert "00_doradcyPRO_RAPORT.pdf" in names
        assert archive.read("00_doradcyPRO_RAPORT.pdf").startswith(b"%PDF")
        assert "99_MANIFEST.json" in names

        instruction = archive.read("00_INSTRUKCJA_ZLOZENIA.txt").decode("utf-8")
        assert "Powiatowy Urząd Pracy" in instruction
        assert "ul. Testowa 1" in instruction
        assert "https://urzad.example/e-dokumenty" in instruction

        manifest = json.loads(
            archive.read("99_MANIFEST.json").decode("utf-8")
        )
        assert manifest["caseId"] == "case-123"
        assert manifest["legal"]["included"] is True
        assert manifest["legal"]["version"]
        assert "00_WARUNKI_LICENCJA_RODO.txt" in manifest["legal"]["files"]
        assert len(manifest["documents"]) == 2
        assert manifest["documents"][0]["sha256"] == hashlib.sha256(b"FORM A").hexdigest()
        assert manifest["ebook"]["name"] == "00_doradcyPRO_RAPORT.pdf"
        assert len(manifest["ebook"]["sha256"]) == 64


def test_build_package_rejects_rendered_document_hash_mismatch(monkeypatch):
    monkeypatch.setattr(
        package_builder,
        "get_bytes",
        lambda _: b"changed",
    )

    payload = {
        "job": {"caseId": "case-1"},
        "fundingCall": {
            "title": "Test",
            "institutionName": "PUP",
        },
        "submissionInstruction": {
            "id": "i",
            "version": 1,
            "instruction": {
                "institutionName": "PUP",
                "methods": ["IN_PERSON"],
            },
            "sourceUrl": "https://example.test",
            "verifiedAt": "2026-01-01T00:00:00Z",
        },
        "documents": [{
            "renderJobId": "r1",
            "storageKey": "x",
            "outputName": "a.pdf",
            "outputSha256": hashlib.sha256(b"original").hexdigest(),
            "mimeType": "application/pdf",
            "sourceSha256": "a" * 64,
            "formCode": "A",
        }],
    }

    try:
        package_builder.build_package(payload)
        assert False, "expected hash mismatch"
    except RuntimeError as exc:
        assert "PACKAGE_DOCUMENT_HASH_MISMATCH" in str(exc)
