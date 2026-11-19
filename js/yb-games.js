/* 音标课挑战：字母大冒险 / 字母快乐谷。纯静态，进度写入当前账号 yinbiao.challenges。 */
(function () {
  'use strict';

  var API = window.App;
  var LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  var FOCUS = ['b', 'd', 'p', 'q', 'l', 'I'];
  var OTHER = LETTERS.map(function (l) { return l.toLowerCase(); }).filter(function (l) { return FOCUS.indexOf(l) < 0; });
  var LETTER_POOL = FOCUS.reduce(function (a, c) { return a.concat(Array(5).fill(c)); }, [])
    .concat(OTHER.reduce(function (a, c) { return a.concat(Array(2).fill(c)); }, []));
  var TARGET_POOL = FOCUS.reduce(function (a, c) { return a.concat(Array(2).fill(c)); }, [])
    .concat(OTHER.map(function (c) { return c; }));

  function $(id) { return document.getElementById(id); }
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  function progress() {
    var all = API ? API.getYinbiaoProgress() : {};
    all.challenges = all.challenges || {};
    return all;
  }
  function saveProgress() {
    if (API) API.setYinbiaoProgress(progress());
  }
  function playLetter(ch) {
    if (window.WordAudio && WordAudio.sayPack) {
      WordAudio.sayPack('ipa', 'l-' + ch.toLowerCase(), null, ch);
      return;
    }
    var audio = new Audio('audio/ipa/l-' + ch.toLowerCase() + '.mp3');
    audio.currentTime = 0;
    var p = audio.play();
    if (p && p.catch) p.catch(function () {});
  }
  function showView(screenId, viewId) {
    var screen = $(screenId);
    if (!screen) return;
    screen.querySelectorAll('.yb-game-view').forEach(function (v) {
      v.classList.toggle('hidden', v.id !== viewId);
      v.classList.toggle('active', v.id === viewId);
    });
  }

  /* ===== 字母大冒险 ===== */
  var adv = {
    running: false, score: 0, combo: 0, maxCombo: 0, correct: 0, mistakes: 0,
    elapsed: 0, target: 'b', items: [], raf: null, spawnTimer: null,
    tickTimer: null, targetTimer: null, lastFrame: 0, arena: null
  };
  var ADV_DURATION = 180;

  function advDifficulty() {
    if (adv.elapsed < 30) return { fall: 4000, max: 3, gap: 1100, bias: 0.4 };
    if (adv.elapsed < 90) return { fall: 3000, max: 5, gap: 900, bias: 0.38 };
    if (adv.elapsed < 150) return { fall: 2500, max: 6, gap: 760, bias: 0.35 };
    return { fall: 2000, max: 8, gap: 600, bias: 0.32 };
  }

  function advSetTarget(play) {
    adv.target = pick(TARGET_POOL);
    $('adv-target-letter').textContent = adv.target;
    if (play !== false) playLetter(adv.target);
  }

  function advUpdateHud() {
    var left = Math.max(0, ADV_DURATION - adv.elapsed);
    $('adv-time').textContent = '⏱ ' + String(Math.floor(left / 60)).padStart(2, '0') + ':' + String(left % 60).padStart(2, '0');
    $('adv-score').textContent = '得分 ' + adv.score;
    $('adv-combo').textContent = '连击 ' + adv.combo;
    $('adv-progress-fill').style.width = (left / ADV_DURATION * 100) + '%';
  }

  function advFeedback(text, bad) {
    var el = $('adv-feedback');
    if (!el) return;
    el.textContent = text;
    el.style.color = bad ? 'var(--danger)' : 'var(--success)';
  }

  function advSpawn() {
    if (!adv.running || !adv.arena) return;
    var d = advDifficulty();
    adv.items = adv.items.filter(function (x) { return x.el.isConnected; });
    if (adv.items.length >= d.max) return;
    var ch = Math.random() < d.bias ? adv.target : pick(LETTER_POOL);
    var el = document.createElement('div');
    el.className = 'falling-letter';
    el.textContent = ch;
    el.style.left = (8 + Math.random() * 82) + '%';
    el.style.transform = 'rotate(' + (-12 + Math.random() * 24) + 'deg)';
    var item = { el: el, ch: ch, y: -60, speed: d.fall };
    el.addEventListener('pointerdown', function (e) {
      e.stopPropagation();
      advTap(item);
    });
    adv.arena.appendChild(el);
    adv.items.push(item);
  }

  function advTap(item) {
    if (!adv.running) return;
    if (item.ch === adv.target) {
      item.el.classList.add('correct');
      adv.score += 10;
      adv.combo++;
      adv.correct++;
      adv.maxCombo = Math.max(adv.maxCombo, adv.combo);
      advFeedback('✅ 找到了 ' + adv.target + '！+10', false);
      playLetter(adv.target);
    } else {
      item.el.classList.add('wrong');
      adv.combo = 0;
      adv.mistakes++;
      advFeedback('✗ 这是 ' + item.ch + '，目标是 ' + adv.target, true);
    }
    advUpdateHud();
    setTimeout(function () {
      if (item.el.parentNode) item.el.parentNode.removeChild(item.el);
      adv.items = adv.items.filter(function (x) { return x !== item; });
    }, 180);
  }

  function advFrame(now) {
    if (!adv.running || !adv.arena) return;
    var dt = Math.min(80, now - adv.lastFrame) / 1000;
    adv.lastFrame = now;
    var h = adv.arena.clientHeight;
    adv.items.slice().forEach(function (item) {
      item.y += (h / item.speed) * dt * 1000;
      item.el.style.top = item.y + 'px';
      if (item.y > h) {
        if (item.el.parentNode) item.el.parentNode.removeChild(item.el);
        adv.items = adv.items.filter(function (x) { return x !== item; });
      }
    });
    adv.raf = requestAnimationFrame(advFrame);
  }

  function advScheduleSpawn() {
    clearTimeout(adv.spawnTimer);
    adv.spawnTimer = setTimeout(function () {
      advSpawn();
      advScheduleSpawn();
    }, advDifficulty().gap);
  }

  function advScheduleTarget() {
    clearTimeout(adv.targetTimer);
    var seconds = 10 + Math.floor(Math.random() * 3);
    adv.targetTimer = setTimeout(function () {
      advSetTarget(true);
      advScheduleTarget();
    }, seconds * 1000);
  }

  function advStop() {
    adv.running = false;
    clearTimeout(adv.spawnTimer);
    clearTimeout(adv.targetTimer);
    clearInterval(adv.tickTimer);
    if (adv.raf) cancelAnimationFrame(adv.raf);
    adv.items = [];
    if (adv.arena) adv.arena.innerHTML = '';
  }

  function advEnd() {
    advStop();
    var total = adv.correct + adv.mistakes;
    var accuracy = total ? Math.round(adv.correct / total * 100) : 0;
    var stars = accuracy >= 85 && adv.maxCombo >= 10 ? 3 : (accuracy >= 65 ? 2 : 1);
    var all = progress();
    all.challenges.adventure = all.challenges.adventure || {};
    if (adv.score > (all.challenges.adventure.bestScore || 0)) {
      all.challenges.adventure.bestScore = adv.score;
      all.challenges.adventure.bestStars = stars;
    }
    saveProgress();
    $('adv-end-stars').textContent = '⭐'.repeat(stars) + '☆'.repeat(3 - stars);
    $('adv-end-verdict').textContent = stars === 3 ? '反应真快！' : (stars === 2 ? '不错，再练练就更快啦！' : '多玩几局，字母会越来越熟！');
    $('adv-end-stats').innerHTML =
      '<div>得分<br><b>' + adv.score + '</b></div>' +
      '<div>答对<br><b>' + adv.correct + '</b></div>' +
      '<div>准确率<br><b>' + accuracy + '%</b></div>';
    showView('yb-adventure-screen', 'adv-end');
  }

  var YBAdventure = {
    stop: advStop,
    showHome: function () { advStop(); showView('yb-adventure-screen', 'adv-home'); },
    playTarget: function () { playLetter(adv.target); },
    start: function () {
      advStop();
      showView('yb-adventure-screen', 'adv-game');
      adv.arena = $('adv-arena');
      adv.running = true;
      adv.score = 0; adv.combo = 0; adv.maxCombo = 0;
      adv.correct = 0; adv.mistakes = 0; adv.elapsed = 0;
      advFeedback('准备…', false);
      advUpdateHud();
      advSetTarget(true);
      advSpawn();
      advScheduleSpawn();
      advScheduleTarget();
      adv.lastFrame = performance.now();
      adv.raf = requestAnimationFrame(advFrame);
      adv.tickTimer = setInterval(function () {
        adv.elapsed++;
        advUpdateHud();
        if (adv.elapsed >= ADV_DURATION) advEnd();
      }, 1000);
    }
  };

  /* ===== 字母快乐谷 ===== */
  var UPPER_STROKES = {
    A: ['M 150,30 L 45,190', 'M 150,30 L 255,190', 'M 80,140 L 220,140'],
    B: ['M 60,30 L 60,190', 'M 60,30 Q 180,30 180,75 Q 180,110 60,110', 'M 60,110 Q 195,110 195,150 Q 195,190 60,190'],
    C: ['M 240,70 A 100,80 0 1,0 240,150'],
    D: ['M 60,30 L 60,190', 'M 60,30 Q 240,30 240,110 Q 240,190 60,190'],
    E: ['M 60,30 L 60,190', 'M 60,30 L 195,30', 'M 60,110 L 165,110', 'M 60,190 L 195,190'],
    F: ['M 60,30 L 60,190', 'M 60,30 L 195,30', 'M 60,110 L 165,110'],
    G: ['M 240,70 A 100,80 0 1,0 240,150', 'M 240,150 L 240,120 L 175,120'],
    H: ['M 60,30 L 60,190', 'M 240,30 L 240,190', 'M 60,110 L 240,110'],
    I: ['M 90,30 L 210,30', 'M 150,30 L 150,190', 'M 90,190 L 210,190'],
    J: ['M 90,30 L 210,30', 'M 150,30 L 150,160 Q 150,190 105,190 Q 60,190 60,160'],
    K: ['M 60,30 L 60,190', 'M 240,30 L 60,110', 'M 60,110 L 240,190'],
    L: ['M 60,30 L 60,190', 'M 60,190 L 210,190'],
    M: ['M 45,30 L 45,190', 'M 45,30 L 150,130', 'M 150,130 L 255,30', 'M 255,30 L 255,190'],
    N: ['M 60,30 L 60,190', 'M 60,30 L 240,190', 'M 240,30 L 240,190'],
    O: ['M 60,110 A 90,80 0 0,1 240,110 A 90,80 0 0,1 60,110'],
    P: ['M 60,30 L 60,190', 'M 60,30 Q 210,30 210,70 Q 210,110 60,110'],
    Q: ['M 60,110 A 90,80 0 0,1 240,110 A 90,80 0 0,1 60,110', 'M 180,150 L 255,205'],
    R: ['M 60,30 L 60,190', 'M 60,30 Q 210,30 210,70 Q 210,110 60,110', 'M 130,110 L 240,190'],
    S: ['M 220,55 Q 220,30 145,30 Q 60,30 60,80 Q 60,110 145,110 Q 230,110 230,150 Q 230,190 145,190 Q 75,190 75,165'],
    T: ['M 45,30 L 255,30', 'M 150,30 L 150,190'],
    U: ['M 60,30 L 60,155 Q 60,190 150,190 Q 240,190 240,155 L 240,30'],
    V: ['M 45,30 L 150,190', 'M 150,190 L 255,30'],
    W: ['M 30,30 L 90,190', 'M 90,190 L 150,80', 'M 150,80 L 210,190', 'M 210,190 L 270,30'],
    X: ['M 45,30 L 255,190', 'M 255,30 L 45,190'],
    Y: ['M 45,30 L 150,110', 'M 255,30 L 150,110', 'M 150,110 L 150,190'],
    Z: ['M 45,30 L 255,30', 'M 255,30 L 45,190', 'M 45,190 L 255,190']
  };
  var STARTS = {
    A: [{x:130,y:50},{x:170,y:50},{x:75,y:135}], B: [{x:60,y:30},{x:95,y:55},{x:60,y:115}],
    C: [{x:240,y:70}], D: [{x:60,y:30},{x:95,y:45}], E: [{x:55,y:50},{x:80,y:25},{x:65,y:105},{x:65,y:185}],
    F: [{x:55,y:50},{x:80,y:25},{x:65,y:105}], G: [{x:240,y:70},{x:240,y:150}],
    H: [{x:60,y:30},{x:240,y:30},{x:60,y:110}], I: [{x:90,y:30},{x:150,y:30},{x:90,y:190}],
    J: [{x:90,y:30},{x:150,y:30}], K: [{x:60,y:30},{x:240,y:30},{x:60,y:110}],
    L: [{x:60,y:30},{x:60,y:190}], M: [{x:30,y:60},{x:60,y:30},{x:165,y:130},{x:255,y:30}],
    N: [{x:45,y:60},{x:75,y:30},{x:240,y:30}], O: [{x:60,y:115}], P: [{x:60,y:30},{x:95,y:45}],
    Q: [{x:60,y:115},{x:185,y:155}], R: [{x:60,y:30},{x:95,y:45},{x:135,y:115}],
    S: [{x:220,y:55}], T: [{x:45,y:30},{x:150,y:30}], U: [{x:60,y:30}],
    V: [{x:45,y:30},{x:150,y:185}], W: [{x:30,y:30},{x:90,y:185},{x:150,y:85},{x:210,y:185}],
    X: [{x:45,y:30},{x:255,y:30}], Y: [{x:45,y:30},{x:255,y:30},{x:160,y:115}],
    Z: [{x:45,y:30},{x:255,y:30},{x:45,y:190}]
  };
  var KEYPOINTS = {
    A: {start:{x:150,y:30},end:{x:255,y:190}}, B: {start:{x:60,y:30},end:{x:60,y:190}},
    C: {start:{x:240,y:70},end:{x:240,y:150}}, D: {start:{x:60,y:30},end:{x:60,y:190}},
    E: {start:{x:60,y:30},end:{x:195,y:190}}, F: {start:{x:60,y:30},end:{x:165,y:110}},
    G: {start:{x:240,y:70},end:{x:175,y:120}}, H: {start:{x:60,y:30},end:{x:240,y:190}},
    I: {start:{x:90,y:30},end:{x:210,y:190}}, J: {start:{x:90,y:30},end:{x:60,y:160}},
    K: {start:{x:60,y:30},end:{x:240,y:190}}, L: {start:{x:60,y:30},end:{x:210,y:190}},
    M: {start:{x:45,y:30},end:{x:255,y:190}}, N: {start:{x:60,y:30},end:{x:240,y:190}},
    O: {start:{x:60,y:110},end:{x:60,y:110}}, P: {start:{x:60,y:30},end:{x:60,y:190}},
    Q: {start:{x:60,y:110},end:{x:255,y:205}}, R: {start:{x:60,y:30},end:{x:240,y:190}},
    S: {start:{x:220,y:55},end:{x:75,y:165}}, T: {start:{x:45,y:30},end:{x:150,y:190}},
    U: {start:{x:60,y:30},end:{x:240,y:30}}, V: {start:{x:45,y:30},end:{x:255,y:30}},
    W: {start:{x:30,y:30},end:{x:270,y:30}}, X: {start:{x:45,y:30},end:{x:255,y:190}},
    Y: {start:{x:45,y:30},end:{x:150,y:190}}, Z: {start:{x:45,y:30},end:{x:255,y:190}}
  };
  var valley = { letter: 'A', strokes: [], drawing: false, canvas: null, ctx: null };

  function valleyBest() {
    var all = progress();
    all.challenges.valley = all.challenges.valley || {};
    all.challenges.valley.bestScores = all.challenges.valley.bestScores || {};
    return all.challenges.valley.bestScores;
  }

  function valleyBuildGrid() {
    var grid = $('valley-grid');
    if (!grid) return;
    var best = valleyBest();
    grid.innerHTML = LETTERS.map(function (l) {
      return '<button type="button" class="valley-letter-btn' + ((best[l] || 0) >= 90 ? ' mastered' : '') + '" data-letter="' + l + '">' + l +
        ((best[l] || 0) >= 90 ? '<br>⭐' : '') + '</button>';
    }).join('');
    grid.querySelectorAll('.valley-letter-btn').forEach(function (btn) {
      btn.onclick = function () { valleyStart(btn.dataset.letter); };
    });
  }

  function valleySetupCanvas() {
    var canvas = $('valley-canvas');
    valley.canvas = canvas;
    valley.ctx = canvas.getContext('2d');
    var rect = canvas.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(300, Math.round(rect.width * dpr));
    canvas.height = Math.max(300, Math.round(rect.height * dpr));
    valley.draw();
  }

  function valleyDraw() {
    if (!valley.ctx || !valley.canvas) return;
    var ctx = valley.ctx;
    var dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr * valley.canvas.clientWidth / 300, 0, 0, dpr * valley.canvas.clientHeight / 300, 0, 0);
    ctx.clearRect(0, 0, 300, 300);
    ctx.strokeStyle = '#ff4757';
    ctx.lineWidth = 10;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    valley.strokes.forEach(function (stroke) {
      if (!stroke.length) return;
      ctx.beginPath();
      ctx.moveTo(stroke[0].x, stroke[0].y);
      stroke.slice(1).forEach(function (p) { ctx.lineTo(p.x, p.y); });
      ctx.stroke();
    });
  }

  function valleyPoint(e) {
    var rect = valley.canvas.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / rect.width * 300, y: (e.clientY - rect.top) / rect.height * 300 };
  }

  function valleyBindCanvas() {
    var canvas = $('valley-canvas');
    canvas.onpointerdown = function (e) {
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      valley.drawing = true;
      valley.strokes.push([valleyPoint(e)]);
      valley.draw();
    };
    canvas.onpointermove = function (e) {
      if (!valley.drawing) return;
      e.preventDefault();
      valley.strokes[valley.strokes.length - 1].push(valleyPoint(e));
      valley.draw();
    };
    var end = function () { valley.drawing = false; };
    canvas.onpointerup = end;
    canvas.onpointercancel = end;
    canvas.onpointerleave = end;
  }

  function valleyRenderGuide(letter) {
    var svg = $('valley-guide');
    svg.innerHTML = '';
    var ns = 'http://www.w3.org/2000/svg';
    (UPPER_STROKES[letter] || []).forEach(function (d, i) {
      var path = document.createElementNS(ns, 'path');
      path.setAttribute('d', d);
      path.setAttribute('class', 'valley-guide-path');
      svg.appendChild(path);
      var s = (STARTS[letter] || [])[i];
      if (s) {
        var circle = document.createElementNS(ns, 'circle');
        circle.setAttribute('cx', s.x); circle.setAttribute('cy', s.y); circle.setAttribute('r', 8);
        circle.setAttribute('class', 'valley-guide-start');
        svg.appendChild(circle);
        var text = document.createElementNS(ns, 'text');
        text.setAttribute('x', s.x + 10); text.setAttribute('y', s.y - 8);
        text.setAttribute('class', 'valley-guide-num');
        text.textContent = i + 1;
        svg.appendChild(text);
      }
    });
  }

  function valleyStart(letter) {
    valley.letter = letter;
    valley.strokes = [];
    valley.drawing = false;
    $('valley-current-letter').textContent = letter;
    $('valley-feedback').textContent = '从编号 1 的起点开始，沿着灰色笔画书写。';
    showView('yb-valley-screen', 'valley-write');
    valleyRenderGuide(letter);
    valleySetupCanvas();
    valleyBindCanvas();
    playLetter(letter);
  }

  function valleyDistance(p, q) { return Math.hypot(p.x - q.x, p.y - q.y); }
  function valleyPathPoints(svg, d, count) {
    var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    path.style.display = 'none';
    svg.appendChild(path);
    var len = path.getTotalLength();
    var pts = [];
    for (var i = 0; i <= count; i++) {
      var p = path.getPointAtLength(len * i / count);
      pts.push({ x: p.x, y: p.y });
    }
    svg.removeChild(path);
    return pts;
  }

  function valleyCalculateScore() {
    var expected = UPPER_STROKES[valley.letter] || [];
    var starts = STARTS[valley.letter] || [];
    var key = KEYPOINTS[valley.letter] || { start: {x:150,y:30}, end: {x:150,y:190} };
    var tolerance = /Mobi|Android|iPad|iPhone/i.test(navigator.userAgent) ? 65 : 45;
    var allPoints = valley.strokes.reduce(function (a, s) { return a.concat(s); }, []);
    function nearestScore(point) {
      if (!allPoints.length) return 0;
      var min = Math.min.apply(null, allPoints.map(function (p) { return valleyDistance(p, point); }));
      return Math.max(0, 1 - min / tolerance);
    }
    var coverage = 0;
    var svg = $('valley-guide');
    expected.forEach(function (d) {
      var pts = valleyPathPoints(svg, d, 16);
      var hit = pts.filter(nearestScore).length;
      coverage += hit / pts.length;
    });
    coverage = expected.length ? coverage / expected.length : 0;
    var strokeScore = Math.max(0, 25 - Math.abs(valley.strokes.length - expected.length) * 8);
    function pointScore(p) {
      if (!allPoints.length) return 0;
      var d = Math.min.apply(null, allPoints.map(function (x) { return valleyDistance(x, p); }));
      return Math.max(0, 25 - d / tolerance * 25);
    }
    var first = allPoints[0] || {x:-999,y:-999};
    var last = allPoints[allPoints.length - 1] || {x:-999,y:-999};
    var startScore = pointScore(key.start);
    var endScore = pointScore(key.end);
    return Math.round(strokeScore + startScore + endScore + coverage * 25);
  }

  function valleySubmit() {
    var score = valleyCalculateScore();
    var stars = score >= 90 ? 3 : (score >= 70 ? 2 : (score >= 50 ? 1 : 0));
    var best = valleyBest();
    if (score > (best[valley.letter] || 0)) {
      best[valley.letter] = score;
      saveProgress();
    }
    $('valley-result-letter').textContent = valley.letter;
    $('valley-score').textContent = score + ' 分';
    $('valley-stars').textContent = '⭐'.repeat(stars) + '☆'.repeat(3 - stars);
    $('valley-result-tip').textContent = stars === 3 ? '写得非常棒！' : (stars >= 1 ? '继续练习会更标准。' : '看看示范，再写一次吧。');
    showView('yb-valley-screen', 'valley-result');
  }

  function valleyDemo() {
    var svg = $('valley-guide');
    (UPPER_STROKES[valley.letter] || []).forEach(function (d, i) {
      var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', d);
      path.setAttribute('class', 'valley-guide-demo');
      path.style.animationDelay = (i * 0.35) + 's';
      svg.appendChild(path);
      setTimeout(function () { if (path.parentNode) path.parentNode.removeChild(path); }, 2200);
    });
    playLetter(valley.letter);
  }

  var YBValley = {
    refresh: function () { valleyBuildGrid(); showView('yb-valley-screen', 'valley-home'); },
    home: function () { valleyBuildGrid(); showView('yb-valley-screen', 'valley-home'); },
    playLetter: function () { playLetter(valley.letter); },
    clear: function () { valley.strokes = []; valley.draw(); },
    demo: valleyDemo,
    submit: valleySubmit,
    retry: function () { valleyStart(valley.letter); },
    next: function () {
      var i = LETTERS.indexOf(valley.letter);
      valleyStart(LETTERS[(i + 1) % LETTERS.length]);
    }
  };

  window.YBAdventure = YBAdventure;
  window.YBValley = YBValley;
  valleyBuildGrid();
})();
