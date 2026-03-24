from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse, FileResponse
import os

router = APIRouter()
MUSIC_DIR = "/music"


@router.get("/stream/{song_id}")
async def stream_audio(song_id: int, request: Request):
    filepath = os.path.join(MUSIC_DIR, f"{song_id}.mp3")
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="Song file not found")

    file_size = os.path.getsize(filepath)
    range_header = request.headers.get("range")

    if range_header:
        try:
            range_str = range_header.replace("bytes=", "")
            parts = range_str.split("-")
            start = int(parts[0]) if parts[0] else 0
            end = int(parts[1]) if len(parts) > 1 and parts[1] else file_size - 1
        except (ValueError, IndexError):
            start, end = 0, file_size - 1

        end = min(end, file_size - 1)
        chunk_size = end - start + 1

        def iter_file():
            with open(filepath, "rb") as f:
                f.seek(start)
                remaining = chunk_size
                while remaining > 0:
                    chunk = f.read(min(65536, remaining))
                    if not chunk:
                        break
                    remaining -= len(chunk)
                    yield chunk

        return StreamingResponse(
            iter_file(),
            status_code=206,
            media_type="audio/mpeg",
            headers={
                "Content-Range": f"bytes {start}-{end}/{file_size}",
                "Accept-Ranges": "bytes",
                "Content-Length": str(chunk_size),
                "Cache-Control": "no-cache",
            },
        )

    return FileResponse(
        filepath,
        media_type="audio/mpeg",
        headers={"Accept-Ranges": "bytes", "Content-Length": str(file_size)},
    )
