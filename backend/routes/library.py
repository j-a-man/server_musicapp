from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from models import get_db
import os

router = APIRouter()
MUSIC_DIR = "/music"


@router.get("/library")
async def get_library():
    conn = get_db()
    songs = conn.execute(
        "SELECT * FROM songs WHERE filename != 'pending' ORDER BY created_at DESC"
    ).fetchall()
    conn.close()
    return {"songs": [dict(s) for s in songs]}


@router.delete("/library/{song_id}")
async def delete_song(song_id: int):
    conn = get_db()
    song = conn.execute("SELECT * FROM songs WHERE id=?", (song_id,)).fetchone()
    if not song:
        raise HTTPException(status_code=404, detail="Song not found")

    filepath = os.path.join(MUSIC_DIR, song["filename"])
    if os.path.exists(filepath):
        os.remove(filepath)

    conn.execute("DELETE FROM playlist_songs WHERE song_id=?", (song_id,))
    conn.execute("DELETE FROM songs WHERE id=?", (song_id,))
    conn.commit()
    conn.close()
    return {"status": "deleted"}


# --- Playlists ---

@router.get("/playlists")
async def get_playlists():
    conn = get_db()
    playlists = conn.execute("SELECT * FROM playlists ORDER BY created_at DESC").fetchall()
    conn.close()
    return {"playlists": [dict(p) for p in playlists]}


class PlaylistCreate(BaseModel):
    name: str


@router.post("/playlists")
async def create_playlist(req: PlaylistCreate):
    conn = get_db()
    cursor = conn.execute("INSERT INTO playlists (name) VALUES (?)", (req.name,))
    playlist_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return {"id": playlist_id, "name": req.name}


@router.delete("/playlists/{playlist_id}")
async def delete_playlist(playlist_id: int):
    conn = get_db()
    conn.execute("DELETE FROM playlist_songs WHERE playlist_id=?", (playlist_id,))
    conn.execute("DELETE FROM playlists WHERE id=?", (playlist_id,))
    conn.commit()
    conn.close()
    return {"status": "deleted"}


@router.get("/playlists/{playlist_id}/songs")
async def get_playlist_songs(playlist_id: int):
    conn = get_db()
    songs = conn.execute("""
        SELECT s.* FROM songs s
        JOIN playlist_songs ps ON s.id = ps.song_id
        WHERE ps.playlist_id = ?
        ORDER BY ps.position
    """, (playlist_id,)).fetchall()
    conn.close()
    return {"songs": [dict(s) for s in songs]}


@router.post("/playlists/{playlist_id}/songs/{song_id}")
async def add_to_playlist(playlist_id: int, song_id: int):
    conn = get_db()
    exists = conn.execute(
        "SELECT 1 FROM playlist_songs WHERE playlist_id=? AND song_id=?",
        (playlist_id, song_id)
    ).fetchone()
    if exists:
        conn.close()
        return {"status": "already exists"}
    position = conn.execute(
        "SELECT COUNT(*) FROM playlist_songs WHERE playlist_id=?", (playlist_id,)
    ).fetchone()[0]
    conn.execute(
        "INSERT INTO playlist_songs (playlist_id, song_id, position) VALUES (?, ?, ?)",
        (playlist_id, song_id, position)
    )
    conn.commit()
    conn.close()
    return {"status": "added"}


@router.delete("/playlists/{playlist_id}/songs/{song_id}")
async def remove_from_playlist(playlist_id: int, song_id: int):
    conn = get_db()
    conn.execute(
        "DELETE FROM playlist_songs WHERE playlist_id=? AND song_id=?",
        (playlist_id, song_id)
    )
    conn.commit()
    conn.close()
    return {"status": "removed"}
