from fastapi import APIRouter
from downloader import search_youtube
from models import get_db
import asyncio
import random

router = APIRouter()

def _enrich_results(results: list) -> list:
    """Check which results are already in the library and return their local ID."""
    if not results:
        return results
    urls = [r.get('url') for r in results if r.get('url')]
    if not urls:
        return results
    
    conn = get_db()
    # Check which of these URLs are already in the DB and not pending
    placeholders = ', '.join(['?'] * len(urls))
    rows = conn.execute(
        f"SELECT id, youtube_url FROM songs WHERE youtube_url IN ({placeholders}) AND filename != 'pending'",
        urls
    ).fetchall()
    downloaded_map = {r['youtube_url']: r['id'] for r in rows}
    conn.close()
    
    for r in results:
        url = r.get('url')
        r['is_downloaded'] = url in downloaded_map
        r['song_id'] = downloaded_map.get(url)
    return results


@router.get("/search")
async def search(q: str, limit: int = 12):
    results = search_youtube(q, limit)
    results = _enrich_results(results)
    return {"results": results}


def _dedup(results: list) -> list:
    """Remove duplicate entries by video ID."""
    seen = set()
    out = []
    for r in results:
        vid = r.get('id') or r.get('url')
        if vid and vid not in seen:
            seen.add(vid)
            out.append(r)
    return out


@router.get("/recommendations")
async def get_recommendations():
    conn = get_db()
    # Top 5 artists by song count
    artist_rows = conn.execute(
        "SELECT artist, COUNT(*) as cnt FROM songs "
        "WHERE artist != '' AND filename != 'pending' "
        "GROUP BY artist ORDER BY cnt DESC LIMIT 5"
    ).fetchall()
    # Top 5 songs by recency
    song_rows = conn.execute(
        "SELECT title, artist FROM songs WHERE filename != 'pending' "
        "ORDER BY created_at DESC LIMIT 5"
    ).fetchall()
    conn.close()

    top_artists = [r["artist"] for r in artist_rows if r["artist"]]
    top_songs = [r for r in song_rows]

    # ── Build diverse queries for "For You" ────────────────────────────
    for_you_queries = []
    if top_artists:
        for_you_queries.append(f"{top_artists[0]} type beats music")
        if len(top_artists) >= 2:
            for_you_queries.append(f"artists similar to {top_artists[0]} and {top_artists[1]}")
    if top_songs:
        for_you_queries.append(f"songs like {top_songs[0]['title']}")
    if not for_you_queries:
        for_you_queries = ["chill R&B music mix", "lo-fi beats playlist"]

    # ── Build per-artist discovery rows ────────────────────────────────
    discovery_artists = top_artists[:3]  # up to 3 rows
    discovery_queries = [f"{a} similar songs" for a in discovery_artists]

    trending_query = "Asian R&B 2024 hits"

    # ── Run all searches concurrently ──────────────────────────────────
    loop = asyncio.get_event_loop()
    tasks = [loop.run_in_executor(None, search_youtube, q, 10) for q in for_you_queries]
    tasks += [loop.run_in_executor(None, search_youtube, q, 8) for q in discovery_queries]
    tasks.append(loop.run_in_executor(None, search_youtube, trending_query, 8))

    all_results = await asyncio.gather(*tasks)

    # Merge and dedup "For You" results from the first N tasks
    n_for_you = len(for_you_queries)
    merged_for_you = []
    for res in all_results[:n_for_you]:
        merged_for_you.extend(res)
    merged_for_you = _dedup(merged_for_you)[:20]
    random.shuffle(merged_for_you)
    merged_for_you = _enrich_results(merged_for_you)

    # Build discovery rows
    discovery_rows = []
    for i, artist in enumerate(discovery_artists):
        songs = _dedup(all_results[n_for_you + i])[:10]
        songs = _enrich_results(songs)
        discovery_rows.append({
            "label": f"Because you listen to {artist}",
            "artist": artist,
            "songs": songs,
        })

    trending = _dedup(all_results[-1])[:10]
    trending = _enrich_results(trending)

    # ── Suggested Playlists ───────────────────────────────────────────
    # We fetch a few playlist-style search results
    playlist_query = f"{top_artists[0]} full album mix" if top_artists else "best music 2024 mix"
    playlists = await loop.run_in_executor(None, search_youtube, playlist_query, 6)
    playlists = _enrich_results(playlists)

    return {
        "trending": trending,
        "forYou": merged_for_you,
        "forYouLabel": f"Because you listen to {top_artists[0]}" if top_artists else "Top Picks For You",
        "discoveryRows": discovery_rows,
        "suggestedPlaylists": playlists,
    }


@router.get("/radio/{artist_name}")
async def get_artist_radio(artist_name: str):
    """Return a curated mix of songs for a given artist's radio."""
    queries = [
        f"{artist_name} radio",
        f"songs like {artist_name}",
        f"{artist_name} style mix",
        f"fans of {artist_name} also listen to",
    ]
    loop = asyncio.get_event_loop()
    tasks = [loop.run_in_executor(None, search_youtube, q, 8) for q in queries]
    all_results = await asyncio.gather(*tasks)

    merged = []
    for res in all_results:
        merged.extend(res)
    merged = _dedup(merged)[:25]
    random.shuffle(merged)
    merged = _enrich_results(merged)

    return {
        "artist": artist_name,
        "songs": merged[:20],
    }
