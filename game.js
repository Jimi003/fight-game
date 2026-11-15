(() => {
  "use strict";

  const canvas = document.querySelector("#game");
  const ctx = canvas.getContext("2d");
  const healthBar = document.querySelector("#player-health");
  const healthText = document.querySelector("#player-health-text");
  const scoreText = document.querySelector("#score-label");
  const waveText = document.querySelector("#wave-label");
  const comboText = document.querySelector("#combo-label");
  const startScreen = document.querySelector("#start-screen");
  const koScreen = document.querySelector("#ko-screen");
  const toast = document.querySelector("#toast");

  const WIDTH = canvas.width;
  const HEIGHT = canvas.height;
  const FLOOR = 454;
  const GRAVITY = 1750;
  const platforms = [
    { x: 118, y: 354, w: 166, h: 13 },
    { x: 675, y: 319, w: 168, h: 13 },
    { x: 406, y: 260, w: 148, h: 12 },
  ];
  const keys = new Set();
  const pressed = new Set();
  const attackBuffer = [];
  const enemies = [];
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

  const player = {};

  const attackMoves = {
    punch: { label: "JAB", damage: 13, range: 72, height: 42, startup: .08, active: .15, recovery: .22, knockback: 185, score: 100 },
    kick: { label: "ROUNDHOUSE", damage: 21, range: 94, height: 55, startup: .16, active: .19, recovery: .34, knockback: 285, score: 175 },
    grab: { label: "THROW", damage: 30, range: 65, height: 79, startup: .12, active: .12, recovery: .42, knockback: 390, score: 250 },
  };

  function reset() {
    Object.assign(player, {
      x: 248, y: FLOOR, vx: 0, vy: 0, w: 38, h: 76, face: 1,
      health: 100, maxHealth: 100, grounded: true, crouching: false,
      blocking: false, invulnerable: 0, attack: null, attackCooldown: 0,
      combo: 0, comboTimer: 0, hurtTimer: 0, jumpHeld: false,
    });
    enemies.length = 0;
    attackBuffer.length = 0;
    keys.clear();
    pressed.clear();
    gameTime = 0;
    spawnTimer = .7;
    score = 0;
    wave = 1;
    defeated = 0;
    shake = 0;
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
    attackBuffer.push({ type, expires: gameTime + .22 });
    if (attackBuffer.length > 4) attackBuffer.shift();
  }

  function tryStartAttack() {
    if (player.attack || player.attackCooldown > 0) return;
    while (attackBuffer.length && attackBuffer[0].expires < gameTime) attackBuffer.shift();
    const input = attackBuffer.shift();
    if (!input) return;
    const move = attackMoves[input.type];
    player.attack = { type: input.type, move, time: 0, hitIds: new Set(), direction: player.face };
    player.crouching = false;
    player.attackCooldown = move.startup + move.active + move.recovery;
    if (soundEnabled) playTone(input.type === "kick" ? 205 : input.type === "grab" ? 115 : 290, .07, "square", .018);
  }

  function spawnEnemy() {
    const fromRight = player.x < WIDTH * .63 ? Math.random() > .2 : Math.random() > .75;
    const x = fromRight ? WIDTH + 24 : -24;
    const toughness = Math.min(1 + Math.floor(defeated / 6) * .17, 1.85);
    enemies.push({
      id: `${gameTime}-${Math.random()}`,
      x, y: FLOOR, vx: 0, vy: 0, w: 38, h: 72,
      health: 34 * toughness, maxHealth: 34 * toughness,
      speed: (55 + Math.random() * 18) * Math.min(1 + defeated * .012, 1.55),
      face: x < player.x ? 1 : -1,
      attack: null, attackCooldown: .65 + Math.random() * .8,
      hitFlash: 0, hurtTimer: 0, grounded: true, dead: false,
      hue: Math.random() > .5 ? "#e75172" : "#b454d8",
    });
  }

  function updatePlayer(dt) {
    const move = (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0)
      - (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0);
    player.crouching = keys.has("KeyS") || keys.has("ArrowDown");
    player.blocking = keys.has("KeyI");

    if (move) player.face = move;
    player.attackCooldown = Math.max(0, player.attackCooldown - dt);
    player.invulnerable = Math.max(0, player.invulnerable - dt);
    player.hurtTimer = Math.max(0, player.hurtTimer - dt);
    player.comboTimer = Math.max(0, player.comboTimer - dt);
    if (player.comboTimer === 0) player.combo = 0;
    if (player.attack) player.attack.time += dt;
    tryStartAttack();

    const canMove = !player.hurtTimer;
    const speed = player.crouching ? 95 : player.blocking ? 112 : 205;
    player.vx = canMove ? move * speed : player.vx * Math.max(0, 1 - dt * 10);
    player.x += player.vx * dt;
    player.x = clamp(player.x, 25, WIDTH - 25);

    const jumpPressed = pressed.has("Space") || pressed.has("KeyW") || pressed.has("ArrowUp");
    if (jumpPressed && player.grounded && canMove) {
      player.vy = -640;
      player.grounded = false;
      player.crouching = false;
      if (soundEnabled) playTone(470, .07, "sine", .018);
    }

    applyGravity(player, dt);
    if (player.attack && player.attack.time > player.attack.move.startup + player.attack.move.active + player.attack.move.recovery) {
      player.attack = null;
    }
    if (player.attack) checkPlayerHits();
  }

  function applyGravity(entity, dt) {
    const oldY = entity.y;
    entity.vy += GRAVITY * dt;
    entity.y += entity.vy * dt;
    entity.grounded = false;

    if (entity.vy >= 0) {
      for (const platform of platforms) {
        const wasAbove = oldY <= platform.y;
        const crosses = entity.y >= platform.y && oldY + entity.vy * dt <= platform.y + 18;
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
    const center = player.x + attack.direction * (player.w / 2 + move.range / 2 - 8);
    const top = player.y - (player.crouching ? 38 : player.h) - (attack.type === "kick" ? 2 : 0);
    const box = { left: center - move.range / 2, right: center + move.range / 2, top, bottom: top + move.height };
    let hit = false;

    for (const enemy of enemies) {
      if (enemy.dead || attack.hitIds.has(enemy.id)) continue;
      const enemyBox = { left: enemy.x - enemy.w / 2, right: enemy.x + enemy.w / 2, top: enemy.y - enemy.h, bottom: enemy.y };
      if (!overlaps(box, enemyBox)) continue;
      attack.hitIds.add(enemy.id);
      enemy.health -= move.damage;
      enemy.hitFlash = .14;
      enemy.hurtTimer = .17;
      enemy.vx = attack.direction * move.knockback;
      enemy.vy = attack.type === "kick" ? -120 : -45;
      hit = true;
      shake = Math.max(shake, attack.type === "grab" ? 8 : 4);
      if (soundEnabled) playTone(attack.type === "grab" ? 90 : attack.type === "kick" ? 145 : 190, .08, "triangle", .035);
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

    if (hit && attack.type === "grab") {
      player.vx = -attack.direction * 32;
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
          const reach = 44;
          const close = Math.abs(distance) < reach + player.w / 2;
          const sameLevel = Math.abs(player.y - enemy.y) < 52;
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
      if (Math.abs(distance) > 47) {
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

    for (let i = enemies.length - 1; i >= 0; i--) {
      const enemy = enemies[i];
      if (enemy.dead) {
        if (enemy.health <= 0) enemies.splice(i, 1);
        continue;
      }
    }
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
    drawVignette();
    ctx.restore();
  }

  function drawBackdrop() {
    const sky = ctx.createLinearGradient(0, 0, 0, FLOOR);
    sky.addColorStop(0, "#202136");
    sky.addColorStop(.58, "#292337");
    sky.addColorStop(1, "#49303c");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    const glow = ctx.createRadialGradient(512, 195, 25, 512, 195, 400);
    glow.addColorStop(0, "rgba(228,92,139,.19)");
    glow.addColorStop(1, "rgba(228,92,139,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, WIDTH, FLOOR);

    drawCityLayer(.18, "#202131", 270, 75, 145);
    drawCityLayer(.34, "#252437", 310, 93, 120);
    drawSign(96, 181, "NIGHT", "#e75172");
    drawSign(765, 208, "09", "#4be6dc");
    drawNeonLine(0, 277, WIDTH, 277, "rgba(252,75,131,.3)");
    drawRain();
  }

  function drawCityLayer(offset, color, base, minHeight, width) {
    const scroll = (gameTime * 12 * offset) % width;
    ctx.fillStyle = color;
    for (let x = -width - scroll; x < WIDTH + width; x += width) {
      const seed = Math.abs(Math.sin((x + 400) * .035));
      const h = minHeight + seed * 100;
      ctx.fillRect(x, base - h, width - 8, h);
      ctx.fillStyle = "rgba(246,180,190,.13)";
      for (let row = 0; row < Math.floor(h / 19); row++) {
        for (let col = 0; col < 4; col++) {
          if ((row + col + Math.round(seed * 10)) % 3 !== 0) {
            ctx.fillRect(x + 12 + col * 19, base - h + 13 + row * 19, 5, 7);
          }
        }
      }
      ctx.fillStyle = color;
    }
  }

  function drawSign(x, y, text, color) {
    ctx.save();
    ctx.fillStyle = "rgba(16,18,28,.8)";
    ctx.fillRect(x, y, 97, 34);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    ctx.strokeRect(x + 1, y + 1, 95, 32);
    ctx.fillStyle = color;
    ctx.font = "700 14px 'DM Mono', monospace";
    ctx.textAlign = "center";
    ctx.fillText(text, x + 48, y + 22);
    ctx.restore();
  }

  function drawNeonLine(x1, y1, x2, y2, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  function drawRain() {
    ctx.strokeStyle = "rgba(181,196,233,.12)";
    ctx.lineWidth = 1;
    for (let i = 0; i < 38; i++) {
      const x = (i * 137 + gameTime * (70 + i % 4 * 13)) % (WIDTH + 35) - 16;
      const y = (i * 67 + gameTime * 160) % FLOOR;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - 6, y + 15);
      ctx.stroke();
    }
  }

  function drawPlatforms() {
    for (const platform of platforms) {
      ctx.fillStyle = "#343044";
      ctx.fillRect(platform.x, platform.y, platform.w, platform.h);
      ctx.fillStyle = "#fb4d82";
      ctx.fillRect(platform.x, platform.y, platform.w, 3);
      ctx.fillStyle = "rgba(246,76,127,.23)";
      ctx.fillRect(platform.x, platform.y + 3, platform.w, 2);
      for (let x = platform.x + 10; x < platform.x + platform.w; x += 22) {
        ctx.fillStyle = "rgba(245,210,220,.18)";
        ctx.fillRect(x, platform.y + 6, 8, 2);
      }
    }
  }

  function drawGround() {
    const ground = ctx.createLinearGradient(0, FLOOR, 0, HEIGHT);
    ground.addColorStop(0, "#292633");
    ground.addColorStop(1, "#171923");
    ctx.fillStyle = ground;
    ctx.fillRect(0, FLOOR, WIDTH, HEIGHT - FLOOR);
    ctx.fillStyle = "#fc4b83";
    ctx.fillRect(0, FLOOR, WIDTH, 3);
    ctx.fillStyle = "rgba(252,75,131,.13)";
    ctx.fillRect(0, FLOOR + 3, WIDTH, 8);
    ctx.strokeStyle = "rgba(228,226,242,.09)";
    ctx.lineWidth = 1;
    for (let x = -40; x < WIDTH + 80; x += 80) {
      const shift = (gameTime * 25) % 80;
      ctx.beginPath();
      ctx.moveTo(x - shift, FLOOR + 14);
      ctx.lineTo(x - shift - 36, HEIGHT);
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(228,226,242,.08)";
    for (let y = FLOOR + 40; y < HEIGHT; y += 38) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(WIDTH, y);
      ctx.stroke();
    }
  }

  function drawFighter(fighter, isPlayer) {
    const crouching = isPlayer && fighter.crouching;
    const bodyH = crouching ? 45 : fighter.h;
    const bottom = fighter.y;
    const left = fighter.x - fighter.w / 2;
    const top = bottom - bodyH;
    const facing = fighter.face;
    const hurt = fighter.hitFlash > 0 || fighter.hurtTimer > 0;
    const isBlocking = isPlayer && fighter.blocking;
    const isAttacking = isPlayer ? Boolean(fighter.attack) : Boolean(fighter.attack);
    let bodyColor = isPlayer ? "#56e4d8" : fighter.hue;
    if (hurt) bodyColor = "#fff2f8";

    ctx.save();
    if (isPlayer && fighter.invulnerable > 0 && Math.floor(gameTime * 22) % 2 === 0) ctx.globalAlpha = .55;
    ctx.fillStyle = "rgba(8,10,18,.38)";
    ctx.beginPath();
    ctx.ellipse(fighter.x, bottom + 3, 26, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    const walk = Math.sin(gameTime * (Math.abs(fighter.vx) > 15 ? 14 : 3)) * (Math.abs(fighter.vx) > 15 ? 5 : 1);
    ctx.translate(fighter.x, 0);
    ctx.scale(facing, 1);
    const shoulderY = top + bodyH * .45;
    const headY = top + 13;

    ctx.fillStyle = "#10121b";
    ctx.beginPath();
    ctx.ellipse(0, headY, 12, 14, -.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = isPlayer ? "#293747" : "#392b3b";
    ctx.fillRect(-10, headY - 8, 19, 5);
    ctx.fillStyle = bodyColor;
    ctx.fillRect(-8, headY - 1, 3, 2);

    const torsoTop = top + 26;
    const torsoBottom = top + bodyH * .67;
    ctx.fillStyle = "#181b28";
    ctx.beginPath();
    ctx.moveTo(-12, torsoTop);
    ctx.lineTo(11, torsoTop + 1);
    ctx.lineTo(13, torsoBottom);
    ctx.lineTo(-11, torsoBottom);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = bodyColor;
    ctx.beginPath();
    ctx.moveTo(-12, torsoTop + 2);
    ctx.lineTo(-7, torsoTop);
    ctx.lineTo(-4, torsoBottom - 2);
    ctx.lineTo(-12, torsoBottom - 2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,.17)";
    ctx.fillRect(-2, torsoTop + 5, 10, 3);
    ctx.fillRect(-2, torsoTop + 11, 8, 3);

    const armReach = isAttacking && fighter.attack.type === "punch"
      ? 24 + Math.sin(Math.min(1, fighter.attack.time / (fighter.attack.move.startup + fighter.attack.move.active)) * Math.PI) * 22
      : isBlocking ? 11 : 3;
    ctx.strokeStyle = bodyColor;
    ctx.lineWidth = 8;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(7, shoulderY);
    ctx.lineTo(14 + armReach, shoulderY + 9);
    ctx.stroke();
    ctx.strokeStyle = "#222532";
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(-7, shoulderY);
    ctx.lineTo(-12, shoulderY + 17);
    ctx.stroke();
    if (isBlocking) {
      ctx.strokeStyle = "#a9fff1";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(14, shoulderY + 7, 17, -1.15, 1.1);
      ctx.stroke();
    }

    const legStart = top + bodyH * .68;
    ctx.strokeStyle = "#151824";
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.moveTo(-5, legStart);
    ctx.lineTo(-9 + walk, bottom - 5);
    ctx.lineTo(-1 + walk, bottom - 4);
    ctx.stroke();
    const kicking = isAttacking && fighter.attack.type === "kick";
    const kickProgress = kicking ? clamp((fighter.attack.time - fighter.attack.move.startup) / fighter.attack.move.active, 0, 1) : 0;
    ctx.strokeStyle = bodyColor;
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.moveTo(5, legStart);
    if (kicking) {
      ctx.lineTo(18 + kickProgress * 27, legStart + 10 + Math.sin(kickProgress * Math.PI) * 4);
      ctx.lineTo(24 + kickProgress * 31, legStart + 11 + Math.sin(kickProgress * Math.PI) * 4);
    } else {
      ctx.lineTo(8 - walk, bottom - 6);
      ctx.lineTo(17 - walk, bottom - 5);
    }
    ctx.stroke();

    if (isAttacking && fighter.attack.type === "grab") {
      ctx.fillStyle = "rgba(252,75,131,.72)";
      ctx.beginPath();
      ctx.arc(25, shoulderY + 8, 5 + Math.sin(fighter.attack.time * 35) * 2, 0, Math.PI * 2);
      ctx.fill();
    }
    if (isPlayer && fighter.combo > 1 && fighter.comboTimer > 0) {
      ctx.fillStyle = "#f4f2f8";
      ctx.font = "800 15px 'Barlow Condensed', Impact, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(`${fighter.combo} HIT`, 0, top - 12);
    }
    ctx.restore();
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
    if (event.code === "Space" || event.code === "KeyW" || event.code === "ArrowUp") player.jumpHeld = false;
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
