/* 单词精灵 - 单词/例句朗读
 * 优先从静态 bin 音频包切片播放（audio/*-pack.bin + audio/pack-index.js），失败回退浏览器语音合成。
 * 需要 http/https 或 localhost 打开页面；file:// 下浏览器禁止 fetch 本地 bin。 */
window.WordAudio = (() => {
    'use strict';

    const PACKS = window.WS_AUDIO_PACKS || null;
    const packBlobs = {};
    const LOWER_AUDIO = {};
    const LOWER_SENTENCES = {};
    const RATE = { rec: 1, en: 0.9 };
    let enVoice = null;
    let audioEl = null;
    let sayToken = 0;
    let packToken = 0;
    let activeObjectUrl = null;
    let packHintShown = false;

    function buildLowerIndex(map, target) {
        if (!map) return;
        Object.keys(map).forEach(key => { target[key.toLowerCase()] = map[key]; });
    }
    buildLowerIndex(window.KW_AUDIO, LOWER_AUDIO);
    buildLowerIndex(window.KW_SENT_AUDIO, LOWER_SENTENCES);

    function pickVoice() {
        if (!('speechSynthesis' in window)) return;
        const voices = speechSynthesis.getVoices();
        enVoice = voices.find(v => /^en[-_]US/i.test(v.lang)) ||
                  voices.find(v => /^en/i.test(v.lang)) || null;
    }
    if ('speechSynthesis' in window) {
        pickVoice();
        speechSynthesis.onvoiceschanged = pickVoice;
    }

    function recFor(text) {
        if (!window.KW_AUDIO) return null;
        const t = String(text).replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();
        const u = t.replace(/^[\s"'“”(（]+|[\s"'“”.,!?;:，。！？；：)）]+$/, '');
        return KW_AUDIO[t] || LOWER_AUDIO[t.toLowerCase()] || KW_AUDIO[u] || LOWER_AUDIO[u.toLowerCase()] || null;
    }

    function sentFor(text) {
        if (!window.KW_SENT_AUDIO) return null;
        const t = String(text).replace(/\s+/g, ' ').trim();
        return KW_SENT_AUDIO[t] || LOWER_SENTENCES[t.toLowerCase()] || null;
    }

    function mark(el, on) {
        if (el && el.classList) el.classList.toggle('speaking', on);
    }

    function releaseUrl(url) {
        if (url) URL.revokeObjectURL(url);
    }

    function stop() {
        sayToken++;
        packToken++;
        if (audioEl) {
            audioEl.onended = audioEl.onerror = null;
            audioEl.pause();
        }
        releaseUrl(activeObjectUrl);
        activeObjectUrl = null;
        if ('speechSynthesis' in window) {
            try { speechSynthesis.cancel(); } catch (e) { /* 忽略 */ }
        }
        document.querySelectorAll('.speaking').forEach(el => el.classList.remove('speaking'));
    }

    function showPackHint() {
        if (packHintShown || document.getElementById('audio-pack-hint')) return;
        packHintShown = true;
        const box = document.createElement('div');
        box.id = 'audio-pack-hint';
        box.className = 'audio-pack-hint';
        box.innerHTML = '<b>离线音频包未加载</b><span>正在使用在线/设备语音；如需原录音，请双击项目里的 start-local-server.bat。</span>' +
            '<button type="button" onclick="this.parentNode.remove()">知道了</button>';
        (document.body || document.documentElement).appendChild(box);
    }

    async function packBlob(kind) {
        if (packBlobs[kind]) return packBlobs[kind];
        const pack = PACKS && PACKS.packs && PACKS.packs[kind];
        if (!pack) return null;
        let response = null;
        try {
            response = await fetch(pack.url, { cache: 'force-cache' });
        } catch (e) {
            showPackHint();
            return null;
        }
        if (!response.ok) { showPackHint(); return null; }
        const blob = await response.blob();
        packBlobs[kind] = blob;
        return blob;
    }

    async function loadPackUrl(kind, stem) {
        const pack = PACKS && PACKS.packs && PACKS.packs[kind];
        const entry = pack && pack.entries && pack.entries[stem];
        if (!entry) return null;
        const blob = await packBlob(kind);
        if (!blob) return null;
        return URL.createObjectURL(blob.slice(entry[0], entry[0] + entry[1]));
    }

    function speakTts(text, token, done) {
        if (!('speechSynthesis' in window)) { done(); return; }
        const u = new SpeechSynthesisUtterance(text);
        u.lang = 'en-US';
        u.rate = RATE.en;
        if (enVoice) u.voice = enVoice;
        let settled = false;
        let timer = 0;
        const finish = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            done();
        };
        u.onend = finish;
        u.onerror = finish;
        timer = setTimeout(finish, 4000 + text.length * 120 / u.rate);
        if (speechSynthesis.resume) speechSynthesis.resume();
        speechSynthesis.speak(u);
    }

    function networkSources(text) {
        const q = encodeURIComponent(String(text || '').trim());
        const youdao = 'https://dict.youdao.com/dictvoice?audio=' + q + '&type=2';
        const baidu = 'https://fanyi.baidu.com/gettts?lan=en&text=' + q + '&spd=3&source=web';
        return String(text || '').length > 60 ? [baidu, youdao] : [youdao, baidu];
    }

    function playNetworkVoice(text, token, done) {
        const sources = networkSources(text);
        const a = audioEl || (audioEl = new Audio());
        a.playsInline = true;
        let i = 0;
        const next = () => {
            if (token !== sayToken || i >= sources.length) { done(false); return; }
            let settled = false;
            let timer = 0;
            const fin = ok => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                a.onended = a.onerror = null;
                if (ok) { done(true); return; }
                i++;
                next();
            };
            a.onended = () => fin(true);
            a.onerror = () => fin(false);
            a.src = sources[i];
            a.playbackRate = RATE.rec;
            timer = setTimeout(() => fin(false), 8000);
            const p = a.play();
            if (p && p.catch) p.catch(() => fin(false));
        };
        next();
    }

    function fallbackVoice(text, token, done) {
        playNetworkVoice(text, token, ok => {
            if (ok) done();
            else speakTts(text, token, done);
        });
    }

    function play(text, el, lookup, kind, fallbackText) {
        stop();
        const content = String(text || '').trim();
        if (!content) return;
        const token = sayToken;
        mark(el, true);
        const done = () => { if (token === sayToken) mark(el, false); };
        const file = lookup(content);
        if (!file) {
            fallbackVoice(fallbackText || content, token, done);
            return;
        }

        const a = audioEl || (audioEl = new Audio());
        let settled = false;
        let timer = 0;
        const finish = ok => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            a.onended = a.onerror = null;
            releaseUrl(activeObjectUrl);
            activeObjectUrl = null;
            if (token !== sayToken) return;
            if (ok) done(); else fallbackVoice(fallbackText || content, token, done);
        };
        const startAudio = src => {
            a.onended = () => finish(true);
            a.onerror = () => finish(false);
            a.src = src;
            a.playbackRate = RATE.rec;
            timer = setTimeout(() => finish(false), 8000);
            const p = a.play();
            if (p && p.catch) p.catch(() => finish(false));
        };

        if (kind) {
            loadPackUrl(kind, file).then(url => {
                if (!url) { finish(false); return; }
                if (token !== sayToken) { releaseUrl(url); return; }
                activeObjectUrl = url;
                startAudio(url);
            }).catch(() => finish(false));
        } else {
            startAudio(file);
        }
    }

    function say(text, el) {
        play(text, el, recFor, 'en');
    }

    function saySentence(text, el) {
        play(text, el, sentFor, 'sentence');
    }

    function sayPack(kind, stem, el, fallbackText) {
        play(stem, el, t => t, kind, fallbackText || stem);
    }

    async function playPack(kind, stem) {
        const token = packToken;
        let url = null;
        try { url = await loadPackUrl(kind, stem); } catch (e) { return false; }
        if (!url) return false;
        if (token !== packToken) { releaseUrl(url); return false; }
        return new Promise(resolve => {
            const a = new Audio(url);
            a.playsInline = true;
            let settled = false;
            let timer = 0;
            const finish = ok => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                a.onended = a.onerror = null;
                releaseUrl(url);
                resolve(ok);
            };
            a.onended = () => finish(true);
            a.onerror = () => finish(false);
            timer = setTimeout(() => finish(false), 8000);
            const p = a.play();
            if (p && p.catch) p.catch(() => finish(false));
        });
    }

    function playPackWithToken(kind, stem, token) {
        return playPack(kind, stem);
    }

    function playText(text) {
        const token = sayToken;
        return new Promise(resolve => fallbackVoice(String(text || '').trim(), token, resolve));
    }

    function stopCurrentVoice() {
        if (audioEl) {
            audioEl.onended = audioEl.onerror = null;
            audioEl.pause();
        }
        if ('speechSynthesis' in window) {
            try { speechSynthesis.cancel(); } catch (e) { /* 忽略 */ }
        }
    }

    return { say, saySentence, sayPack, playPack, playPackWithToken, playText, stop, stopCurrentVoice, recFor, sentFor, loadPackUrl };
})();
