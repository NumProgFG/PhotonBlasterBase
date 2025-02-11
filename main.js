// Set up canvas and context
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;
window.addEventListener('resize', function() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
});

// Define level boundaries for player travel
const levelBounds = {
  minX: -1000,
  maxX: 1000,
  minY: -1000,
  maxY: 1000
};

// Input tracking
let keys = {};
let mousePos = { x: 0, y: 0 };
let mouseDown = false;
window.addEventListener('keydown', (e) => { keys[e.key.toLowerCase()] = true; });
window.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });
canvas.addEventListener('mousemove', (e) => {
  mousePos = { x: e.clientX, y: e.clientY };
});
canvas.addEventListener('mousedown', (e) => { if (e.button === 0) mouseDown = true; });
canvas.addEventListener('mouseup', (e) => { if (e.button === 0) mouseDown = false; });

// Global game control variables
let gameLoopRequestId = null
let gameRunning = false;

// Sound volume: load from localStorage or default to 0.1
let currentVolume = parseFloat(localStorage.getItem('gameVolume')) || 0.1;

// Load sounds from the Sounds folder
const sounds = {
  playerShoot: new Audio("Sounds/PlayerShoot.wav"),
  cardSelect: new Audio("Sounds/CardSelect.wav"),
  enemyHit: new Audio("Sounds/EnemyHit.wav"),
  playerHit: new Audio("Sounds/PlayerHit.wav"),
  playerDeath: new Audio("Sounds/PlayerDeath.wav"),
  enemyDeath: new Audio("Sounds/EnemyDeath.wav")
};
for (let key in sounds) {
  sounds[key].volume = currentVolume;
}

// Function to play a sound by name
function playSound(name) {
  if (sounds[name]) {
    sounds[name].currentTime = 0;
    sounds[name].play();
  }
}

// Player object with new level, XP, dash properties, and hit timer
const player = {
  x: 0,
  y: 0,
  radius: 20,
  color: '#00f', // Neon blue
  speed: 3,
  health: 100,
  damage: 10,
  fireRate: 500, // in milliseconds
  lastShot: 0,
  shield: 0,             // Player starts with no shield
  shieldArc: 1.2566,     // 20% coverage in radians (~72°)
  revive: false,
  critChance: 0,
  lifeSteal: 0,
  scoreMultiplier: 1,
  dashCooldown: 1000,    // Dash cooldown in ms (1 second)
  lastDash: 0,
  dashDistance: 150,
  level: 1,
  xp: 0,
  xpToLevel: 100,
  xpMultiplier: 1,
  hitTimer: 0            // Timer (in ms) for flashing red when hit
};

// Dash animation variables
let dashActive = false;
let dashStart = { x: 0, y: 0 };
let dashTarget = { x: 0, y: 0 };
let dashElapsed = 0;
const dashDuration = 200; // Dash animation duration in ms

// Global score variables
let killCount = 0;
let bossKillCount = 0;
let score = 0;
const bossKillBonus = 10;

// Wave management variables
let currentWave = 1;
let waveEnemyTotal = currentWave * 6; // Increased enemies per wave
let waveEnemySpawned = 0;
let enemySpawnInterval = Math.max(300, 2000 - (currentWave - 1) * 150);
let lastEnemySpawn = Date.now();
// For boss spawning, use a global bossWave that is calculated only after a boss wave is completed
let bossWave = Math.floor(Math.random() * 3) + 3; // initial boss wave between 3 and 5
let bossSpawned = false;

// Upgrade overlay elements
let upgradeMode = false;
const upgradeOverlay = document.getElementById('upgradeOverlay');
const upgradeContainer = document.getElementById('upgradeContainer');

