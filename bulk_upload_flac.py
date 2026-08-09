#!/usr/bin/env python3
"""
Bulk FLAC Upload Utility for Spotibase
Extracts metadata from FLAC files and uploads to the backend API.
"""

import os
import sys
import json
import time
from pathlib import Path
from typing import Optional, List, Dict, Any
from dataclasses import dataclass, field
from datetime import datetime

import requests
from mutagen.flac import FLAC, Picture
from mutagen import MutagenError


# ============ CONFIGURATION ============
API_BASE = os.getenv("SPOTIBASE_API", "http://localhost:8080/api/v1")
AUTH_EMAIL = os.getenv("SPOTIBASE_EMAIL", "admin@spotibase.com")
AUTH_PASSWORD = os.getenv("SPOTIBASE_PASSWORD", "admin123")
MUSIC_FOLDER = os.getenv("MUSIC_FOLDER", r"D:\Music\hires_from_spotiflac\Sathish babu")
DEFAULT_GENRE = os.getenv("DEFAULT_GENRE", "Tamil")
MAX_RETRIES = 3
RETRY_DELAY = 2
UPLOAD_DELAY = 0.5


# ============ DATA CLASSES ============
@dataclass
class FlacMetadata:
    title: str
    artists: List[str]
    album_artist: str
    album: str
    release_date: Optional[str]
    composer: Optional[str]
    track_number: int
    disc_number: int
    total_tracks: int
    total_discs: int
    isrc: Optional[str]
    genre: Optional[str]
    language: Optional[str]
    lyrics: Optional[str]
    explicit: bool
    duration_seconds: float
    sample_rate: int
    channels: int
    bits_per_sample: int
    bitrate: int
    file_format: str = "FLAC"
    cover_data: Optional[bytes] = None
    cover_mime: Optional[str] = None
    file_path: str = ""


@dataclass
class ArtistCache:
    by_name: Dict[str, str] = field(default_factory=dict)


@dataclass
class AlbumCache:
    by_key: Dict[str, str] = field(default_factory=dict)


