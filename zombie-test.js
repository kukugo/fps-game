/* 僵尸外观与命中判定的离线断言（Node + 无渲染 stub）
   生成 zombie-diag.js 并执行。 */
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
function shot() {
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

console.log('\\n===== 1. 僵尸材质 =====');
setup();
ok('腐尸皮肤贴图存在', !!(MAT.zSkin.map && MAT.zSkin.normalMap && MAT.zSkin.roughnessMap));
ok('破布带 alphaMap（破洞）', !!MAT.rags.alphaMap, 'alphaTest=' + MAT.rags.alphaTest);
ok('骨骼 / 血痂材质存在', !!MAT.bone && !!MAT.gore);

console.log('\\n===== 2. 僵尸模型 =====');
setup();
const z = spawnEnemy('grunt', 0, -10);
z.speed = 0; z.vx = z.vz = 0;
for (let s = 0; s < 20; s++) updateEnemies(0.05);
z.mesh.updateMatrixWorld(true);
let meshes = 0; z.mesh.traverse(o => { if (o.isMesh) meshes++; });
const zbb = new THREE.Box3().setFromObject(z.mesh);
const zs = zbb.getSize(new THREE.Vector3());
const headW0 = z.hm.head.getWorldPosition(new THREE.Vector3());
const footW = z.hm.legR.children.find(c => c.geometry && c.geometry.type === 'BoxGeometry' && c.position.y < -0.6)
  .getWorldPosition(new THREE.Vector3());
ok('僵尸网格数 > 30', meshes > 30, meshes + ' 个');
ok('头高约 1.5 m / 脚贴地', headW0.y > 1.35 && headW0.y < 1.75 && Math.abs(footW.y) < 0.35,
   '头 y=' + headW0.y.toFixed(2) + ' 脚 y=' + footW.y.toFixed(2));
ok('头是命中体', z.hm.head.userData.headshot === true);
// 双臂前伸：手的世界 z 必须大于肩的世界 z（模型面朝 +Z）
const hand = z.hm.armR.children.find(c => c.geometry && c.geometry.type === 'BoxGeometry' && c.position.y < -0.5);
const hw = hand.getWorldPosition(new THREE.Vector3());
const sw = z.hm.armR.getWorldPosition(new THREE.Vector3());
ok('双臂前伸（手在肩的前方）', hw.z > sw.z + 0.25, '手 z=' + hw.z.toFixed(2) + ' 肩 z=' + sw.z.toFixed(2));
// 驼背：头在骨盆前方
const headW = z.hm.head.getWorldPosition(new THREE.Vector3());
const hipsW = z.hm.hips ? z.hm.hips.getWorldPosition(new THREE.Vector3()) : null;
ok('身体前倾（驼背）', !!hipsW && headW.z > hipsW.z + 0.05,
   hipsW ? ('头 z=' + headW.z.toFixed(2) + ' 骨盆 z=' + hipsW.z.toFixed(2)) : '无骨盆引用');

console.log('\\n===== 3. 命中判定 =====');
setup();
player.x = 24; player.z = 0; player.y = EYE_H;
const z2 = spawnEnemy('grunt', 24, -6);
z2.hp = z2.maxHp = 100000;          // 血量拉满，免得第一轮就把僵尸打死
z2.speed = 0; z2.vx = z2.vz = 0;
z2.mesh.updateMatrixWorld(true);
const tb = new THREE.Box3().setFromObject(z2.hm.torso), tc = tb.getCenter(new THREE.Vector3());
const hb = new THREE.Box3().setFromObject(z2.hm.head), hc = hb.getCenter(new THREE.Vector3());
let dmgBody = 0;
for (let i = 0; i < 10; i++) { aim(tc.x, tc.y, tc.z); const before = z2.hp; shot(); dmgBody += before - z2.hp; }
ok('打僵尸躯干有伤害', dmgBody > 0, '10 发共 ' + dmgBody);
let dmgHead = 0, headHits = 0;
for (let i = 0; i < 10; i++) { aim(hc.x, hc.y, hc.z); const before = z2.hp; shot(); const d = before - z2.hp; dmgHead += d; if (d >= 52) headHits++; }
ok('僵尸爆头 2 倍伤害', headHits > 0, dmgHead + ' 伤害，其中 ' + headHits + ' 发爆头');

console.log('\\n===== 4. 各类型僵尸 =====');
setup();
for (const t2 of ['grunt', 'shooter', 'tank', 'boss', 'kaiju']) {
  const e2 = spawnEnemy(t2, 5, -10);
  e2.mesh.updateMatrixWorld(true);
  const b2 = new THREE.Box3().setFromObject(e2.mesh);
  const s2 = b2.getSize(new THREE.Vector3());
  ok('类型 ' + t2 + ' 可生成并有尺寸', s2.y > 0.5, '高 ' + s2.y.toFixed(2) + ' 宽 ' + s2.x.toFixed(2));
}

/* ============ 5. ASCII 渲染：直接"看"一眼僵尸 ============ */
function asciiRender(root, camPos, lookAt, W, H) {
  const cam = new THREE.PerspectiveCamera(50, W / H, 0.05, 200);
  cam.position.set(camPos[0], camPos[1], camPos[2]);
  cam.lookAt(new THREE.Vector3(lookAt[0], lookAt[1], lookAt[2]));
  cam.updateMatrixWorld(true);
  const depth = new Float32Array(W * H).fill(Infinity);
  const shade = new Float32Array(W * H).fill(-1);
  const light = new THREE.Vector3(0.4, 0.8, 0.45).normalize();
  root.updateMatrixWorld(true);
  const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const nrm = new THREE.Vector3();
  root.traverse(o => {
    if (!o.isMesh) return;
    const g = o.geometry, pos = g.attributes.position, idx = g.index;
    const count = idx ? idx.count : pos.count;
    for (let i = 0; i < count; i += 3) {
      const ia = idx ? idx.getX(i) : i, ib = idx ? idx.getX(i + 1) : i + 1, ic = idx ? idx.getX(i + 2) : i + 2;
      for (let k = 0; k < 3; k++) {
        const j = k === 0 ? ia : (k === 1 ? ib : ic);
        v[k].fromBufferAttribute(pos, j).applyMatrix4(o.matrixWorld);
      }
      nrm.copy(v[1]).sub(v[0]).cross(v[2].clone().sub(v[0])).normalize();
      const lum = Math.max(0.08, Math.abs(nrm.dot(light))) * 0.9 + 0.1;
      const sp = v.map(p => p.clone().project(cam));
      const sx = sp.map(p => (p.x * 0.5 + 0.5) * (W - 1));
      const sy = sp.map(p => (1 - (p.y * 0.5 + 0.5)) * (H - 1));
      const dz = (v[0].z + v[1].z + v[2].z) / 3;
      const minX = Math.max(0, Math.floor(Math.min(sx[0], sx[1], sx[2])));
      const maxX = Math.min(W - 1, Math.ceil(Math.max(sx[0], sx[1], sx[2])));
      const minY = Math.max(0, Math.floor(Math.min(sy[0], sy[1], sy[2])));
      const maxY = Math.min(H - 1, Math.ceil(Math.max(sy[0], sy[1], sy[2])));
      const d = (x, y) => (sx[1] - sx[0]) * (y - sy[0]) - (x - sx[0]) * (sy[1] - sy[0]);
      const d0 = d(sx[2], sy[2]);
      for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
        const w0 = d0 * (d(x, y) >= 0 ? 1 : 0);
        if (w0 === 0 && d0 !== 0) continue;
        const idx2 = y * W + x;
        if (dz < depth[idx2]) { depth[idx2] = dz; shade[idx2] = lum; }
      }
    }
  });
  const chars = ' .:-=+*#%@';
  let out = '';
  for (let y = 0; y < H; y++) {
    let row = '';
    for (let x = 0; x < W; x++) {
      const s = shade[y * W + x];
      row += s < 0 ? ' ' : chars[Math.min(9, Math.floor(s * 10))];
    }
    out += row + '\\n';
  }
  return out;
}
console.log('\\n===== 5. 僵尸的正面 / 侧面（ASCII 渲染） =====');
setup();
const zz = spawnEnemy('grunt', 0, 0);
zz.speed = 0; zz.vx = zz.vz = 0;
for (let s2 = 0; s2 < 10; s2++) updateEnemies(0.05);   // 让它摆出僵尸姿势
console.log('--- 正面（面朝 +Z，摄像机在 +Z 看向 -Z）---');
console.log(asciiRender(zz.mesh, [0, 1.0, 3.2], [0, 0.95, 0], 62, 34));
console.log('--- 侧面（从 +X 看，+Z 朝右）---');
console.log(asciiRender(zz.mesh, [3.2, 1.0, 0], [0, 0.95, 0], 62, 34));

console.log('\\n总计: ' + pass + ' PASS, ' + fail + ' FAIL');
`;

fs.writeFileSync(path.join(dir, 'zombie-diag.js'), stubs + body + '\n' + tests);
console.log('wrote zombie-diag.js');
