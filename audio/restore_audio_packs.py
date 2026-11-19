"""从 audio/*-pack.bin 还原单个 mp3 文件。

用法：
  python audio/restore_audio_packs.py            # 还原全部
  python audio/restore_audio_packs.py sentence   # 只还原例句
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
AUDIO = ROOT / 'audio'
OUT_DIRS = {
    'en': AUDIO / 'en',
    'sentence': AUDIO / 'sentence',
    'ipa': AUDIO / 'ipa',
    'syl': AUDIO / 'syl',
}

src = (AUDIO / 'pack-index.js').read_text(encoding='utf-8')
obj = re.search(r'window\.WS_AUDIO_PACKS\s*=\s*(\{.*?\});', src, re.S)
if not obj:
    raise SystemExit('找不到 window.WS_AUDIO_PACKS')
packs = json.loads(obj.group(1))['packs']

only = sys.argv[1] if len(sys.argv) > 1 else None
if only and only not in packs:
    raise SystemExit(f'未知音频包: {only}')

for kind, meta in packs.items():
    if only and kind != only:
        continue
    bin_path = ROOT / meta['url'].split('?')[0]
    data = bin_path.read_bytes()
    out_dir = OUT_DIRS[kind]
    out_dir.mkdir(parents=True, exist_ok=True)
    count = 0
    for stem, (start, length) in meta['entries'].items():
        clip = data[start:start + length]
        (out_dir / f'{stem}.mp3').write_bytes(clip)
        count += 1
    print(f'{kind}: restored {count} mp3 files to {out_dir}')
