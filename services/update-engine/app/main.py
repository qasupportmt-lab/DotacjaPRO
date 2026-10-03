import os

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import FastAPI, Header, HTTPException
from zoneinfo import ZoneInfo

from .scanner import scan_all_sources, build_morning_digests

app = FastAPI(title="DotacjaPRO Update Engine")
scheduler = AsyncIOScheduler(timezone=ZoneInfo("Europe/Warsaw"))


def require_secret(x_worker_secret: str | None):
    configured = os.getenv("INTERNAL_WORKER_SECRET")
    if not configured or x_worker_secret != configured:
        raise HTTPException(status_code=401, detail="Unauthorized")


@app.on_event("startup")
async def startup():
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
        "scan_schedule": ["05:00", "18:00"],
        "digest_policy": "morning-if-relevant"
    }


@app.post("/scan-now")
async def scan_now(x_worker_secret: str | None = Header(default=None)):
    require_secret(x_worker_secret)
    return await scan_all_sources()
