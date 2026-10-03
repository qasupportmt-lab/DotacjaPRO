import os
import smtplib
import ssl
from email.message import EmailMessage


def _smtp_config() -> dict:
    host = os.getenv("SMTP_HOST")
    user = os.getenv("SMTP_USER")
    password = os.getenv("SMTP_PASS")
    sender = os.getenv("SMTP_FROM")
    port = int(os.getenv("SMTP_PORT", "587"))
    secure = os.getenv("SMTP_SECURE", "false").lower() == "true"

    if not host or not user or not password or not sender:
        raise RuntimeError("SMTP_NOT_CONFIGURED")

    return {
        "host": host,
        "user": user,
        "password": password,
        "sender": sender,
        "port": port,
        "secure": secure,
    }


def send_package_email(
    recipient: str,
    package_name: str,
    package_bytes: bytes | None,
    download_url: str | None,
    funding_call_title: str,
    institution_name: str,
) -> None:
    config = _smtp_config()

    message = EmailMessage()
    message["From"] = config["sender"]
    message["To"] = recipient
    message["Subject"] = f"DotacjaPRO — komplet dokumentów: {funding_call_title}"

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

    message.set_content("\n".join(text))

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