// Expanded upgrades array with weights for rarity
const upgrades = [
  { name: 'Increase Damage', rarity: 'common', weight: 50, apply: () => { player.damage += 5; } },
  { name: 'Increase Fire Rate', rarity: 'common', weight: 50, apply: () => { player.fireRate = Math.max(200, player.fireRate - 100); } },
  { name: 'Increase Bullet Speed', rarity: 'common', weight: 50, apply: () => { bulletSpeedModifier += 1; } },
  { name: 'Increase Speed', rarity: 'common', weight: 50, apply: () => { player.speed += 1; } },
  { name: 'Increase Shield Coverage', rarity: 'uncommon', weight: 30, apply: () => { player.shieldArc = Math.min(Math.PI * 0.5, player.shieldArc + (0.1 * 2 * Math.PI)); } },
  { name: 'Increase Dash Distance', rarity: 'uncommon', weight: 30, apply: () => { player.dashDistance += 50; } },
  { name: 'Increase Health', rarity: 'rare', weight: 15, apply: () => { player.health += 20; } },
  { name: 'Increase Player Size', rarity: 'rare', weight: 15, apply: () => { player.radius += 2; } },
  { name: 'Reduce Dash Cooldown', rarity: 'rare', weight: 15, apply: () => { player.dashCooldown = Math.max(500, player.dashCooldown - 200); } },
  { name: 'Score Multiplier', rarity: 'rare', weight: 15, apply: () => { player.scoreMultiplier += 0.5; } },
  { name: 'Shield Boost', rarity: 'epic', weight: 5, apply: () => { player.shield += 30; } },
  { name: 'Life Steal', rarity: 'epic', weight: 5, apply: () => { player.lifeSteal += 0.05; } },
  { name: 'XP Boost', rarity: 'epic', weight: 5, apply: () => { player.xpMultiplier += 0.5; } },
  { name: 'Critical Strike', rarity: 'legendary', weight: 2, apply: () => { player.critChance += 0.1; } },
  { name: 'Revive', rarity: 'legendary', weight: 2, apply: () => { player.revive = true; } }
];

let bulletSpeedModifier = 5;

// Particle system for enemy death effects
const particles = [];
function Particle(x, y, color) {
  this.x = x;
  this.y = y;
  this.radius = Math.random() * 2 + 2;
  const angle = Math.random() * Math.PI * 2;
  const speed = Math.random() * 2 + 1;
  this.vx = Math.cos(angle) * speed;
  this.vy = Math.sin(angle) * speed;
  this.life = 50 + Math.random() * 50;
  this.color = color;
}
function updateParticles() {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.life -= 1;
    if (p.life <= 0) {
      particles.splice(i, 1);
    }
  }
}
function drawParticles(offsetX, offsetY) {
  particles.forEach(p => {
    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.globalAlpha = p.life / 100;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });
}

// Enemy constructor with variant adjustments
function Enemy(x, y, variant = 'normal') {
  this.x = x;
  this.y = y;
  this.variant = variant;
  this.radius = 15;
  this.baseHealth = 20;
  this.health = this.baseHealth + (currentWave - 1) * 5;
  this.maxHealth = this.health;
  this.speed = 1.5 + (currentWave - 1) * 0.1;
  this.color = getRandomEnemyColor();
  this.isBoss = false;
  switch (variant) {
    case 'fast':
      this.speed *= 1.5;
      this.health *= 0.8;
      this.maxHealth = this.health;
      break;
    case 'small':
      this.radius = 10;
      this.health *= 0.7;
      this.maxHealth = this.health;
      break;
    case 'slow':
      this.speed *= 0.7;
      break;
    case 'tank':
      this.radius = 20;
      this.health *= 2;
      this.maxHealth = this.health;
      this.speed *= 0.8;
      break;
    default:
      break;
  }
}

// Boss constructor – bosses are larger and have distinct properties
function Boss(x, y) {
  this.x = x;
  this.y = y;
  this.radius = 40; // Used for health calculations (drawn as square)
  this.baseHealth = 200;
  this.health = this.baseHealth + (currentWave - 1) * 20;
  this.maxHealth = this.health;
  this.speed = 1 + (currentWave - 1) * 0.05;
  this.color = '#ff0000';
  this.isBoss = true;
}

