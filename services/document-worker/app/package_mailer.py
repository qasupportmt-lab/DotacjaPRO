import base64
import os
import smtplib
import ssl
from email.message import EmailMessage

import httpx


def _sender() -> str | None:
    return os.getenv("EMAIL_FROM") or os.getenv("SMTP_FROM")


def email_provider_configured() -> bool:
    brevo = bool(
        os.getenv("BREVO_API_KEY")
        and os.getenv("BREVO_FROM_EMAIL")
    )
    resend = bool(os.getenv("RESEND_API_KEY") and _sender())
    smtp = bool(
        os.getenv("SMTP_HOST")
        and os.getenv("SMTP_USER")
        and os.getenv("SMTP_PASS")
        and _sender()
    )
    return brevo or resend or smtp


def _smtp_config() -> dict | None:
    host = os.getenv("SMTP_HOST")
    user = os.getenv("SMTP_USER")
    password = os.getenv("SMTP_PASS")
    sender = _sender()
    port = int(os.getenv("SMTP_PORT", "587"))
    secure = os.getenv("SMTP_SECURE", "false").lower() == "true"

    if not host or not user or not password or not sender:
        return None

    return {
        "host": host,
        "user": user,
        "password": password,
        "sender": sender,
        "port": port,
        "secure": secure,
    }


def _send_brevo(
    recipient: str,
    subject: str,
    text: str,
    package_name: str,
    package_bytes: bytes | None,
) -> bool:
    api_key = os.getenv("BREVO_API_KEY")
    sender_email = os.getenv("BREVO_FROM_EMAIL")
    sender_name = os.getenv("BREVO_FROM_NAME", "DotacjaPRO")

    if not api_key or not sender_email:
        return False

    payload: dict = {
        "sender": {
            "email": sender_email,
            "name": sender_name,
        },
        "to": [{"email": recipient}],
        "replyTo": {
            "email": sender_email,
            "name": sender_name,
        },
        "subject": subject,
        "textContent": text,
    }

    if package_bytes is not None:
        payload["attachment"] = [{
            "name": package_name,
            "content": base64.b64encode(package_bytes).decode("ascii"),
        }]

    response = httpx.post(
        "https://api.brevo.com/v3/smtp/email",
        headers={
            "api-key": api_key,
            "accept": "application/json",
            "content-type": "application/json",
        },
        json=payload,
        timeout=45.0,
    )

    if response.status_code >= 400:
        raise RuntimeError(
            f"BREVO_SEND_FAILED:{response.status_code}:{response.text[:2000]}"
        )

    return True


def _send_resend(
    recipient: str,
    subject: str,
    text: str,
    package_name: str,
    package_bytes: bytes | None,
    message_id: str,
) -> bool:
    api_key = os.getenv("RESEND_API_KEY")
    sender = _sender()
    if not api_key or not sender:
        return False

    payload: dict = {
        "from": sender,
        "to": [recipient],
        "subject": subject,
        "text": text,
    }

    if package_bytes is not None:
        payload["attachments"] = [{
            "filename": package_name,
            "content": base64.b64encode(package_bytes).decode("ascii"),
            "content_type": "application/zip",
        }]

    response = httpx.post(
        "https://api.resend.com/emails",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Idempotency-Key": f"document-package/{message_id}",
        },
        json=payload,
        timeout=45.0,
    )
    if response.status_code >= 400:
        raise RuntimeError(
            f"RESEND_SEND_FAILED:{response.status_code}:{response.text[:2000]}"
        )
    return True


def send_package_email(
    recipient: str,
    package_name: str,
    package_bytes: bytes | None,
    download_url: str | None,
    funding_call_title: str,
    institution_name: str,
    message_id: str,
) -> None:
    subject = f"DotacjaPRO — komplet dokumentów: {funding_call_title}"

    text = [
        "Twój komplet dokumentów DotacjaPRO jest gotowy.",
        "",
        f"Nabór: {funding_call_title}",
        f"Instytucja: {institution_name}",
        "",
    ]

    if package_bytes is not None:
        text.append(
            "Pakiet ZIP znajduje się w załączniku. "
            "Wewnątrz znajdziesz formularze oraz instrukcję złożenia."
        )
    elif download_url:
        text.extend([
            "Pakiet jest zbyt duży, aby bezpiecznie dołączyć go do wiadomości.",
            "Pobierz tę samą paczkę ZIP z czasowego, podpisanego linku:",
            download_url,
        ])
    else:
        raise RuntimeError("EMAIL_PACKAGE_DELIVERY_MODE_MISSING")

    text.extend([
        "",
        "Przed złożeniem wydrukuj dokumenty, jeżeli urząd wymaga wersji papierowej,",
        "sprawdź podpisy i zastosuj instrukcję znajdującą się w pakiecie.",
        "",
        "DotacjaPRO nie gwarantuje przyznania dofinansowania; decyzję podejmuje właściwa instytucja.",
    ])
    body = "\n".join(text)

    if _send_brevo(
        recipient,
        subject,
        body,
        package_name,
        package_bytes,
    ):
        return

    if _send_resend(
        recipient,
        subject,
        body,
        package_name,
        package_bytes,
        message_id,
    ):
        return

    config = _smtp_config()
    if not config:
        raise RuntimeError("EMAIL_PROVIDER_NOT_CONFIGURED")

    message = EmailMessage()
    message["From"] = config["sender"]
    message["To"] = recipient
    message["Subject"] = subject
    message["Message-ID"] = f"<dotacjapro-package-{message_id}@dotacjapro.local>"
    message.set_content(body)

    if package_bytes is not None:
        message.add_attachment(
            package_bytes,
            maintype="application",
            subtype="zip",
            filename=package_name,
        )

    if config["secure"]:
        with smtplib.SMTP_SSL(
            config["host"],
            config["port"],
            context=ssl.create_default_context(),
            timeout=30,
        ) as smtp:
            smtp.login(config["user"], config["password"])
            smtp.send_message(message)
    else:
        with smtplib.SMTP(
            config["host"],
            config["port"],
            timeout=30,
        ) as smtp:
            smtp.ehlo()
            smtp.starttls(context=ssl.create_default_context())
            smtp.ehlo()
            smtp.login(config["user"], config["password"])
            smtp.send_message(message)