# ============ API CLIENT ============
class SpotibaseAPI:
    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip("/")
        self.token: Optional[str] = None
        self.refresh_token: Optional[str] = None
        self.session = requests.Session()
        self.session.timeout = 120
    
    def login(self, email: str, password: str) -> bool:
        url = f"{self.base_url}/auth/login"
        resp = self.session.post(url, json={"email": email, "password": password})
        if resp.status_code == 200:
            data = resp.json()
            self.token = data.get("accessToken")
            self.refresh_token = data.get("refreshToken")
            self.session.headers.update({"Authorization": f"Bearer {self.token}"})
            print(f"✓ Logged in as {email}")
            return True
        else:
            print(f"✗ Login failed: {resp.status_code} - {resp.text}")
            return False
    
    def _request(self, method: str, endpoint: str, **kwargs) -> requests.Response:
        url = f"{self.base_url}{endpoint}"
        for attempt in range(MAX_RETRIES):
            try:
                resp = self.session.request(method, url, **kwargs)
                if resp.status_code == 401 and self.refresh_token:
                    if self.refresh():
                        continue
                return resp
            except requests.RequestException as e:
                if attempt == MAX_RETRIES - 1:
                    raise
                time.sleep(RETRY_DELAY * (attempt + 1))
        return resp
    
    def refresh(self) -> bool:
        url = f"{self.base_url}/auth/refresh"
        resp = self.session.post(url, json={"refreshToken": self.refresh_token})
        if resp.status_code == 200:
            data = resp.json()
            self.token = data.get("accessToken")
            self.refresh_token = data.get("refreshToken")
            self.session.headers.update({"Authorization": f"Bearer {self.token}"})
            return True
        return False
    
    # ---- Search ----
    def search_artist(self, name: str) -> Optional[str]:
        resp = self._request("GET", f"/search?query={requests.utils.quote(name)}&types=artist&page=0&size=5")
        if resp.status_code == 200:
            data = resp.json()
            artists = data.get("artists", [])
            if artists:
                for artist in artists:
                    if artist["name"].lower() == name.lower():
                        return artist["id"]
                return artists[0]["id"]
        return None
    
    def search_album(self, name: str, artist_id: Optional[str] = None) -> Optional[str]:
        resp = self._request("GET", f"/search?query={requests.utils.quote(name)}&types=album&page=0&size=10")
        if resp.status_code == 200:
            data = resp.json()
            albums = data.get("albums", [])
            for album in albums:
                if album["title"].lower() == name.lower():
                    if artist_id is None or album.get("artistId") == artist_id:
                        return album["id"]
            if albums:
                return albums[0]["id"]
        return None
    
    # ---- Artist (uses @RequestParam, not @RequestPart) ----
    def create_artist(self, name: str, bio: str = "") -> Optional[str]:
        url = f"{self.base_url}/artists"
        data = {"name": name}
        if bio:
            data["bio"] = bio
        # Artist uses multipart/form-data with @RequestParam
        resp = self.session.post(url, data=data)
        if resp.status_code == 201:
            return resp.json()["id"]
        elif resp.status_code == 409:
            return self.search_artist(name)
        elif resp.status_code == 403:
            print(f"  ⚠ Need ADMIN role to create artist '{name}'")
        else:
            print(f"  ✗ Failed to create artist '{name}': {resp.status_code} - {resp.text}")
        return None
    
    # ---- Album (uses @RequestPart "request" with JSON) ----
    def create_album(self, artist_id: str, title: str, release_date: Optional[str] = None,
                     cover_url: Optional[str] = None) -> Optional[str]:
        # Album expects @RequestPart("request") CreateAlbumRequest + @RequestPart coverFile
        request_data = {
            "name": title,
            "artistId": artist_id,
            "releaseDate": release_date or "2024-01-01",
            "type": "ALBUM"
        }
        if cover_url:
            request_data["coverUrl"] = cover_url
        
        files = {
            "request": (None, json.dumps(request_data), "application/json")
        }
        resp = self._request("POST", "/albums", files=files)
        if resp.status_code == 201:
            return resp.json()["id"]
        elif resp.status_code == 409:
            return self.search_album(title, artist_id)
        print(f"  ✗ Failed to create album '{title}': {resp.status_code} - {resp.text}")
        return None
    
    # ---- Song (uses @RequestPart "request" with JSON) ----
    def upload_song(self, metadata: FlacMetadata, artist_id: str, 
                    album_artist_id: Optional[str] = None,
                    album_id: Optional[str] = None,
                    genre_id: Optional[str] = None,
                    contributing_artists: Optional[List[Dict]] = None) -> Optional[str]:
        """
        Upload song with metadata and audio file.
        Expects @RequestPart("request") CreateSongRequest + @RequestPart audioFile + @RequestPart coverFile
        """
        request_data = {
            "title": metadata.title,
            "artistId": artist_id,
            "releaseDate": metadata.release_date or "2024-01-01",
            "trackNumber": metadata.track_number,
            "discNumber": metadata.disc_number,
            "explicit": metadata.explicit,
            "language": metadata.language or "ta",
            "composer": metadata.composer or "",
            "lyrics": metadata.lyrics or "",
            "fileFormat": metadata.file_format,
        }
        
        if album_artist_id:
            request_data["albumArtistId"] = album_artist_id
        if album_id:
            request_data["albumId"] = album_id
        if genre_id:
            request_data["genreId"] = genre_id
        
        if contributing_artists:
            request_data["contributingArtists"] = contributing_artists
        
        # Build multipart form with JSON part
        files = {
            "request": (None, json.dumps(request_data), "application/json")
        }
        
        audio_file = None
        try:
            audio_file = open(metadata.file_path, "rb")
            files["audioFile"] = (os.path.basename(metadata.file_path), audio_file, f"audio/{metadata.file_format.lower()}")
            
            if metadata.cover_data:
                files["coverFile"] = ("cover.jpg", metadata.cover_data, metadata.cover_mime or "image/jpeg")
            
            resp = self._request("POST", "/songs", files=files)
            
        finally:
            if audio_file:
                audio_file.close()
        
        if resp.status_code == 201:
            return resp.json()["id"]
        else:
            print(f"  ✗ Upload failed: {resp.status_code} - {resp.text}")
            return None


