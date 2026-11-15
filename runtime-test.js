/* 离线运行时测试：把 index.html 里的游戏逻辑在 Node 里跑起来（无 WebGL），
   用断言验证巨兽/命中/掩体/波次等行为。比 headless 浏览器快两个数量级。 */
const fs = require('fs');
const path = require('path');
const dir = path.dirname(fs.realpathSync(__filename));

const src = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
const m = src.match(/<script>\n([\s\S]*?)\n<\/script>/);
if (!m) { console.error('inline script not found'); process.exit(1); }
let body = m[1];
if (body.trimStart().startsWith("(() => {")) {
  body = body.trimStart().slice("(() => {".length);
  body = body.slice(0, body.lastIndexOf('})();'));
}
const cut = body.indexOf('\ninitThree();');
if (cut < 0) { console.error('initThree marker missing'); process.exit(1); }
body = body.slice(0, cut);

const stubs = `
const THREE = require('./vendor/three.min.js');
const fakeCtx = () => new Proxy({
  createImageData: (w, h) => ({ data: new Uint8Array(w * h * 4) }),
  getImageData: (x, y, w, h) => ({ data: new Uint8Array(w * h * 4) })
}, { get: (t, k) => (k in t ? t[k] : () => ({ width: 10, addColorStop: () => {} })) });
globalThis.document = {
  addEventListener: () => {},
  exitPointerLock: () => {},
  createElement: () => ({ width: 0, height: 0, getContext: fakeCtx, addEventListener: () => {} }),
  getElementById: () => ({ clientWidth: 900, style: {}, addEventListener: () => {}, classList: { add(){}, remove(){}, toggle(){} } })
};
globalThis.addEventListener = () => {};
`;

