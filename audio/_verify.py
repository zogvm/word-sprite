import json, os, re

w = open('words.js', encoding='utf-8').read()
ids = open('audio/index.js', encoding='utf-8').read()
sids = open('audio/sentence-index.js', encoding='utf-8').read()
M = json.loads(ids[ids.index('{'):ids.rindex('}') + 1])
S = json.loads(sids[sids.index('{'):sids.rindex('}') + 1])
words = set(re.findall(r'\bword\s*:\s*"([^"]+)"', w))

LOW = {k.lower(): v for k, v in M.items()}

def lookup(text):
    t = str(text).replace('\u2019', "'").replace('\u2018', "'")
    t = re.sub(r'\s+', ' ', t).strip()
    u = re.sub(r'^[\s"\"\u201c\u201d(（]+|[\s"\"\u201c\u201d.,!?;:，。！？；：)）]+$', '', t)
    return M.get(t) or LOW.get(t.lower()) or M.get(u) or LOW.get(u.lower())

miss = [x for x in words if not lookup(x)]
badword = [x for x in words if lookup(x) and not os.path.exists('audio/en/' + lookup(x) + '.mp3')]

sent = set()
for m in re.findall(r'\bexample\s*:\s*"([^"]+)"', w):
    t = re.sub(r'<[^>]+>', '', m).replace('&amp;', '&').replace('&#39;', "'").replace('&apos;', "'").replace('&quot;', '"')
    t = re.sub(r'\s+', ' ', t).strip()
    if t:
        sent.add(t)
badsent = [s for s in sent if s not in S or not os.path.exists('audio/sentence/' + S[s] + '.mp3')]

print('uniqueWords=', len(words), 'missingWordIndex=', len(miss), miss[:10])
for key in ['Good night, kids!', "What's the time?", 'march', 'March']:
    print('key', repr(key), '->', M.get(key))
print('missingWordFiles=', len(badword), badword[:10])
print('uniqueSentences=', len(sent), 'badSentence=', len(badsent), badsent[:3])
print('enFiles=', len([f for f in os.listdir('audio/en') if f.endswith('.mp3')]))
print('sentenceFiles=', len([f for f in os.listdir('audio/sentence') if f.endswith('.mp3')]))
