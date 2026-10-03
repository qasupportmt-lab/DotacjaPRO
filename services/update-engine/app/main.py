import os
from datetime import datetime

import httpx
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import FastAPI, Header, HTTPException, Request
from zoneinfo import ZoneInfo

from .scanner import (
    advance_funding_call_statuses,
    build_morning_digests,
    requalify_verified_changes,
    scan_all_sources,
)
from .teryt import sync_teryt_from_urls

WARSAW = ZoneInfo("Europe/Warsaw")
app = FastAPI(title="DotacjaPRO Update Engine")
scheduler = AsyncIOScheduler(timezone=WARSAW)


def require_secret(x_worker_secret: str | None):
    configured = os.getenv("INTERNAL_WORKER_SECRET")
    if not configured or x_worker_secret != configured:
        raise HTTPException(status_code=401, detail="Unauthorized")


def require_cron(request: Request):
    configured = os.getenv("CRON_SECRET")
    received = request.headers.get("authorization")
    if not configured or received != f"Bearer {configured}":
        raise HTTPException(status_code=401, detail="Unauthorized cron")


async def run_local_schedule_tick(now: datetime | None = None) -> dict:
    local_now = (now or datetime.now(WARSAW)).astimezone(WARSAW)
    hour = local_now.hour
    minute = local_now.minute

    results: dict[str, object] = {
        "localTime": local_now.isoformat(),
        "advanceCalls": await advance_funding_call_statuses(),
    }

    if hour == 4 and minute < 45:
        results["teryt"] = await sync_teryt_from_urls()

    if (hour, minute // 30) in {(5, 0), (18, 0)}:
        results["sourceScan"] = await scan_all_sources()

    if (hour, minute // 30) in {(5, 1), (18, 1)}:
        results["requalification"] = await requalify_verified_changes()

    if hour == 7 and minute < 30:
        results["morningDigest"] = await build_morning_digests()

    return results


@app.on_event("startup")
async def startup():
    if os.getenv("ENABLE_BACKGROUND_SCHEDULER", "false").lower() != "true":
        return

    scheduler.add_job(
        advance_funding_call_statuses,
        "cron",
        minute=5,
        id="funding-call-status-clock",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
    )
    scheduler.add_job(
        sync_teryt_from_urls,
        "cron",
        hour=4,
        minute=30,
        id="daily-teryt-sync",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
    )
    scheduler.add_job(
        scan_all_sources,
        "cron",
        hour=5,
        minute=0,
        id="morning-source-scan",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
    )
    scheduler.add_job(
        requalify_verified_changes,
        "cron",
        hour=5,
        minute=30,
        id="morning-requalification",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
    )
    scheduler.add_job(
        build_morning_digests,
        "cron",
        hour=7,
        minute=0,
        id="morning-digest-builder",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
    )
    scheduler.add_job(
        scan_all_sources,
        "cron",
        hour=18,
        minute=0,
        id="evening-source-scan",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
    )
    scheduler.add_job(
        requalify_verified_changes,
        "cron",
        hour=18,
        minute=30,
        id="evening-requalification",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
    )
    scheduler.start()


@app.on_event("shutdown")
async def shutdown():
    if scheduler.running:
        scheduler.shutdown(wait=False)


@app.get("/health")
def health():
    return {
        "service": "update-engine",
        "status": "ok",
        "timezone": "Europe/Warsaw",
        "backgroundScheduler": os.getenv(
            "ENABLE_BACKGROUND_SCHEDULER",
            "false",
        ).lower() == "true",
        "cronTick": "every 30 minutes; local Warsaw dispatcher",
        "scan_schedule": [
            "04:30 TERYT",
            "05:00 sources",
            "05:30 requalification",
            "07:00 digest",
            "18:00 sources",
            "18:30 requalification",
        ],
    }


@app.get("/ready")
async def ready():
    missing = [
        name for name in ("API_BASE_URL", "INTERNAL_WORKER_SECRET")
        if not os.getenv(name)
    ]

    api_ready = False
    api_status = None
    api_error = None

    if not missing:
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(
                    f"{os.getenv('API_BASE_URL', '').rstrip('/')}/ready"
                )
                api_status = response.status_code
                api_ready = response.status_code == 200
        except Exception as exc:
            api_error = str(exc)[:1000]

    is_ready = not missing and api_ready
    payload = {
        "service": "update-engine",
        "ready": is_ready,
        "apiReady": api_ready,
        "apiStatus": api_status,
        "missingEnv": missing,
        "apiError": api_error,
    }

    if not is_ready:
        raise HTTPException(status_code=503, detail=payload)
    return payload


@app.get("/cron/tick")
async def cron_tick(request: Request):
    require_cron(request)
    return await run_local_schedule_tick()


@app.post("/tick-now")
async def tick_now(x_worker_secret: str | None = Header(default=None)):
    require_secret(x_worker_secret)
    return await run_local_schedule_tick()


@app.post("/scan-now")
async def scan_now(x_worker_secret: str | None = Header(default=None)):
    require_secret(x_worker_secret)
    return await scan_all_sources()


@app.post("/teryt-sync-now")
async def teryt_sync_now(x_worker_secret: str | None = Header(default=None)):
    require_secret(x_worker_secret)
    return await sync_teryt_from_urls()


@app.post("/requalify-now")
async def requalify_now(x_worker_secret: str | None = Header(default=None)):
    require_secret(x_worker_secret)
    return await requalify_verified_changes()


@app.post("/advance-calls-now")
async def advance_calls_now(x_worker_secret: str | None = Header(default=None)):
    require_secret(x_worker_secret)
    return await advance_funding_call_statuses()