// For bosses, draw as squares instead of circles
function drawBoss(enemy, offsetX, offsetY) {
  ctx.save();
  ctx.translate(offsetX, offsetY);
  ctx.shadowBlur = 20;
  ctx.shadowColor = enemy.color;
  ctx.fillStyle = enemy.color;
  // Draw square centered at enemy.x, enemy.y with side length = enemy.radius*2
  ctx.fillRect(enemy.x - enemy.radius, enemy.y - enemy.radius, enemy.radius * 2, enemy.radius * 2);
  ctx.restore();
  // Draw health bar
  ctx.save();
  ctx.translate(offsetX, offsetY);
  const barWidth = enemy.radius * 2;
  const barHeight = 5;
  const healthRatio = enemy.health / enemy.maxHealth;
  ctx.fillStyle = '#000';
  ctx.fillRect(enemy.x - enemy.radius, enemy.y - enemy.radius - 10, barWidth, barHeight);
  ctx.fillStyle = '#0f0';
  ctx.fillRect(enemy.x - enemy.radius, enemy.y - enemy.radius - 10, barWidth * healthRatio, barHeight);
  ctx.restore();
}

function getRandomEnemyColor() {
  const neonColors = ['#ff00ff', '#00ffff', '#ffff00', '#ff8800', '#ff0088', '#88ff00'];
  let color = neonColors[Math.floor(Math.random() * neonColors.length)];
  if (color === player.color) return getRandomEnemyColor();
  return color;
}

// Bullet constructor
function Bullet(x, y, dx, dy) {
  this.x = x;
  this.y = y;
  this.dx = dx;
  this.dy = dy;
  this.radius = 5;
  this.damage = player.damage;
}

// Animated dash – smoothly animate the player moving toward the dash target
function startDash() {
  if (dashActive) return;
  const canvasCenter = { x: canvas.width / 2, y: canvas.height / 2 };
  const targetX = player.x + (mousePos.x - canvasCenter.x);
  const targetY = player.y + (mousePos.y - canvasCenter.y);
  const angle = Math.atan2(targetY - player.y, targetX - player.x);
  dashStart = { x: player.x, y: player.y };
  dashTarget = { x: player.x + Math.cos(angle) * player.dashDistance, y: player.y + Math.sin(angle) * player.dashDistance };
  dashActive = true;
  dashElapsed = 0;
}

// Shooting function supporting continuous shooting while holding left click
function shootBullet() {
  const currentTime = Date.now();
  if (currentTime - player.lastShot < player.fireRate) return;
  player.lastShot = currentTime;
  const canvasCenter = { x: canvas.width / 2, y: canvas.height / 2 };
  const targetX = player.x + (mousePos.x - canvasCenter.x);
  const targetY = player.y + (mousePos.y - canvasCenter.y);
  const angle = Math.atan2(targetY - player.y, targetX - player.x);
  const dx = Math.cos(angle) * bulletSpeedModifier;
  const dy = Math.sin(angle) * bulletSpeedModifier;
  let bulletDamage = player.damage;
  if (Math.random() < player.critChance) bulletDamage *= 2;
  let bullet = new Bullet(player.x, player.y, dx, dy);
  bullet.damage = bulletDamage;
  bullets.push(bullet);
  playSound("playerShoot");
}

const bullets = []; // Array for bullets
const enemies = []; // Array for enemies

// Spawn a normal enemy with a random variant
function spawnNormalEnemy() {
  const variants = ['normal', 'fast', 'small', 'slow', 'tank'];
  const variant = variants[Math.floor(Math.random() * variants.length)];
  const angle = Math.random() * Math.PI * 2;
  const distance = Math.max(canvas.width, canvas.height) / 2 + 50;
  const x = player.x + Math.cos(angle) * distance;
  const y = player.y + Math.sin(angle) * distance;
  enemies.push(new Enemy(x, y, variant));
}

