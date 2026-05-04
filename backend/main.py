from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from models import init_db
from routes import search, download, stream, library
import os

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- 1. API ROUTERS ---
app.include_router(search.router, prefix="/api")
app.include_router(download.router, prefix="/api")
app.include_router(stream.router, prefix="/api")
app.include_router(library.router, prefix="/api")


# --- 3. STATIC FILES & STARTUP ---
app.mount("/static", StaticFiles(directory="frontend"), name="static")

@app.on_event("startup")
async def startup():
    init_db()
    os.makedirs("/music", exist_ok=True)

# --- 4. THE CATCH-ALL (MUST BE LAST) ---
# This tells the server: "If you didn't match any of the routes above, 
# then (and only then) send the HTML file."
@app.get("/{full_path:path}")
async def serve_frontend(full_path: str):
    return FileResponse("frontend/index.html")