import pytest

from app.renderers.dispatch import (
    UnsupportedOfficialFormFormat,
    render_official_document,
)


def test_legacy_doc_is_blocked_instead_of_converted():
    with pytest.raises(UnsupportedOfficialFormFormat):
        render_official_document(
            source=b"legacy",
            original_name="wniosek.doc",
            mime_type="application/msword",
            mappings=[],
            values={},
        )
