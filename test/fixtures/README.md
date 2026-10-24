# Gameplay test video

`gameplay.mp4` is a two-second, silent, generated test pattern. It is not Subway
Surfers footage. The real-browser smoke test uses it to verify decoding, time
advancement, looping, and pause/resume without downloading media.

Regenerate with FFmpeg (the test itself does not require FFmpeg):

```bash
ffmpeg -f lavfi -i 'testsrc2=size=180x320:rate=20:duration=2' -an \
  -c:v libx264 -pix_fmt yuv420p -crf 30 -movflags +faststart test/fixtures/gameplay.mp4
```
