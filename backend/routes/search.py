from fastapi import APIRouter
from downloader import search_youtube

router = APIRouter()

@router.get("/search")
async def search(q: str, limit: int = 12):
    results = search_youtube(q, limit)
    return {"results": results}
