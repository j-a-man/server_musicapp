import yt_dlp
import os

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
        
        # FIX 1: Corrected the URL string formatting so yt-dlp gets a real link
        video_id = entry.get('id', '')
        entries.append({
            'id': video_id,
            'title': entry.get('title', 'Unknown'),
            'channel': entry.get('channel') or entry.get('uploader', 'Unknown'),
            'duration': entry.get('duration') or 0,
            'thumbnail': entry.get('thumbnail', ''),
            'url': f"https://www.youtube.com/watch?v={video_id}",
            'view_count': entry.get('view_count', 0),
        })
    return entries


def download_audio(youtube_url: str, song_id: int) -> dict:
    os.makedirs(MUSIC_DIR, exist_ok=True)

    ydl_opts = {
        'headers': {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-us,en;q=0.5',
            'Sec-Fetch-Mode': 'navigate',
        },
        'format': 'bestaudio/best',
        'outtmpl': f'{MUSIC_DIR}/{song_id}.%(ext)s',
        'noplaylist': True,
        'nocheckcertificate': True,
        # IMPORTANT: This line often fixes the "Format not available" error on servers
        'youtube_include_dash_manifest': False, 
        'postprocessors': [
            {
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'mp3',
                'preferredquality': '192', # 192 is faster and more reliable than 320
            },
        ],
        'quiet': False,
        'no_warnings': False,
    }

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        # We use extract_info with download=True
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