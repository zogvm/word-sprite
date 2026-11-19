import json, os, re, sys

MAX_WORDS = int(sys.argv[1]) if len(sys.argv) > 1 else 0
MAX_SENT = int(sys.argv[2]) if len(sys.argv) > 2 else 0

ROOT = 'c:/pt2/enggame/word-sprite-main'
AUDIO = os.path.join(ROOT, 'audio')
TOOLS = os.path.join(AUDIO, '_tools')
REF = 'c:/pt2/enggame/knowledge-map-main/knowledge-map-main/english-map'
REF_AUDIO = os.path.join(REF, 'audio')

sys.path.insert(0, TOOLS)
sys.path.insert(0, os.path.join(REF, 'docs', 'audio'))
import numpy as np
import build_audio as B
from kokoro_onnx import Kokoro

k = Kokoro(os.path.join(TOOLS, 'kokoro-v1.0.onnx'), os.path.join(TOOLS, 'voices-v1.0.bin'))


def load_js_object(path, var):
    text = open(path, encoding='utf-8').read()
    return json.loads(text[text.index('{', text.index(var)):text.rindex('}') + 1])


def normalize_word(s):
    t = str(s).replace('\u2019', "'").replace('\u2018', "'").strip()
    return re.sub(r'^[\s"\']+|[\s"\',.!?;:]+$', '', t)


def word_stem(en, used):
    s = re.sub(r'[^a-z0-9]+', '-', en.lower()).strip('-') or 'w'
    base, n = s, 2
    while s in used and used[s] != en:
        s = f'{base}-{n}'
        n += 1
    used[s] = en
    return s


def sentence_stem(s, used):
    base = re.sub(r'[\\/:*?"<>|]+', '', str(s))
    base = re.sub(r'\s+', ' ', base).strip().rstrip('. ')
    base = base[:120] or 'sentence'
    stem, n = base, 2
    while stem.lower() in used:
        stem = f'{base} ({n})'
        n += 1
    used[stem.lower()] = s
    return stem


def synth(text, path, skip=False):
    if skip and os.path.exists(path):
        return
    x, sr = k.create(text, voice=B.VOICE, speed=B.SPEED, lang='en-us', trim=False)
    t0, t1 = B.speech_span(x, sr)
    c = B.lead_cut(x, sr, t0, k.tokenizer.phonemize(text, 'en-us')) if not text.endswith(('.', '?', '!')) else t0
    peak = float(np.abs(x).max()) or 1.0
    seg = B.clip(x * (B.PEAK / peak), sr, c, t1, pre=0.03 if c == t0 else 0, post=0.12)
    B.to_mp3(seg, sr, path)


words_js = open(os.path.join(ROOT, 'words.js'), encoding='utf-8').read()
unique_words = sorted(set(m.group(1) for m in re.finditer(r'\bword\s*:\s*"([^"]+)"', words_js)))
sentences = set()
for m in re.finditer(r'\bexample\s*:\s*"([^"]+)"', words_js):
    t = re.sub(r'<[^>]+>', '', m.group(1))
    t = t.replace('&amp;', '&').replace('&apos;', "'").replace('&#39;', "'").replace('&quot;', '"')
    t = re.sub(r'\s+', ' ', t).strip()
    if t:
        sentences.add(t)
sentences = sorted(sentences)

base_map = load_js_object(os.path.join(REF_AUDIO, 'index.js'), 'KW_AUDIO')
lower = {w.lower() for w in base_map}
missing = [w for w in unique_words if normalize_word(w).lower() not in lower]
if MAX_WORDS:
    missing = missing[:MAX_WORDS]
if MAX_SENT:
    sentences = sentences[:MAX_SENT]

en_dir = os.path.join(AUDIO, 'en')
sent_dir = os.path.join(AUDIO, 'sentence')
os.makedirs(en_dir, exist_ok=True)
os.makedirs(sent_dir, exist_ok=True)
for f in os.listdir(sent_dir):
    if f.endswith('.mp3'):
        os.remove(os.path.join(sent_dir, f))

used = {}
for en, stem in base_map.items():
    used[stem] = en
for i, en in enumerate(missing, 1):
    stem = word_stem(en, used)
    synth(B.spoken(en), os.path.join(en_dir, stem + '.mp3'))
    base_map[en] = stem
    if i % 50 == 0:
        print('words', i, '/', len(missing), en, flush=True)

index_js = ('// 英文单词录音索引：Kokoro af_heart（Apache-2.0），语速 0.9；由 audio/_kokoro_gen.py 生成\n'
            'window.KW_AUDIO = ' + json.dumps(base_map, ensure_ascii=False, separators=(',', ':'), sort_keys=True) + ';\n')
open(os.path.join(AUDIO, 'index.js'), 'w', encoding='utf-8', newline='\n').write(index_js)

sent_index = {}
sent_used = {}
for i, s in enumerate(sentences, 1):
    stem = sentence_stem(s, sent_used)
    synth(s, os.path.join(sent_dir, stem + '.mp3'), skip=True)
    sent_index[s] = stem
    if i % 200 == 0:
        print('sentences', i, '/', len(sentences), flush=True)

sent_js = ('// 英文例句录音索引：句子 -> audio/sentence/<句子>.mp3（Kokoro af_heart，Apache-2.0，语速 0.9）\n'
           'window.KW_SENT_AUDIO = ' + json.dumps(sent_index, ensure_ascii=False, separators=(',', ':'), sort_keys=True) + ';\n')
open(os.path.join(AUDIO, 'sentence-index.js'), 'w', encoding='utf-8', newline='\n').write(sent_js)
print('DONE words', len(missing), 'sentences', len(sentences), flush=True)