// Spawn a boss enemy
function spawnBoss() {
  const angle = Math.random() * Math.PI * 2;
  const distance = Math.max(canvas.width, canvas.height) / 2 + 50;
  const x = player.x + Math.cos(angle) * distance;
  const y = player.y + Math.sin(angle) * distance;
  enemies.push(new Boss(x, y));
}

// Weighted random selection for upgrade cards
function getWeightedUpgrade() {
  let totalWeight = 0;
  upgrades.forEach(u => { totalWeight += u.weight; });
  let randomWeight = Math.random() * totalWeight;
  for (let i = 0; i < upgrades.length; i++) {
    randomWeight -= upgrades[i].weight;
    if (randomWeight <= 0) {
      return upgrades[i];
    }
  }
  return upgrades[upgrades.length - 1];
}

// Show upgrade options (called between waves and on level up)
function showUpgradeOptions() {
  upgradeMode = true;
  upgradeContainer.innerHTML = '';
  let options = [];
  while (options.length < 3) {
    let upgrade = getWeightedUpgrade();
    if (!options.includes(upgrade)) {
      options.push(upgrade);
    }
  }
  options.forEach(upgrade => {
    const card = document.createElement('div');
    card.className = `upgrade-card rarity-${upgrade.rarity}`;
    card.innerText = upgrade.name + "\n(" + upgrade.rarity.toUpperCase() + ")";
    card.addEventListener('click', function() {
      upgrade.apply();
      playSound("cardSelect");
      upgradeOverlay.style.display = 'none';
      upgradeMode = false;
    });
    upgradeContainer.appendChild(card);
  });
  upgradeOverlay.style.display = 'flex';
}

// Check for level up based on XP thresholds; each level up awards a card selection.
function checkLevelUp() {
  if (player.xp >= player.xpToLevel) {
    player.level++;
    player.xp -= player.xpToLevel;
    player.xpToLevel = player.level * 100;
    showUpgradeOptions();
  }
}

// Function to initialize game variables for a new game
function initGame() {
  // Reset player properties
  player.x = 0;
  player.y = 0;
  player.health = 100;
  player.damage = 10;
  player.fireRate = 500;
  player.lastShot = 0;
  player.shield = 0;
  player.shieldArc = 1.2566;
  player.revive = false;
  player.critChance = 0;
  player.lifeSteal = 0;
  player.scoreMultiplier = 1;
  player.dashCooldown = 1000;
  player.lastDash = 0;
  player.dashDistance = 150;
  player.level = 1;
  player.xp = 0;
  player.xpToLevel = 100;
  player.xpMultiplier = 1;
  player.hitTimer = 0;
  
  // Reset global counters and arrays
  killCount = 0;
  bossKillCount = 0;
  score = 0;
  currentWave = 1;
  waveEnemyTotal = currentWave * 6;
  waveEnemySpawned = 0;
  enemySpawnInterval = Math.max(300, 2000 - (currentWave - 1) * 150);
  lastEnemySpawn = Date.now();
  bossWave = Math.floor(Math.random() * 3) + 3; // initial boss wave between 3 and 5
  bossSpawned = false;
  bullets.length = 0;
  enemies.length = 0;
  particles.length = 0;
  dashActive = false;
}

// Start the game by initializing variables and starting the game loop
function startGame() {
  initGame();
  gameRunning = true;
  lastTime = performance.now();
  if (gameLoopRequestId) cancelAnimationFrame(gameLoopRequestId);
  gameLoopRequestId = requestAnimationFrame(gameLoop);
}

// Player explosion on death
function playerExplosion() {
  for (let i = 0; i < 50; i++) {
    particles.push(new Particle(player.x, player.y, player.color));
  }
  playSound("playerDeath");
}

