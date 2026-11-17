// ===== ころころ惑星 物理・合体ルール（画面とは切り離してテストできるようにしている） =====
// 論理座標：幅 400 × 高さ 640。箱は x = BOX_L〜BOX_R、底は BOX_B、上の線（ここを越えて積むとアウト）は LINE_Y
// 物理は「位置ベースの Verlet 積分」：速度を持たず、前の位置との差を速度として扱う。
// 円どうしの重なりを何度も押し戻すことで、積み重なっても安定しやすい。
'use strict';

const MergeCore = (() => {
  const W = 400, H = 640;
  const BOX_L = 22, BOX_R = 378, BOX_B = 620, LINE_Y = 150, DROP_Y = 92;
  const GRAVITY = 1500;              // px/s²
  const ITER = 8;                    // 押し戻しの繰り返し回数（多いほど積み重ねが安定）
  const DAMP = 0.99995;              // 空気抵抗（ほぼなし。1秒で約 0.6% 減速）
  // 転がり：惑星は回転の勢い（角速度 w）を持つ。床の上では移動と回転が引っ張り合い、
  // 「滑らずに転がる」状態に近づく。転がり抵抗は一定の強さ（等減速）なので、少しずつ減速して止まる
  const ROLL_DECEL = 3;              // 転がり抵抗（px/s²）。ほぼなし＝一度転がるとほぼずっと転がり続ける
  // 静止摩擦：転がる速さがこれを下回ったら、すっと止まる。大きい（重い）惑星ほど動き出しにくい
  //   ほし屑 ≈ 14px/s、地球 ≈ 41px/s、木星 ≈ 72px/s → 小さい惑星が当たったくらいでは大きい惑星は転がり出さない
  const stopSpeed = (r) => 6 + r * 0.68;
  const STOP_DECEL = 600;            // 止まるときの減速（px/s²）
  const GRIP = 0.35;                 // 床との食いつき（1ステップで滑りをどれだけ転がりに変えるか）
  const SPIN_FOLLOW = 0.08;          // 惑星どうしが触れているときに、回転が動きに合わせていく速さ
  const SPIN_DECAY = 0.6;            // 空中・積み重なった状態での回転の減り方（rad/s²）
  const WALL_SLIP = 0.01;            // 横の壁にこすれたときの縦方向の減速
  const BOUNCE = 0.08;               // 床・壁での跳ね返り（小さいほどドスンと止まる）
  // 速さの上限（px/s）。合体で押し出された惑星が弾け飛びすぎないように、上と横は低めにしている
  const MAX_UP = 420, MAX_SIDE = 520, MAX_DOWN = 1400;
  const OVER_LIMIT = 2.5;            // 線を越えた状態がこの秒数続いたらアウト
  const GROW = 0.3;                  // 合体でできた惑星が元の大きさまで膨らむ時間（秒）。ゆっくり膨らむほど周りを押す勢いが弱い

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
  function body(level, x, y, vx = 0, vy = 0, dt = 1 / 120) {
    const r = KINDS[level].r;
    // full = 本来の半径。r は膨らんでいる途中の半径
    return { id: nextId++, level, r, full: r, m: r * r, x, y, px: x - vx * dt, py: y - vy * dt, angle: 0, w: 0, born: 0, over: 0, grow: 1, touch: false };
  }

  function createWorld(rand = Math.random) {
    return {
      bodies: [], time: 0, score: 0, merges: 0, maxLevel: 0, suns: 0, novas: 0,
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
    for (const b of bs) {
      if (b.grow < 1) {
        b.grow = Math.min(1, b.grow + dt / GROW);
        const from = b.level > 0 ? KINDS[b.level - 1].r : b.full;
        b.r = from + (b.full - from) * b.grow;
        b.m = b.r * b.r;
      }
      const vx = (b.x - b.px) * DAMP, vy = (b.y - b.py) * DAMP;
      b.px = b.x; b.py = b.y;
      b.x += vx; b.y += vy + GRAVITY * dt * dt;
    }

    // 2. 重なりと壁を何度も直す
    for (const b of bs) b.touch = false;
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
          a.touch = true; c.touch = true;
          const nx = dx / d, ny = dy / d;
          const ka = c.m / (a.m + c.m), kc = a.m / (a.m + c.m);   // 重いほうは動きにくい
          a.x -= nx * over * ka; a.y -= ny * over * ka;
          c.x += nx * over * kc; c.y += ny * over * kc;
        }
      }
      for (const b of bs) walls(b);
    }

    // 3. 転がり（床・惑星どうし）と、速さの上限
    for (const b of bs) {
      let vx = (b.x - b.px) / dt, vy = (b.y - b.py) / dt;     // px/s
      const onFloor = b.y + b.r >= BOX_B - 0.5;
      const atWall = b.x - b.r <= BOX_L + 0.5 || b.x + b.r >= BOX_R - 0.5;
      if (onFloor) {
        // 何か（惑星・壁）に当たって進めないときは、回転を実際の動きにすぐ合わせる
        // → 回転の勢いだけで相手を押し続けることがない
        if (b.touch || atWall) b.w += (vx / b.r - b.w) * 0.5;
        // 床との接点の滑り = 移動の速さ − 回転による表面の速さ。これを移動と回転に分けて打ち消す
        // （中身の詰まった球と同じ配分：移動 2/7、回転 5/7）
        const slip = vx - b.w * b.r;
        vx -= slip * GRIP * (2 / 7);
        b.w += (slip * GRIP * (5 / 7)) / b.r;
        // 転がり抵抗（ほぼなし）と、遅くなったら止まる静止摩擦
        const decel = Math.abs(vx) < stopSpeed(b.r) ? STOP_DECEL : ROLL_DECEL;
        vx = Math.sign(vx) * Math.max(0, Math.abs(vx) - decel * dt);
        b.w = Math.sign(b.w) * Math.max(0, Math.abs(b.w) - (decel * dt) / b.r);
        // 上に積まれて床に押しつけられている惑星の、細かい上下の震えを止める
        if (vy < 0 && vy > -40) vy = 0;
      } else if (b.touch) {
        // 惑星の上を転がっているとき：回転を動きに合わせる。ほとんど動いていなければ止める
        b.w += (vx / b.r - b.w) * SPIN_FOLLOW;
        if (Math.hypot(vx, vy) < stopSpeed(b.r) * 0.5) b.w *= 0.8;
      } else {
        b.w = Math.sign(b.w) * Math.max(0, Math.abs(b.w) - SPIN_DECAY * dt);   // 空中ではほぼ回り続ける
      }
      if (b.x - b.r <= BOX_L + 0.5 || b.x + b.r >= BOX_R - 0.5) vy *= 1 - WALL_SLIP;   // 壁にこすれる
      vx = Math.max(-MAX_SIDE, Math.min(MAX_SIDE, vx));
      vy = Math.max(-MAX_UP, Math.min(MAX_DOWN, vy));
      b.px = b.x - vx * dt; b.py = b.y - vy * dt;
    }

    // 4. 転がる見た目（回転の勢いで回す。止まっても回転はなめらかにゆるむ）
    for (const b of bs) b.angle += b.w * dt;

    // 5. 合体
    merge(w);

    // 6. ゲームオーバー判定：落としてから 1 秒以上たった惑星が線を越えている状態が 2.5 秒続いたらアウト
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

  // 壁・床：めり込んだら押し戻し、ぶつかった向きの速さだけ小さく跳ね返す（横すべりはそのまま＝転がる）
  function walls(b) {
    if (b.x - b.r < BOX_L) { const vx = b.x - b.px; b.x = BOX_L + b.r; if (vx < 0) b.px = b.x + vx * BOUNCE; }
    if (b.x + b.r > BOX_R) { const vx = b.x - b.px; b.x = BOX_R - b.r; if (vx > 0) b.px = b.x + vx * BOUNCE; }
    if (b.y + b.r > BOX_B) { const vy = b.y - b.py; b.y = BOX_B - b.r; if (vy > 0) b.py = b.y + vy * BOUNCE; }
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
        if (lv === SUN) {                      // 太陽 + 太陽 → 超新星（消える）
          w.score += SUN_BONUS;
          w.novas++;
          w.events.push({ type: 'nova', x, y, points: SUN_BONUS });
        } else {
          const vx = ((a.x - a.px) + (c.x - c.px)) / 2, vy = ((a.y - a.py) + (c.y - c.py)) / 2;
          const nb = body(lv, x, y);
          nb.px = x - vx; nb.py = y - vy;
          nb.grow = 0; nb.r = a.r; nb.m = nb.r * nb.r;   // 元の大きさから膨らむ
          nb.w = ((a.w || 0) * a.r + (c.w || 0) * c.r) / (2 * a.r) * 0.5;
          nb.born = w.time - 1;   // 合体でできたものはすぐに判定の対象
          // 大きくなって壁にめり込まないように
          nb.x = Math.max(BOX_L + nb.full, Math.min(BOX_R - nb.full, nb.x));
          born.push(nb);
          w.score += POINTS[lv];
          if (lv > w.maxLevel) w.maxLevel = lv;
          if (lv === SUN - 1) w.suns++;            // 太陽ができた
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
      bodies: w.bodies.map((b) => ({ level: b.level, x: b.x, y: b.y, px: b.px, py: b.py, angle: b.angle, w: b.w })),
      time: w.time, score: w.score, merges: w.merges, maxLevel: w.maxLevel, suns: w.suns, novas: w.novas,
      current: w.current, next: w.next, gameOver: w.gameOver,
    };
  }
  function restore(s, rand = Math.random) {
    const w = createWorld(rand);
    Object.assign(w, { time: s.time, score: s.score, merges: s.merges, maxLevel: s.maxLevel, suns: s.suns || 0, novas: s.novas || 0, current: s.current, next: s.next, gameOver: s.gameOver });
    w.bodies = s.bodies.map((o) => {
      const b = body(o.level, o.x, o.y);
      Object.assign(b, { px: o.px, py: o.py, angle: o.angle, w: o.w || 0, born: s.time - 2 });
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
