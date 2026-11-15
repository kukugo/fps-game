const fs = require('fs');
const path = require('path');
const dir = path.dirname(fs.realpathSync(__filename));

const src = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
const m = src.match(/<script>\n([\s\S]*?)\n<\/script>/);
if (!m) { console.error('inline script not found'); process.exit(1); }
let body = m[1];

// 去掉最外层 IIFE：(() => { ... })();
if (body.trimStart().startsWith("(() => {")) {
  body = body.trimStart().slice("(() => {".length);
  const end = body.lastIndexOf('})();');
  body = body.slice(0, end);
}
// 去掉启动段（initThree / buildWorld / loop 等需要浏览器 + WebGL）
const cut = body.indexOf('\ninitThree();');
if (cut < 0) { console.error('initThree marker missing'); process.exit(1); }
body = body.slice(0, cut);

const stubs = `
const fs = require('fs');
const path = require('path');
const dir = path.dirname(path.resolve(__filename));
const THREE = require('./vendor/three.min.js');
const fakeCtx = () => new Proxy({
  createImageData: (w, h) => ({ data: new Uint8Array(w * h * 4) }),
  getImageData: (x, y, w, h) => ({ data: new Uint8Array(w * h * 4) })
}, {
  get: (t, k) => (k in t ? t[k] : () => ({ width: 10, addColorStop: () => {} }))
});
globalThis.document = {
  addEventListener: () => {},
  exitPointerLock: () => {},
  createElement: () => ({ width: 0, height: 0, getContext: fakeCtx, addEventListener: () => {} }),
  getElementById: () => ({ clientWidth: 900, style: {}, addEventListener: () => {}, classList: { add(){}, remove(){}, toggle(){} } })
};
globalThis.addEventListener = () => {};
`;

