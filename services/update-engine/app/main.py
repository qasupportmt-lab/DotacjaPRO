import os

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import FastAPI, Header, HTTPException
from zoneinfo import ZoneInfo

from .scanner import scan_all_sources, build_morning_digests, requalify_verified_changes, advance_funding_call_statuses
from .teryt import sync_teryt_from_urls

app = FastAPI(title="DotacjaPRO Update Engine")
scheduler = AsyncIOScheduler(timezone=ZoneInfo("Europe/Warsaw"))


def require_secret(x_worker_secret: str | None):
    configured = os.getenv("INTERNAL_WORKER_SECRET")
    if not configured or x_worker_secret != configured:
        raise HTTPException(status_code=401, detail="Unauthorized")


@app.on_event("startup")
async def startup():
    scheduler.add_job(
        advance_funding_call_statuses,
        "cron",
        minute=5,
        id="funding-call-status-clock",
        replace_existing=True,
        max_instances=1,
        coalesce=True
    )
    scheduler.add_job(
        sync_teryt_from_urls,
        "cron",
        hour=4,
        minute=30,
        id="daily-teryt-sync",
        replace_existing=True,
        max_instances=1,
        coalesce=True
    )
    scheduler.add_job(
        scan_all_sources,
        "cron",
        hour=5,
        minute=0,
        id="morning-source-scan",
        replace_existing=True,
        max_instances=1,
        coalesce=True
    )
    scheduler.add_job(
        requalify_verified_changes,
        "cron",
        hour=5,
        minute=30,
        id="morning-requalification",
        replace_existing=True,
        max_instances=1,
        coalesce=True
    )
    scheduler.add_job(
        build_morning_digests,
        "cron",
        hour=7,
        minute=0,
        id="morning-digest-builder",
        replace_existing=True,
        max_instances=1,
        coalesce=True
    )
    scheduler.add_job(
        scan_all_sources,
        "cron",
        hour=18,
        minute=0,
        id="evening-source-scan",
        replace_existing=True,
        max_instances=1,
        coalesce=True
    )
    scheduler.add_job(
        requalify_verified_changes,
        "cron",
        hour=18,
        minute=30,
        id="evening-requalification",
        replace_existing=True,
        max_instances=1,
        coalesce=True
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
        "scan_schedule": [
            "04:30 TERYT",
            "05:00 sources",
            "05:30 requalification",
            "18:00 sources",
            "18:30 requalification"
        ],
        "digest_policy": "morning-if-relevant"
    }


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
