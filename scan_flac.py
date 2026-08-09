from mutagen.flac import FLAC
import os

folder = r"D:\Music\hires_from_spotiflac\Sathish babu"
files = [f for f in os.listdir(folder) if f.endswith('.flac')][:15]

for fname in files:
    fpath = os.path.join(folder, fname)
    audio = FLAC(fpath)
    title = audio.get('title', [''])[0]
    artist = audio.get('artist', [''])[0]
    albumartist = audio.get('albumartist', [''])[0]
    album = audio.get('album', [''])[0]
    date = audio.get('date', [''])[0]
    composer = audio.get('composer', [''])[0]
    isrc = audio.get('isrc', [''])[0]
    tracknum = audio.get('tracknumber', [''])[0]
    print(f"{fname}")
    print(f"  title: {title}")
    print(f"  artist: {artist}")
    print(f"  albumartist: {albumartist}")
    print(f"  album: {album}")
    print(f"  date: {date}")
    print(f"  composer: {composer}")
    print(f"  isrc: {isrc}")
    print(f"  track: {tracknum}")
    print()