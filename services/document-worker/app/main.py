from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI(title="DotacjaPRO Document Worker")

class RenderRequest(BaseModel):
    template_id: str
    case_id: str

@app.get('/health')
def health():
    return {'service': 'document-worker', 'status': 'ok', 'official_form_only': True}

@app.post('/render')
def render(req: RenderRequest):
    raise HTTPException(status_code=501, detail='Official template renderer not connected yet')