# ============ METADATA EXTRACTION ============
def extract_flac_metadata(file_path: str) -> Optional[FlacMetadata]:
    try:
        audio = FLAC(file_path)
    except MutagenError as e:
        print(f"  ✗ Failed to read {file_path}: {e}")
        return None
    
    def get_first(tag: str, default: str = "") -> str:
        vals = audio.get(tag, [])
        return vals[0] if vals else default
    
    def get_all(tag: str) -> List[str]:
        return audio.get(tag, [])
    
    def get_int(tag: str, default: int = 1) -> int:
        vals = audio.get(tag, [])
        if vals:
            try:
                return int(vals[0].split("/")[0])
            except (ValueError, IndexError):
                pass
        return default
    
    # Cover art
    cover_data = None
    cover_mime = None
    for pic in audio.pictures:
        if pic.type == 3:
            cover_data = pic.data
            cover_mime = pic.mime
            break
    
    artists = get_all("artist")
    if not artists:
        artists = [get_first("albumartist", "Unknown Artist")]
    
    album_artist = get_first("albumartist", artists[0] if artists else "Unknown Artist")
    date_str = get_first("date", "")
    release_date = parse_date(date_str)
    duration = audio.info.length if audio.info else 0
    
    return FlacMetadata(
        title=get_first("title", os.path.splitext(os.path.basename(file_path))[0]),
        artists=artists,
        album_artist=album_artist,
        album=get_first("album", "Unknown Album"),
        release_date=release_date,
        composer=get_first("composer"),
        track_number=get_int("tracknumber"),
        disc_number=get_int("discnumber"),
        total_tracks=get_int("totaltracks", 0),
        total_discs=get_int("totaldiscs", 1),
        isrc=get_first("isrc"),
        genre=get_first("genre"),
        language=detect_language(get_first("title", "") + " " + " ".join(artists)),
        lyrics=get_first("lyrics"),
        explicit=is_explicit(get_first("title", ""), artists),
        duration_seconds=duration,
        sample_rate=audio.info.sample_rate if audio.info else 44100,
        channels=audio.info.channels if audio.info else 2,
        bits_per_sample=audio.info.bits_per_sample if audio.info else 16,
        bitrate=audio.info.bitrate if audio.info else 0,
        cover_data=cover_data,
        cover_mime=cover_mime,
        file_path=file_path,
    )


def parse_date(date_str: str) -> Optional[str]:
    if not date_str:
        return None
    date_str = date_str.strip()
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%Y.%m.%d", "%Y", "%d-%m-%Y", "%d/%m/%Y"):
        try:
            dt = datetime.strptime(date_str, fmt)
            return dt.strftime("%Y-%m-%d")
        except ValueError:
            continue
    if date_str.isdigit() and len(date_str) == 4:
        return f"{date_str}-01-01"
    return None


def detect_language(text: str) -> str:
    tamil_chars = set("அஆஇஈஉஊஎஏஐஒஓஔகஙசஜஞடணதநபமயரலவழளறன")
    if any(c in tamil_chars for c in text):
        return "ta"
    return "en"


def is_explicit(title: str, artists: List[str]) -> bool:
    explicit_keywords = ["explicit", "clean version", "radio edit", "censored"]
    text = (title + " " + " ".join(artists)).lower()
    return any(kw in text for kw in explicit_keywords)


