"""把 audio 下的 mp3 合并成 4 个 bin，并生成运行时清单 audio/pack-index.js。

用法：python audio/build_audio_packs.py
还原：python audio/restore_audio_packs.py
"""
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
AUDIO = ROOT / 'audio'
VERSION = 1
DIRS = {
    'en': AUDIO / 'en',
    'sentence': AUDIO / 'sentence',
    'ipa': AUDIO / 'ipa',
    'syl': AUDIO / 'syl',
}

packs = {}
for kind, folder in DIRS.items():
    files = sorted(folder.glob('*.mp3'), key=lambda p: p.name.lower())
    out = AUDIO / f'{kind}-pack.bin'
    entries = {}
    offset = 0
    with out.open('wb') as fout:
        for path in files:
            data = path.read_bytes()
            fout.write(data)
            entries[path.stem] = [offset, len(data)]
            offset += len(data)
    packs[kind] = {
        'url': f'audio/{kind}-pack.bin?v={VERSION}',
        'bytes': offset,
        'clips': len(entries),
        'entries': entries,
    }
    print(f'{kind}: {len(entries)} clips, {offset / 1024 / 1024:.2f} MB -> {out.name}')

js = ('// 静态音频包清单：bin 内是原始 mp3 字节直接拼接；entries[文件名 stem] = [offset, length]\n'
      'window.WS_AUDIO_PACKS = ' + json.dumps(
          {'version': VERSION, 'codec': 'mp3', 'packs': packs},
          ensure_ascii=False, separators=(',', ':'), sort_keys=True
      ) + ';\n')
(AUDIO / 'pack-index.js').write_text(js, encoding='utf-8', newline='\n')
print('wrote audio/pack-index.js')
