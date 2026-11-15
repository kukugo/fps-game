/* 生成 shot.html：index.html + 一段通过 __fps 调试钩子驱动的自动拍照脚本 */
const fs = require('fs');
const path = require('path');
const dir = path.dirname(fs.realpathSync(__filename));

const src = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');

const mode = process.argv[2] || 'front';
const flags = process.argv[3] || '';
const iso = flags.includes('iso') ? '1' : '0';
const lite = flags.includes('lite') ? '1' : '0';
const clean = (iso === '1' || lite === '1' || flags.includes('clean')) ? '1' : '0';

const inject = `
<script>
(function () {
  const F = window.__fps;
  const THREE = window.THREE;
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:99;background:#0b1220;border:1px solid #35e6ff;' +
    'color:#dfe6ff;font:12px/1.5 monospace;padding:8px 12px;max-width:760px;white-space:pre;';
  document.body.appendChild(box);
  box.textContent = '注入完成，等待渲染…';
  if ("${clean}" === '1') box.style.display = 'none';
  try {
  F.begin();
  F.player.hp = 1e6;

  // 只留一只巨兽：把开局刷出的其它敌人清掉
  for (const e of F.enemies.slice()) {
    F.scene.remove(e.mesh);
    if (e.bar) F.scene.remove(e.bar.group);
  }
  F.enemies.length = 0;
  F.hitTargets.length = 0;

  const k = F.spawn('kaiju', 0, -10);
  k.speed = 0;                       // 定妆照：不让它走动
  k.x = 0; k.z = -10;
  k.mesh.position.set(0, 0, -10);

  const view = {
    front:   { px: 0,   pz: 6,  ty: 2.6 },
    side:    { px: 7,   pz: -3, ty: 2.6 },
    close:   { px: 0,   pz: -4.2, ty: 2.2 },
    head:    { px: 1.6, pz: -6.2, ty: 3.0 },
    isoF:    { px: 0,   pz: -1.4, ty: 2.5 },
    isoS:    { px: 5.2, pz: -5.4, ty: 2.5 },
    isoH:    { px: 1.1, pz: -6.6, ty: 3.1 }
  }["${mode}"] || { px: 0, pz: 6, ty: 2.6 };

  F.player.x = view.px; F.player.z = view.pz; F.player.y = 1.65;
  const dx = 0 - view.px, dz = -10 - view.pz;
  F.player.yaw = Math.atan2(-dx, -dz);
  F.player.pitch = Math.atan2(view.ty - 1.65, Math.hypot(dx, dz));
  F.camera.position.set(view.px, 1.65, view.pz);
  F.camera.rotation.set(F.player.pitch, F.player.yaw, 0);

  if ("${iso}" === '1') {
    // 定妆照：把世界里其它对象全部隐藏，只留巨兽
    for (const c of F.scene.children) if (c !== k.mesh) c.visible = false;
    F.renderer.setClearColor(0x0b1018, 1);
    F.renderer.shadowMap.enabled = false;
  }
  if ("${lite}" === '1') {
    // 软件渲染（SwiftShader）下阴影和分辨率是主要开销：截图时砍掉
    F.renderer.shadowMap.enabled = false;
    F.renderer.setSize(720, 460, false);
    F.camera.aspect = 720 / 460;
    F.camera.updateProjectionMatrix();
  }
  if ("${mode}" === 'breath') k.chargeT = 0.5;

  setInterval(() => {
    k.mesh.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(k.mesh);
    const parts = [];
    k.mesh.traverse(o => { if (o.isMesh) parts.push(o); });
    const headBB = new THREE.Box3().setFromObject(k.hm.head);
    const torsoBB = new THREE.Box3().setFromObject(k.hm.torso);
    const scr = new THREE.Vector3(0, 2.6, -10).project(F.camera);
    box.textContent =
      'gameTime=' + F.gameTime.toFixed(2) + ' 网格数=' + parts.length +
      ' rootScale=' + k.mesh.scale.x + '\\n' +
      '整体 AABB y ' + bb.min.y.toFixed(2) + '→' + bb.max.y.toFixed(2) +
      '  x ' + bb.min.x.toFixed(2) + '→' + bb.max.x.toFixed(2) +
      '  z ' + bb.min.z.toFixed(2) + '→' + bb.max.z.toFixed(2) + '\\n' +
      '躯干 y ' + torsoBB.min.y.toFixed(2) + '→' + torsoBB.max.y.toFixed(2) +
      '  头 y ' + headBB.min.y.toFixed(2) + '→' + headBB.max.y.toFixed(2) +
      '  吐息球可见:' + k.hm.breath.visible +
      '  绘制调用=' + F.draws + ' 三角形=' + F.tris +
      '  场景对象=' + F.scene.children.length +
      '  巨兽中心屏幕坐标=(' + scr.x.toFixed(2) + ',' + scr.y.toFixed(2) + ')';
  }, 300);
  } catch (err) {
    box.textContent = '注入脚本出错: ' + err.message + '\\n' + String(err.stack || '').slice(0, 700);
  }
})();
</script>
`;

const out = src.replace('</body>', inject + '</body>');
fs.writeFileSync(path.join(dir, 'shot.html'), out);
console.log('wrote shot.html (mode=' + mode + ') bytes=' + out.length);
