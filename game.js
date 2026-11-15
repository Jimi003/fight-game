(() => {
  "use strict";

  const canvas = document.querySelector("#game");
  const displayContext = canvas.getContext("2d");
  const buffer = document.createElement("canvas");
  buffer.width = canvas.width / 2;
  buffer.height = canvas.height / 2;
  const ctx = buffer.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  const healthBar = document.querySelector("#player-health");
  const healthText = document.querySelector("#player-health-text");
  const scoreText = document.querySelector("#score-label");
  const waveText = document.querySelector("#wave-label");
  const comboText = document.querySelector("#combo-label");
  const startScreen = document.querySelector("#start-screen");
  const koScreen = document.querySelector("#ko-screen");
  const toast = document.querySelector("#toast");

  const WIDTH = buffer.width;
  const HEIGHT = buffer.height;
  const TILE_WIDTH = 16;
  const TILE_HEIGHT = 8;
  const PIXEL = 2;
  const FLOOR = 224;
  const GRAVITY = 720;
  const platforms = [
    { x: 64, y: 176, w: 96, h: TILE_HEIGHT },
    { x: 336, y: 152, w: 96, h: TILE_HEIGHT },
    { x: 208, y: 112, w: 64, h: TILE_HEIGHT },
  ];
  const keys = new Set();
  const pressed = new Set();
  const attackBuffer = [];
  const enemies = [];
  const projectiles = [];
  const effects = [];
  let running = false;
  let lastTime = 0;
  let gameTime = 0;
  let spawnTimer = 1.8;
  let score = 0;
  let wave = 1;
  let defeated = 0;
  let shake = 0;
  let toastTimer = 0;
  let soundEnabled = true;
  let audioContext;
  let consumedJumpKey = null;

  const player = {};

  const attackMoves = {
    punch: { label: "JAB", damage: 13, range: 24, height: 16, startup: .08, active: .15, recovery: .22, knockback: 92, score: 100 },
    kick: { label: "ROUNDHOUSE", damage: 21, range: 32, height: 20, startup: .16, active: .19, recovery: .34, knockback: 142, score: 175 },
    grab: { label: "THROW", damage: 30, range: 24, height: 32, startup: .12, active: .12, recovery: .42, knockback: 195, score: 250 },
  };

  function reset() {
    Object.assign(player, {
      x: 124, y: FLOOR, vx: 0, vy: 0, w: 16, h: 32, face: 1,
      health: 100, maxHealth: 100, grounded: true, crouching: false,
      blocking: false, invulnerable: 0, attack: null, attackCooldown: 0,
      combo: 0, comboTimer: 0, hurtTimer: 0, jumpHeld: false,
      coyoteTimer: 0, jumpBuffer: 0, breath: 0, dropTimer: 0,
    });
    enemies.length = 0;
    projectiles.length = 0;
    effects.length = 0;
    attackBuffer.length = 0;
    keys.clear();
    pressed.clear();
    gameTime = 0;
    spawnTimer = .7;
    score = 0;
    wave = 1;
    defeated = 0;
    shake = 0;
    consumedJumpKey = null;
    updateHud();
  }

  function startGame() {
    reset();
    running = true;
    startScreen.classList.add("hidden");
    koScreen.classList.add("hidden");
    showToast("FIGHT!");
    lastTime = performance.now();
    requestAnimationFrame(loop);
    if (soundEnabled) playTone(420, .09, "sine", .025);
  }

  function endGame() {
    running = false;
    document.querySelector("#final-score").textContent = String(score).padStart(6, "0");
    koScreen.classList.remove("hidden");
    if (soundEnabled) playTone(130, .34, "sawtooth", .04);
  }

  function updateHud() {
    const health = Math.max(0, player.health);
    healthBar.style.width = `${health / player.maxHealth * 100}%`;
    healthBar.style.background = health < 30
      ? "linear-gradient(90deg, #ec4369, #ff796c)"
      : "linear-gradient(90deg, #38d8bf, #72f0cb)";
    healthText.textContent = String(Math.ceil(health)).padStart(3, "0");
    scoreText.textContent = String(score).padStart(6, "0");
    waveText.textContent = String(wave).padStart(2, "0");
    comboText.textContent = player.combo > 1 ? `${player.combo} HIT COMBO` : (player.combo === 1 ? "NICE HIT" : "READY TO FIGHT");
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add("show");
    toastTimer = .8;
  }

  function playTone(frequency, duration, type = "square", volume = .025) {
    if (!soundEnabled) return;
    try {
      audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
      if (audioContext.state === "suspended") audioContext.resume();
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime);
      gain.gain.setValueAtTime(volume, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(.001, audioContext.currentTime + duration);
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start();
      oscillator.stop(audioContext.currentTime + duration);
    } catch (error) {
      console.warn("Audio could not be started.", error);
    }
  }

  function queueAttack(type) {
    const down = keys.has("KeyS") || keys.has("ArrowDown");
    const up = keys.has("KeyW") || keys.has("ArrowUp");
    const left = keys.has("KeyA") || keys.has("ArrowLeft");
    const right = keys.has("KeyD") || keys.has("ArrowRight");
    const direction = left === right ? player.face : (right ? 1 : -1);
    if (type === "punch" && down && left !== right) {
      type = "energy";
      player.face = direction;
    } else if (type === "kick" && up && left !== right) {
      type = "spinKick";
      player.face = direction;
      consumedJumpKey = keys.has("KeyW") ? "KeyW" : "ArrowUp";
    }
    attackBuffer.push({ type, direction, expires: gameTime + .22 });
    if (attackBuffer.length > 4) attackBuffer.shift();
  }

  function tryStartAttack() {
    if (player.attack || player.attackCooldown > 0) return;
    while (attackBuffer.length && attackBuffer[0].expires < gameTime) attackBuffer.shift();
    const input = attackBuffer.shift();
    if (!input) return;
    const special = input.type === "energy" || input.type === "spinKick";
    const move = attackMoves[input.type] || (input.type === "energy"
      ? { label: "ENERGY BOMB", startup: .16, active: .2, recovery: .22 }
      : { label: "SPIRAL KICK", startup: .04, active: .62, recovery: .18 });
    player.attack = {
      type: input.type,
      move,
      time: 0,
      hitIds: new Set(),
      direction: input.direction,
      spawned: false,
      nextHit: .04,
    };
    player.crouching = false;
    player.attackCooldown = move.startup + move.active + move.recovery;
    if (input.type === "spinKick") {
      player.vy = -245;
      player.grounded = false;
      player.invulnerable = Math.max(player.invulnerable, .25);
    }
    if (soundEnabled) {
      const pitch = input.type === "spinKick" ? 155 : input.type === "energy" ? 370 : input.type === "kick" ? 205 : input.type === "grab" ? 115 : 290;
      playTone(pitch, .09, "square", .022);
    }
  }

  function spawnEnemy() {
    const fromRight = player.x < WIDTH * .63 ? Math.random() > .2 : Math.random() > .75;
    const x = fromRight ? WIDTH + 12 : -12;
    const toughness = Math.min(1 + Math.floor(defeated / 6) * .17, 1.85);
    enemies.push({
      id: `${gameTime}-${Math.random()}`,
      x, y: FLOOR, vx: 0, vy: 0, w: 14, h: 30,
      health: 34 * toughness, maxHealth: 34 * toughness,
      speed: (29 + Math.random() * 8) * Math.min(1 + defeated * .012, 1.55),
      face: x < player.x ? 1 : -1,
      attack: null, attackCooldown: .65 + Math.random() * .8,
      hitFlash: 0, hurtTimer: 0, grounded: true, dead: false,
      hue: Math.random() > .5 ? "#e75172" : "#b454d8",
    });
  }

  function updatePlayer(dt) {
    const move = (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0)
      - (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0);
    const down = keys.has("KeyS") || keys.has("ArrowDown");
    player.crouching = down && !player.attack;
    player.blocking = keys.has("KeyI");

    if (move) player.face = move;
    player.attackCooldown = Math.max(0, player.attackCooldown - dt);
    player.invulnerable = Math.max(0, player.invulnerable - dt);
    player.hurtTimer = Math.max(0, player.hurtTimer - dt);
    player.comboTimer = Math.max(0, player.comboTimer - dt);
    if (player.comboTimer === 0) player.combo = 0;
    player.breath += dt;
    player.jumpBuffer = Math.max(0, player.jumpBuffer - dt);
    if (player.grounded) player.coyoteTimer = .1;
    else player.coyoteTimer = Math.max(0, player.coyoteTimer - dt);
    if (pressed.has("Space") || pressed.has("KeyW") || pressed.has("ArrowUp")) player.jumpBuffer = .12;
    if (player.attack) {
      const previousTime = player.attack.time;
      player.attack.time += dt;
      if (player.attack.type === "energy" && !player.attack.spawned
        && previousTime < player.attack.move.startup && player.attack.time >= player.attack.move.startup) {
        spawnEnergyBomb(player.attack.direction);
        player.attack.spawned = true;
      }
    }
    tryStartAttack();

    const canMove = !player.hurtTimer;
    const speed = player.crouching ? 52 : player.blocking ? 55 : 105;
    const acceleration = player.grounded ? 780 : 480;
    if (canMove && move) {
      player.vx = approach(player.vx, move * speed, acceleration * dt);
    } else if (player.grounded) {
      player.vx = approach(player.vx, 0, (player.crouching ? 1150 : 780) * dt);
    } else {
      player.vx = approach(player.vx, 0, 75 * dt);
    }
    if (!canMove) player.vx = approach(player.vx, 0, 560 * dt);
    player.x += player.vx * dt;
    player.x = clamp(player.x, player.w / 2, WIDTH - player.w / 2);

    const jumpHeld = keys.has("Space") || keys.has("KeyW") || keys.has("ArrowUp");
    if (player.jumpBuffer > 0 && (player.grounded || player.coyoteTimer > 0) && canMove
      && consumedJumpKey === null) {
      player.vy = -270;
      player.grounded = false;
      player.coyoteTimer = 0;
      player.jumpBuffer = 0;
      player.jumpHeld = true;
      player.crouching = false;
      if (soundEnabled) playTone(470, .07, "sine", .018);
    }

    applyGravity(player, dt);
    if (player.attack?.type === "spinKick") checkSpinHits();
    if (player.attack && player.attack.time > player.attack.move.startup + player.attack.move.active + player.attack.move.recovery) {
      player.attack = null;
    }
    if (player.attack && attackMoves[player.attack.type]) checkPlayerHits();
    if (player.vy < 0 && !jumpHeld && player.attack?.type !== "spinKick") player.vy += 430 * dt;
  }

  function applyGravity(entity, dt) {
    const oldY = entity.y;
    const jumpHeld = entity === player && player.jumpHeld
      && (keys.has("Space") || keys.has("KeyW") || keys.has("ArrowUp"));
    entity.vy += GRAVITY * (jumpHeld && entity.vy < 0 ? .66 : 1) * dt;
    entity.y += entity.vy * dt;
    entity.grounded = false;

    if (entity.vy >= 0) {
      for (const platform of platforms) {
        const wasAbove = oldY <= platform.y;
        const crosses = entity.y >= platform.y && oldY <= platform.y;
        if (wasAbove && crosses && entity.x + entity.w / 2 > platform.x && entity.x - entity.w / 2 < platform.x + platform.w) {
          entity.y = platform.y;
          entity.vy = 0;
          entity.grounded = true;
          break;
        }
      }
    }

    if (entity.y >= FLOOR) {
      entity.y = FLOOR;
      entity.vy = 0;
      entity.grounded = true;
    }
  }

  function checkPlayerHits() {
    const attack = player.attack;
    if (!attack) return;
    const move = attack.move;
    if (attack.time < move.startup || attack.time > move.startup + move.active) return;
    const center = player.x + attack.direction * (player.w / 2 + move.range / 2 - 3);
    const top = player.y - player.h;
    const box = { left: center - move.range / 2, right: center + move.range / 2, top, bottom: top + move.height };

    for (const enemy of enemies) {
      if (enemy.dead || attack.hitIds.has(enemy.id)) continue;
      const enemyBox = { left: enemy.x - enemy.w / 2, right: enemy.x + enemy.w / 2, top: enemy.y - enemy.h, bottom: enemy.y };
      if (!overlaps(box, enemyBox)) continue;
      attack.hitIds.add(enemy.id);
      applyEnemyHit(enemy, move, attack.direction, attack.type === "kick" ? -42 : -22);
    }
  }

  function applyEnemyHit(enemy, move, direction, launch = -22) {
    enemy.health -= move.damage;
    enemy.hitFlash = .14;
    enemy.hurtTimer = .17;
    enemy.vx = direction * move.knockback;
    enemy.vy = launch;
    shake = Math.max(shake, move.damage > 20 ? 4 : 2);
    if (soundEnabled) playTone(move.damage > 20 ? 135 : 190, .07, "triangle", .028);
    if (player.comboTimer > 0) player.combo++;
    else player.combo = 1;
    player.comboTimer = 1.25;
    score += move.score * player.combo;
    if (enemy.health <= 0) {
      enemy.dead = true;
      defeated++;
      score += 300;
      if (defeated % 5 === 0) {
        wave++;
        player.health = Math.min(player.maxHealth, player.health + 12);
        showToast(`WAVE ${String(wave).padStart(2, "0")}`);
      }
    } else {
      showToast(player.combo > 1 ? `${player.combo} HIT!` : move.label);
    }
    updateHud();
  }

  function spawnEnergyBomb(direction) {
    projectiles.push({
      x: player.x + direction * 13,
      y: player.y - 20,
      vx: direction * 178,
      direction,
      age: 0,
      radius: 5,
      dead: false,
    });
    effects.push({ x: player.x + direction * 12, y: player.y - 20, timer: .18, type: "muzzle" });
    if (soundEnabled) playTone(620, .14, "sawtooth", .025);
  }

  function detonate(projectile) {
    projectile.dead = true;
    effects.push({ x: projectile.x, y: projectile.y, timer: .28, type: "explosion" });
    shake = Math.max(shake, 5);
    for (const enemy of enemies) {
      if (enemy.dead) continue;
      const dx = enemy.x - projectile.x;
      const dy = enemy.y - enemy.h / 2 - projectile.y;
      if (Math.hypot(dx, dy) > 28 + enemy.w / 2) continue;
      applyEnemyHit(enemy, {
        label: "ENERGY BOMB",
        damage: 24,
        knockback: 130,
        score: 220,
      }, dx === 0 ? projectile.direction : Math.sign(dx), -46);
    }
    if (soundEnabled) playTone(95, .18, "sawtooth", .04);
  }

  function checkSpinHits() {
    const attack = player.attack;
    if (!attack || attack.time < attack.nextHit) return;
    attack.nextHit += .14;
    const move = { label: "SPIRAL KICK", damage: 7, knockback: 78, score: 85 };
    for (const enemy of enemies) {
      if (enemy.dead || Math.hypot(enemy.x - player.x, (enemy.y - enemy.h / 2) - (player.y - player.h / 2)) > 28) continue;
      applyEnemyHit(enemy, move, enemy.x === player.x ? player.face : Math.sign(enemy.x - player.x), -34);
    }
  }

  function updateEnemies(dt) {
    for (const enemy of enemies) {
      if (enemy.dead) continue;
      enemy.hitFlash = Math.max(0, enemy.hitFlash - dt);
      enemy.hurtTimer = Math.max(0, enemy.hurtTimer - dt);
      enemy.attackCooldown = Math.max(0, enemy.attackCooldown - dt);
      enemy.x += enemy.vx * dt;
      enemy.vx *= Math.max(0, 1 - dt * (enemy.hurtTimer ? 1.1 : 8));
      applyGravity(enemy, dt);

      const distance = player.x - enemy.x;
      enemy.face = distance >= 0 ? 1 : -1;
      if (enemy.attack) {
        enemy.attack.time += dt;
        if (!enemy.attack.hit && enemy.attack.time >= .26 && enemy.attack.time <= .48) {
          enemy.attack.hit = true;
          const reach = 19;
          const close = Math.abs(distance) < reach + player.w / 2;
          const sameLevel = Math.abs(player.y - enemy.y) < 20;
          if (close && sameLevel && player.invulnerable <= 0) {
            const blocked = player.blocking || (player.crouching && Math.abs(distance) < 34);
            const damage = blocked ? 3 : 9;
            player.health = Math.max(0, player.health - damage);
            player.hurtTimer = blocked ? 0 : .22;
            player.invulnerable = blocked ? .18 : .58;
            player.vx = enemy.face * (blocked ? 55 : 155);
            if (!blocked) player.vy = -55;
            shake = Math.max(shake, blocked ? 2 : 7);
            showToast(blocked ? "BLOCKED" : "GET BACK!");
            if (soundEnabled) playTone(blocked ? 250 : 100, .1, "triangle", .035);
            updateHud();
            if (player.health <= 0) endGame();
          }
        }
        if (enemy.attack.time > .69) enemy.attack = null;
        continue;
      }

      if (enemy.hurtTimer > 0) continue;
      if (Math.abs(distance) > 23) {
        enemy.vx += Math.sign(distance) * enemy.speed * dt * 4;
        enemy.vx = clamp(enemy.vx, -enemy.speed, enemy.speed);
      } else if (enemy.attackCooldown <= 0) {
        enemy.attack = { time: 0, hit: false };
        enemy.attackCooldown = .95 + Math.random() * .45;
        enemy.vx = 0;
      } else {
        enemy.vx *= Math.max(0, 1 - dt * 7);
      }
      enemy.x = clamp(enemy.x, -28, WIDTH + 28);
    }

    for (let i = enemies.length - 1; i >= 0; i--) if (enemies[i].dead) enemies.splice(i, 1);
  }

  function updateProjectiles(dt) {
    for (const projectile of projectiles) {
      if (projectile.dead) continue;
      projectile.x += projectile.vx * dt;
      projectile.age += dt;
      for (const enemy of enemies) {
        if (enemy.dead) continue;
        if (Math.abs(enemy.x - projectile.x) < 16
          && Math.abs(enemy.y - enemy.h / 2 - projectile.y) < 18) {
          detonate(projectile);
          break;
        }
      }
      if (projectile.age > 1.6 || projectile.x < 0 || projectile.x > WIDTH) detonate(projectile);
    }
    for (let i = projectiles.length - 1; i >= 0; i--) if (projectiles[i].dead) projectiles.splice(i, 1);
    for (const effect of effects) effect.timer -= dt;
    for (let i = effects.length - 1; i >= 0; i--) if (effects[i].timer <= 0) effects.splice(i, 1);
  }

  function update(dt) {
    gameTime += dt;
    if (toastTimer > 0) {
      toastTimer -= dt;
      if (toastTimer <= 0) toast.classList.remove("show");
    }
    shake = Math.max(0, shake - dt * 27);
    updatePlayer(dt);
    updateEnemies(dt);
    updateProjectiles(dt);
    if (!running) return;

    spawnTimer -= dt;
    if (spawnTimer <= 0 && enemies.filter((enemy) => !enemy.dead).length < Math.min(2 + Math.floor(defeated / 8), 5)) {
      spawnEnemy();
      spawnTimer = Math.max(.85, 2.15 - defeated * .035) + Math.random() * .55;
    }
    pressed.clear();
  }

  function loop(now) {
    if (!running) return;
    const dt = Math.min((now - lastTime) / 1000, .033);
    lastTime = now;
    update(dt);
    draw();
    if (running) requestAnimationFrame(loop);
  }

  function draw() {
    ctx.save();
    if (shake > 0) ctx.translate((Math.random() - .5) * shake, (Math.random() - .5) * shake);
    drawBackdrop();
    drawPlatforms();
    drawGround();
    for (const enemy of enemies) drawFighter(enemy, false);
    drawFighter(player, true);
    drawEnergyBombs();
    drawEffects();
    ctx.restore();
    displayContext.imageSmoothingEnabled = false;
    displayContext.clearRect(0, 0, canvas.width, canvas.height);
    displayContext.drawImage(buffer, 0, 0, canvas.width, canvas.height);
  }

  function drawBackdrop() {
    ctx.fillStyle = "#182033";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    ctx.fillStyle = "#33314a";
    ctx.fillRect(376, 24, 16, 8);
    ctx.fillStyle = "#262a40";
    ctx.fillRect(384, 24, 8, 8);
    ctx.fillStyle = "#f2d89a";
    ctx.fillRect(384, 26, 4, 4);

    drawCityLayer(.16, "#22283c", 160, 56, 80);
    drawCityLayer(.3, "#292a42", 192, 72, 64);
    drawSign(48, 96, "09", "#fa527f");
    drawSign(376, 120, "FIGHT", "#54d9d0");
    ctx.fillStyle = "#73445e";
    ctx.fillRect(0, 208, WIDTH, 2);
    drawRain();
  }

  function drawCityLayer(speed, color, base, minHeight, width) {
    const scroll = Math.floor(gameTime * speed) % width;
    const start = -width - scroll;
    for (let x = start, index = 0; x < WIDTH + width; x += width, index++) {
      const height = minHeight + (Math.abs(Math.sin((x + index * 41) * .071)) > .5 ? 24 : 0);
      const top = base - height;
      ctx.fillStyle = color;
      ctx.fillRect(x, top, width - TILE_WIDTH / 2, height);
      ctx.fillStyle = "#37344e";
      ctx.fillRect(x + 8, top - 8, 16, 8);
      for (let y = top + 8; y < base - 8; y += TILE_HEIGHT * 2) {
        for (let wx = x + 8; wx < x + width - 16; wx += 16) {
          if ((wx + y + index * 7) % 3 !== 0) {
            ctx.fillStyle = (wx + y) % 2 ? "#65516c" : "#4b4662";
            ctx.fillRect(wx, y, 4, 4);
          }
        }
      }
    }
  }

  function drawSign(x, y, text, color) {
    const width = text.length * 8 + 16;
    ctx.fillStyle = "#171b2c";
    ctx.fillRect(x, y, width, 24);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, width, 2);
    ctx.fillRect(x, y + 22, width, 2);
    ctx.fillRect(x, y, 2, 24);
    ctx.fillRect(x + width - 2, y, 2, 24);
    ctx.fillStyle = color;
    ctx.font = "bold 8px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x + width / 2, y + 12);
  }

  function drawRain() {
    ctx.fillStyle = "#42445c";
    for (let i = 0; i < 24; i++) {
      const x = (i * 79 + Math.floor(gameTime * 44)) % WIDTH;
      const y = (i * 37 + Math.floor(gameTime * 66)) % FLOOR;
      ctx.fillRect(x, y, 2, 6);
    }
  }

  function drawPlatforms() {
    for (const platform of platforms) {
      ctx.fillStyle = "#29263b";
      ctx.fillRect(platform.x, platform.y, platform.w, platform.h);
      ctx.fillStyle = "#f24b79";
      ctx.fillRect(platform.x, platform.y, platform.w, 2);
      ctx.fillStyle = "#81506b";
      ctx.fillRect(platform.x, platform.y + 2, platform.w, 2);
      for (let x = platform.x; x < platform.x + platform.w; x += TILE_WIDTH) {
        ctx.fillStyle = "#51405b";
        ctx.fillRect(x + 4, platform.y + 4, 8, 2);
      }
    }
  }

  function drawGround() {
    ctx.fillStyle = "#272738";
    ctx.fillRect(0, FLOOR, WIDTH, HEIGHT - FLOOR);
    ctx.fillStyle = "#f24b79";
    ctx.fillRect(0, FLOOR, WIDTH, 3);
    for (let x = 0; x < WIDTH; x += TILE_WIDTH) {
      ctx.fillStyle = "#383348";
      ctx.fillRect(x, FLOOR + 4, TILE_WIDTH - 1, TILE_HEIGHT);
      ctx.fillStyle = "#252638";
      ctx.fillRect(x + TILE_WIDTH / 2, FLOOR + 12, TILE_WIDTH / 2 - 1, TILE_HEIGHT);
      ctx.fillStyle = "#4a4052";
      ctx.fillRect(x + 4, FLOOR + 6, 6, 2);
      ctx.fillRect(x + 2, FLOOR + 18, 8, 2);
    }
  }

  function drawFighter(fighter, isPlayer) {
    const crouching = isPlayer && fighter.crouching;
    const rows = fighterSprite(fighter, isPlayer, crouching);
    const height = rows.length * PIXEL;
    const top = fighter.y - height + Math.round(isPlayer ? breathingOffset(fighter) : 0);
    const left = Math.round(fighter.x - 8);
    const palette = isPlayer
      ? { K: "#151725", H: "#f0bc91", R: "#241a28", P: "#22b6ae", W: "#e5d8ba", Q: "#34435c", G: "#ed6e59", L: "#a6fff1" }
      : { K: "#171725", H: "#dba281", R: "#281c2b", P: fighter.hue, W: "#bfa9a0", Q: "#343047", G: "#ef6074", L: "#ffd48b" };
    if (fighter.hitFlash > 0 || fighter.hurtTimer > 0) palette.P = "#f3d9db";

    ctx.save();
    if (isPlayer && fighter.invulnerable > 0 && Math.floor(gameTime * 18) % 2 === 0) ctx.globalAlpha = .55;
    ctx.fillStyle = "#111522";
    ctx.fillRect(fighter.x - 10, fighter.y + 1, 20, 3);

    const spinning = isPlayer && fighter.attack?.type === "spinKick";
    const spriteOffset = spinning ? -16 : 0;
    ctx.save();
    ctx.translate(Math.round(fighter.x), Math.round(top + (spinning ? 16 : 0)));
    if (spinning) ctx.rotate(fighter.attack.time * Math.PI * 4);
    ctx.scale(fighter.face, 1);
    for (let row = 0; row < rows.length; row++) {
      for (let column = 0; column < rows[row].length; column++) {
        const color = palette[rows[row][column]];
        if (!color) continue;
        ctx.fillStyle = color;
        ctx.fillRect((column - 4) * PIXEL, row * PIXEL + spriteOffset, PIXEL, PIXEL);
      }
    }

    const attack = fighter.attack;
    if (isPlayer && attack?.type === "punch") {
      ctx.fillStyle = palette.G;
      ctx.fillRect(12, 15, 6, 4);
      ctx.fillStyle = palette.L;
      ctx.fillRect(16, 15, 2, 2);
    } else if (isPlayer && attack?.type === "kick") {
      ctx.fillStyle = palette.Q;
      ctx.fillRect(6, 24, 10, 4);
      ctx.fillStyle = palette.G;
      ctx.fillRect(14, 24, 5, 4);
    } else if (isPlayer && attack?.type === "energy") {
      ctx.fillStyle = palette.G;
      ctx.fillRect(10, 13, 8, 4);
      ctx.fillStyle = palette.L;
      ctx.fillRect(16, 13, 3, 2);
    } else if (isPlayer && attack?.type === "spinKick") {
      ctx.fillStyle = "#f2d67c";
      const spinFrame = Math.floor(attack.time * 20) % 4;
      if (spinFrame % 2 === 0) {
        ctx.fillRect(-13, 10 + spriteOffset, 4, 2);
        ctx.fillRect(11, 21 + spriteOffset, 4, 2);
      } else {
        ctx.fillRect(11, 10 + spriteOffset, 4, 2);
        ctx.fillRect(-13, 21 + spriteOffset, 4, 2);
      }
    } else if (isPlayer && fighter.blocking) {
      ctx.fillStyle = palette.L;
      ctx.fillRect(10, 13, 4, 7);
    }
    ctx.restore();

    if (!isPlayer) {
      const barWidth = 18;
      ctx.fillStyle = "#171725";
      ctx.fillRect(fighter.x - barWidth / 2, top - 5, barWidth, 3);
      ctx.fillStyle = "#f15d78";
      ctx.fillRect(fighter.x - barWidth / 2 + 1, top - 4, (barWidth - 2) * Math.max(0, fighter.health / fighter.maxHealth), 1);
    }
    if (isPlayer && fighter.combo > 1 && fighter.comboTimer > 0) {
      ctx.fillStyle = "#fff0a8";
      ctx.font = "bold 7px monospace";
      ctx.textAlign = "center";
      ctx.fillText(`${fighter.combo} HIT`, fighter.x, top - 5);
    }
    ctx.restore();
  }

  function fighterSprite(fighter, isPlayer, crouching) {
    const idle = [
      "....RRRR", "...RRRRR", "...HHHHK", "..KHHHHK",
      "..KHHHHK", "...KKKK.", "..KPPPK.", ".KPPPPPP",
      ".KPPPPPK", ".KWWWBK.", "..KPPPK.", "..KQQK..",
      "..KQQK..", ".KK.PKK.", ".KK.PKK.", "KK...KK.",
    ];
    const walkA = idle.slice();
    walkA[13] = "..KK.PK.";
    walkA[14] = ".KK..PK.";
    walkA[15] = "KK...KK.";
    const walkB = idle.slice();
    walkB[13] = ".KP..KK.";
    walkB[14] = ".K.P.KK.";
    walkB[15] = ".KK..KK.";
    const crouch = [
      "........", "........", "....RRRR", "...HHHHK",
      "..KHHHHK", "..KHHHHK", "...KKKK.", "..KPPPK.",
      ".KPPPPPP", ".KPPPPPK", ".KWWWBK..", "..KPPPK.",
    ];
    if (crouching) return crouch;
    if (isPlayer && fighter.attack?.type === "spinKick") return idle;
    if (isPlayer && fighter.attack?.type === "kick") return idle;
    if (isPlayer && fighter.attack?.type === "energy") return idle;
    if (isPlayer && fighter.attack?.type === "punch") return idle;
    if (isPlayer && fighter.blocking) return idle;
    if (Math.abs(fighter.vx) > 12 && fighter.grounded) {
      return Math.floor(gameTime * 11) % 2 ? walkA : walkB;
    }
    return idle;
  }

  function breathingOffset(fighter) {
    if (!fighter.grounded || Math.abs(fighter.vx) > 12 || fighter.attack) return 0;
    return Math.sin(fighter.breath * 5) > .45 ? -1 : 0;
  }

  function drawEnergyBombs() {
    for (const projectile of projectiles) {
      const pulse = Math.floor(projectile.age * 20) % 2;
      ctx.fillStyle = "#5365bd";
      ctx.fillRect(projectile.x - 7, projectile.y - 7, 14, 14);
      ctx.fillStyle = "#55d9e3";
      ctx.fillRect(projectile.x - 5, projectile.y - 5, 10, 10);
      ctx.fillStyle = "#e5f5d7";
      ctx.fillRect(projectile.x - 3, projectile.y - 3, 6, 6);
      ctx.fillStyle = "#fff2a1";
      ctx.fillRect(projectile.x - 1, projectile.y - 1, 2, 2);
      ctx.fillStyle = "#62a5e8";
      ctx.fillRect(projectile.x - projectile.direction * (10 + pulse * 2), projectile.y - 2, 4, 4);
    }
  }

  function drawEffects() {
    for (const effect of effects) {
      if (effect.type === "muzzle") {
        ctx.fillStyle = "#e7ffff";
        ctx.fillRect(effect.x - 2, effect.y - 2, 4, 4);
        ctx.fillStyle = "#54d9e3";
        ctx.fillRect(effect.x - 4, effect.y - 1, 8, 2);
        continue;
      }
      const size = effect.timer > .14 ? 20 : 12;
      ctx.fillStyle = "#f3e78d";
      ctx.fillRect(effect.x - size / 2, effect.y - 2, size, 4);
      ctx.fillRect(effect.x - 2, effect.y - size / 2, 4, size);
      ctx.fillStyle = "#f28a63";
      ctx.fillRect(effect.x - 6, effect.y - 6, 12, 12);
      ctx.fillStyle = "#fff1b0";
      ctx.fillRect(effect.x - 3, effect.y - 3, 6, 6);
      ctx.fillStyle = "#70dce3";
      ctx.fillRect(effect.x - size, effect.y - 1, 4, 2);
      ctx.fillRect(effect.x + size - 4, effect.y - 1, 4, 2);
    }
  }

  function drawVignette() {
    const gradient = ctx.createRadialGradient(WIDTH / 2, HEIGHT / 2, 170, WIDTH / 2, HEIGHT / 2, 600);
    gradient.addColorStop(0, "rgba(5,7,14,0)");
    gradient.addColorStop(1, "rgba(5,7,14,.34)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }

  function overlaps(a, b) {
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function approach(value, target, amount) {
    if (value < target) return Math.min(value + amount, target);
    if (value > target) return Math.max(value - amount, target);
    return target;
  }

  document.addEventListener("keydown", (event) => {
    const gameKeys = ["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
    if (gameKeys.includes(event.code)) event.preventDefault();
    if (!keys.has(event.code)) pressed.add(event.code);
    keys.add(event.code);

    if (!running && (event.code === "Enter" || event.code === "Space")) {
      startGame();
      return;
    }
    if (!running) return;
    if (event.code === "KeyJ") queueAttack("punch");
    if (event.code === "KeyK") queueAttack("kick");
    if (event.code === "KeyL") queueAttack("grab");
  });

  document.addEventListener("keyup", (event) => {
    keys.delete(event.code);
    if (event.code === "Space" || event.code === "KeyW" || event.code === "ArrowUp") {
      player.jumpHeld = false;
      if (event.code === consumedJumpKey) consumedJumpKey = null;
    }
  });

  document.querySelector("#start-button").addEventListener("click", startGame);
  document.querySelector("#restart-button").addEventListener("click", startGame);
  document.querySelector("#sound-toggle").addEventListener("click", (event) => {
    soundEnabled = !soundEnabled;
    event.currentTarget.setAttribute("aria-pressed", String(!soundEnabled));
    document.querySelector("#sound-label").textContent = soundEnabled ? "SOUND ON" : "SOUND OFF";
    if (soundEnabled) playTone(520, .08, "sine", .025);
  });

  reset();
  draw();
})();
