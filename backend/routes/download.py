from fastapi import APIRouter, BackgroundTasks
from pydantic import BaseModel
from downloader import download_audio
from models import get_db
import asyncio

router = APIRouter()

# In-memory download status tracker
download_status: dict[int, str] = {}


class DownloadRequest(BaseModel):
    url: str
    title: str
    artist: str = ""
    thumbnail: str = ""
    duration: int = 0


@router.post("/download")
async def start_download(req: DownloadRequest, background_tasks: BackgroundTasks):
    conn = get_db()
    
    # Check if already exists
    existing = conn.execute(
        "SELECT id, filename FROM songs WHERE youtube_url = ?", 
        (req.url,)
    ).fetchone()
    
    if existing:
        if existing["filename"] != "pending":
            conn.close()
            return {"song_id": existing["id"], "status": "done", "already_exists": True}
        else:
            # Still downloading
            conn.close()
            return {"song_id": existing["id"], "status": "downloading", "already_exists": True}

    cursor = conn.execute(
        "INSERT INTO songs (title, artist, youtube_url, filename, thumbnail, duration) VALUES (?, ?, ?, ?, ?, ?)",
        (req.title, req.artist, req.url, "pending", req.thumbnail, req.duration)
    )
    song_id = cursor.lastrowid
    conn.commit()
    conn.close()

    download_status[song_id] = "downloading"
    background_tasks.add_task(_do_download, req.url, song_id)

    return {"song_id": song_id, "status": "downloading"}


async def _do_download(url: str, song_id: int):
    try:
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(None, download_audio, url, song_id)

        conn = get_db()
        conn.execute(
            "UPDATE songs SET filename=?, title=?, artist=?, thumbnail=?, duration=? WHERE id=?",
            (result['filename'], result['title'], result['artist'],
             result['thumbnail'], result['duration'], song_id)
        )
        conn.commit()
        conn.close()
        download_status[song_id] = "done"
    except Exception as e:
        download_status[song_id] = f"error: {str(e)}"
        conn = get_db()
        conn.execute("DELETE FROM songs WHERE id=?", (song_id,))
        conn.commit()
        conn.close()


@router.get("/download/status/{song_id}")
async def get_status(song_id: int):
    status = download_status.get(song_id, "unknown")
    return {"song_id": song_id, "status": status}
