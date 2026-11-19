/**
 * 单词精灵 - 主应用逻辑
 * 核心特色：养精灵 + 间隔重复 + 趣味挑战
 */
const App = (() => {
    // ===== 数据状态 =====
    const STORAGE_KEY = 'word_sprite_data';        // 老版本单账号数据，仅用于迁移
    const ACCOUNT_PREFIX = 'word_sprite_account_'; // 浏览器缓存（降级/离线用）
    const LAST_ACCOUNT_KEY = 'word_sprite_last_account';
    const FILES_DB = 'word_sprite_files';          // 保存 FileSystemHandle
    const SAVE_DIR_NAME = 'SAVE';                  // index.html 同目录下的保存目录
    const ROOT_KEY = '__save_root__';              // 已授权的 index.html 所在目录句柄
    let currentAccount = null;
    let accountHandle = null;
    let saveRootHandle = null;
    let diskWriteTimer = null;
    let state = defaultState();

    // 迁移老数据并恢复上次账号
    (function restoreSession() {
        let legacy = null;
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) legacy = normalizeState(JSON.parse(raw));
        } catch (e) { /* 忽略损坏数据 */ }
        if (legacy && legacy.userName) {
            writeCache(legacy.userName, legacy);
            try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* 忽略 */ }
        }
        try { currentAccount = localStorage.getItem(LAST_ACCOUNT_KEY); } catch (e) { /* 忽略 */ }
        if (!currentAccount && legacy && legacy.userName) currentAccount = legacy.userName;
        if (currentAccount) state = readCache(currentAccount) || legacy || defaultState();
    })();

    // Restore sidebar state
    const sidebarState = localStorage.getItem('word_sprite_sidebar');
    if (sidebarState === 'collapsed') document.body.classList.add('sidebar-collapsed');

    // 精灵进化表
    const PET_EVOLUTION = {
        fire: ['🥚', '🐣', '🐤', '🐦', '🦅', '🐉'],
        water: ['🥚', '🐣', '🐟', '🐠', '🐬', '🐋'],
        leaf:  ['🥚', '🐣', '🐛', '🦋', '🦚', '🦄']
    };
    const PET_NAMES = {
        fire:  ['火焰蛋', '小火苗', '火焰雏', '火焰鸟', '烈焰鹰', '烈焰龙'],
        water: ['水滴蛋', '小水滴', '小鱼苗', '小锦鲤', '海豚灵', '海洋之心'],
        leaf:  ['叶子蛋', '小嫩芽', '叶毛虫', '花蝴蝶', '孔雀灵', '森林精灵']
    };
    const MOODS = ['开心极了！', '状态不错~', '心情还好', '有点无聊...', '想你了！快来学习吧'];

    // 成就系统
    const ACHIEVEMENTS = [
        { id: 'first', emoji: '🌟', name: '初出茅庐', desc: '学完第一个词', check: s => s.totalLearned >= 1 },
        { id: 'ten', emoji: '🎯', name: '小有所成', desc: '学会10个词', check: s => s.totalLearned >= 10 },
        { id: 'fifty', emoji: '🏅', name: '词汇达人', desc: '学会50个词', check: s => s.totalLearned >= 50 },
        { id: 'hundred', emoji: '👑', name: '百词斩', desc: '学会100个词', check: s => s.totalLearned >= 100 },
        { id: 'streak3', emoji: '🔥', name: '三天小灶', desc: '连续学习3天', check: s => s.streak >= 3 },
        { id: 'streak7', emoji: '💪', name: '坚持不懈', desc: '连续学习7天', check: s => s.streak >= 7 },
        { id: 'streak30', emoji: '🏆', name: '习惯养成', desc: '连续学习30天', check: s => s.streak >= 30 },
        { id: 'perfect', emoji: '💯', name: '全对达人', desc: '复习全对一次', check: s => s.perfectReviews >= 1 },
        { id: 'fast', emoji: '⚡', name: '闪电手', desc: '挑战赛得分>50', check: s => s.bestChallengeScore >= 50 },
        { id: 'master', emoji: '🎓', name: '单词大师', desc: '掌握50个词', check: s => s.masteredCount >= 50 },
        { id: 'energy', emoji: '⚡', name: '能量满满', desc: '累计获得100能量', check: s => s.totalEnergy >= 100 },
        { id: 'egg', emoji: '🥚', name: '破壳而出', desc: '精灵孵化', check: s => s.petLevel >= 1 },
    ];

    // ===== 状态管理 =====
    function defaultState() {
        return {
            userName: '',
            grade: 4,
            textbook: 'PEP_4上',
            petType: null,
            petLevel: 0,
            petExp: 0,
            energy: 0,
            totalEnergy: 0,
            streak: 0,
            lastStudyDate: null,
            words: {},
            totalLearned: 0,
            masteredCount: 0,
            perfectReviews: 0,
            bestChallengeScore: 0,
            achievements: [],
            dailyStats: {},
            dailyGoal: 10,
            dailyLearned: 0,
            todayKey: getTodayKey(),
            setupDone: false,
            visitLog: {},
            yinbiao: {},
            updatedAt: 0,
        };
    }

    function normalizeState(parsed) {
        if (!parsed || typeof parsed !== 'object') return defaultState();
        if (!parsed.textbook && parsed.grade) parsed.textbook = `PEP_${parsed.grade}上`;
        // 老存档：首次学习曾把复习安排在 24 小时后，导致当天“待复习”为 0。
        // 迁移为学完立即可复习；后续间隔仍由复习评分重新计算。
        if (parsed.words && typeof parsed.words === 'object') {
            const now = Date.now();
            Object.values(parsed.words).forEach(ws => {
                if (ws && typeof ws === 'object' && ws.correctStreak === undefined) ws.correctStreak = 0;
                if (ws && ws.status && ws.status !== 'new' && (ws.repetitions || 0) <= 1 &&
                    ws.lastReview && ws.nextReview > now) {
                    ws.nextReview = Number(ws.lastReview);
                }
            });
        }
        return { ...defaultState(), ...parsed };
    }

    function cacheKey(name) {
        return ACCOUNT_PREFIX + encodeURIComponent(name);
    }

    function readCache(name) {
        if (!name) return null;
        try {
            const raw = localStorage.getItem(cacheKey(name));
            return raw ? normalizeState(JSON.parse(raw)) : null;
        } catch (e) { return null; }
    }

    function writeCache(name, data) {
        if (!name) return;
        try {
            localStorage.setItem(cacheKey(name), JSON.stringify(data));
            localStorage.setItem(LAST_ACCOUNT_KEY, name);
        } catch (e) { /* 忽略存储配额错误 */ }
    }

    function listAccounts() {
        const names = new Set();
        try {
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith(ACCOUNT_PREFIX)) {
                    const name = decodeURIComponent(key.slice(ACCOUNT_PREFIX.length));
                    if (name) names.add(name);
                }
            }
        } catch (e) { /* 忽略 */ }
        if (currentAccount) names.add(currentAccount);
        return [...names].sort((a, b) => a.localeCompare(b, 'zh-CN'));
    }

    function saveState() {
        state.todayKey = getTodayKey();
        state.updatedAt = Date.now();
        writeCache(currentAccount, state);
        scheduleDiskWrite();
    }

    function safeFileName(name) {
        return String(name).replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);
    }

    // ===== 磁盘文件（File System Access API，仅 Chrome/Edge） =====
    const AccountFiles = (() => {
        let dbPromise = null;
        function open() {
            if (!('indexedDB' in window)) return Promise.resolve(null);
            if (dbPromise) return dbPromise;
            dbPromise = new Promise(resolve => {
                const req = indexedDB.open(FILES_DB, 1);
                req.onupgradeneeded = () => {
                    if (!req.result.objectStoreNames.contains('handles')) req.result.createObjectStore('handles');
                };
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => resolve(null);
            });
            return dbPromise;
        }
        return {
            get(name) {
                return open().then(db => {
                    if (!db) return null;
                    return new Promise(resolve => {
                        const req = db.transaction('handles', 'readonly').objectStore('handles').get(name);
                        req.onsuccess = () => resolve(req.result || null);
                        req.onerror = () => resolve(null);
                    });
                });
            },
            set(name, handle) {
                return open().then(db => {
                    if (!db) return;
                    return new Promise(resolve => {
                        const tx = db.transaction('handles', 'readwrite');
                        tx.objectStore('handles').put(handle, name);
                        tx.oncomplete = () => resolve();
                        tx.onerror = () => resolve();
                    });
                });
            },
            getRoot() { return this.get(ROOT_KEY); },
            setRoot(handle) { return this.set(ROOT_KEY, handle); }
        };
    })();

    function dirSupported() {
        return typeof window.showDirectoryPicker === 'function';
    }

    function diskSupported() {
        return dirSupported() || typeof window.showSaveFilePicker === 'function';
    }

    async function hasPermission(handle, mode) {
        if (!handle) return false;
        if (!handle.queryPermission) return true;
        try { return (await handle.queryPermission({ mode })) === 'granted'; } catch (e) { return false; }
    }

    async function requestPermission(handle, mode) {
        if (!handle || !handle.requestPermission) return false;
        try { return (await handle.requestPermission({ mode })) === 'granted'; } catch (e) { return false; }
    }

    async function getSaveDir(create) {
        if (!saveRootHandle || !(await hasPermission(saveRootHandle, 'readwrite'))) return null;
        try { return await saveRootHandle.getDirectoryHandle(SAVE_DIR_NAME, { create: !!create }); }
        catch (e) { return null; }
    }

    async function getAccountFileHandle(name, create) {
        const dir = await getSaveDir(create);
        if (!dir) return null;
        try { return await dir.getFileHandle(`${safeFileName(name)}.json`, { create: !!create }); }
        catch (e) { return null; }
    }

    async function ensureHandle(name, mode = 'readwrite') {
        let handle = accountHandle;
        if (!handle) handle = await AccountFiles.get(name);
        if (!handle) return null;
        if (!(await hasPermission(handle, mode))) {
            if (!(await requestPermission(handle, mode))) return null;
        }
        accountHandle = handle;
        return handle;
    }

    async function writeAccountFile(handle, data) {
        const writable = await handle.createWritable();
        try {
            await writable.write(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
        } finally {
            await writable.close();
        }
    }

    async function flushToDisk() {
        if (!currentAccount) return;
        clearTimeout(diskWriteTimer);
        let handle = await getAccountFileHandle(currentAccount, true);
        if (!handle) handle = await ensureHandle(currentAccount, 'readwrite');
        if (!handle) return;
        try {
            await writeAccountFile(handle, state);
            accountHandle = handle;
        } catch (e) {
            showToast('保存到磁盘失败：' + ((e && e.message) || e), 'warning');
        }
    }

    function scheduleDiskWrite() {
        if (!saveRootHandle && !accountHandle) return; // 没有授权目录/文件时不要弹窗打扰
        clearTimeout(diskWriteTimer);
        diskWriteTimer = setTimeout(flushToDisk, 400);
    }

    async function createAccountFile(name) {
        if (!diskSupported()) return null;
        const handle = await window.showSaveFilePicker({
            suggestedName: `${safeFileName(name)}.json`,
            types: [{ description: 'JSON 文件', accept: { 'application/json': ['.json'] } }]
        });
        accountHandle = handle;
        await AccountFiles.set(name, handle);
        return handle;
    }

    // 让用户授权选择 index.html 所在文件夹；之后自动用其中的 SAVE/账号名.json 保存
    async function linkSaveFolder(opts = {}) {
        if (!dirSupported()) {
            if (!opts.silent) showToast('当前浏览器不支持选择文件夹，请用「导出 JSON」', 'warning');
            return false;
        }
        try {
            if (saveRootHandle) {
                let ready = await hasPermission(saveRootHandle, 'readwrite');
                if (!ready) ready = await requestPermission(saveRootHandle, 'readwrite');
                if (ready) {
                    await saveRootHandle.getDirectoryHandle(SAVE_DIR_NAME, { create: true });
                    await flushToDisk();
                    updateSaveStatus();
                    if (!opts.silent) showToast('已恢复 SAVE 目录授权，修改会自动保存', 'success');
                    return true;
                }
            }
            const handle = await window.showDirectoryPicker({ id: 'word-sprite-save-dir', mode: 'readwrite' });
            saveRootHandle = handle;
            await AccountFiles.setRoot(handle);
            const dir = await handle.getDirectoryHandle(SAVE_DIR_NAME, { create: true });
            if (!opts.silent) showToast(`已连接 ${dir.name} 目录，修改会自动保存`, 'success');
            await flushToDisk();
            updateSaveStatus();
            return true;
        } catch (e) {
            if (!(e && e.name === 'AbortError') && !opts.silent) {
                showToast('连接目录失败：' + ((e && e.message) || e), 'warning');
            }
            return false;
        }
    }

    async function updateSaveStatus() {
        const el = document.getElementById('save-status');
        if (!el) return;
        if (!saveRootHandle) {
            el.textContent = '未连接 SAVE 目录（点「立即保存到SAVE」选择）';
        } else if (await hasPermission(saveRootHandle, 'readwrite')) {
            el.textContent = `自动保存：${SAVE_DIR_NAME}/账号名.json`;
        } else {
            el.textContent = 'SAVE 目录需重新授权（点下方按钮）';
        }
    }

    async function readDiskAccount(name, allowPrompt) {
        if (!name) return null;
        if (saveRootHandle) {
            if (!(await hasPermission(saveRootHandle, 'readwrite')) && allowPrompt) {
                await requestPermission(saveRootHandle, 'readwrite');
            }
            const handle = await getAccountFileHandle(name, false);
            if (handle) {
                accountHandle = handle;
                try {
                    const file = await handle.getFile();
                    return normalizeState(JSON.parse(await file.text()));
                } catch (e) { /* 文件损坏时再尝试旧的单文件句柄 */ }
            }
        }
        const legacy = await AccountFiles.get(name);
        if (!legacy) return null;
        if (!(await hasPermission(legacy, 'readwrite'))) {
            if (!allowPrompt || !(await requestPermission(legacy, 'readwrite'))) return null;
        }
        accountHandle = legacy;
        try {
            const file = await legacy.getFile();
            return normalizeState(JSON.parse(await file.text()));
        } catch (e) { return null; }
    }

    function dateKey(d) {
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    function getTodayKey() {
        return dateKey(new Date());
    }

    function getYesterdayKey() {
        const d = new Date();
        d.setDate(d.getDate() - 1);
        return dateKey(d);
    }

    // ===== 访问统计 =====
    function trackVisit() {
        const today = getTodayKey();
        if (!state.visitLog) state.visitLog = {};
        if (!state.visitLog[today]) {
            state.visitLog[today] = { visits: 0, firstVisit: Date.now() };
        }
        state.visitLog[today].visits++;
        // 只保留最近 90 天的日志
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 90);
        const cutoffKey = cutoff.toISOString().split('T')[0];
        Object.keys(state.visitLog).forEach(k => {
            if (k < cutoffKey) delete state.visitLog[k];
        });
        saveState();
    }

    function getVisitStats() {
        const log = state.visitLog || {};
        const days = Object.keys(log).length;
        const totalVisits = Object.values(log).reduce((s, d) => s + (d.visits || 0), 0);
        const today = getTodayKey();
        const todayVisits = log[today] ? log[today].visits : 0;
        return { days, totalVisits, todayVisits, log };
    }

    // ===== 间隔重复算法 (SM-2变体) =====
    function calculateNextReview(wordState, quality) {
        let { ease = 2.5, interval = 0, repetitions = 0 } = wordState;

        if (quality < 3) {
            repetitions = 0;
            interval = 1;
        } else {
            if (repetitions === 0) interval = 1;
            else if (repetitions === 1) interval = 3;
            else interval = Math.round(interval * ease);
            repetitions++;
        }

        ease = Math.max(1.3, ease + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)));

        const nextReview = Date.now() + interval * 24 * 60 * 60 * 1000;

        return {
            ...wordState,
            ease,
            interval,
            repetitions,
            nextReview,
            lastReview: Date.now(),
        };
    }

    function getWordState(word) {
        const key = `${state.textbook}_${word}`;
        return state.words[key] || {
            word,
            status: 'new',
            ease: 2.5,
            interval: 0,
            repetitions: 0,
            correctStreak: 0,
            nextReview: 0,
            lastReview: 0,
        };
    }

    // ===== 单词获取 =====
    function getWordsForTextbook() {
        const book = WORD_DB[state.textbook];
        if (!book) return [];
        // 返回所有单元的词汇合并
        const allWords = [];
        for (const unit of Object.values(book.units)) {
            allWords.push(...unit.words);
        }
        return allWords;
    }

    function getAllLearnedWords() {
        const details = new Map();
        Object.values(WORD_DB).forEach(book => {
            Object.values(book.units).forEach(unit => {
                unit.words.forEach(w => {
                    const key = String(w.word || '').toLowerCase();
                    if (key && !details.has(key)) details.set(key, w);
                });
            });
        });
        const seen = new Set();
        const list = [];
        Object.values(state.words || {}).forEach(ws => {
            const key = String((ws && ws.word) || '').toLowerCase();
            if (!key || seen.has(key) || !ws || ws.status === 'new' || !details.has(key)) return;
            seen.add(key);
            list.push(details.get(key));
        });
        return list;
    }

    function getNewWords() {
        const words = getWordsForTextbook();
        return words.filter(w => {
            const ws = getWordState(w.word);
            return ws.status === 'new';
        });
    }

    function getReviewWords() {
        const now = Date.now();
        const words = getWordsForTextbook();
        return words.filter(w => {
            const ws = getWordState(w.word);
            return ws.status !== 'new' && ws.nextReview <= now;
        });
    }

    // ===== 侧边栏管理 =====
    function updateSidebar() {
        // 更新侧边栏用户信息
        const sidebarAvatar = document.getElementById('sidebar-avatar');
        const sidebarUsername = document.getElementById('sidebar-username');
        if (sidebarAvatar) sidebarAvatar.textContent = getPetEmoji();
        if (sidebarUsername) sidebarUsername.textContent = state.userName || currentAccount || '未登录';
    }

    function highlightNav(screenId) {
        const navId = screenId === 'spell-screen' ? 'challenge-select-screen' : screenId;
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.remove('active');
            if (item.dataset.screen === navId) {
                item.classList.add('active');
            }
        });
    }

    // ===== 音标课 / 自然拼读 =====
    function getYinbiaoProgress() {
        if (!state.yinbiao || typeof state.yinbiao !== 'object') state.yinbiao = {};
        return state.yinbiao;
    }

    function setYinbiaoProgress(all) {
        state.yinbiao = all || {};
        saveState();
    }

    function openPhonics(word) {
        if (!word || !window.KWPhonics) return false;
        return KWPhonics.open(word, '', { autoplay: true });
    }

    function renderPhonicsScreen() {
        const list = document.getElementById('phonics-list');
        if (!list || !window.KW_PHONICS) return;
        const words = Object.keys(KW_PHONICS);
        list.innerHTML = words.map(w =>
            `<button type="button" class="phonics-chip" data-word="${escapeHtml(w)}">${escapeHtml(w)}</button>`
        ).join('');
        list.querySelectorAll('.phonics-chip').forEach(btn => {
            btn.onclick = () => openPhonics(btn.dataset.word);
        });
    }

    // ===== 屏幕管理 =====
    function showScreen(id) {
        const currentActive = document.querySelector('.screen.active');
        const target = document.getElementById(id);
        if (!target || (currentActive && currentActive.id === id)) return;
        closeAccountMenu();
        if (window.YBAdventure && id !== 'yb-adventure-screen') window.YBAdventure.stop();
        if (window.WordAudio) WordAudio.stop();

        if (currentActive) {
            currentActive.classList.add('screen-exit');
            setTimeout(() => {
                currentActive.classList.remove('active', 'screen-exit');
            }, 200);
        }

        setTimeout(() => {
            target.classList.add('active', 'screen-enter');
            setTimeout(() => target.classList.remove('screen-enter'), 400);
        }, currentActive ? 150 : 0);

        // Setup mode
        const setupScreens = ['splash-screen', 'name-screen', 'egg-screen', 'textbook-screen'];
        if (setupScreens.includes(id)) {
            document.body.classList.add('setup-mode');
        } else {
            document.body.classList.remove('setup-mode');
        }

        highlightNav(id);
        updateSidebar();

        if (id === 'home-screen') updateHome();
        if (id === 'stats-screen') updateStats();
        if (id === 'wordbook-screen') {
            renderUnitTabs();
            renderWordbook();
        }
        if (id === 'profile-screen') updateProfile();
        if (id === 'phonics-screen') renderPhonicsScreen();
        if (id === 'yb-screen' && window.YinbiaoCourse) YinbiaoCourse.refresh();
        if (id === 'yb-adventure-screen' && window.YBAdventure) window.YBAdventure.showHome();
        if (id === 'yb-valley-screen' && window.YBValley) window.YBValley.refresh();
        if (id === 'textbook-screen') {
            renderTextbookGrid('textbook-grid', 'PEP', 'selectTextbook');
        }
    }

    // ===== 应用启动 =====
    // 页面加载引导：已完成的用户直接进首页，新用户停留在启动页等待点击「开始冒险」
    async function boot() {
        saveRootHandle = await AccountFiles.getRoot();
        updateSaveStatus();
        scheduleMidnightRefresh();
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                checkStreak();
                scheduleMidnightRefresh();
            }
        });
        if (!currentAccount) return;
        const disk = await readDiskAccount(currentAccount, false);
        if (disk && (disk.updatedAt || 0) >= (state.updatedAt || 0)) {
            state = disk;
            writeCache(currentAccount, state);
        }
        saveState(); // 持久化老存档的“学完立即可复习”迁移
        updateSidebar();
        if (state.setupDone) start();
        else showScreen('name-screen');
    }

    function start() {
        trackVisit();
        if (!state.setupDone) {
            showScreen('name-screen');
        } else {
            checkStreak();
            showScreen('home-screen');
        }
    }

    async function setName() {
        const name = document.getElementById('user-name').value.trim();
        if (!name) {
            document.getElementById('user-name').style.borderColor = '#E74C3C';
            return;
        }

        if (listAccounts().includes(name) && name !== currentAccount) {
            const ok = await showConfirm('账号已存在', `账号「${name}」已存在，是否切换到该账号？`);
            if (ok) await switchAccount(name);
            else showToast('请换一个名字', 'warning');
            return;
        }

        await flushToDisk();
        currentAccount = name;
        state = { ...defaultState(), userName: name };
        accountHandle = null;

        if (dirSupported()) {
            if (!saveRootHandle || !(await hasPermission(saveRootHandle, 'readwrite'))) {
                await linkSaveFolder({ silent: true });
            }
            if (!(await hasPermission(saveRootHandle, 'readwrite'))) {
                showToast('未连接 SAVE 目录，已暂存浏览器缓存，可在账号菜单连接或导出', 'warning');
            }
        } else if (diskSupported()) {
            try {
                await createAccountFile(name);
            } catch (e) {
                accountHandle = null;
                if (!(e && e.name === 'AbortError')) {
                    showToast('未连接磁盘文件，已暂存浏览器缓存，可在账号菜单导出', 'warning');
                }
            }
        } else {
            showToast('当前浏览器不支持直接写磁盘，已暂存浏览器缓存，可在账号菜单导出', 'warning');
        }

        saveState();
        await flushToDisk();
        document.getElementById('user-name').style.borderColor = '';
        document.getElementById('egg-greeting').textContent = `${name}，选一只精灵蛋吧！`;
        showScreen('egg-screen');
    }

    function choosePet(type) {
        state.petType = type;
        saveState();

        const eggEl = document.querySelector('.pet-emoji');
        if (eggEl) eggEl.style.animation = 'hatch 0.8s ease';

        // 选完精灵后进入教材选择
        showScreen('textbook-screen');
    }

    function selectTextbook(textbook) {
        state.textbook = textbook;
        const book = WORD_DB[textbook];
        if (book) state.grade = book.grade;
        state.setupDone = true;
        saveState();
        showScreen('home-screen');
    }

    // ===== 今日推荐单词 =====
    let _dailyWord = null;

    function getDailyWord() {
        const allWords = getWordsForTextbook();
        if (allWords.length === 0) return null;
        // 基于日期生成稳定的索引
        const today = getTodayKey();
        let hash = 0;
        for (let i = 0; i < today.length; i++) {
            hash = ((hash << 5) - hash) + today.charCodeAt(i);
            hash |= 0;
        }
        const idx = Math.abs(hash) % allWords.length;
        return allWords[idx];
    }

    function renderDailyWord() {
        const word = getDailyWord();
        if (!word) return;
        _dailyWord = word;

        document.getElementById('daily-word-emoji').textContent = word.emoji;
        document.getElementById('daily-word-en').textContent = word.word;
        document.getElementById('daily-word-cn').textContent = word.meaning;

        const ws = getWordState(word.word);
        const statusEl = document.getElementById('daily-word-status');
        if (ws.status === 'mastered') {
            statusEl.textContent = '已掌握';
            statusEl.className = 'daily-word-status mastered-word';
        } else if (ws.status === 'learning') {
            statusEl.textContent = '学习中';
            statusEl.className = 'daily-word-status learning-word';
        } else {
            statusEl.textContent = '新发现';
            statusEl.className = 'daily-word-status new-word';
        }
    }

    function speakDailyWord() {
        WordAudio.say(_dailyWord && _dailyWord.word, document.getElementById('btn-daily-speak'));
    }

    // ===== 精灵互动 =====
    const PET_REACTIONS = {
        feed: ['好饱好饱~', '真好吃！', '吃饱了有力气学习！', '谢谢投喂~'],
        pet: ['好舒服~', '嘻嘻~', '还要还要！', '最喜欢你了！'],
        play: ['好开心！', '再来一次！', '太好玩了~', '冲冲冲！'],
    };

    function interactPet(action) {
        if (state.energy < 3) {
            const el = document.getElementById('pet-reaction-text');
            el.textContent = '💤 能量不足，快去学习吧！';
            el.style.color = '#E67E22';
            return;
        }

        state.energy -= 3;
        saveState();
        document.getElementById('energy-count').textContent = state.energy;

        const reactions = PET_REACTIONS[action] || PET_REACTIONS.play;
        const reaction = reactions[Math.floor(Math.random() * reactions.length)];
        const el = document.getElementById('pet-reaction-text');
        el.textContent = reaction;
        el.style.color = '';

        // 精灵动画反馈
        const petEl = document.getElementById('pet-emoji');
        petEl.style.animation = 'none';
        petEl.offsetHeight; // 触发重排
        petEl.style.animation = action === 'feed' ? 'bounce 0.6s ease' :
                                action === 'pet' ? 'pulse 0.6s ease' : 'hatch 0.6s ease';
        setTimeout(() => {
            petEl.style.animation = 'wobble 4s ease-in-out infinite';
        }, 700);
    }

    // ===== 最近成就 =====
    function renderRecentAchievements() {
        const container = document.getElementById('achievement-list');
        container.innerHTML = '';

        if (state.achievements.length === 0) {
            container.innerHTML = '<div class="achievement-empty">继续学习解锁成就吧~</div>';
            return;
        }

        // 取最近3个成就
        const recent = state.achievements.slice(-3).reverse();
        recent.forEach(id => {
            const ach = ACHIEVEMENTS.find(a => a.id === id);
            if (!ach) return;
            const row = document.createElement('div');
            row.className = 'achievement-row';
            row.innerHTML = `
                <span class="ach-r-emoji">${ach.emoji}</span>
                <span class="ach-r-name">${ach.name}</span>
                <span class="ach-r-tag">已解锁</span>
            `;
            container.appendChild(row);
        });
    }

    // ===== 精灵系统 =====
    function getPetEmoji() {
        if (!state.petType) return '🥚';
        const evolutions = PET_EVOLUTION[state.petType];
        const idx = Math.min(state.petLevel, evolutions.length - 1);
        return evolutions[idx];
    }

    function getPetName() {
        if (!state.petType) return '精灵蛋';
        const names = PET_NAMES[state.petType];
        const nameIdx = Math.min(state.petLevel, names.length - 1);
        return names[nameIdx];
    }

    function getPetMood() {
        const daysSince = state.lastStudyDate ?
            Math.floor((Date.now() - new Date(state.lastStudyDate).getTime()) / 86400000) : 999;
        if (daysSince === 0) return MOODS[0];
        if (daysSince === 1) return MOODS[2];
        if (daysSince >= 2) return MOODS[4];
        return MOODS[1];
    }

    function addExp(amount) {
        state.petExp += amount;
        state.totalEnergy += amount;
        state.energy += amount;

        const newLevel = Math.floor(state.petExp / 50);
        if (newLevel > state.petLevel) {
            state.petLevel = newLevel;
            state._pendingLevelUp = true;
        }

        saveState();
    }

    function checkPendingLevelUp() {
        if (state._pendingLevelUp) {
            state._pendingLevelUp = false;
            saveState();
            showCelebration('levelup');
            return true;
        }
        return false;
    }

    // ===== 连续天数 =====
    function checkStreak() {
        const today = getTodayKey();
        const yesterday = getYesterdayKey();
        let changed = false;

        if (state.todayKey !== today) {
            state.todayKey = today;
            state.dailyLearned = 0;
            changed = true;
        }
        if (state.lastStudyDate !== today && state.lastStudyDate !== yesterday) {
            state.streak = 0;
            changed = true;
        }

        if (!changed) return;
        saveState();
        const home = document.getElementById('home-screen');
        if (home && home.classList.contains('active')) updateHome();
    }

    let dailyRefreshTimer = null;
    function scheduleMidnightRefresh() {
        clearTimeout(dailyRefreshTimer);
        const now = new Date();
        const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 500);
        const delay = Math.max(1000, next.getTime() - now.getTime());
        dailyRefreshTimer = setTimeout(() => {
            checkStreak();
            scheduleMidnightRefresh();
        }, delay);
    }

    function markStudyToday() {
        const today = getTodayKey();
        if (state.lastStudyDate !== today) {
            state.streak = (state.lastStudyDate === getYesterdayKey()) ? state.streak + 1 : 1;
            state.lastStudyDate = today;
        }
    }

    // ===== 首页更新 =====
    function updateHome() {
        document.getElementById('home-user-name').textContent = state.userName || '小朋友';
        document.getElementById('home-streak').textContent = `🔥 ${state.streak}天`;

        // 显示当前教材信息
        const book = WORD_DB[state.textbook];
        const textbookTag = document.getElementById('home-textbook-tag');
        if (textbookTag && book) {
            textbookTag.textContent = `📖 ${book.name}`;
        }

        // 精灵
        document.getElementById('pet-emoji').textContent = getPetEmoji();
        document.getElementById('pet-name-tag').textContent = getPetName();
        document.getElementById('pet-mood').textContent = getPetMood();

        // 经验条
        const level = state.petLevel + 1;
        const expInLevel = state.petExp % 50;
        document.getElementById('exp-bar').style.width = `${(expInLevel / 50) * 100}%`;
        document.getElementById('exp-text').textContent = `Lv.${level}`;
        document.getElementById('energy-count').textContent = state.energy;

        // 按钮计数
        const newWords = getNewWords();
        const reviewWords = getReviewWords();
        document.getElementById('new-word-count').textContent = `${newWords.length}个新词`;
        document.getElementById('review-count').textContent = `${reviewWords.length}个待复习`;
        document.getElementById('total-words').textContent = `已学${state.totalLearned}词`;

        // 今日目标
        const progress = Math.min(state.dailyLearned / state.dailyGoal, 1);
        document.getElementById('goal-fill').style.width = `${progress * 100}%`;
        document.getElementById('goal-text').textContent = `${state.dailyLearned}/${state.dailyGoal} 词`;

        // 快速统计
        updateQuickStats();

        // 今日推荐单词
        renderDailyWord();

        // 最近成就
        renderRecentAchievements();

        checkAchievements();
    }

    function updateQuickStats() {
        const qsLearned = document.getElementById('qs-learned');
        const qsMastered = document.getElementById('qs-mastered');
        const qsStreak = document.getElementById('qs-streak');
        const qsAccuracy = document.getElementById('qs-accuracy');

        if (qsLearned) qsLearned.textContent = state.totalLearned;
        if (qsMastered) qsMastered.textContent = state.masteredCount;
        if (qsStreak) qsStreak.textContent = state.streak;

        let totalCorrect = 0, totalAttempts = 0;
        Object.values(state.dailyStats).forEach(d => {
            totalCorrect += d.correct || 0;
            totalAttempts += d.total || 0;
        });
        const accuracy = totalAttempts > 0 ? Math.round((totalCorrect / totalAttempts) * 100) : 0;
        if (qsAccuracy) qsAccuracy.textContent = `${accuracy}%`;
    }

    // ===== 学习模式 =====
    let learnQueue = [];
    let learnIndex = 0;

    function startLearn() {
        const newWords = getNewWords();
        if (newWords.length === 0) {
            showToast('今天的新词都学完啦！去复习吧~', 'warning');
            return;
        }

        learnQueue = shuffle(newWords).slice(0, 5);
        learnIndex = 0;
        renderLearnProgress();
        showLearnCard();
        showScreen('learn-screen');
    }

    function renderLearnProgress() {
        const container = document.getElementById('learn-progress');
        container.innerHTML = '';
        for (let i = 0; i < learnQueue.length; i++) {
            const dot = document.createElement('div');
            dot.className = 'progress-dot' +
                (i < learnIndex ? ' done' : '') +
                (i === learnIndex ? ' current' : '');
            container.appendChild(dot);
        }
    }

    function showLearnCard() {
        if (learnIndex >= learnQueue.length) {
            finishLearn();
            return;
        }

        const word = learnQueue[learnIndex];
        document.getElementById('learn-emoji').textContent = word.emoji;
        document.getElementById('learn-word').textContent = word.word;
        document.getElementById('learn-phonetic').textContent = word.phonetic;
        const posEl = document.getElementById('learn-pos');
        const pos = window.WORD_POS_EXACT && (WORD_POS_EXACT[word.word.toLowerCase()] ||
            WORD_POS_EXACT[word.word.toLowerCase().split(/\s+/).pop()]);
        posEl.textContent = formatPosLabel(pos);
        posEl.classList.toggle('hidden', !pos);
        document.getElementById('learn-meaning').classList.add('hidden');
        document.getElementById('learn-syllables').classList.add('hidden');
        document.getElementById('learn-forms-row').classList.add('hidden');
        document.getElementById('learn-example-cn').classList.add('hidden');
        document.getElementById('learn-example-row').classList.add('hidden');
        document.getElementById('learn-extra-section').classList.add('hidden');
        document.getElementById('btn-show-answer').classList.remove('hidden');
        document.getElementById('rate-buttons').classList.add('hidden');

        renderLearnProgress();
    }

    function showAnswer() {
        const word = learnQueue[learnIndex];
        document.getElementById('learn-meaning').textContent = word.meaning;
        document.getElementById('learn-meaning').classList.remove('hidden');
        renderLearnSyllables(word.word);

        const extra = getCardExtra(word.word);
        const hasForms = renderFormsInto(word, document.getElementById('learn-forms'));
        document.getElementById('learn-forms-row').classList.toggle('hidden', !hasForms || !!extra);

        if (!extra) {
            document.getElementById('learn-example-en').innerHTML = highlightExampleWord(word.word, word.example);
            const cn = exampleChinese(word.example, word.meaning);
            const cnEl = document.getElementById('learn-example-cn');
            cnEl.textContent = cn;
            cnEl.classList.toggle('hidden', !cn);
        }
        document.getElementById('learn-example-row').classList.toggle('hidden', !!extra);
        renderCardExtra(word.word, document.getElementById('learn-extra-section'));

        document.getElementById('btn-show-answer').classList.add('hidden');
        document.getElementById('rate-buttons').classList.remove('hidden');

        speakWord();
    }

    function rateWord(quality) {
        const word = learnQueue[learnIndex];
        const key = `${state.textbook}_${word.word}`;
        let ws = getWordState(word.word);

        ws = calculateNextReview(ws, quality);
        ws.status = 'learning';
        ws.correctStreak = 0; // 学习评分不计入复习连对
        ws.nextReview = Date.now(); // 学完立即可复习，后续间隔由复习评分重新计算
        state.words[key] = ws;

        if (ws.status === 'learning') {
            state.totalLearned++;
            state.dailyLearned++;
            addExp(5);
            markStudyToday();

            const today = getTodayKey();
            if (!state.dailyStats[today]) state.dailyStats[today] = { learned: 0, reviewed: 0, correct: 0, total: 0 };
            state.dailyStats[today].learned++;
        }

        saveState();
        learnIndex++;
        showLearnCard();
    }

    function finishLearn() {
        const learned = learnQueue.length;
        if (state._pendingLevelUp) {
            state._pendingLevelUp = false;
            saveState();
            showCelebration('levelup');
        } else {
            showCelebration('learn', { count: learned });
        }
    }

    function speakWord() {
        const word = learnIndex < learnQueue.length ? learnQueue[learnIndex].word : '';
        WordAudio.say(word, document.getElementById('btn-learn-speak'));
    }

    const SYLLABLE_OVERRIDES = {
        cooperation: ['co', 'op', 'er', 'a', 'tion'], basketball: ['bas', 'ket', 'ball'],
        treasure: ['trea', 'sure'], important: ['im', 'por', 'tant'], beautiful: ['beau', 'ti', 'ful'],
        vegetable: ['veg', 'e', 'ta', 'ble'], computer: ['com', 'pu', 'ter'], classroom: ['class', 'room'],
        birthday: ['birth', 'day'], favorite: ['fa', 'vor', 'ite'], chocolate: ['choc', 'o', 'late'],
        tomorrow: ['to', 'mor', 'row'], yesterday: ['yes', 'ter', 'day'], understand: ['un', 'der', 'stand'],
        interesting: ['in', 'ter', 'est', 'ing'], information: ['in', 'for', 'ma', 'tion'],
        pronunciation: ['pro', 'nun', 'ci', 'a', 'tion'], activity: ['ac', 'tiv', 'i', 'ty'],
        elephant: ['el', 'e', 'phant'], banana: ['ba', 'na', 'na'], tomato: ['to', 'ma', 'to'],
        potato: ['po', 'ta', 'to'], cinema: ['cin', 'e', 'ma'], family: ['fam', 'i', 'ly']
    };

    function splitTokenSyllables(token) {
        const raw = String(token || '');
        const parsed = window.KWPhonics ? KWPhonics.parse(raw) : null;
        if (parsed && parsed.syls && parsed.syls.length) return parsed.syls;
        const low = raw.toLowerCase().replace(/[^a-z]/g, '');
        const parts = SYLLABLE_OVERRIDES[low] ||
            (low.match(/[^aeiouy]*[aeiouy]+(?:[^aeiouy](?![aeiouy]))?/gi) || []);
        const chunks = parts.length ? parts : [low || raw];
        let k = 0;
        return chunks.map(g => {
            const part = raw.slice(k, k + g.length) || g;
            k += g.length;
            return { g: part, ipa: '' };
        });
    }

    function renderSyllablesInto(word, box) {
        if (!box) return;
        box.classList.remove('hidden');
        const text = String(word || '').trim();
        const tokens = text.match(/[A-Za-z]+(?:[-'][A-Za-z]+)*|\d+|[^\s]/g) || [];
        if (!tokens.length) { box.classList.add('hidden'); return; }
        const tileMap = {};
        const syls = [];
        tokens.forEach((token, wi) => {
            tileMap[wi] = [];
            splitTokenSyllables(token).forEach((s, si) => {
                tileMap[wi][si] = syls.length;
                syls.push(s);
            });
        });
        if (!syls.length) { box.classList.add('hidden'); return; }
        const cleanIpa = v => String(v || '').replace(/^\/+|\/+$/g, '');
        const stressed = syls.find(s => s.stress);
        box.innerHTML =
            '<div class="syl-tiles">' + syls.map((s, i) =>
                (i ? '<span class="syl-dot">·</span>' : '') +
                `<button type="button" class="syl-tile${s.stress ? ' stress' : ''}"><b>${escapeHtml(s.g)}</b>${s.ipa ? `<i>/${escapeHtml(cleanIpa(s.ipa))}/</i>` : ''}</button>`
            ).join('') + '</div>' +
            `<div class="syl-note">${syls.length} 个音节：${syls.map(s => escapeHtml(s.g)).join(' · ')}${stressed ? `；重读 ${escapeHtml(stressed.g)}` : ''}</div>` +
            '<button type="button" class="syl-play">▶ 拼读</button>';
        box.querySelectorAll('.syl-tile').forEach(tile => { tile.onclick = () => openPhonics(text); });
        const playBtn = box.querySelector('.syl-play');
        playBtn.onclick = () => {
            if (window.WordAudio) WordAudio.stop();
            const tiles = Array.from(box.querySelectorAll('.syl-tile'));
            const clearTiles = () => tiles.forEach(t => t.classList.remove('on'));
            if (window.KWPhonics && KWPhonics.has && KWPhonics.has(text) && KWPhonics.spell) {
                playBtn.classList.add('speaking');
                const done = KWPhonics.spell(text, (wi, si, on) => {
                    const idx = tileMap[wi] && tileMap[wi][si];
                    tiles.forEach((t, i) => t.classList.toggle('on', !!on && i === idx));
                });
                Promise.resolve(done).then(() => {
                    clearTiles();
                    playBtn.classList.remove('speaking');
                });
            } else if (window.WordAudio) {
                clearTiles();
                WordAudio.say(text, playBtn);
            }
        };
        box.classList.remove('hidden');
    }

    function renderLearnSyllables(word) {
        renderSyllablesInto(word, document.getElementById('learn-syllables'));
    }

    function formChinese(label, base, value, meaning) {
        const m = String(meaning || '').split(/[；;，,]/)[0].trim();
        if (!m) return '';
        switch (label) {
            case '复数':
            case '第三人称单数':
            case '过去式':
            case '过去分词':
            case '现在分词': return m;
            case '比较级': return `更${m}`;
            case '最高级': return `最${m}`;
            default: return m;
        }
    }

    function renderFormsInto(word, box) {
        if (!box || !window.WordForms) return false;
        const rows = WordForms.getRows(word.word, word);
        box.innerHTML = rows.length
            ? rows.map(r => `<span class="form-item"><span class="form-value">${highlightFormDiff(word.word, r.value)}</span><span class="form-cn">${escapeHtml(r.cn || formChinese(r.label, word.word, r.value, word.meaning))}</span></span>`).join('')
            : '';
        return rows.length > 0;
    }

    function highlightFormDiff(base, value) {
        const a = String(base || '').toLowerCase();
        const b = String(value || '');
        const bl = b.toLowerCase();
        let prefix = 0;
        while (prefix < a.length && prefix < bl.length && a[prefix] === bl[prefix]) prefix++;
        let suffix = 0;
        while (suffix < a.length - prefix && suffix < bl.length - prefix &&
               a[a.length - 1 - suffix] === bl[bl.length - 1 - suffix]) suffix++;
        const head = escapeHtml(b.slice(0, prefix));
        const mid = escapeHtml(b.slice(prefix, b.length - suffix));
        const tail = suffix ? escapeHtml(b.slice(b.length - suffix)) : '';
        return mid ? head + '<em>' + mid + '</em>' + tail : head + tail;
    }

    function highlightExampleWord(word, example) {
        const src = String(example || '');
        if (/<em>/i.test(src)) return src;
        const safe = escapeHtml(src);
        const raw = String(word || '').trim();
        if (!raw) return safe;
        const variants = [
            raw, raw + 's', raw + 'es', raw.replace(/y$/i, 'ies'),
            raw + 'ed', raw + 'd', raw.replace(/e$/i, 'ing'), raw + 'ing'
        ];
        const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        for (const v of variants) {
            if (!v) continue;
            const re = new RegExp('\\b(' + esc(v) + ')\\b', 'i');
            if (re.test(safe)) return safe.replace(re, '<em>$1</em>');
        }
        return safe;
    }

    function genericExampleChinese(example, meaning) {
        const src = String(example || '');
        const plain = src.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
        const dict = Object.assign({}, window.WORD_ZH || {});
        const em = src.match(/<em>(.*?)<\/em>/i);
        const sense = String(meaning || '').split(/[；;，,]/)[0].trim();
        if (em && sense) dict[em[1].toLowerCase()] = sense;
        const has = k => Object.prototype.hasOwnProperty.call(dict, k);
        const wordZh = token => {
            const k = String(token || '').toLowerCase().replace(/[.,!?]$/, '');
            if (!k) return '';
            if (has(k)) return dict[k];
            const stems = [k.replace(/ies$/, 'y'), k.replace(/es$/, ''), k.replace(/s$/, ''), k.replace(/ed$/, ''), k.replace(/ing$/, '')];
            for (const s of stems) if (has(s)) return dict[s];
            return '';
        };
        const tr = text => String(text || '').trim().toLowerCase().split(/\s+/).map(wordZh).filter(Boolean).join('');
        const q = plain.endsWith('?');
        const body = plain.replace(/[.!?]+$/, '').trim();
        const rules = [
            [/^can i have some (.+)$/i, m => {
                const x = tr(m[1]);
                const drink = /water|juice|milk|tea|coffee|soup|drink/i.test(m[1].toLowerCase());
                return `我能${drink ? '喝' : '吃'}点${x}吗？`;
            }],
            [/^(?:the|a|an) (.+) is (on|in|under|near|behind) the (.+)$/i, m => {
                const pos = { on: '上', in: '里', under: '下', near: '附近', behind: '后面' }[m[2].toLowerCase()];
                return `${tr(m[1])}在${tr(m[3])}${pos}。`;
            }],
            [/^i see (\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty) (.+)$/i, m => `我看见${tr(m[1])}${m[2].endsWith('s') ? '些' : '个'}${tr(m[2])}。`],
            [/^there are (\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty) (.+)$/i, m => `有${tr(m[1])}${tr(m[2])}。`],
            [/^(?:the|a|an) (.+) is (.+)$/i, m => `这个${tr(m[1])}是${tr(m[2])}的。`],
            [/^i have (.+)$/i, m => `我有${tr(m[1])}。`],
            [/^let's (.+)$/i, m => `我们${tr(m[1])}吧。`],
            [/^what is your (.+)$/i, m => `你的${tr(m[1])}是什么？`],
            [/^where is my (.+)$/i, m => `我的${tr(m[1])}在哪里？`],
            [/^how is the (.+)$/i, m => `${tr(m[1])}怎么样？`]
        ];
        for (const [re, fn] of rules) {
            const m = body.match(re);
            if (m) return fn(m);
        }
        const out = body.split(/\s+/).map(wordZh).filter(Boolean).join('');
        if (out) return out + (q && !/？$/.test(out) ? '吗？' : '。');
        return sense ? `这句话与“${sense}”有关。` : '例句中文翻译。';
    }

    function getCardExtra(word) {
        if (!word || !window.WORD_CARD_EXTRA) return null;
        const key = String(word).trim().toLowerCase();
        return window.WORD_CARD_EXTRA[key] || null;
    }

    function tokenChinese(token, extra) {
        const raw = String(token || '');
        const key = raw.toLowerCase().replace(/[’']/g, "'");
        const dict = window.WORD_ZH || {};
        if (extra && key === String(extra.word || '').toLowerCase()) {
            return (extra.meanings || [])[0] || choiceMeaningExtra(extra);
        }
        if (Object.prototype.hasOwnProperty.call(dict, key)) return dict[key];
        const candidates = [key.replace(/ies$/, 'y'), key.replace(/es$/, ''), key.replace(/s$/, ''),
            key.replace(/ied$/, 'y'), key.replace(/ed$/, ''), key.replace(/ing$/, ''), key.replace(/e$/, '')];
        for (const c of candidates) {
            if (c && Object.prototype.hasOwnProperty.call(dict, c)) return dict[c];
        }
        if (/^[A-Z]/.test(raw)) return '人名、地名或专有名称';
        return '结合句子理解';
    }

    function choiceMeaningExtra(extra) {
        return String((extra && extra.word) || '');
    }

    function sentenceWordBlocks(text, extra) {
        const tokens = String(text || '').match(/[A-Za-z]+(?:['’][A-Za-z]+)?|[^A-Za-z]+/g) || [];
        return tokens.map(token => {
            if (!/^[A-Za-z]/.test(token)) return `<span>${escapeHtml(token)}</span>`;
            const mean = tokenChinese(token, extra);
            return `<button type="button" class="sentence-word-btn" data-token="${escapeHtml(token)}" data-meaning="${escapeHtml(mean)}">${escapeHtml(token)}</button>`;
        }).join('');
    }

    function renderCardExtra(word, box) {
        if (!box) return false;
        box.classList.add('hidden');
        const extra = getCardExtra(word);
        if (!extra) return false;
        const examples = (extra.examples || []).map((ex, i) =>
            `<section class="card-extra-example">
                <header><span>例句 ${i + 1}</span><button type="button" class="example-speak" data-text="${escapeHtml(ex.en || '')}" aria-label="朗读整句">🔊 整句</button></header>
                <div class="card-extra-sentence">${sentenceWordBlocks(ex.en || '', extra)}<div class="word-tip hidden"></div></div>
                <p><b>句子意思</b>${escapeHtml(ex.zh || '')}</p>
                <p><b>${escapeHtml(ex.role || '词的作用')}</b><strong>${escapeHtml(extra.word || word)}</strong>：${escapeHtml(ex.roleDetail || '')}</p>
            </section>`
        ).join('');
        box.innerHTML =
            `<div class="card-extra-profile">
                <div><b>词性</b><span>${escapeHtml(extra.pos || '')}</span></div>
                <div><b>单复数 / 词形</b><span>${escapeHtml(extra.forms || '')}</span></div>
                <div><b>本课词义与常见义</b><span>${(extra.meanings || []).map(m => `<em>${escapeHtml(m)}</em>`).join('')}</span></div>
            </div>` + examples;
        box.querySelectorAll('.example-speak').forEach(btn => {
            btn.onclick = () => {
                if (window.WordAudio) WordAudio.saySentence(btn.dataset.text, btn);
            };
        });
        box.querySelectorAll('.sentence-word-btn').forEach(btn => {
            btn.onclick = () => {
                const tip = btn.closest('.card-extra-sentence').querySelector('.word-tip');
                tip.innerHTML =
                    `<button type="button" class="mini-speak" aria-label="朗读单词">🔊</button>` +
                    `<b>${escapeHtml(btn.dataset.token)}</b><em>${escapeHtml(btn.dataset.meaning)}</em>`;
                tip.classList.remove('hidden');
                if (window.WordAudio) WordAudio.say(btn.dataset.token, btn);
                const speakBtn = tip.querySelector('.mini-speak');
                speakBtn.onclick = e => {
                    e.stopPropagation();
                    if (window.WordAudio) WordAudio.say(btn.dataset.token, speakBtn);
                };
            };
        });
        box.classList.remove('hidden');
        return true;
    }

    function formatPosLabel(pos) {
        if (!pos) return '';
        const names = {
            'n.': '名词', 'v.': '动词', 'adj.': '形容词', 'adv.': '副词',
            'pron.': '代词', 'prep.': '介词', 'num.': '数词', 'art.': '冠词',
            'conj.': '连词', 'interj.': '感叹词'
        };
        const parts = String(pos).split('/').filter(Boolean);
        if (parts.length === 1) return `${parts[0]} ${names[parts[0]] || ''}`.trim();
        return parts.map(p => `(${p} ${names[p] || ''})`).join('/');
    }

    function exampleChinese(example, meaning) {
        const src = String(example || '');
        const plain = src.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
        const FIX = {
            'can i have some water?': '我能喝点水吗？',
            'the book is on the desk.': '书在桌子上。',
            'he is grow up.': '他长大了。',
            'she wants a put on.': '她想穿上它。',
            'it is very take off today.': '今天很适合出发。'
        };
        if (FIX[plain]) return FIX[plain];
        const polish = text => String(text || '').replace(/[A-Za-z][A-Za-z'-]*/g, m => {
            const k = m.toLowerCase();
            return window.WORD_ZH && Object.prototype.hasOwnProperty.call(window.WORD_ZH, k)
                ? window.WORD_ZH[k] : m;
        });
        const exact = window.EXAMPLE_ZH && window.EXAMPLE_ZH[plain];
        if (exact) return polish(exact);
        const pattern = src.replace(/<em>.*?<\/em>/g, '{W}');
        const tpl = window.EXAMPLE_TPL && window.EXAMPLE_TPL[pattern];
        if (tpl) {
            const w = String(meaning || '').split(/[；;，,]/)[0].trim();
            if (w) return polish(tpl.replace(/\{W\}/g, w));
        }
        return polish(genericExampleChinese(src, meaning));
    }

    function speakExample() {
        const item = learnIndex < learnQueue.length ? learnQueue[learnIndex] : null;
        if (!item || !item.example) return;
        const text = String(item.example)
            .replace(/<[^>]+>/g, '')
            .replace(/&amp;/g, '&').replace(/&apos;|&#39;/g, "'").replace(/&quot;/g, '"')
            .replace(/\s+/g, ' ').trim();
        WordAudio.saySentence(text, document.getElementById('btn-example-speak'));
    }

    // ===== 复习模式 =====
    let reviewQueue = [];
    let reviewIndex = 0;
    let reviewCorrect = 0;

    function startReview() {
        const reviewWords = getReviewWords();
        if (reviewWords.length === 0) {
            const allLearned = getWordsForTextbook().filter(w => {
                const ws = getWordState(w.word);
                return ws.status !== 'new';
            });
            if (allLearned.length === 0) {
                showToast('还没有学过的词哦，先去学新词吧！', 'warning');
                return;
            }
            reviewQueue = shuffle(allLearned).slice(0, 10);
        } else {
            reviewQueue = shuffle(reviewWords).slice(0, 10);
        }

        reviewIndex = 0;
        reviewCorrect = 0;
        showScreen('review-screen');
        showReviewQuestion();
    }

    function showReviewQuestion() {
        if (reviewIndex >= reviewQueue.length) {
            finishReview();
            return;
        }

        const word = reviewQueue[reviewIndex];
        document.getElementById('review-counter').textContent = `${reviewIndex + 1}/${reviewQueue.length}`;
        document.getElementById('review-feedback').classList.add('hidden');
        document.getElementById('review-card').classList.remove('hidden');
        document.getElementById('review-emoji').textContent = word.emoji;

        const isEnToCn = Math.random() > 0.3;
        const allWords = getWordsForTextbook();

        if (isEnToCn) {
            document.getElementById('review-question').textContent = `"${word.word}" 是什么意思？`;
            const options = generateOptions(word, allWords, 'meaning');
            renderOptions(options, word.meaning);
        } else {
            document.getElementById('review-question').textContent = `"${word.meaning}" 的英文是？`;
            const options = generateOptions(word, allWords, 'word');
            renderOptions(options, word.word);
        }
    }

    function generateOptions(correct, allWords, field) {
        const options = [{ text: correct[field], correct: true }];
        const others = allWords.filter(w => w.word !== correct.word);
        const shuffled = shuffle(others).slice(0, 3);
        shuffled.forEach(w => options.push({ text: w[field], correct: false }));
        return shuffle(options);
    }

    function renderOptions(options, correctAnswer) {
        const container = document.getElementById('review-options');
        container.innerHTML = '';
        options.forEach(opt => {
            const btn = document.createElement('button');
            btn.className = 'review-option';
            btn.textContent = opt.text;
            btn.onclick = () => checkReviewAnswer(btn, opt.correct, correctAnswer);
            container.appendChild(btn);
        });
    }

    function checkReviewAnswer(btn, isCorrect, correctAnswer) {
        document.querySelectorAll('.review-option').forEach(b => {
            b.onclick = null;
            if (b.textContent === correctAnswer) b.classList.add('correct');
        });

        if (isCorrect) {
            btn.classList.add('correct');
            reviewCorrect++;
        } else {
            btn.classList.add('wrong');
        }

        const word = reviewQueue[reviewIndex];
        const key = `${state.textbook}_${word.word}`;
        let ws = getWordState(word.word);
        const wasMastered = ws.status === 'mastered';
        ws = calculateNextReview(ws, isCorrect ? 5 : 1);

        if (isCorrect) {
            ws.correctStreak = (ws.correctStreak || 0) + 1;
            if (ws.correctStreak >= 3 && ws.repetitions >= 3 && ws.interval >= 7 && !wasMastered) {
                ws.status = 'mastered';
                state.masteredCount = (state.masteredCount || 0) + 1;
            }
        } else {
            ws.correctStreak = 0;
            ws.status = 'learning';
            if (wasMastered) state.masteredCount = Math.max(0, (state.masteredCount || 0) - 1);
            ws.nextReview = Date.now() + 24 * 60 * 60 * 1000; // 答错后明天再进复习池
        }

        state.words[key] = ws;

        const today = getTodayKey();
        if (!state.dailyStats[today]) state.dailyStats[today] = { learned: 0, reviewed: 0, correct: 0, total: 0 };
        state.dailyStats[today].reviewed++;
        state.dailyStats[today].total++;
        if (isCorrect) state.dailyStats[today].correct++;

        state.dailyLearned++;
        addExp(isCorrect ? 3 : 1);
        markStudyToday();
        saveState();

        playSound(isCorrect ? 'correct' : 'wrong');

        if (isCorrect) {
            // 答对：短暂高亮后自动跳转下一题
            setTimeout(() => {
                reviewIndex++;
                showReviewQuestion();
            }, 1000);
        } else {
            // 答错：高亮错误选项 + 正确答案，让用户继续选择正确答案
            setTimeout(() => {
                document.querySelectorAll('.review-option').forEach(b => {
                    if (b.classList.contains('wrong')) {
                        b.classList.remove('wrong');
                        b.style.opacity = '0.4';
                        b.style.pointerEvents = 'none';
                    } else if (b.classList.contains('correct')) {
                        b.onclick = () => {
                            playSound('correct');
                            reviewIndex++;
                            showReviewQuestion();
                        };
                    }
                });
            }, 800);
        }
    }

    function nextReview() {
        reviewIndex++;
        showReviewQuestion();
    }

    function finishReview() {
        const accuracy = Math.round((reviewCorrect / reviewQueue.length) * 100);
        if (accuracy === 100) {
            state.perfectReviews = (state.perfectReviews || 0) + 1;
        }
        saveState();
        if (state._pendingLevelUp) {
            state._pendingLevelUp = false;
            saveState();
            showCelebration('levelup');
        } else {
            showCelebration('review', { correct: reviewCorrect, total: reviewQueue.length, accuracy });
        }
    }

    // ===== 选择题挑战：英选中 / 中选英 =====
    let choiceQueue = [];
    let choiceIndex = 0;
    let choiceCorrect = 0;
    let choiceMode = 'en2zh';

    function choiceMeaning(w) {
        return String((w && w.meaning) || '').split(/[；;，,]/)[0].trim();
    }

    function startChoiceChallenge(mode) {
        const learned = getAllLearnedWords();
        if (learned.length < 4) {
            showToast('至少学会4个单词才能参加挑战赛哦！', 'warning');
            return;
        }
        choiceMode = mode === 'zh2en' ? 'zh2en' : 'en2zh';
        choiceQueue = shuffle(learned).slice(0, Math.min(10, learned.length));
        choiceIndex = 0;
        choiceCorrect = 0;
        const title = document.getElementById('choice-challenge-title');
        if (title) title.textContent = choiceMode === 'zh2en' ? '🏆 中选英（简单）' : '🏆 英选中（简单）';
        showScreen('choice-challenge-screen');
        renderChoiceQuestion();
    }

    function choiceOptions(word, field) {
        const answer = field === 'word' ? word.word : choiceMeaning(word);
        const options = [{ text: answer, correct: true }];
        const seen = new Set([answer.toLowerCase()]);
        const pool = getAllLearnedWords().filter(w => w.word.toLowerCase() !== word.word.toLowerCase());
        shuffle(pool).forEach(w => {
            const text = field === 'word' ? w.word : choiceMeaning(w);
            if (!text || seen.has(text.toLowerCase())) return;
            seen.add(text.toLowerCase());
            options.push({ text, correct: false });
        });
        return shuffle(options.slice(0, 4));
    }

    function renderChoiceQuestion() {
        const listenBtn = document.getElementById('btn-listen-speak');
        if (listenBtn) listenBtn.classList.add('hidden');
        const nextBtn = document.getElementById('choice-next');
        if (nextBtn) nextBtn.onclick = nextChoiceChallenge;
        if (choiceIndex >= choiceQueue.length) {
            const feedback = document.getElementById('choice-feedback');
            feedback.textContent = `本轮完成！答对 ${choiceCorrect}/${choiceQueue.length} 题。`;
            feedback.classList.remove('hidden');
            feedback.style.color = 'var(--primary)';
            const next = document.getElementById('choice-next');
            next.textContent = '再玩一次';
            next.classList.remove('hidden');
            return;
        }
        const word = choiceQueue[choiceIndex];
        const isEnToZh = choiceMode === 'en2zh';
        const field = isEnToZh ? 'meaning' : 'word';
        document.getElementById('choice-progress').textContent = `${choiceIndex + 1}/${choiceQueue.length}`;
        document.getElementById('choice-question').textContent = isEnToZh
            ? `"${word.word}" 是什么意思？`
            : `"${choiceMeaning(word)}" 的英文是？`;
        const feedback = document.getElementById('choice-feedback');
        feedback.classList.add('hidden');
        document.getElementById('choice-next').classList.add('hidden');

        const container = document.getElementById('choice-options');
        container.innerHTML = '';
        choiceOptions(word, field).forEach(opt => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'choice-option';
            btn.textContent = opt.text;
            btn.onclick = () => {
                const answer = field === 'word' ? word.word : choiceMeaning(word);
                container.querySelectorAll('.choice-option').forEach(b => {
                    b.onclick = null;
                    if (b.textContent === answer) b.classList.add('correct');
                });
                if (opt.correct) {
                    btn.classList.add('correct');
                    choiceCorrect++;
                } else {
                    btn.classList.add('wrong');
                }
                feedback.textContent = opt.correct ? '✅ 答对了！' : `❌ 正确答案是 ${answer}`;
                feedback.style.color = opt.correct ? 'var(--success)' : 'var(--danger)';
                feedback.classList.remove('hidden');
                document.getElementById('choice-next').classList.remove('hidden');
            };
            container.appendChild(btn);
        });
    }

    function nextChoiceChallenge() {
        if (choiceIndex >= choiceQueue.length) {
            startChoiceChallenge(choiceMode);
            return;
        }
        choiceIndex++;
        renderChoiceQuestion();
    }

    // ===== 听音选词挑战 =====
    let listenMode = 'en';
    let listenWord = null;

    function startListenChallenge(mode) {
        const learned = getAllLearnedWords();
        if (learned.length < 4) {
            showToast('至少学会4个单词才能参加听音挑战哦！', 'warning');
            return;
        }
        listenMode = mode === 'zh' ? 'zh' : 'en';
        listenWord = null;
        choiceQueue = shuffle(learned).slice(0, Math.min(10, learned.length));
        choiceIndex = 0;
        choiceCorrect = 0;
        const title = document.getElementById('choice-challenge-title');
        if (title) title.textContent = listenMode === 'zh' ? '🏆 听音选词（简单2）' : '🏆 听音选词（简单）';
        showScreen('choice-challenge-screen');
        renderListenQuestion();
    }

    function speakListenWord() {
        if (!listenWord || !window.WordAudio) return;
        WordAudio.say(listenWord.word, document.getElementById('btn-listen-speak'));
    }

    function renderListenQuestion() {
        const speakBtn = document.getElementById('btn-listen-speak');
        const nextBtn = document.getElementById('choice-next');
        if (speakBtn) speakBtn.classList.remove('hidden');
        if (nextBtn) {
            nextBtn.onclick = nextListenChallenge;
            nextBtn.classList.add('hidden');
        }
        if (choiceIndex >= choiceQueue.length) {
            const feedback = document.getElementById('choice-feedback');
            feedback.textContent = `本轮完成！答对 ${choiceCorrect}/${choiceQueue.length} 题。`;
            feedback.style.color = 'var(--primary)';
            feedback.classList.remove('hidden');
            if (nextBtn) {
                nextBtn.textContent = '再玩一次';
                nextBtn.classList.remove('hidden');
            }
            if (speakBtn) speakBtn.classList.add('hidden');
            return;
        }

        listenWord = choiceQueue[choiceIndex];
        const field = listenMode === 'en' ? 'word' : 'meaning';
        const answer = field === 'word' ? listenWord.word : choiceMeaning(listenWord);
        document.getElementById('choice-progress').textContent = `${choiceIndex + 1}/${choiceQueue.length}`;
        document.getElementById('choice-question').textContent = listenMode === 'en'
            ? '听一听，选出你听到的英文单词'
            : '听一听，选出你听到的中文意思';
        const feedback = document.getElementById('choice-feedback');
        feedback.classList.add('hidden');

        const container = document.getElementById('choice-options');
        container.innerHTML = '';
        choiceOptions(listenWord, field).forEach(opt => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'choice-option';
            btn.textContent = opt.text;
            btn.onclick = () => {
                container.querySelectorAll('.choice-option').forEach(b => {
                    b.onclick = null;
                    if (b.textContent === answer) b.classList.add('correct');
                });
                if (opt.correct) {
                    btn.classList.add('correct');
                    choiceCorrect++;
                } else {
                    btn.classList.add('wrong');
                }
                feedback.textContent = opt.correct ? '✅ 答对了！' : `❌ 正确答案是 ${answer}`;
                feedback.style.color = opt.correct ? 'var(--success)' : 'var(--danger)';
                feedback.classList.remove('hidden');
                if (nextBtn) {
                    nextBtn.textContent = '下一题';
                    nextBtn.classList.remove('hidden');
                }
            };
            container.appendChild(btn);
        });

        speakListenWord();
    }

    function nextListenChallenge() {
        if (choiceIndex >= choiceQueue.length) {
            startListenChallenge(listenMode);
            return;
        }
        choiceIndex++;
        renderListenQuestion();
    }

    // ===== 拖拽配对挑战 =====
    let dragWords = [];
    let dragSelected = null;
    let dragDone = 0;
    let dragScore = 0;

    function startDragMatchChallenge() {
        const learned = getAllLearnedWords();
        if (learned.length < 4) {
            showToast('至少学会4个单词才能参加拖拽游戏哦！', 'warning');
            return;
        }
        dragWords = shuffle(learned).slice(0, Math.min(6, learned.length));
        dragSelected = null;
        dragDone = 0;
        dragScore = 0;
        showScreen('drag-match-screen');
        renderDragMatch();
    }

    function selectDragToken(word, token) {
        document.querySelectorAll('.drag-token').forEach(t => t.classList.remove('selected'));
        dragSelected = word;
        if (token) token.classList.add('selected');
        if (window.WordAudio) WordAudio.say(word.word, token);
    }

    function tryDragMatch(word, target, chosenWord) {
        if (!word || !target || target.classList.contains('correct')) return;
        const chosen = chosenWord || (dragSelected && dragSelected.word);
        const feedback = document.getElementById('drag-match-feedback');
        if (chosen && chosen.toLowerCase() === word.word.toLowerCase()) {
            target.classList.add('correct');
            target.innerHTML = `<span>${word.emoji || '📘'} ${escapeHtml(word.meaning || '')}</span><span>${escapeHtml(word.word)}</span>`;
            const token = Array.from(document.querySelectorAll('.drag-token'))
                .find(t => t.dataset.word.toLowerCase() === word.word.toLowerCase());
            if (token) token.remove();
            dragSelected = null;
            dragDone++;
            dragScore += 10;
            feedback.textContent = `✅ 配对成功！得分 ${dragScore}`;
            feedback.style.color = 'var(--success)';
            feedback.classList.remove('hidden');
            document.getElementById('drag-match-progress').textContent = `${dragDone}/${dragWords.length}`;
            if (dragDone >= dragWords.length) feedback.textContent = `🎉 全部完成！得分 ${dragScore}，可以点“换一组”再来。`;
        } else {
            target.classList.remove('wrong');
            void target.offsetWidth;
            target.classList.add('wrong');
            feedback.textContent = '还差一点，再看清楚中文意思。';
            feedback.style.color = 'var(--danger)';
            feedback.classList.remove('hidden');
            if (window.WordAudio) WordAudio.say(word.word, target);
        }
    }

    function renderDragMatch() {
        const tokensEl = document.getElementById('drag-match-tokens');
        const targetsEl = document.getElementById('drag-match-targets');
        if (!tokensEl || !targetsEl) return;
        tokensEl.innerHTML = '';
        targetsEl.innerHTML = '';
        document.getElementById('drag-match-feedback').classList.add('hidden');
        document.getElementById('drag-match-progress').textContent = `0/${dragWords.length}`;

        shuffle(dragWords).forEach(word => {
            const token = document.createElement('button');
            token.type = 'button';
            token.className = 'drag-token';
            token.draggable = true;
            token.dataset.word = word.word;
            token.textContent = word.word;
            token.onclick = () => selectDragToken(word, token);
            token.ondragstart = e => {
                token.classList.add('dragging');
                e.dataTransfer.setData('text/plain', word.word);
                selectDragToken(word, token);
            };
            token.ondragend = () => token.classList.remove('dragging');
            tokensEl.appendChild(token);
        });

        shuffle(dragWords).forEach(word => {
            const target = document.createElement('div');
            target.className = 'drop-target';
            target.dataset.word = word.word;
            target.innerHTML = `<span>${word.emoji || '📘'} ${escapeHtml(word.meaning || '')}</span><span>拖到这里</span>`;
            target.onclick = () => tryDragMatch(word, target);
            target.ondragover = e => e.preventDefault();
            target.ondrop = e => {
                e.preventDefault();
                tryDragMatch(word, target, e.dataTransfer.getData('text/plain'));
            };
            targetsEl.appendChild(target);
        });
    }

    function nextDragMatchRound() {
        startDragMatchChallenge();
    }

    // ===== 拼写挑战 =====
    let challengeWord = null;
    let challengeInput = [];
    let challengeTimer = null;
    let challengeScore = 0;
    let challengeTimeLeft = 60;
    let challengeMode = 'hard';
    let challengeFixed = [];

    function startChallenge(mode = 'hard') {
        const learnedWords = getAllLearnedWords();

        if (learnedWords.length < 4) {
            showToast('至少学会4个单词才能参加挑战赛哦！', 'warning');
            return;
        }

        challengeMode = ['easy', 'medium', 'medium2'].includes(mode) ? mode : 'hard';
        challengeScore = 0;
        challengeTimeLeft = 60;
        const titleEl = document.getElementById('challenge-title');
        const titles = { hard: '🏆 单词拼写（困难）', medium: '🏆 单词拼写（中等）', medium2: '🏆 单词拼写（中等2）', easy: '🏆 单词拼写（简单）' };
        if (titleEl) titleEl.textContent = titles[challengeMode];
        showScreen('spell-screen');
        updateChallengeTimer();
        nextChallengeWord();

        challengeTimer = setInterval(() => {
            challengeTimeLeft--;
            updateChallengeTimer();
            if (challengeTimeLeft <= 0) {
                clearInterval(challengeTimer);
                finishChallenge();
            }
        }, 1000);
    }

    function speakChallengeWord() {
        if (challengeWord && window.WordAudio) {
            WordAudio.say(challengeWord.word, document.getElementById('btn-challenge-speak'));
        }
    }

    function updateChallengeTimer() {
        const timerEl = document.getElementById('challenge-timer');
        timerEl.textContent = `⏱ ${challengeTimeLeft}s`;
        timerEl.style.color = challengeTimeLeft <= 10 ? '#E74C3C' : '#2C3E50';
    }

    function nextChallengeWord() {
        const learnedWords = getAllLearnedWords();
        challengeWord = learnedWords[Math.floor(Math.random() * learnedWords.length)];
        const len = challengeWord.word.length;
        challengeInput = Array(len).fill('');
        challengeFixed = [];
        if ((challengeMode === 'medium2' || challengeMode === 'easy') && len > 1) {
            const indices = Array.from({ length: len }, (_, i) => i);
            for (let i = indices.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [indices[i], indices[j]] = [indices[j], indices[i]];
            }
            indices.slice(0, Math.ceil(len / 2)).forEach(i => {
                challengeInput[i] = challengeWord.word[i].toLowerCase();
                challengeFixed.push(i);
            });
        }

        document.getElementById('spell-meaning').textContent = `${challengeWord.emoji} ${challengeWord.meaning}`;
        document.getElementById('spell-feedback').classList.add('hidden');

        const inputsEl = document.getElementById('spell-inputs');
        inputsEl.innerHTML = '';
        for (let i = 0; i < len; i++) {
            const div = document.createElement('div');
            div.className = 'spell-letter';
            div.id = `letter-${i}`;
            div.textContent = challengeInput[i] || '';
            if (challengeInput[i]) div.classList.add('filled');
            if (challengeFixed.includes(i)) div.classList.add('fixed');
            inputsEl.appendChild(div);
        }

        renderKeyboard();
    }

    function renderKeyboard() {
        let keys = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
        if ((challengeMode === 'medium' || challengeMode === 'easy') && challengeWord) {
            const letters = String(challengeWord.word).toUpperCase().replace(/[^A-Z]/g, '').split('');
            keys = challengeMode === 'easy' ? letters : [...new Set(letters)];
            for (let i = keys.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [keys[i], keys[j]] = [keys[j], keys[i]];
            }
        }
        const container = document.getElementById('keyboard-keys');
        container.innerHTML = '';
        keys.forEach(k => {
            const btn = document.createElement('button');
            btn.className = 'key-btn';
            btn.textContent = k;
            btn.onclick = () => typeLetter(k.toLowerCase());
            container.appendChild(btn);
        });
        const del = document.createElement('button');
        del.className = 'key-btn';
        del.textContent = '←';
        del.style.width = '60px';
        del.style.background = '#FFE0E0';
        del.onclick = () => deleteLetter();
        container.appendChild(del);
    }

    function typeLetter(letter) {
        if (!challengeWord) return;
        const idx = challengeInput.findIndex((c, i) => !c && !challengeFixed.includes(i));
        if (idx < 0) return;
        challengeInput[idx] = letter.toLowerCase();
        const el = document.getElementById(`letter-${idx}`);
        if (el) {
            el.textContent = challengeInput[idx];
            el.classList.add('filled');
        }
        if (challengeInput.every(Boolean)) checkSpelling();
    }

    function deleteLetter() {
        for (let i = challengeInput.length - 1; i >= 0; i--) {
            if (challengeFixed.includes(i) || !challengeInput[i]) continue;
            challengeInput[i] = '';
            const el = document.getElementById(`letter-${i}`);
            if (el) {
                el.textContent = '';
                el.classList.remove('filled', 'correct', 'wrong');
            }
            return;
        }
    }

    function checkSpelling() {
        const answer = challengeInput.join('');
        const correct = answer === challengeWord.word.toLowerCase();

        for (let i = 0; i < challengeWord.word.length; i++) {
            const el = document.getElementById(`letter-${i}`);
            if (el) {
                el.classList.add(correct ? 'correct' : 'wrong');
            }
        }

        const feedback = document.getElementById('spell-feedback');
        feedback.classList.remove('hidden');
        feedback.textContent = correct ? '✅ 正确！' : `❌ 答案是: ${challengeWord.word}`;
        feedback.style.color = correct ? '#2ECC71' : '#E74C3C';

        if (correct) {
            challengeScore += 10;
            addExp(2);
            markStudyToday();
        }

        setTimeout(() => {
            if (challengeTimeLeft > 0) nextChallengeWord();
        }, 1000);
    }

    function finishChallenge() {
        clearInterval(challengeTimer);
        if (challengeScore > state.bestChallengeScore) {
            state.bestChallengeScore = challengeScore;
        }
        saveState();
        showCelebration('challenge', { score: challengeScore });
    }

    // ===== 单词本 =====
    let currentFilter = 'all';
    let currentUnit = 'all';

    let cardWord = null;

    function openWordCard(word) {
        if (!word) return;
        cardWord = word;
        const overlay = document.getElementById('word-card-overlay');
        if (!overlay) return;
        const closeBtn = overlay.querySelector('.word-card-close');
        if (closeBtn) closeBtn.onclick = closeWordCard;
        document.getElementById('wd-emoji').textContent = word.emoji || '📘';
        document.getElementById('wd-word').textContent = word.word;
        document.getElementById('wd-phonetic').textContent = word.phonetic || '';
        const pos = window.WORD_POS_EXACT && (WORD_POS_EXACT[word.word.toLowerCase()] ||
            WORD_POS_EXACT[word.word.toLowerCase().split(/\s+/).pop()]);
        const posEl = document.getElementById('wd-pos');
        posEl.textContent = formatPosLabel(pos);
        posEl.classList.toggle('hidden', !pos);
        document.getElementById('wd-meaning').textContent = word.meaning || '';
        renderSyllablesInto(word.word, document.getElementById('wd-syllables'));
        const extra = getCardExtra(word.word);
        const hasForms = renderFormsInto(word, document.getElementById('wd-forms'));
        document.getElementById('wd-forms-row').classList.toggle('hidden', !hasForms || !!extra);
        if (!extra) {
            document.getElementById('wd-example-en').innerHTML = highlightExampleWord(word.word, word.example || '');
            const cn = exampleChinese(word.example || '', word.meaning || '');
            const cnEl = document.getElementById('wd-example-cn');
            cnEl.textContent = cn;
            cnEl.classList.toggle('hidden', !cn);
        }
        document.getElementById('wd-example-row').classList.toggle('hidden', !word.example || !!extra);
        renderCardExtra(word.word, document.getElementById('wd-extra-section'));
        overlay.classList.add('active');
    }

    function closeWordCard() {
        const overlay = document.getElementById('word-card-overlay');
        if (overlay) overlay.classList.remove('active');
        if (window.WordAudio) WordAudio.stop();
        cardWord = null;
    }

    function speakCardWord() {
        if (cardWord && window.WordAudio) WordAudio.say(cardWord.word, document.getElementById('wd-speak'));
    }

    function speakCardExample() {
        if (!cardWord || !cardWord.example || !window.WordAudio) return;
        const text = String(cardWord.example).replace(/<[^>]+>/g, '')
            .replace(/&amp;/g, '&').replace(/&apos;|&#39;/g, "'").replace(/&quot;/g, '"')
            .replace(/\s+/g, ' ').trim();
        WordAudio.saySentence(text, document.getElementById('wd-example-speak'));
    }

    function renderWordbook(filter, unitFilter) {
        if (filter) currentFilter = filter;
        if (unitFilter !== undefined) currentUnit = unitFilter;

        document.querySelectorAll('.filter-tabs .tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.filter-tabs .tab').forEach(t => {
            if (t.textContent.includes(
                currentFilter === 'all' ? '全部' :
                currentFilter === 'mastered' ? '已掌握' :
                currentFilter === 'learning' ? '学习中' : '未学习'
            )) t.classList.add('active');
        });

        const list = document.getElementById('wordbook-list');
        list.innerHTML = '';

        const book = WORD_DB[state.textbook];
        if (!book) return;

        // 收集词汇，支持按单元筛选
        let allWords = [];
        if (currentUnit === 'all') {
            for (const unit of Object.values(book.units)) {
                for (const w of unit.words) {
                    allWords.push({ ...w, unitName: unit.name });
                }
            }
        } else {
            const unit = book.units[currentUnit];
            if (unit) {
                for (const w of unit.words) {
                    allWords.push({ ...w, unitName: unit.name });
                }
            }
        }

        const filtered = allWords.filter(w => {
            const ws = getWordState(w.word);
            if (currentFilter === 'all') return true;
            return ws.status === currentFilter;
        });

        if (filtered.length === 0) {
            list.innerHTML = '<div style="text-align:center;padding:40px;color:#7F8C8D;grid-column:1/-1;">暂无单词</div>';
            return;
        }

        filtered.forEach(w => {
            const ws = getWordState(w.word);
            const item = document.createElement('div');
            item.className = 'wordbook-item';
            item.innerHTML = `
                <div>
                    <div class="wb-word">${w.emoji} ${w.word}</div>
                    <div class="wb-meaning">${w.phonetic} ${w.meaning}</div>
                    <div class="wb-unit">${w.unitName || ''}</div>
                </div>
                <span class="wb-status ${ws.status}">${
                    ws.status === 'new' ? '未学' :
                    ws.status === 'mastered' ? '已掌握' : '学习中'
                }</span>
                <button class="wb-speak" type="button" aria-label="朗读单词">🔊</button>
            `;
            item.onclick = () => openWordCard(w);
            item.querySelector('.wb-speak').onclick = e => {
                e.stopPropagation();
                WordAudio.say(w.word, e.currentTarget);
            };
            list.appendChild(item);
        });
    }

    function filterWords(filter) {
        renderWordbook(filter);
    }

    function renderUnitTabs() {
        const container = document.getElementById('unit-tabs');
        if (!container) return;
        container.innerHTML = '';

        // "全部单元" 按钮
        const allBtn = document.createElement('button');
        allBtn.className = 'tab' + (currentUnit === 'all' ? ' active' : '');
        allBtn.textContent = '全部单元';
        allBtn.onclick = () => filterByUnit('all');
        container.appendChild(allBtn);

        const book = WORD_DB[state.textbook];
        if (!book) return;

        for (const [uid, unit] of Object.entries(book.units)) {
            const btn = document.createElement('button');
            btn.className = 'tab' + (currentUnit === String(uid) ? ' active' : '');
            btn.textContent = unit.name;
            btn.onclick = () => filterByUnit(uid);
            container.appendChild(btn);
        }
    }

    function filterByUnit(unit) {
        currentUnit = String(unit);
        document.querySelectorAll('.unit-tabs .tab').forEach(t => {
            t.classList.toggle('active', t.dataset.unit === String(unit));
        });
        renderWordbook();
    }

    function switchVersion(version) {
        document.querySelectorAll('#textbook-screen .version-tab').forEach(t => {
            t.classList.toggle('active', t.dataset.version === version);
        });
        renderTextbookGrid('textbook-grid', version, 'selectTextbook');
    }

    function switchVersionProfile(version) {
        document.querySelectorAll('#profile-version-tabs .version-tab').forEach(t => {
            t.classList.toggle('active', t.dataset.version === version);
        });
        renderTextbookGrid('profile-textbook-grid', version, 'setTextbook');
    }

    function filterByUnit(unit) {
        currentUnit = unit;
        // 更新单元 tab 状态
        document.querySelectorAll('.unit-tabs .tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.unit-tabs .tab').forEach(t => {
            if (t.dataset.unit === String(unit)) t.classList.add('active');
        });
        renderWordbook();
    }

    // ===== 统计页面 =====
    function updateStats() {
        document.getElementById('stat-total').textContent = state.totalLearned;
        document.getElementById('stat-mastered').textContent = state.masteredCount;
        document.getElementById('stat-streak').textContent = state.streak;

        let totalCorrect = 0, totalAttempts = 0;
        Object.values(state.dailyStats).forEach(d => {
            totalCorrect += d.correct || 0;
            totalAttempts += d.total || 0;
        });
        const accuracy = totalAttempts > 0 ? Math.round((totalCorrect / totalAttempts) * 100) : 0;
        document.getElementById('stat-accuracy').textContent = `${accuracy}%`;

        // 访问统计
        const vs = getVisitStats();
        document.getElementById('stat-total-visits').textContent = vs.totalVisits;
        document.getElementById('stat-visit-days').textContent = vs.days;
        renderVisitChart(vs.log);

        renderWeeklyChart();
        renderAchievements();
    }

    function renderWeeklyChart() {
        const chart = document.getElementById('weekly-chart');
        chart.innerHTML = '';

        const days = [];
        const dayNames = ['日', '一', '二', '三', '四', '五', '六'];
        for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const key = d.toISOString().split('T')[0];
            const stats = state.dailyStats[key] || { learned: 0, reviewed: 0 };
            days.push({
                label: dayNames[d.getDay()],
                count: stats.learned + stats.reviewed
            });
        }

        const maxCount = Math.max(...days.map(d => d.count), 1);

        days.forEach(d => {
            const wrapper = document.createElement('div');
            wrapper.className = 'chart-bar-wrapper';
            const height = Math.max((d.count / maxCount) * 100, 4);
            wrapper.innerHTML = `
                <div class="chart-bar" style="height:${height}px"></div>
                <span class="chart-label">${d.label}</span>
            `;
            chart.appendChild(wrapper);
        });
    }

    function renderVisitChart(log) {
        const chart = document.getElementById('visit-chart');
        if (!chart) return;
        chart.innerHTML = '';

        const days = [];
        const dayNames = ['日', '一', '二', '三', '四', '五', '六'];
        for (let i = 13; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const key = d.toISOString().split('T')[0];
            const entry = log[key];
            days.push({
                label: (i === 0 ? '今' : dayNames[d.getDay()]),
                count: entry ? entry.visits : 0
            });
        }

        const maxCount = Math.max(...days.map(d => d.count), 1);

        days.forEach(d => {
            const wrapper = document.createElement('div');
            wrapper.className = 'chart-bar-wrapper';
            const height = Math.max((d.count / maxCount) * 80, 4);
            wrapper.innerHTML = `
                <div class="chart-bar visit-bar" style="height:${height}px"></div>
                <span class="chart-label">${d.label}</span>
            `;
            chart.appendChild(wrapper);
        });
    }

    function renderAchievements() {
        const container = document.getElementById('achievements');
        container.innerHTML = '';

        const statsForCheck = {
            ...state,
            totalLearned: state.totalLearned,
            masteredCount: state.masteredCount,
            totalEnergy: state.totalEnergy,
        };

        ACHIEVEMENTS.forEach(ach => {
            const unlocked = ach.check(statsForCheck);
            const div = document.createElement('div');
            div.className = 'achievement' + (unlocked ? '' : ' locked');
            div.innerHTML = `
                <span class="ach-emoji">${ach.emoji}</span>
                <span class="ach-name">${ach.name}</span>
            `;
            div.title = ach.desc;
            container.appendChild(div);
        });
    }

    function checkAchievements() {
        const newAch = [];
        ACHIEVEMENTS.forEach(ach => {
            if (!state.achievements.includes(ach.id) && ach.check(state)) {
                newAch.push(ach);
                state.achievements.push(ach.id);
            }
        });
        saveState();
        return newAch;
    }

    // ===== 个人页面 =====
    function updateProfile() {
        document.getElementById('profile-avatar').textContent = getPetEmoji();
        document.getElementById('profile-name').textContent = state.userName;
        document.getElementById('profile-level').textContent = `Lv.${state.petLevel + 1}`;

        // 更新教材选择按钮状态
        document.querySelectorAll('.textbook-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.textbook === state.textbook);
        });

        // Update textbook grid for current version
        const currentVersion = state.textbook.split('_')[0];
        renderTextbookGrid('profile-textbook-grid', currentVersion, 'setTextbook');

        // 显示当前教材进度
        const book = WORD_DB[state.textbook];
        if (book) {
            const allWords = [];
            for (const unit of Object.values(book.units)) {
                allWords.push(...unit.words);
            }
            const learnedCount = allWords.filter(w => {
                const ws = getWordState(w.word);
                return ws.status !== 'new';
            }).length;
            const progressEl = document.getElementById('textbook-progress');
            if (progressEl) {
                progressEl.textContent = `${book.name} — 已学 ${learnedCount}/${allWords.length} 词`;
            }
        }
    }

    function setTextbook(textbook) {
        state.textbook = textbook;
        // 同步更新 grade 字段
        const book = WORD_DB[textbook];
        if (book) state.grade = book.grade;
        saveState();
        updateProfile();
        updateHome();
    }

    async function resetData() {
        const confirmed = await showConfirm('重置进度', '确定要重置当前账号的所有进度吗？这不可恢复！');
        if (confirmed) {
            const name = currentAccount || state.userName;
            state = { ...defaultState(), userName: name };
            saveState();
            await flushToDisk();
            showScreen('splash-screen');
            showToast('进度已重置', 'info');
        }
    }

    // ===== 账号管理 =====
    function escapeHtml(text) {
        return String(text).replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        })[c]);
    }

    function onAccountDocClick(e) {
        if (!e.target.closest('#account-menu') && !e.target.closest('#sidebar-user')) closeAccountMenu();
    }

    function openAccountMenu() {
        const menu = document.getElementById('account-menu');
        if (!menu) return;
        renderAccountMenu();
        menu.classList.remove('hidden');
        setTimeout(() => document.addEventListener('click', onAccountDocClick), 0);
    }

    function closeAccountMenu() {
        const menu = document.getElementById('account-menu');
        if (menu) menu.classList.add('hidden');
        document.removeEventListener('click', onAccountDocClick);
    }

    function renderAccountMenu() {
        const list = document.getElementById('account-list');
        if (!list) return;
        updateSaveStatus();
        const accounts = listAccounts();
        list.innerHTML = accounts.length
            ? accounts.map(name =>
                `<button type="button" class="account-item${name === currentAccount ? ' active' : ''}" data-name="${escapeHtml(name)}">👤 ${escapeHtml(name)}</button>`
              ).join('')
            : '<div class="account-empty">暂无账号</div>';
        list.querySelectorAll('.account-item').forEach(btn => {
            btn.onclick = () => switchAccount(btn.dataset.name);
        });
    }

    async function switchAccount(name) {
        if (!name) return;
        if (name === currentAccount) {
            closeAccountMenu();
            showToast('已经是当前账号', 'info');
            return;
        }
        await flushToDisk();
        accountHandle = null;
        const cached = readCache(name);
        const disk = await readDiskAccount(name, true);
        const next = (disk && (disk.updatedAt || 0) >= ((cached && cached.updatedAt) || 0)) ? disk : cached;
        if (!next) {
            showToast(`没有找到账号「${name}」的数据`, 'warning');
            return;
        }
        currentAccount = name;
        state = next;
        if (!accountHandle) accountHandle = await AccountFiles.get(name);
        if (!accountHandle && diskSupported()) {
            const link = await showConfirm('连接磁盘文件', `为账号「${name}」选择或新建 JSON 文件？取消则暂用浏览器缓存。`);
            if (link) {
                try { await createAccountFile(name); } catch (e) { accountHandle = null; }
            }
        }
        saveState();
        showScreen(state.setupDone ? 'home-screen' : 'name-screen');
        showToast(`已切换到 ${name}`, 'success');
        closeAccountMenu();
    }

    async function logout() {
        await flushToDisk();
        closeAccountMenu();
        currentAccount = null;
        accountHandle = null;
        state = defaultState();
        try { localStorage.removeItem(LAST_ACCOUNT_KEY); } catch (e) { /* 忽略 */ }
        showScreen('splash-screen');
        showToast('已登出，账号文件已保留', 'info');
    }

    async function openAccountFromFile() {
        if (typeof window.showOpenFilePicker !== 'function') {
            showToast('当前浏览器不支持打开磁盘文件，请用「导入 JSON」', 'warning');
            return;
        }
        try {
            const [handle] = await window.showOpenFilePicker({
                types: [{ description: 'JSON 文件', accept: { 'application/json': ['.json'] } }],
                multiple: false
            });
            const file = await handle.getFile();
            const data = normalizeState(JSON.parse(await file.text()));
            const name = data.userName || file.name.replace(/\.json$/i, '');
            if (!name) throw new Error('JSON 中没有账号名');
            data.userName = name;
            await flushToDisk();
            currentAccount = name;
            accountHandle = handle;
            await AccountFiles.set(name, handle);
            state = data;
            saveState();
            showScreen(state.setupDone ? 'home-screen' : 'name-screen');
            showToast(`已登录 ${name}`, 'success');
        } catch (e) {
            if (!(e && e.name === 'AbortError')) showToast('读取磁盘文件失败：' + ((e && e.message) || e), 'warning');
        } finally {
            closeAccountMenu();
        }
    }

    async function saveAccountToDisk() {
        if (!currentAccount) {
            closeAccountMenu();
            showToast('请先登录账号', 'warning');
            return;
        }
        if (!dirSupported()) {
            closeAccountMenu();
            showToast('当前浏览器不支持选择文件夹，请使用「导出 JSON」', 'warning');
            return;
        }
        if (!saveRootHandle || !(await hasPermission(saveRootHandle, 'readwrite'))) {
            const ok = await linkSaveFolder({ silent: true });
            if (!ok) { closeAccountMenu(); return; }
        }
        await flushToDisk();
        showToast(`已保存到 ${SAVE_DIR_NAME}/${safeFileName(currentAccount)}.json`, 'success');
        closeAccountMenu();
    }

    function exportAccountJson() {
        closeAccountMenu();
        if (!currentAccount) { showToast('请先登录账号', 'warning'); return; }
        const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${safeFileName(currentAccount)}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        showToast('已导出 JSON 文件', 'success');
    }

    function importAccountJson() {
        closeAccountMenu();
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        input.onchange = async () => {
            const file = input.files && input.files[0];
            if (!file) return;
            try {
                const data = normalizeState(JSON.parse(await file.text()));
                const name = data.userName || file.name.replace(/\.json$/i, '');
                if (!name) throw new Error('JSON 中没有账号名');
                data.userName = name;
                await flushToDisk();
                currentAccount = name;
                accountHandle = null;
                state = data;
                saveState();
                showScreen(state.setupDone ? 'home-screen' : 'name-screen');
                showToast(`已导入账号 ${name}，可在账号菜单保存到磁盘`, 'success');
            } catch (e) {
                showToast('导入失败：' + ((e && e.message) || e), 'warning');
            }
        };
        input.click();
    }

    // ===== 庆祝 =====
    function showCelebration(type, data = {}) {
        let emoji = '🎉', title = '太棒了！', details = '', petReaction = '🥳';

        switch (type) {
            case 'learn':
                emoji = '📖';
                title = '学习完成！';
                details = `学会了 ${data.count} 个新词！`;
                petReaction = getPetEmoji();
                break;
            case 'review':
                emoji = data.accuracy === 100 ? '💯' : '✅';
                title = data.accuracy === 100 ? '完美通关！' : '复习完成！';
                details = `正确率: ${data.accuracy}% (${data.correct}/${data.total})`;
                petReaction = data.accuracy >= 80 ? '🥳' : '💪';
                break;
            case 'challenge':
                emoji = '🏆';
                title = '挑战结束！';
                details = `得分: ${data.score} 分`;
                petReaction = data.score >= 50 ? '🦸' : '😊';
                break;
            case 'levelup':
                emoji = '✨';
                title = '精灵升级了！';
                details = `${getPetName()} 成长到了 Lv.${state.petLevel + 1}`;
                petReaction = getPetEmoji();
                break;
        }

        document.getElementById('celebrate-emoji').textContent = emoji;
        document.getElementById('celebrate-title').textContent = title;
        document.getElementById('celebrate-details').innerHTML = details;
        document.getElementById('pet-reaction').textContent = petReaction;

        showScreen('celebration-screen');
    }

    // ===== 音效系统 =====
    let audioCtx = null;
    function getAudioCtx() {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        return audioCtx;
    }
    function playSound(type) {
        try {
            const ctx = getAudioCtx();
            if (ctx.state === 'suspended') ctx.resume();
            if (type === 'correct') {
                [523.25, 659.25].forEach((freq, i) => {
                    const osc = ctx.createOscillator();
                    const gain = ctx.createGain();
                    osc.type = 'sine';
                    osc.frequency.value = freq;
                    gain.gain.setValueAtTime(0.3, ctx.currentTime + i * 0.12);
                    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + i * 0.12 + 0.3);
                    osc.connect(gain).connect(ctx.destination);
                    osc.start(ctx.currentTime + i * 0.12);
                    osc.stop(ctx.currentTime + i * 0.12 + 0.3);
                });
            } else {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'square';
                osc.frequency.value = 200;
                osc.frequency.exponentialRampToValueAtTime(120, ctx.currentTime + 0.25);
                gain.gain.setValueAtTime(0.15, ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
                osc.connect(gain).connect(ctx.destination);
                osc.start(ctx.currentTime);
                osc.stop(ctx.currentTime + 0.3);
            }
        } catch (e) {}
    }

    // ===== 工具函数 =====
    function shuffle(arr) {
        const a = [...arr];
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    }

    // ===== 键盘快捷键支持 =====
    document.addEventListener('keydown', (e) => {
        // Escape → go to home screen
        if (e.key === 'Escape') {
            e.preventDefault();
            const card = document.getElementById('word-card-overlay');
            const picker = document.getElementById('textbook-picker-overlay');
            if (card && card.classList.contains('active')) closeWordCard();
            else if (picker && picker.classList.contains('active')) closeTextbookPicker();
            else if (window.KWPhonics && KWPhonics.close) KWPhonics.close();
            else showScreen('home-screen');
            return;
        }

        // Ctrl+B → toggle sidebar
        if (e.ctrlKey && e.key === 'b') {
            e.preventDefault();
            toggleSidebar();
            return;
        }

        // During learn: 1/2/3 for rating (hard/ok/easy)
        const learnScreen = document.getElementById('learn-screen');
        if (learnScreen && learnScreen.classList.contains('active')) {
            const rateButtons = document.getElementById('rate-buttons');
            if (rateButtons && !rateButtons.classList.contains('hidden')) {
                if (e.key === '1') { rateWord(1); return; }
                if (e.key === '2') { rateWord(3); return; }
                if (e.key === '3') { rateWord(5); return; }
            }
        }

        // 拼写挑战中支持物理键盘
        const spellScreen = document.getElementById('spell-screen');
        if (spellScreen && spellScreen.classList.contains('active')) {
            if (e.key === 'Backspace') {
                e.preventDefault();
                deleteLetter();
            } else if (e.key.length === 1 && /[a-zA-Z]/.test(e.key)) {
                typeLetter(e.key.toLowerCase());
            }
        }
    });

    // ===== Toast 通知系统 =====
    function showToast(msg, type = 'info', duration = 3000) {
        const container = document.getElementById('toast-container');
        if (!container) return;
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        const icons = { info: '💡', success: '✅', warning: '⚠️', error: '❌' };
        toast.innerHTML = `<span class="toast-icon">${icons[type] || '💡'}</span><span class="toast-msg">${msg}</span>`;
        container.appendChild(toast);
        requestAnimationFrame(() => toast.classList.add('toast-show'));
        setTimeout(() => {
            toast.classList.remove('toast-show');
            toast.classList.add('toast-hide');
            setTimeout(() => toast.remove(), 400);
        }, duration);
    }

    // ===== Modal 确认框系统 =====
    function showConfirm(title, message) {
        return new Promise(resolve => {
            const overlay = document.getElementById('modal-overlay');
            if (!overlay) { resolve(false); return; }
            document.getElementById('modal-title').textContent = title;
            document.getElementById('modal-message').textContent = message;
            overlay.classList.add('active');
            const confirmBtn = document.getElementById('modal-confirm');
            const cancelBtn = document.getElementById('modal-cancel');
            const cleanup = (result) => {
                overlay.classList.remove('active');
                confirmBtn.replaceWith(confirmBtn.cloneNode(true));
                cancelBtn.replaceWith(cancelBtn.cloneNode(true));
                resolve(result);
            };
            document.getElementById('modal-confirm').onclick = () => cleanup(true);
            document.getElementById('modal-cancel').onclick = () => cleanup(false);
        });
    }

    // ===== 数字动画 =====
    function animateNumber(el, target, duration = 800) {
        const start = parseInt(el.textContent) || 0;
        if (start === target) return;
        const startTime = performance.now();
        function update(now) {
            const elapsed = now - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            el.textContent = Math.round(start + (target - start) * eased);
            if (progress < 1) requestAnimationFrame(update);
        }
        requestAnimationFrame(update);
    }

    // ===== 教材版本数据 =====
    const TEXTBOOK_VERSIONS = [
        { id: 'PEP', label: '人教版PEP' },
        { id: 'WYS', label: '外研版' },
        { id: 'YL', label: '译林版' },
        { id: 'BNU', label: '北师大版' },
        { id: 'MJ', label: '闽教版' },
        { id: 'GD', label: '广东开心版' },
        { id: 'JJ', label: '冀教版' },
        { id: 'SL', label: '陕旅版' },
        { id: 'XS', label: '湘少版' },
        { id: 'SH', label: '沪教版' },
        { id: 'RA', label: '仁爱版（初中）' },
    ];

    function renderTextbookGrid(containerId, version, onSelectFn) {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = '';
        const grades = [3, 4, 5, 6, 7, 8, 9];
        const gradeLabels = { 3: '三年级', 4: '四年级', 5: '五年级', 6: '六年级', 7: '七年级', 8: '八年级', 9: '九年级' };
        grades.forEach(grade => {
            const group = document.createElement('div');
            group.className = 'textbook-grade-group';
            const hasUpper = WORD_DB[`${version}_${grade}上`];
            const hasLower = WORD_DB[`${version}_${grade}下`];
            if (!hasUpper && !hasLower) return;
            group.innerHTML = `
                <div class="textbook-grade-label">${gradeLabels[grade]}</div>
                <div class="textbook-semester-btns">
                    ${hasUpper ? `<button class="textbook-btn" data-textbook="${version}_${grade}上" onclick="App.${onSelectFn}('${version}_${grade}上')">上册</button>` : ''}
                    ${hasLower ? `<button class="textbook-btn" data-textbook="${version}_${grade}下" onclick="App.${onSelectFn}('${version}_${grade}下')">下册</button>` : ''}
                </div>
            `;
            container.appendChild(group);
        });
    }

    // ===== 首页教材切换弹层 =====
    let textbookPickerVersion = null;

    function openTextbookPicker() {
        const overlay = document.getElementById('textbook-picker-overlay');
        if (!overlay) return;
        textbookPickerVersion = (state.textbook && state.textbook.split('_')[0]) || 'PEP';
        renderTextbookPicker();
        overlay.classList.add('active');
    }

    function closeTextbookPicker() {
        const overlay = document.getElementById('textbook-picker-overlay');
        if (overlay) overlay.classList.remove('active');
    }

    function openCourseFromPicker(screenId) {
        closeTextbookPicker();
        showScreen(screenId);
    }

    function renderTextbookPicker() {
        const tabs = document.getElementById('textbook-picker-versions');
        if (!tabs) return;
        tabs.innerHTML = TEXTBOOK_VERSIONS.map(v =>
            `<button type="button" class="version-tab${v.id === textbookPickerVersion ? ' active' : ''}" data-version="${v.id}">${v.label}</button>`
        ).join('');
        tabs.querySelectorAll('.version-tab').forEach(btn => {
            btn.onclick = () => {
                textbookPickerVersion = btn.dataset.version;
                renderTextbookPicker();
            };
        });
        renderTextbookGrid('textbook-picker-grid', textbookPickerVersion, 'pickTextbook');
    }

    async function pickTextbook(textbook) {
        setTextbook(textbook);
        await flushToDisk();
        closeTextbookPicker();
        const book = WORD_DB[textbook];
        showToast(`已切换到${book ? book.name : textbook}`, 'success');
    }

    // ===== 侧边栏切换 =====
    function toggleSidebar() {
        document.body.classList.toggle('sidebar-collapsed');
        const collapsed = document.body.classList.contains('sidebar-collapsed');
        localStorage.setItem('word_sprite_sidebar', collapsed ? 'collapsed' : 'expanded');
    }

    // ===== 单词搜索 =====
    function searchWords(query) {
        if (!query) { renderWordbook(); return; }
        const q = query.toLowerCase();
        const book = WORD_DB[state.textbook];
        if (!book) return;
        let allWords = [];
        for (const unit of Object.values(book.units)) {
            for (const w of unit.words) {
                allWords.push({ ...w, unitName: unit.name });
            }
        }
        const filtered = allWords.filter(w =>
            w.word.toLowerCase().includes(q) || w.meaning.includes(q)
        );
        // Render filtered results
        const list = document.getElementById('wordbook-list');
        list.innerHTML = '';
        if (filtered.length === 0) {
            list.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-lighter, #7F8C8D);grid-column:1/-1;">没有找到匹配的单词</div>';
            return;
        }
        filtered.forEach(w => {
            const ws = getWordState(w.word);
            const item = document.createElement('div');
            item.className = 'wordbook-item';
            item.innerHTML = `
                <div>
                    <div class="wb-word">${w.emoji} ${w.word}</div>
                    <div class="wb-meaning">${w.phonetic} ${w.meaning}</div>
                    <div class="wb-unit">${w.unitName || ''}</div>
                </div>
                <span class="wb-status ${ws.status}">${
                    ws.status === 'new' ? '未学' :
                    ws.status === 'mastered' ? '已掌握' : '学习中'
                }</span>
                <button class="wb-speak" type="button" aria-label="朗读单词">🔊</button>
            `;
            item.onclick = () => openWordCard(w);
            item.querySelector('.wb-speak').onclick = e => {
                e.stopPropagation();
                WordAudio.say(w.word, e.currentTarget);
            };
            list.appendChild(item);
        });
    }

    // ===== 暴露公共API =====
    return {
        boot,
        start,
        setName,
        choosePet,
        selectTextbook,
        showScreen,
        startLearn,
        showAnswer,
        rateWord,
        speakWord,
        speakExample,
        exampleChinese,
        highlightExampleWord,
        highlightFormDiff,
        renderLearnSyllables,
        startReview,
        nextReview,
        startChallenge,
        speakChallengeWord,
        startChoiceChallenge,
        nextChoiceChallenge,
        startListenChallenge,
        speakListenWord,
        nextListenChallenge,
        startDragMatchChallenge,
        nextDragMatchRound,
        filterWords,
        filterByUnit,
        openWordCard,
        closeWordCard,
        speakCardWord,
        speakCardExample,
        switchVersion,
        switchVersionProfile,
        openTextbookPicker,
        closeTextbookPicker,
        openCourseFromPicker,
        pickTextbook,
        setTextbook,
        setGrade: setTextbook, // 向后兼容
        resetData,
        interactPet,
        speakDailyWord,
        toggleSidebar,
        searchWords,
        openAccountMenu,
        closeAccountMenu,
        switchAccount,
        logout,
        openAccountFromFile,
        saveAccountToDisk,
        exportAccountJson,
        importAccountJson,
        getYinbiaoProgress,
        setYinbiaoProgress,
        openPhonics,
        renderPhonicsScreen,
    };
})();

window.App = App;

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
    App.boot();
});
