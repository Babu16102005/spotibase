from mutagen.flac import FLAC
import os

folder = r"D:\Music\hires_from_spotiflac\Sathish babu"
files = [f for f in os.listdir(folder) if f.endswith('.flac')]

print(f"Total FLAC files: {len(files)}")
print()

# Check for multiple artists
multi_artist = []
single_artist = []

for fname in files:
    fpath = os.path.join(folder, fname)
    audio = FLAC(fpath)
    artists = audio.get('artist', [])
    if len(artists) > 1:
        multi_artist.append((fname, artists))
    else:
        single_artist.append((fname, artists[0] if artists else ''))

print(f"Songs with MULTIPLE artists: {len(multi_artist)}")
for fname, artists in multi_artist:
    print(f"  {fname}")
    print(f"    artists: {artists}")
    # Also check albumartist
    albumartist = audio.get('albumartist', [''])[0]
    print(f"    albumartist: {albumartist}")

print()
print(f"Songs with SINGLE artist: {len(single_artist)}")
# Check some edge cases
print()
print("=== Edge cases ===")
# Different artist vs albumartist
diff = []
for fname in files:
    fpath = os.path.join(folder, fname)
    audio = FLAC(fpath)
    artist = audio.get('artist', [''])[0]
    albumartist = audio.get('albumartist', [''])[0]
    if artist != albumartist:
        diff.append((fname, artist, albumartist))

print(f"artist != albumartist: {len(diff)}")
for fname, artist, albumartist in diff[:10]:
    print(f"  {fname}")
    print(f"    artist: {artist}")
    print(f"    albumartist: {albumartist}")

# Check for composer different from artist
print()
composer_diff = []
for fname in files:
    fpath = os.path.join(folder, fname)
    audio = FLAC(fpath)
    artist = audio.get('artist', [''])[0]
    composer = audio.get('composer', [''])[0]
    if composer and composer != artist:
        composer_diff.append((fname, artist, composer))

print(f"composer != artist: {len(composer_diff)}")
for fname, artist, composer in composer_diff[:10]:
    print(f"  {fname}")
    print(f"    artist: {artist}")
    print(f"    composer: {composer}")