# ============ MAIN UPLOAD LOGIC ============
class BulkUploader:
    def __init__(self, api: SpotibaseAPI, music_folder: str, default_genre: str = "Tamil"):
        self.api = api
        self.music_folder = Path(music_folder)
        self.artist_cache = ArtistCache()
        self.album_cache = AlbumCache()
        self.default_genre = default_genre
        self.stats = {"total": 0, "success": 0, "failed": 0, "skipped": 0}
    
    def get_or_create_artist(self, name: str) -> Optional[str]:
        if not name:
            return None
        name = name.strip()
        if name in self.artist_cache.by_name:
            return self.artist_cache.by_name[name]
        
        artist_id = self.api.search_artist(name)
        if not artist_id:
            artist_id = self.api.create_artist(name)
        
        if artist_id:
            self.artist_cache.by_name[name] = artist_id
            print(f"  ✓ Artist: {name} -> {artist_id}")
        else:
            print(f"  ✗ Failed to get/create artist: {name}")
        return artist_id
    
    def get_or_create_album(self, artist_id: str, album_name: str, release_date: Optional[str]) -> Optional[str]:
        if not artist_id or not album_name:
            return None
        key = f"{artist_id}|{album_name}"
        if key in self.album_cache.by_key:
            return self.album_cache.by_key[key]
        
        album_id = self.api.search_album(album_name, artist_id)
        if not album_id:
            album_id = self.api.create_album(artist_id, album_name, release_date)
        
        if album_id:
            self.album_cache.by_key[key] = album_id
            print(f"  ✓ Album: {album_name} -> {album_id}")
        else:
            print(f"  ✗ Failed to get/create album: {album_name}")
        return album_id
    
    def process_file(self, file_path: Path) -> bool:
        self.stats["total"] += 1
        print(f"\n[{self.stats['total']}] Processing: {file_path.name}")
        
        metadata = extract_flac_metadata(str(file_path))
        if not metadata:
            self.stats["failed"] += 1
            return False
        
        print(f"  Title: {metadata.title}")
        print(f"  Artists: {metadata.artists}")
        print(f"  Album Artist: {metadata.album_artist}")
        print(f"  Album: {metadata.album}")
        print(f"  Date: {metadata.release_date}")
        print(f"  Duration: {metadata.duration_seconds:.1f}s")
        print(f"  Quality: {metadata.sample_rate}Hz/{metadata.bits_per_sample}bit")
        if metadata.cover_data:
            print(f"  Cover: {len(metadata.cover_data)} bytes ({metadata.cover_mime})")
        if metadata.composer:
            print(f"  Composer: {metadata.composer}")
        if metadata.isrc:
            print(f"  ISRC: {metadata.isrc}")
        
        # Primary artist
        primary_artist_name = metadata.artists[0] if metadata.artists else "Unknown Artist"
        artist_id = self.get_or_create_artist(primary_artist_name)
        if not artist_id:
            self.stats["failed"] += 1
            return False
        
        # Album artist (if different)
        album_artist_id = None
        if metadata.album_artist != primary_artist_name:
            album_artist_id = self.get_or_create_artist(metadata.album_artist)
        
        # Album
        album_artist_for_album = album_artist_id or artist_id
        album_id = self.get_or_create_album(album_artist_for_album, metadata.album, metadata.release_date)
        
        # Genre - skip for now (no genre API)
        genre_id = None
        
        # Contributing artists
        contributing = []
        for i, artist_name in enumerate(metadata.artists[1:], 1):
            ca_artist_id = self.get_or_create_artist(artist_name)
            if ca_artist_id:
                role = self.infer_role(artist_name, metadata.composer)
                contributing.append({
                    "artistId": ca_artist_id,
                    "role": role,
                    "position": i
                })
                print(f"  Contributing: {artist_name} ({role})")
        
        # Upload
        song_id = self.api.upload_song(
            metadata=metadata,
            artist_id=artist_id,
            album_artist_id=album_artist_id,
            album_id=album_id,
            genre_id=genre_id,
            contributing_artists=contributing if contributing else None
        )
        
        if song_id:
            print(f"  ✓ Uploaded! Song ID: {song_id}")
            self.stats["success"] += 1
            return True
        else:
            self.stats["failed"] += 1
            return False
    
    def infer_role(self, artist_name: str, composer: Optional[str]) -> str:
        name_lower = artist_name.lower()
        if composer and composer.lower() == name_lower:
            return "COMPOSER"
        if any(kw in name_lower for kw in ["prod", "remix", "mix", "dj ", "remixer"]):
            return "PRODUCER"
        if any(kw in name_lower for kw in ["lyric", "writer", "poet"]):
            return "LYRICIST"
        return "FEATURING"
    
    def run(self):
        print(f"🎵 Spotibase Bulk FLAC Uploader")
        print(f"📁 Folder: {self.music_folder}")
        print(f"🌐 API: {self.api.base_url}")
        print("=" * 60)
        
        flac_files = list(self.music_folder.rglob("*.flac"))
        print(f"Found {len(flac_files)} FLAC files")
        
        if not flac_files:
            print("No FLAC files found!")
            return
        
        for i, file_path in enumerate(flac_files):
            try:
                self.process_file(file_path)
                if i < len(flac_files) - 1:
                    time.sleep(UPLOAD_DELAY)
            except KeyboardInterrupt:
                print("\n\n⚠ Interrupted by user")
                break
            except Exception as e:
                print(f"  ✗ Error: {e}")
                self.stats["failed"] += 1
        
        print("\n" + "=" * 60)
        print(f"📊 SUMMARY")
        print(f"  Total:   {self.stats['total']}")
        print(f"  ✓ Success: {self.stats['success']}")
        print(f"  ✗ Failed:  {self.stats['failed']}")
        print(f"  ⏭ Skipped: {self.stats['skipped']}")
        
        if self.stats['failed'] > 0:
            sys.exit(1)


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Bulk upload FLAC files to Spotibase")
    parser.add_argument("--api", default=API_BASE, help="API base URL")
    parser.add_argument("--email", default=AUTH_EMAIL, help="Admin email")
    parser.add_argument("--password", default=AUTH_PASSWORD, help="Admin password")
    parser.add_argument("--folder", default=MUSIC_FOLDER, help="Music folder path")
    parser.add_argument("--genre", default=DEFAULT_GENRE, help="Default genre")
    args = parser.parse_args()
    
    api = SpotibaseAPI(args.api)
    
    if not api.login(args.email, args.password):
        print("Login failed. Check credentials and backend availability.")
        sys.exit(1)
    
    uploader = BulkUploader(api, args.folder, args.genre)
    uploader.run()


if __name__ == "__main__":
    main()