// Game over function: shows the game over overlay and stops the game loop
function gameOver() {
  playerExplosion();
  gameRunning = false;
  if (gameLoopRequestId) cancelAnimationFrame(gameLoopRequestId);
  let highScore = localStorage.getItem('highScore') || 0;
  if (score > highScore) {
    localStorage.setItem('highScore', score);
  }
  document.getElementById("gameOverOverlay").style.display = "flex";
}

// Main update loop
let lastTime = 0;
function update(deltaTime) {
  if (upgradeMode) return;
  
  // Animate dash if active; otherwise process normal movement
  if (dashActive) {
    dashElapsed += deltaTime;
    let t = dashElapsed / dashDuration;
    if (t >= 1) { t = 1; dashActive = false; }
    player.x = dashStart.x + (dashTarget.x - dashStart.x) * t;
    player.y = dashStart.y + (dashTarget.y - dashStart.y) * t;
  } else {
    if (keys['w'] || keys['arrowup']) player.y -= player.speed;
    if (keys['s'] || keys['arrowdown']) player.y += player.speed;
    if (keys['a'] || keys['arrowleft']) player.x -= player.speed;
    if (keys['d'] || keys['arrowright']) player.x += player.speed;
  }
  
  // Activate dash (space key) if not active and cooldown is complete
  if ((keys[' '] || keys['space']) && !dashActive && (Date.now() - player.lastDash >= player.dashCooldown)) {
    startDash();
    player.lastDash = Date.now();
  }
  
  // Clamp player within level boundaries
  player.x = Math.min(levelBounds.maxX, Math.max(levelBounds.minX, player.x));
  player.y = Math.min(levelBounds.maxY, Math.max(levelBounds.minY, player.y));
  
  // Continuous shooting while left mouse button held down
  if (mouseDown) { shootBullet(); }
  
  // Update bullets
  for (let i = bullets.length - 1; i >= 0; i--) {
    const bullet = bullets[i];
    bullet.x += bullet.dx;
    bullet.y += bullet.dy;
    if (Math.hypot(bullet.x - player.x, bullet.y - player.y) > canvas.width) {
      bullets.splice(i, 1);
    }
  }
  
  // Enemy spawning: spawn a boss on the designated bossWave or normal enemies otherwise
  let now = Date.now();
  if (currentWave === bossWave && !bossSpawned) {
    spawnBoss();
    bossSpawned = true;
  } else if (waveEnemySpawned < waveEnemyTotal && now - lastEnemySpawn > enemySpawnInterval) {
    spawnNormalEnemy();
    waveEnemySpawned++;
    lastEnemySpawn = now;
  }
  
  // Update enemy movement and handle collisions with player
  for (let i = enemies.length - 1; i >= 0; i--) {
    const enemy = enemies[i];
    const angle = Math.atan2(player.y - enemy.y, player.x - enemy.x);
    enemy.x += Math.cos(angle) * enemy.speed;
    enemy.y += Math.sin(angle) * enemy.speed;
    if (Math.hypot(enemy.x - player.x, enemy.y - player.y) < enemy.radius + player.radius) {
      let damage = 10;
      if (player.shield > 0) {
        const shieldAbsorb = Math.min(player.shield, damage);
        player.shield -= shieldAbsorb;
        damage -= shieldAbsorb;
      }
      player.health -= damage;
      playSound("playerHit");
      player.hitTimer = 200; // flash red for 200ms
      enemies.splice(i, 1);
    }
  }
  
  // Bullet-enemy collision detection with XP rewards and particle effects
  for (let i = bullets.length - 1; i >= 0; i--) {
    for (let j = enemies.length - 1; j >= 0; j--) {
      const bullet = bullets[i];
      const enemy = enemies[j];
      if (Math.hypot(bullet.x - enemy.x, bullet.y - enemy.y) < bullet.radius + enemy.radius) {
        enemy.health -= bullet.damage;
        bullets.splice(i, 1);
        if (enemy.health > 0) {
          playSound("enemyHit");
        }
        if (enemy.health <= 0) {
          let xpGain = enemy.isBoss
            ? Math.floor((Math.random() * 10 + 20) * (1 + (currentWave - 1) * 0.1))
            : Math.floor((Math.random() * 5 + 5) * (1 + (currentWave - 1) * 0.1));
          xpGain = Math.floor(xpGain * player.xpMultiplier);
          player.xp += xpGain;
          checkLevelUp();
          if (enemy.isBoss) { bossKillCount++; }
          else { killCount++; }
          playSound("enemyDeath");
          for (let p = 0; p < 15; p++) {
            particles.push(new Particle(enemy.x, enemy.y, enemy.color));
          }
          enemies.splice(j, 1);
        }
        break;
      }
    }
  }
  
  updateParticles();
  
  // Check if the wave is complete
  if (waveEnemySpawned >= waveEnemyTotal && enemies.length === 0) {
    currentWave++;
    waveEnemyTotal = currentWave * 6;
    waveEnemySpawned = 0;
    enemySpawnInterval = Math.max(300, 2000 - (currentWave - 1) * 150);
    if (bossSpawned) { 
      bossWave = currentWave + Math.floor(Math.random() * 3) + 3;
      bossSpawned = false;
    }
    showUpgradeOptions();
  }
  
  score = (killCount + bossKillCount * bossKillBonus) * player.scoreMultiplier;
  
  // Update hit timer for red flash effect
  if (player.hitTimer > 0) {
    player.hitTimer -= deltaTime;
    if (player.hitTimer < 0) player.hitTimer = 0;
  }
  
  // Check for game over (revive if available)
  if (player.health <= 0) {
    if (player.revive) { player.health = 50; player.revive = false; }
    else { gameOver(); }
  }
}

