from fastapi import APIRouter
from downloader import search_youtube
from models import get_db
import asyncio

router = APIRouter()

@router.get("/search")
async def search(q: str, limit: int = 12):
    results = search_youtube(q, limit)
    return {"results": results}


@router.get("/recommendations")
async def get_recommendations():
    # Get top artists from the user's library
    conn = get_db()
    rows = conn.execute(
        "SELECT artist, COUNT(*) as cnt FROM songs WHERE artist != '' AND filename != 'pending' "
        "GROUP BY artist ORDER BY cnt DESC LIMIT 3"
    ).fetchall()
    conn.close()

    top_artists = [r["artist"] for r in rows if r["artist"]]

    # Build queries
    if top_artists:
        for_you_query = f"{top_artists[0]} similar songs"
    else:
        for_you_query = "latest asian R&B"

    trending_query = "Asian R&B song"

    # Run both searches concurrently
    loop = asyncio.get_event_loop()
    trending_task = loop.run_in_executor(None, search_youtube, trending_query, 8)
    for_you_task = loop.run_in_executor(None, search_youtube, for_you_query, 8)

    trending, for_you = await asyncio.gather(trending_task, for_you_task)

    return {
        "trending": trending,
        "forYou": for_you,
        "forYouLabel": f"Because you listen to {top_artists[0]}" if top_artists else "Top Picks For You",
    }