const analysis = `
/* ================= 诊断 ================= */
makeSurfaceMaps = () => ({ map: null, normalMap: null, roughnessMap: null });
makeGunMetalMaps = () => ({ map: null, normalMap: null, roughnessMap: null });
makeTubeMaps = () => ({ map: null, normalMap: null, roughnessMap: null });
makeMarkingMaps = () => ({ map: null, normalMap: null });
camera = new THREE.Group();
renderer = { capabilities: { getMaxAnisotropy: () => 8 }, render: () => {}, info: { render: { calls: 0, triangles: 0 } } };
initMaterials();

function analyse(kind) {
  const gunG = buildWeapon(kind);
  const rotor = gunG.userData.rotor;
  if (!rotor) { console.log(kind + ': 无转子'); return; }
  const parts = [];
  gunG.traverse(o => { if (o.isMesh) parts.push(o); });
  const snap = () => {
    gunG.updateMatrixWorld(true);
    const mp = new Map();
    for (const o of parts) mp.set(o, o.getWorldPosition(new THREE.Vector3()).clone());
    return mp;
  };
  rotor.rotation.z = 0;
  const A = snap();
  rotor.rotation.z = Math.PI / 2;
  gunG.updateMatrixWorld(true);
  const B = snap();
  const describe = o => {
    const p = (o.geometry && o.geometry.parameters) || {};
    const dims = ['radius', 'height', 'innerRadius', 'outerRadius', 'width', 'length']
      .filter(k => p[k] != null).map(k => k + '=' + p[k]).join(' ');
    const par = o.parent === gunG ? '静止枪身' : o.parent === rotor ? '转子 rotor' : (o.parent.type || 'group');
    return o.geometry.type + ' ' + dims + ' | 挂在: ' + par + ' | 局部z=' + o.position.z.toFixed(3);
  };
  let nMove = 0;
  console.log('\\n===== ' + kind + ' (' + parts.length + ' 个网格) =====');
  console.log('--- 转子转 90 度后【会移动】的零件 ---');
  for (const o of parts) {
    const d = A.get(o).distanceTo(B.get(o));
    if (d > 1e-6) { nMove++; console.log('  ' + describe(o) + ' | 位移=' + d.toFixed(4)); }
  }
  console.log('--- 转子转 90 度后【保持静止】的零件 ---');
  for (const o of parts) {
    const d = A.get(o).distanceTo(B.get(o));
    if (d <= 1e-6) console.log('  ' + describe(o));
  }
  console.log('移动件数: ' + nMove + ' / ' + parts.length);
}
analyse('gatling');
exportMeshes('gatling');

/* ---------- 巨兽模型自检：装配连通性 + 尺寸 + 网格导出 ---------- */
function kaijuCheck() {
  const hm = makeKaiju('kaiju');
  const root = hm.root;
  root.updateMatrixWorld(true);
  const meshes = [];
  root.traverse(o => { if (o.isMesh) meshes.push(o); });
  const boxes = meshes.map(o => ({ o, box: new THREE.Box3().setFromObject(o) }));
  const parent = boxes.map((_, i) => i);
  const find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i].box, b = boxes[j].box;
      const ox = Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x);
      const oy = Math.min(a.max.y, b.max.y) - Math.max(a.min.y, b.min.y);
      const oz = Math.min(a.max.z, b.max.z) - Math.max(a.min.z, b.min.z);
      if (ox > 0 && oy > 0 && oz > 0) parent[find(i)] = find(j);
    }
  }
  const groups = {};
  boxes.forEach((b, i) => { const r = find(i); groups[r] = (groups[r] || 0) + 1; });
  const comps = Object.entries(groups).sort((a, b) => b[1] - a[1]);
  console.log('\\n===== 巨兽装配自检 =====');
  console.log('网格数: ' + meshes.length + '，连通分量: ' + comps.length + '（最大分量 ' + comps[0][1] + ' 个网格）');
  for (const [r, n] of comps) {
    const p = boxes[+r].o.getWorldPosition(new THREE.Vector3());
    console.log('  分量 ' + n + ' 网格，代表: ' + boxes[+r].o.geometry.type + ' @ (' +
      p.x.toFixed(2) + ', ' + p.y.toFixed(2) + ', ' + p.z.toFixed(2) + ')');
    if (n < 10) {
      boxes.forEach((b, i) => {
        if (find(i) === +r) {
          const c = b.box.getCenter(new THREE.Vector3());
          const s = b.box.getSize(new THREE.Vector3());
          console.log('     ' + b.o.geometry.type + ' 中心(' + c.x.toFixed(3) + ',' + c.y.toFixed(3) + ',' + c.z.toFixed(3) + ') 尺寸(' + s.x.toFixed(3) + ',' + s.y.toFixed(3) + ',' + s.z.toFixed(3) + ')');
        }
      });
    }
  }
  const full = new THREE.Box3().setFromObject(root);
  console.log('尺寸（米）: 高 ' + (full.max.y - full.min.y).toFixed(2) +
              ' 长 ' + (full.max.z - full.min.z).toFixed(2) +
              ' 宽 ' + (full.max.x - full.min.x).toFixed(2) +
              ' | 脚底 y=' + full.min.y.toFixed(3) + ' 头顶 y=' + full.max.y.toFixed(2));
  return hm;
}
function exportKaiju(hm) {
  const root = hm.root;
  const frames = [];
  for (const pose of [0, 1]) {
    hm.jaw.rotation.x = pose * 0.8;
    hm.head.rotation.x = pose * 0.3;
    root.updateMatrixWorld(true);
    const tris = [];
    root.traverse(o => {
      if (!o.isMesh) return;
      const geo = o.geometry, pos = geo.attributes.position;
      const idx = geo.indices ? geo.indices.array : Array.from({ length: pos.count }, (_, i) => i);
      const V = [];
      for (let i = 0; i < pos.count; i++) {
        const v = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(o.matrixWorld);
        V.push([v.x, v.y, v.z]);
      }
      const mat = o.material;
      let col;
      if (mat === hm.mats.belly) col = [152, 148, 124];
      else if (mat === hm.mats.plate) col = [126, 130, 122];
      else if (mat === hm.mats.scale) col = [100, 112, 84];
      else if (mat === hm.mats.eye) col = [255, 176, 61];
      else col = [70, 90, 120];                       // 吐息能量球等
      const isRim = mat.side === THREE.BackSide;
      for (let k = 0; k + 2 < idx.length; k += 3) {
        const a = V[idx[k]], b = V[idx[k + 1]], c = V[idx[k + 2]];
        tris.push({ t: [a, b, c], n: [(b[1]-a[1])*(c[2]-a[2])-(b[2]-a[2])*(c[1]-a[1]),
                                   (b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2]),
                                   (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])],
                    c: col, rim: isRim });
      }
    });
    frames.push(tris);
  }
  fs.writeFileSync(path.join(dir, 'kaiju-mesh.json'), JSON.stringify(frames));
  console.log('导出巨兽网格: ' + frames[0].length + ' 个三角形（闭嘴 / 张口两帧）');
}
const kaiju = kaijuCheck();
exportKaiju(kaiju);

/* ---------- 冒烟测试：把 AI 循环跑几波，抓运行时错误 ---------- */
function smokeTest() {
  scene = new THREE.Group();
  camera = new THREE.Group();
  camera.position.set(0, 1.65, 6);
  renderer = { capabilities: { getMaxAnisotropy: () => 8 }, render: () => {}, info: { render: { calls: 0, triangles: 0 } } };
  initMaterials();
  initParticles();
  player.hp = 1e6;
  const seen = {};
  for (let w = 1; w <= 3; w++) {
    startWave();
    for (let step = 0; step < 220; step++) {
      const dt = 0.05;
      updateEnemies(dt);
      updateBullets(dt);
      updateFlashes(dt);
      updateParticles(dt);
      updatePickups(dt);
    }
    for (const e of enemies) seen[e.type] = (seen[e.type] || 0) + 1;
  }
  console.log('\\n===== 冒烟测试（3 波 × 11 秒）=====');
  console.log('无运行时错误。存活敌人 ' + enemies.length + ' 个：' + JSON.stringify(seen));
  console.log('原子吐息发射 ' + projLog.filter(p => p.kind === 'breath').length + ' 次；投射物在场 ' + bullets.length + ' 个');
  console.log('命中体数量 ' + hitTargets.length + '（躯干 + 头）');
  const e = enemies.find(x => x.type === 'kaiju');
  if (e) console.log('巨兽样例：hp ' + e.hp.toFixed(0) + ' r ' + e.r.toFixed(2) + ' speed ' + e.speed.toFixed(2) + ' 血条宽 ' + (e.bar ? e.bar.w : '-'));
}
smokeTest();
function exportMeshes(kind) {
  const gunG = buildWeapon(kind);
  const rotor = gunG.userData.rotor;
  const frames = [];
  for (const angle of [0, Math.PI / 2]) {
    rotor.rotation.z = angle;
    gunG.updateMatrixWorld(true);
    const tris = [];
    gunG.traverse(o => {
      if (!o.isMesh) return;
      const geo = o.geometry;
      if (!geo) return;
      const isRotor = o === rotor || (o.parent !== gunG && (function inRotor(n) { while (n && n !== gunG) { if (n === rotor) return true; n = n.parent; } return false; })(o.parent));
      const pos = geo.attributes.position;
      const idx = geo.indices ? geo.indices.array : Array.from({ length: pos.count }, (_, i) => i);
      const V = [];
      for (let i = 0; i < pos.count; i++) {
        const v = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(o.matrixWorld);
        V.push([v.x, v.y, v.z]);
      }
      for (let k = 0; k + 2 < idx.length; k += 3) {
        const a = V[idx[k]], b = V[idx[k + 1]], c = V[idx[k + 2]];
        const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
        const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const len = Math.hypot(nx, ny, nz);
        if (len < 1e-9) continue;
        tris.push({ t: [a, b, c], n: [nx / len, ny / len, nz / len], r: isRotor ? 1 : 0 });
      }
    });
    frames.push(tris);
  }
  fs.writeFileSync(path.join(dir, 'gatling-mesh.json'), JSON.stringify(frames));
  console.log('导出网格: ' + frames[0].length + ' 个三角形（转子 0° / 90° 两帧）');
}
exportMeshes('gatling');
`;

fs.writeFileSync(path.join(dir, 'gatling-diag.js'), stubs + body + '\n' + analysis);
console.log('wrote gatling-diag.js');
