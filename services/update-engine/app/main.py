from fastapi import FastAPI

app = FastAPI(title='DotacjaPRO Update Engine')

@app.get('/health')
def health():
    return {
        'service': 'update-engine',
        'status': 'ok',
        'scan_policy': ['morning', 'evening'],
        'digest_policy': 'morning-if-relevant'
    }
