// ===== ころころ惑星 物理・合体ルール（画面とは切り離してテストできるようにしている） =====
// 論理座標：幅 400 × 高さ 640。箱は x = BOX_L〜BOX_R、底は BOX_B、上の線（ここを越えて積むとアウト）は LINE_Y
//
// 物理は Matter.js 0.19.0（matter.min.js を同梱, MIT License, https://brm.io/matter-js/）。
// 動きの設定は、参考にした fruit.js（フルーツまぜまぜ）に合わせている：
//   ・1/60 秒刻みで更新、位置の補正 10 回・速度の補正 8 回、重力 1.15
//   ・惑星：跳ね返り 0.15、摩擦 0.08、静止摩擦 0.4、密度 0.0012、slop 0.02
//   ・壁と床：摩擦 0.3、跳ね返り 0.1（箱の外側に置いた長方形）
//   ・同じ惑星どうしが触れた瞬間に 2 つを消し、真ん中に 1 段階大きい惑星を出す
//   ・落としてから 1.5 秒以上たった惑星が、線より上でほぼ止まって（速さ 1.2 未満）いる状態が
//     2.5 秒続いたらゲームオーバー
'use strict';

const MergeCore = (() => {
  const Mt = typeof Matter !== 'undefined' ? Matter : require('./matter.min.js');
  const { Engine, Bodies, Composite, Events, Body } = Mt;

  const W = 400, H = 640;
  const BOX_L = 22, BOX_R = 378, BOX_B = 620, LINE_Y = 150, DROP_Y = 92;
  const STEP_MS = 1000 / 60;         // 物理の刻み（fruit.js と同じ）
  const GRAVITY_Y = 1.15;
  const BODY_OPT = { restitution: 0.15, friction: 0.08, frictionStatic: 0.4, density: 0.0012, slop: 0.02 };
  const WALL_OPT = { isStatic: true, friction: 0.3, restitution: 0.1 };
  const OVER_LIMIT = 2.5;            // 線を越えて止まっている状態がこの秒数続いたらアウト
  const SETTLE_AGE = 1.5;            // 落としてからこの秒数たった惑星だけを判定する
  const STILL_SPEED = 1.2;           // これより遅ければ「止まっている」（Matter.js の速さ＝1 ステップあたりの px）

  // 12段階：ほし屑 → 小惑星 → 月 → 水星 → 火星 → 金星 → 地球 → 海王星 → 天王星 → 土星 → 木星 → 太陽
  //          →（太陽2つで）超新星になって消える。消えたらまた積めるので、上限なくスコアを稼げる
  const KINDS = [
    { name: 'ほし屑', r: 12  },
    { name: '小惑星', r: 16  },
    { name: '月',     r: 21  },
    { name: '水星',   r: 27  },
    { name: '火星',   r: 34  },
    { name: '金星',   r: 42  },
    { name: '地球',   r: 51  },
    { name: '海王星', r: 61  },
    { name: '天王星', r: 72  },
    { name: '土星',   r: 84  },
    { name: '木星',   r: 98  },
    { name: '太陽',   r: 112 },   // 箱の幅 356 に2つ横並びできない大きさ → 縦に重なって必ずくっつく
  ];
  const SUN = KINDS.length;          // 太陽どうしが合体すると超新星になって消える（大ボーナス）
  const DROP_KINDS = 5;              // 落とせるのは小さいほうから5種類
  // 得点：合体してできた惑星の段階に応じて（三角数）
  const POINTS = KINDS.map((_, i) => ((i + 1) * (i + 2)) / 2);
  const SUN_BONUS = 200;             // 超新星のボーナス

  let nextId = 1;

  // ---------- 世界 ----------
  function createWorld(rand = Math.random) {
    const engine = Engine.create({ positionIterations: 10, velocityIterations: 8 });
    engine.gravity.y = GRAVITY_Y;
    const thick = 60, tall = H * 2;
    Composite.add(engine.world, [
      Bodies.rectangle((BOX_L + BOX_R) / 2, BOX_B + thick / 2, BOX_R - BOX_L + 200, thick, WALL_OPT),  // 床
      Bodies.rectangle(BOX_L - thick / 2, BOX_B - tall / 2, thick, tall, WALL_OPT),                    // 左の壁
      Bodies.rectangle(BOX_R + thick / 2, BOX_B - tall / 2, thick, tall, WALL_OPT),                    // 右の壁
    ]);
    const w = {
      engine, bodies: [], time: 0, acc: 0, score: 0, merges: 0, maxLevel: 0, suns: 0, novas: 0,
      rand, events: [], pending: [],
      current: randomDrop(rand, 0), next: randomDrop(rand, 0),
      overTime: 0, danger: 0, gameOver: false,
    };
    // 同じ惑星どうしが触れたら、その瞬間に合体（fruit.js と同じく、触れ始めと触れ続けの両方で見る）
    const onCollide = (e) => { for (const p of e.pairs) w.pending.push([p.bodyA, p.bodyB]); };
    Events.on(engine, 'collisionStart', onCollide);
    Events.on(engine, 'collisionActive', onCollide);
    return w;
  }

  // 次に落とす惑星。最初のうちは小さいものが出やすい
  function randomDrop(rand, maxLevel) {
    const top = Math.min(DROP_KINDS, Math.max(3, maxLevel));
    return Math.floor(rand() * top);
  }

  function clampDropX(level, x) {
    const r = KINDS[level].r;
    return Math.max(BOX_L + r + 2, Math.min(BOX_R - r - 2, x));
  }

  // 画面側は b.x / b.y / b.r / b.angle / b.level / b.over を読む
  function addBody(w, level, x, y, born) {
    const r = KINDS[level].r;
    const mb = Bodies.circle(x, y, r, BODY_OPT);
    const b = { id: nextId++, level, r, x, y, px: x, py: y, angle: 0, born, over: 0, gone: false, mb };
    mb.planet = b;
    Composite.add(w.engine.world, mb);
    w.bodies.push(b);
    return b;
  }
  function removeBody(w, b) {
    b.gone = true;
    Composite.remove(w.engine.world, b.mb);
  }

  function drop(w, x) {
    if (w.gameOver) return null;
    const lv = w.current;
    const b = addBody(w, lv, clampDropX(lv, x), DROP_Y, w.time);
    w.current = w.next;
    w.next = randomDrop(w.rand, w.maxLevel);
    return b;
  }

  // dt 秒ぶん進める（中では 1/60 秒刻みで Matter.js を更新。1 回の呼び出しで最大 3 刻みまで）
  function step(w, dt) {
    w.events = [];
    if (w.gameOver) return w.events;
    w.acc += dt * 1000;
    let n = 0;
    while (w.acc >= STEP_MS && n < 3) {
      for (const b of w.bodies) { b.px = b.mb.position.x; b.py = b.mb.position.y; }
      Engine.update(w.engine, STEP_MS);
      w.acc -= STEP_MS; n++;
      w.time += STEP_MS / 1000;
      merge(w);
      sync(w);
      judge(w, STEP_MS / 1000);
      if (w.gameOver) break;
    }
    if (n === 3) w.acc = Math.min(w.acc, STEP_MS);     // 遅れがたまりすぎないように
    return w.events;
  }

  function sync(w) {
    for (const b of w.bodies) { b.x = b.mb.position.x; b.y = b.mb.position.y; b.angle = b.mb.angle; }
  }

  function merge(w) {
    const pairs = w.pending;
    w.pending = [];
    for (const [ma, mc] of pairs) {
      const a = ma.planet, c = mc.planet;
      if (!a || !c || a.gone || c.gone || a.level !== c.level) continue;
      const x = (ma.position.x + mc.position.x) / 2, y = (ma.position.y + mc.position.y) / 2;
      const lv = a.level + 1;
      removeBody(w, a); removeBody(w, c);
      w.merges++;
      if (lv === SUN) {                      // 太陽 + 太陽 → 超新星（消える）
        w.score += SUN_BONUS;
        w.novas++;
        w.events.push({ type: 'nova', x, y, points: SUN_BONUS });
      } else {
        addBody(w, lv, x, y, w.time - 2);    // 合体でできたものはすぐに判定の対象
        w.score += POINTS[lv];
        if (lv > w.maxLevel) w.maxLevel = lv;
        if (lv === SUN - 1) w.suns++;        // 太陽ができた
        w.events.push({ type: 'merge', x, y, level: lv, points: POINTS[lv] });
      }
    }
    if (w.bodies.some((b) => b.gone)) w.bodies = w.bodies.filter((b) => !b.gone);
  }

  // ゲームオーバー判定（fruit.js と同じ考え方）
  function judge(w, dt) {
    let anyOver = false;
    for (const b of w.bodies) {
      const v = b.mb.velocity;
      const isOver = w.time - b.born > SETTLE_AGE && b.y - b.r < LINE_Y && Math.hypot(v.x, v.y) < STILL_SPEED;
      b.over = isOver ? b.over + dt : 0;
      if (isOver) anyOver = true;
    }
    w.overTime = anyOver ? w.overTime + dt : 0;
    w.danger = Math.min(1, w.overTime / OVER_LIMIT);
    if (w.overTime > OVER_LIMIT) {
      w.gameOver = true;
      w.events.push({ type: 'gameover' });
    }
  }

  // ---------- 保存・復元（位置と向きを保存。再開時は止まった状態から） ----------
  function serialize(w) {
    return {
      bodies: w.bodies.map((b) => ({ level: b.level, x: b.x, y: b.y, angle: b.angle })),
      time: w.time, score: w.score, merges: w.merges, maxLevel: w.maxLevel, suns: w.suns, novas: w.novas,
      current: w.current, next: w.next, gameOver: w.gameOver,
    };
  }
  function restore(s, rand = Math.random) {
    const w = createWorld(rand);
    Object.assign(w, { time: s.time || 0, score: s.score || 0, merges: s.merges || 0, maxLevel: s.maxLevel || 0, suns: s.suns || 0, novas: s.novas || 0, current: s.current || 0, next: s.next || 0, gameOver: !!s.gameOver });
    for (const o of s.bodies || []) {
      const b = addBody(w, o.level, o.x, o.y, w.time - 2);
      if (o.angle) { Body.setAngle(b.mb, o.angle); b.angle = o.angle; }
    }
    return w;
  }

  return {
    W, H, BOX_L, BOX_R, BOX_B, LINE_Y, DROP_Y, KINDS, SUN, POINTS, SUN_BONUS, DROP_KINDS,
    createWorld, drop, step, clampDropX, serialize, restore,
  };
})();

if (typeof module !== 'undefined') module.exports = MergeCore;