// Draw function including grid background, particles, player (with hit flash), enemies, and UI
function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const offsetX = canvas.width / 2 - player.x;
  const offsetY = canvas.height / 2 - player.y;
  
  // Draw grid background for spatial reference
  const gridSize = 100;
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 1;
  const startX = Math.floor((player.x + levelBounds.minX) / gridSize) * gridSize;
  const endX = Math.ceil((player.x + levelBounds.maxX) / gridSize) * gridSize;
  const startY = Math.floor((player.y + levelBounds.minY) / gridSize) * gridSize;
  const endY = Math.ceil((player.y + levelBounds.maxY) / gridSize) * gridSize;
  for (let x = startX; x <= endX; x += gridSize) {
    ctx.beginPath();
    ctx.moveTo(x + offsetX, levelBounds.minY + offsetY);
    ctx.lineTo(x + offsetX, levelBounds.maxY + offsetY);
    ctx.stroke();
  }
  for (let y = startY; y <= endY; y += gridSize) {
    ctx.beginPath();
    ctx.moveTo(levelBounds.minX + offsetX, y + offsetY);
    ctx.lineTo(levelBounds.maxX + offsetX, y + offsetY);
    ctx.stroke();
  }
  
  drawParticles(offsetX, offsetY);
  
  // Draw player with neon glow; if hit, flash red
  ctx.save();
  ctx.translate(offsetX, offsetY);
  ctx.shadowBlur = 20;
  if (player.hitTimer > 0) {
    ctx.shadowColor = "red";
    ctx.fillStyle = "red";
  } else {
    ctx.shadowColor = player.color;
    ctx.fillStyle = player.color;
  }
  ctx.beginPath();
  ctx.arc(player.x, player.y, player.radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  
  // Draw shield indicator (if shield > 0)
  if (player.shield > 0) {
    ctx.save();
    ctx.translate(offsetX, offsetY);
    const mouseWorldX = player.x + (mousePos.x - canvas.width / 2);
    const mouseWorldY = player.y + (mousePos.y - canvas.height / 2);
    const shieldAngle = Math.atan2(mouseWorldY - player.y, mouseWorldX - player.x);
    ctx.beginPath();
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0, 200, 255, 0.7)';
    ctx.arc(player.x, player.y, player.radius + 10, shieldAngle - player.shieldArc / 2, shieldAngle + player.shieldArc / 2);
    ctx.stroke();
    ctx.restore();
  }
  
  // Draw bullets with glow effect
  bullets.forEach(bullet => {
    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.shadowBlur = 10;
    ctx.shadowColor = '#fff';
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(bullet.x, bullet.y, bullet.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });
  
  // Draw enemies and their health bars (bosses as squares)
  enemies.forEach(enemy => {
    if (enemy.isBoss) {
      drawBoss(enemy, offsetX, offsetY);
    } else {
      ctx.save();
      ctx.translate(offsetX, offsetY);
      ctx.shadowBlur = 20;
      ctx.shadowColor = enemy.color;
      ctx.fillStyle = enemy.color;
      ctx.beginPath();
      ctx.arc(enemy.x, enemy.y, enemy.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      
      ctx.save();
      ctx.translate(offsetX, offsetY);
      const barWidth = enemy.radius * 2;
      const barHeight = 5;
      const healthRatio = enemy.health / enemy.maxHealth;
      ctx.fillStyle = '#000';
      ctx.fillRect(enemy.x - enemy.radius, enemy.y - enemy.radius - 10, barWidth, barHeight);
      ctx.fillStyle = '#0f0';
      ctx.fillRect(enemy.x - enemy.radius, enemy.y - enemy.radius - 10, barWidth * healthRatio, barHeight);
      ctx.restore();
    }
  });
  
  // Draw UI elements: Health, kills, wave, score, high score (on right)
  ctx.fillStyle = '#fff';
  ctx.font = '20px Arial';
  ctx.fillText('Health: ' + player.health, 20, 30);
  ctx.fillText('Kills: ' + killCount, 20, 60);
  ctx.fillText('Boss Kills: ' + bossKillCount, 20, 90);
  ctx.fillText('Wave: ' + currentWave, 20, 120);
  ctx.fillText('Score: ' + Math.floor(score), 20, 150);
  let highScore = localStorage.getItem('highScore') || 0;
  ctx.fillText('High Score: ' + Math.floor(highScore), canvas.width - 220, 30);
  
  // Dash ability indicator
  let now = Date.now();
  let dashTimeRemaining = Math.max(0, (player.dashCooldown - (now - player.lastDash)) / 1000);
  if (dashTimeRemaining <= 0) {
    ctx.fillText("Dash: READY", 20, canvas.height - 60);
  } else {
    ctx.fillText("Dash: " + dashTimeRemaining.toFixed(1) + "s", 20, canvas.height - 60);
  }
  
  // Display level and XP at bottom left
  ctx.fillText("Level: " + player.level, 20, canvas.height - 30);
  ctx.fillText("XP: " + player.xp + " / " + player.xpToLevel, 20, canvas.height - 10);
}

// Main game loop
function gameLoop(timestamp) {
  const deltaTime = timestamp - lastTime;
  lastTime = timestamp;
  update(deltaTime);
  draw();
  if (gameRunning) {
    gameLoopRequestId = requestAnimationFrame(gameLoop);
  }
}

// Option overlay event listeners
document.getElementById("startButton").addEventListener("click", function() {
  document.getElementById("startOverlay").style.display = "none";
  startGame();
});
document.getElementById("restartButton").addEventListener("click", function() {
  document.getElementById("gameOverOverlay").style.display = "none";
  startGame();
});
document.getElementById("optionsButton").addEventListener("click", function() {
  document.getElementById("optionsOverlay").style.display = "flex";
});
document.getElementById("closeOptionsButton").addEventListener("click", function() {
  document.getElementById("optionsOverlay").style.display = "none";
});
document.getElementById("volumeSlider").addEventListener("input", function() {
  currentVolume = parseFloat(this.value);
  localStorage.setItem('gameVolume', currentVolume);
  for (let key in sounds) {
    sounds[key].volume = currentVolume;
  }
});
document.getElementById("volumeSlider").value = currentVolume;
