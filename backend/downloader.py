import yt_dlp
import os
import re

MUSIC_DIR = "/music"

def search_youtube(query: str, limit: int = 12):
    opts = {
        'quiet': True,
        'extract_flat': True,
        'no_warnings': True,
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        results = ydl.extract_info(f"ytsearch{limit}:{query}", download=False)

    entries = []
    for entry in results.get('entries', []) or []:
        if not entry:
            continue
        duration = entry.get('duration') or 0
        entries.append({
            'id': entry.get('id', ''),
            'title': entry.get('title', 'Unknown'),
            'channel': entry.get('channel') or entry.get('uploader', 'Unknown'),
            'duration': duration,
            'thumbnail': entry.get('thumbnail', ''),
            'url': f"https://www.youtube.com/watch?v={entry.get('id', '')}",
            'view_count': entry.get('view_count', 0),
        })
    return entries


def download_audio(youtube_url: str, song_id: int) -> dict:
    os.makedirs(MUSIC_DIR, exist_ok=True)

    ydl_opts = {
        'format': 'bestaudio/best',
        'outtmpl': f'{MUSIC_DIR}/{song_id}.%(ext)s',
        'postprocessors': [
            {
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'mp3',
                'preferredquality': '320',
            },
        ],
        'quiet': True,
        'no_warnings': True,
    }

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(youtube_url, download=True)
        title = info.get('title', 'Unknown')
        artist = info.get('channel') or info.get('uploader', 'Unknown')
        duration = info.get('duration', 0)
        thumbnail = info.get('thumbnail', '')

    return {
        'title': title,
        'artist': artist,
        'duration': duration,
        'thumbnail': thumbnail,
        'filename': f'{song_id}.mp3',
    }
