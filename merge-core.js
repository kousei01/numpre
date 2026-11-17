// ===== まぜまぜフルーツ 物理・合体ルール（画面とは切り離してテストできるようにしている） =====
// 論理座標：幅 400 × 高さ 640。箱は x = BOX_L〜BOX_R、底は BOX_B、上の線（ここを越えて積むとアウト）は LINE_Y
// 物理は「位置ベースの Verlet 積分」：速度を持たず、前の位置との差を速度として扱う。
// 円どうしの重なりを何度も押し戻すことで、積み重なっても安定しやすい。
'use strict';

const MergeCore = (() => {
  const W = 400, H = 640;
  const BOX_L = 22, BOX_R = 378, BOX_B = 620, LINE_Y = 150, DROP_Y = 92;
  const GRAVITY = 1500;              // px/s²
  const ITER = 8;                    // 押し戻しの繰り返し回数（多いほど積み重ねが安定）
  const DAMP = 0.995;                // 空気抵抗
  const FRICTION = 0.12;             // 壁・床との摩擦
  const MAX_V = 1100;                // 速さの上限（px/s）。重なりの押し戻しで弾け飛ばないように
  const OVER_LIMIT = 2.5;            // 線を越えた状態がこの秒数続いたらアウト
  const GROW = 0.12;                 // 合体でできた惑星が元の大きさまで膨らむ時間（秒）

  // 11段階：ブルーベリー → ラズベリー → ライチ → キウイ → レモン → みかん → もも → 青りんご
  //          → グレープフルーツ → マンゴー → ココナッツ →（ココナッツ2つで）フルーツバスケット
  const KINDS = [
    { name: 'ブルーベリー',     r: 12  },
    { name: 'ラズベリー',       r: 16  },
    { name: 'ライチ',           r: 21  },
    { name: 'キウイ',           r: 27  },
    { name: 'レモン',           r: 34  },
    { name: 'みかん',           r: 42  },
    { name: 'もも',             r: 51  },
    { name: '青りんご',         r: 61  },
    { name: 'グレープフルーツ', r: 72  },
    { name: 'マンゴー',         r: 84  },
    { name: 'ココナッツ',       r: 98  },
  ];
  const SUN = KINDS.length;          // ココナッツどうしが合体するとフルーツバスケットになって消える（大ボーナス）
  const DROP_KINDS = 5;              // 落とせるのは小さいほうから5種類
  // 得点：合体してできた惑星の段階に応じて（三角数）
  const POINTS = KINDS.map((_, i) => ((i + 1) * (i + 2)) / 2);
  const SUN_BONUS = 100;

  let nextId = 1;
  function body(level, x, y, vx = 0, vy = 0, dt = 1 / 120) {
    const r = KINDS[level].r;
    // full = 本来の半径。r は膨らんでいる途中の半径
    return { id: nextId++, level, r, full: r, m: r * r, x, y, px: x - vx * dt, py: y - vy * dt, angle: 0, born: 0, over: 0, grow: 1 };
  }

  function createWorld(rand = Math.random) {
    return {
      bodies: [], time: 0, score: 0, merges: 0, maxLevel: 0, suns: 0,
      rand, events: [],
      current: randomDrop(rand, 0), next: randomDrop(rand, 0),
      overTime: 0, gameOver: false,
    };
  }

  // 次に落とす惑星。最初のうちは小さいものが出やすい
  function randomDrop(rand, maxLevel) {
    const top = Math.min(DROP_KINDS, Math.max(3, maxLevel));
    return Math.floor(rand() * top);
  }

  function clampDropX(level, x) {
    const r = KINDS[level].r;
    return Math.max(BOX_L + r, Math.min(BOX_R - r, x));
  }

  function drop(w, x) {
    if (w.gameOver) return null;
    const lv = w.current;
    const b = body(lv, clampDropX(lv, x), DROP_Y, 0, 120);
    b.born = w.time;
    w.bodies.push(b);
    w.current = w.next;
    w.next = randomDrop(w.rand, w.maxLevel);
    return b;
  }

  function step(w, dt) {
    w.events = [];
    if (w.gameOver) return w.events;
    w.time += dt;
    const bs = w.bodies;

    // 1. 動かす（Verlet）。合体直後の惑星は少しずつ膨らませる
    const vmax = MAX_V * dt;
    for (const b of bs) {
      if (b.grow < 1) {
        b.grow = Math.min(1, b.grow + dt / GROW);
        const from = b.level > 0 ? KINDS[b.level - 1].r : b.full;
        b.r = from + (b.full - from) * b.grow;
        b.m = b.r * b.r;
      }
      let vx = (b.x - b.px) * DAMP, vy = (b.y - b.py) * DAMP;
      const sp = Math.hypot(vx, vy);
      if (sp > vmax) { vx *= vmax / sp; vy *= vmax / sp; }
      b.px = b.x; b.py = b.y;
      b.x += vx; b.y += vy + GRAVITY * dt * dt;
    }

    // 2. 重なりと壁を何度も直す
    for (let it = 0; it < ITER; it++) {
      for (let i = 0; i < bs.length; i++) {
        const a = bs[i];
        for (let j = i + 1; j < bs.length; j++) {
          const c = bs[j];
          const dx = c.x - a.x, dy = c.y - a.y;
          const rr = a.r + c.r;
          const d2 = dx * dx + dy * dy;
          if (d2 >= rr * rr || d2 === 0) continue;
          const d = Math.sqrt(d2), over = rr - d;
          const nx = dx / d, ny = dy / d;
          const ka = c.m / (a.m + c.m), kc = a.m / (a.m + c.m);   // 重いほうは動きにくい
          a.x -= nx * over * ka; a.y -= ny * over * ka;
          c.x += nx * over * kc; c.y += ny * over * kc;
        }
      }
      for (const b of bs) walls(b);
    }

    // 3. 転がる見た目（横の移動量で回す）
    for (const b of bs) b.angle += (b.x - b.px) / b.r;

    // 4. 合体
    merge(w);

    // 5. ゲームオーバー判定：落としてから 1 秒以上たった惑星が線を越えている状態が 2.5 秒続いたらアウト
    //    （動いているかどうかは見ない。連打で上の惑星を揺らし続けても、あふれたらちゃんと終わるように）
    let anyOver = false;
    for (const b of w.bodies) {
      const isOver = w.time - b.born > 1.0 && b.y - b.r < LINE_Y;
      b.over = isOver ? b.over + dt : 0;
      if (isOver) anyOver = true;
    }
    w.overTime = anyOver ? w.overTime + dt : Math.max(0, w.overTime - dt * 2);
    w.danger = Math.min(1, w.overTime / OVER_LIMIT);
    if (w.overTime > OVER_LIMIT) {
      w.gameOver = true;
      w.events.push({ type: 'gameover' });
    }
    return w.events;
  }

  function walls(b) {
    const vx = b.x - b.px, vy = b.y - b.py;
    if (b.x - b.r < BOX_L) { b.x = BOX_L + b.r; b.py = b.y - vy * (1 - FRICTION); }
    if (b.x + b.r > BOX_R) { b.x = BOX_R - b.r; b.py = b.y - vy * (1 - FRICTION); }
    if (b.y + b.r > BOX_B) { b.y = BOX_B - b.r; b.px = b.x - vx * (1 - FRICTION); }
  }

  function merge(w) {
    const bs = w.bodies;
    const gone = new Set();
    const born = [];
    for (let i = 0; i < bs.length; i++) {
      const a = bs[i];
      if (gone.has(a.id)) continue;
      for (let j = i + 1; j < bs.length; j++) {
        const c = bs[j];
        if (gone.has(c.id) || c.level !== a.level) continue;
        const dx = c.x - a.x, dy = c.y - a.y, rr = a.r + c.r + 1.5;
        if (dx * dx + dy * dy > rr * rr) continue;
        gone.add(a.id); gone.add(c.id);
        const x = (a.x + c.x) / 2, y = (a.y + c.y) / 2;
        const lv = a.level + 1;
        w.merges++;
        if (lv === SUN) {
          w.score += SUN_BONUS;
          w.suns++;
          w.events.push({ type: 'sun', x, y, points: SUN_BONUS });
        } else {
          const vx = ((a.x - a.px) + (c.x - c.px)) / 2, vy = ((a.y - a.py) + (c.y - c.py)) / 2;
          const nb = body(lv, x, y);
          nb.px = x - vx; nb.py = y - vy;
          nb.grow = 0; nb.r = a.r; nb.m = nb.r * nb.r;   // 元の大きさから膨らむ
          nb.born = w.time - 1;   // 合体でできたものはすぐに判定の対象
          // 大きくなって壁にめり込まないように
          nb.x = Math.max(BOX_L + nb.full, Math.min(BOX_R - nb.full, nb.x));
          born.push(nb);
          w.score += POINTS[lv];
          if (lv > w.maxLevel) w.maxLevel = lv;
          w.events.push({ type: 'merge', x, y, level: lv, points: POINTS[lv] });
        }
        break;
      }
    }
    if (gone.size) w.bodies = bs.filter((b) => !gone.has(b.id)).concat(born);
  }

  // 保存用（関数や乱数を除いた形）
  function serialize(w) {
    return {
      bodies: w.bodies.map((b) => ({ level: b.level, x: b.x, y: b.y, px: b.px, py: b.py, angle: b.angle })),
      time: w.time, score: w.score, merges: w.merges, maxLevel: w.maxLevel, suns: w.suns,
      current: w.current, next: w.next, gameOver: w.gameOver,
    };
  }
  function restore(s, rand = Math.random) {
    const w = createWorld(rand);
    Object.assign(w, { time: s.time, score: s.score, merges: s.merges, maxLevel: s.maxLevel, suns: s.suns || 0, current: s.current, next: s.next, gameOver: s.gameOver });
    w.bodies = s.bodies.map((o) => {
      const b = body(o.level, o.x, o.y);
      Object.assign(b, { px: o.px, py: o.py, angle: o.angle, born: s.time - 2 });
      return b;
    });
    return w;
  }

  return {
    W, H, BOX_L, BOX_R, BOX_B, LINE_Y, DROP_Y, KINDS, SUN, POINTS, SUN_BONUS, DROP_KINDS,
    createWorld, drop, step, clampDropX, serialize, restore,
  };
})();

if (typeof module !== 'undefined') module.exports = MergeCore;