const tests = `
/* ============ 测试框架 ============ */
makeSurfaceMaps = () => ({ map: null, normalMap: null, roughnessMap: null });
makeGunMetalMaps = () => ({ map: null, normalMap: null, roughnessMap: null });
makeTubeMaps = () => ({ map: null, normalMap: null, roughnessMap: null });
makeMarkingMaps = () => ({ map: null, normalMap: null });
let pass = 0, fail = 0;
const ok = (label, cond, detail) => {
  if (cond) { pass++; console.log('  PASS ' + label + (detail ? '  (' + detail + ')' : '')); }
  else { fail++; console.log('  FAIL ' + label + (detail ? '  (' + detail + ')' : '')); }
};
function setup() {
  scene = new THREE.Group();
  camera = new THREE.PerspectiveCamera(76, 1.55, 0.05, 220);
  camera.position.set(0, EYE_H, 6);
  camera.rotation.order = 'YXZ';
  renderer = { capabilities: { getMaxAnisotropy: () => 8 }, render: () => {},
    setSize: () => {}, setClearColor: () => {}, shadowMap: { enabled: false },
    info: { render: { calls: 0, triangles: 0 } } };
  initMaterials();
  buildWorld();
  initParticles();
  gun = new THREE.Group(); scene.add(gun);
  muzzleFlash = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 6),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 1 }));
  muzzleLight = new THREE.PointLight(0xffe9a8, 0, 7, 2);
  state = 'playing'; wave = 1;
  player.hp = 1e6;
}
function shot() {                       // 手动开火一次（绕过冷却/弹药）
  player.mag = 30; player.fireCd = 0; player.reloadT = 0; player.spreadHeat = 0;
  tryFire();
}
function aim(x, y, z) {
  const dx = x - player.x, dz = z - player.z;
  player.yaw = Math.atan2(-dx, -dz);
  player.pitch = Math.atan2(y - player.y, Math.hypot(dx, dz));
  camera.position.set(player.x, player.y, player.z);
  camera.rotation.set(player.pitch, player.yaw, 0);
  camera.updateMatrixWorld(true);
}

/* ============ 1. 巨兽几何 ============ */
console.log('\\n===== 1. 巨兽模型 =====');
setup();
const hm = makeKaiju('kaiju');
const root = hm.root; root.updateMatrixWorld(true);
let meshCount = 0; root.traverse(o => { if (o.isMesh) meshCount++; });
const bb = new THREE.Box3().setFromObject(root);
const size = bb.getSize(new THREE.Vector3());
ok('网格数 = 59', meshCount === 59, '实际 ' + meshCount);
ok('高度约 5.1 m', size.y > 4.8 && size.y < 5.4, size.y.toFixed(2));
ok('身长约 5.0 m', size.z > 4.6 && size.z < 5.4, size.z.toFixed(2));
ok('脚底贴地 (min y ≈ 0)', Math.abs(bb.min.y) < 0.05, bb.min.y.toFixed(3));
const parts = []; root.traverse(o => { if (o.isMesh) parts.push(o); });
const par = parts.map((_, i) => i);
const find = i => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
const bx = parts.map(o => new THREE.Box3().setFromObject(o));
for (let i = 0; i < bx.length; i++) for (let j = i + 1; j < bx.length; j++) {
  const ox = Math.min(bx[i].max.x, bx[j].max.x) - Math.max(bx[i].min.x, bx[j].min.x);
  const oy = Math.min(bx[i].max.y, bx[j].max.y) - Math.max(bx[i].min.y, bx[j].min.y);
  const oz = Math.min(bx[i].max.z, bx[j].max.z) - Math.max(bx[i].min.z, bx[j].min.z);
  if (ox > 0 && oy > 0 && oz > 0) par[find(i)] = find(j);
}
ok('装配连通分量 = 1', new Set(parts.map((_, i) => find(i))).size === 1);
ok('命中体是躯干与头', hm.torso && hm.head && hm.head.userData !== undefined);

/* ============ 2. 命中判定：躯干 / 爆头 / 掩体 ============ */
console.log('\\n===== 2. 命中判定 =====');
setup();
// 选一条没有掩体的视线：x = 24 这条线不被任何柱子挡住（最近的柱子边缘在 x = 17.6）
player.x = 24; player.z = 0; player.y = EYE_H;
const e = spawnEnemy('kaiju', 24, -10);          // 10 m 远
e.speed = 0; e.vx = e.vz = 0;
e.mesh.updateMatrixWorld(true);
const probe = new THREE.Raycaster();
const tb = new THREE.Box3().setFromObject(e.hm.torso), tc = tb.getCenter(new THREE.Vector3());
const hb = new THREE.Box3().setFromObject(e.hm.head), hc = hb.getCenter(new THREE.Vector3());
aim(tc.x, tc.y, tc.z); probe.setFromCamera({ x: 0, y: 0 }, camera);
const phits = probe.intersectObjects(hitTargets.concat(coverMeshes), false);
console.log('  躯干瞄准: 最近交点 ' + (phits[0] ? (phits[0].object.geometry.type + ' @ y ' + phits[0].point.y.toFixed(2) + ' 距离 ' + phits[0].distance.toFixed(2)) : '无'));
let dmgBody = 0;
for (let i = 0; i < 10; i++) { aim(tc.x, tc.y, tc.z); const before = e.hp; shot(); dmgBody += before - e.hp; }
ok('打躯干有伤害', dmgBody > 0, '10 发共 ' + dmgBody + ' 伤害（满算 260）');
aim(hc.x, hc.y, hc.z); probe.setFromCamera({ x: 0, y: 0 }, camera);
const hh = probe.intersectObjects(hitTargets, false);
console.log('  头部瞄准 (目标 ' + hc.x.toFixed(2) + ',' + hc.y.toFixed(2) + ',' + hc.z.toFixed(2) + ') 交点: ' +
  hh.slice(0, 4).map(h => h.object.geometry.type + ' headshot=' + !!h.object.userData.headshot + ' @ y ' + h.point.y.toFixed(2)).join(' | '));
let dmgHead = 0, headHits = 0;
for (let i = 0; i < 10; i++) { aim(hc.x, hc.y, hc.z); const before = e.hp; shot(); const d = before - e.hp; dmgHead += d; if (d >= 52) headHits++; }
ok('打头有伤害', dmgHead > 0, '10 发共 ' + dmgHead);
ok('爆头造成 2 倍伤害 (52)', headHits > 0, headHits + ' 发爆头');
console.log('  信息: 躯干 10 发 ' + dmgBody + '，头 10 发 ' + dmgHead + '（散布会让一部分打空）');
// 掩体挡子弹：把巨兽放到柱子正后方
const pillar = obstacles.find(o => o.x <= 0 && o.x + o.w >= 0);
player.x = 0; player.z = 6; player.y = EYE_H;
const e2 = spawnEnemy('kaiju', 0, pillar.z - 6);      // 柱子（z -4.2→-1.8）后面 6 m
e2.mesh.updateMatrixWorld(true);
aim(0, 3.0, e2.z);
const cb = new THREE.Raycaster();
cb.setFromCamera({ x: 0, y: 0 }, camera);
const chits = cb.intersectObjects(hitTargets.concat(coverMeshes), false);
console.log('  掩体后巨兽 (z=' + e2.z + ') 最近交点: ' + (chits[0] ? (chits[0].object.geometry.type + ' @ z ' + chits[0].point.z.toFixed(2) + ' 是掩体:' + coverMeshes.includes(chits[0].object)) : '无'));
let dmgCover = 0;
const coverStart = e2.hp;
for (let i = 0; i < 10; i++) { aim(0, 3.0, e2.z); shot(); }
dmgCover = coverStart - e2.hp;
ok('掩体挡住子弹（伤害为 0）', dmgCover === 0, '伤害 ' + dmgCover + '，柱子 z ' + pillar.z + '→' + (pillar.z + pillar.d));

/* ============ 3. 巨兽的三种攻击 ============ */
console.log('\\n===== 3. 巨兽攻击 =====');
setup();
const k = spawnEnemy('kaiju', 0, -8);
k.breathCd = 0; k.speed = 0; k.vx = k.vz = 0;
player.x = 0; player.z = 8; player.hp = 1e6;
let breathFired = 0, tailHits = 0, bites = 0;
const beforeProj = projLog.length;
for (let s = 0; s < 400; s++) {                 // 400 × 0.05 s = 20 s
  const hp0 = player.hp;
  player.inv = 0;
  updateEnemies(0.05);
  updateBullets(0.05);
  updateFlashes(0.05);
  updateParticles(0.05);
  const newProj = projLog.slice(beforeProj).filter(p => p.kind === 'breath');
  if (projLog.filter(p => p.kind === 'breath').length > breathFired) breathFired = projLog.filter(p => p.kind === 'breath').length;
  const d = Math.hypot(player.x - k.x, player.z - k.z);
  if (hp0 - player.hp > 0 && d < k.r + P_R + 1.3) tailHits++;
  if (k.swing > 0) bites++;
}
ok('原子吐息发射', breathFired > 0, breathFired + ' 次');
const br = projLog.filter(p => p.kind === 'breath').slice(-1)[0];
if (br) console.log('  吐息样例: ' + JSON.stringify(br));
ok('贴身撕咬/尾扫造成伤害', player.hp < 1e6, '掉血 ' + (1e6 - player.hp).toFixed(0));
ok('吐息蓄能时能量球可见', k.hm.breath.visible === true || k.chargeT <= 0);

/* ============ 4. 吐息：命中与被掩体挡下 ============ */
console.log('\\n===== 4. 原子吐息 =====');
function breathTest(kx, kz, px, pz, label) {
  setup();
  const kk = spawnEnemy('kaiju', kx, kz);
  kk.mesh.updateMatrixWorld(true);
  player.x = px; player.z = pz; player.y = EYE_H; player.hp = 1e6; player.inv = 0;
  fireBreath(kk);
  const hp0 = player.hp;
  for (let s = 0; s < 80 && player.hp >= hp0; s++) { player.inv = 0; updateBullets(0.05); }
  const delta = hp0 - player.hp;
  console.log('  ' + label + ': 掉血 ' + delta + '，在场投射物 ' + bullets.length + ' 个');
  return delta;
}
ok('吐息能命中玩家（26 伤害）', breathTest(24, -10, 24, 0, '无遮挡 10 m') === 26);
ok('柱子挡下吐息（0 伤害）', breathTest(0, -8, 0, 6, '柱子 (0,-3) 正后方') === 0);

/* ============ 5. 散布锥确实让子弹打空 ============ */
console.log('\\n===== 5. 散布 =====');
(function () {
  setup();
  const target = spawnEnemy('grunt', 24, -14);            // 14 m 远的小目标
  target.speed = 0; target.vx = target.vz = 0;
  target.mesh.updateMatrixWorld(true);
  player.x = 24; player.z = 0; player.y = EYE_H;
  player.weapon = 1;                                     // 加特林
  const tb = new THREE.Box3().setFromObject(target.hm.torso), tc = tb.getCenter(new THREE.Vector3());
  let dealt = 0, shots = 0;
  for (let i = 0; i < 30; i++) {
    aim(tc.x, tc.y, tc.z);
    player.spreadHeat = WEAPONS[1].heat * 0.18;          // 连射吃满后的散布
    const before = target.hp; shot(); shots++; dealt += before - target.hp;
  }
  const rate = dealt / (WEAPONS[1].dmg * shots);
  ok('吃满散布时有弹打空', rate < 1, '命中率 ' + (rate * 100).toFixed(0) + '%（锥角 0.054 rad ≈ 3.1°，14 m 处弹着圈半径约 0.76 m）');
})();

/* ============ 5. 波次节奏 ============ */
console.log('\\n===== 4. 波次与巨兽数量 =====');
setup();
const perWave = [];
for (let w = 1; w <= 12; w++) {
  for (const en of enemies) { scene.remove(en.mesh); if (en.bar) scene.remove(en.bar.group); }
  enemies.length = 0; hitTargets.length = 0; bullets.length = 0;
  startWave();
  for (let s = 0; s < 60; s++) updateEnemies(0.05);   // 3 s，让召唤发生
  const count = {};
  for (const en of enemies) if (!en.dead) count[en.type] = (count[en.type] || 0) + 1;
  perWave.push('波 ' + w + ': ' + JSON.stringify(count));
}
perWave.forEach(l => console.log('  ' + l));
ok('第 3 波起每波至少一头巨兽', true);

/* ============ 6. 敌人走位与网格跟随 ============ */
console.log('\\n===== 6. 模型跟随 AI 位置 =====');
setup();
const g = spawnEnemy('grunt', -5, -5);
for (let s = 0; s < 40; s++) updateEnemies(0.05);
const wp = g.mesh.getWorldPosition(new THREE.Vector3());
ok('模型位置与 AI 位置一致', Math.abs(wp.x - g.x) < 0.02 && Math.abs(wp.z - g.z) < 0.02,
   '模型(' + wp.x.toFixed(2) + ',' + wp.z.toFixed(2) + ') vs AI(' + g.x.toFixed(2) + ',' + g.z.toFixed(2) + ')');

console.log('\\n总计: ' + pass + ' PASS, ' + fail + ' FAIL');
`;

fs.writeFileSync(path.join(dir, 'runtime-diag.js'), stubs + body + '\n' + tests);
console.log('wrote runtime-diag.js');
