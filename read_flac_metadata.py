import mutagen
from mutagen.flac import FLAC
import json
import sys

files = [
    r"D:\Music\hires_from_spotiflac\Sathish babu\Anbae Peranbae - Yuvan Shankar Raja.flac",
    r"D:\Music\hires_from_spotiflac\Sathish babu\Edharkadi - Dhruv Vikram.flac"
]

for f in files:
    audio = FLAC(f)
    print(f"\n{'='*60}")
    print(f"FILE: {f}")
    print(f"{'='*60}")
    for key, value in audio.items():
        print(f"  {key}: {value}")
    print(f"\n  INFO:")
    print(f"    sample_rate: {audio.info.sample_rate}")
    print(f"    channels: {audio.info.channels}")
    print(f"    bits_per_sample: {audio.info.bits_per_sample}")
    print(f"    length: {audio.info.length:.2f}s")
    print(f"    bitrate: {audio.info.bitrate}")