/* 生成 zombie-shot.html：index.html + 一段用 __fps 钩子把僵尸摆好并拍照的脚本
   用法：node zombie-shot.js [类型] [视角]   类型: grunt|shooter|tank|boss|kaiju
                                视角: front|head|iso|close  */
const fs = require('fs');
const path = require('path');
const dir = path.dirname(fs.realpathSync(__filename));

const src = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
const type = process.argv[2] || 'grunt';
const mode = process.argv[3] || 'front';

const inject = `
<script>
(function () {
  const F = window.__fps;
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:99;background:#0b1220;border:1px solid #35e6ff;' +
    'color:#dfe6ff;font:12px/1.5 monospace;padding:8px 12px;white-space:pre;';
  document.body.appendChild(box);
  box.textContent = '注入完成…';
  try {
    F.begin();
    F.player.hp = 1e6;
    for (const e of F.enemies.slice()) {
      F.scene.remove(e.mesh);
      if (e.bar) F.scene.remove(e.bar.group);
    }
    F.enemies.length = 0;
    F.hitTargets.length = 0;

    const z = F.spawn("${type}", 24, -6);
    z.speed = 0; z.x = 24; z.z = -6;
    z.mesh.position.set(24, 0, -6);
    z.mesh.updateMatrixWorld(true);
    if ("${type}" === 'none') { F.scene.remove(z.mesh); F.enemies.length = 0; }

    const V = {
      front: { px: 0,   pz: -2.2, ty: 1.2, dist: 3.8 },
      head:  { px: 0.9, pz: -3.6, ty: 1.6, dist: 3.2 },
      iso:   { px: 2.2, pz: -3.4, ty: 1.4, dist: 4.0 },
      close: { px: 0,   pz: -4.6, ty: 1.5, dist: 1.8 }
    }["${mode}"] || { px: 0, pz: -2.2, ty: 1.2, dist: 3.8 };

    F.player.x = 24 + V.px; F.player.z = V.pz; F.player.y = 1.65;
    const dx = 24 - F.player.x, dz = -6 - V.pz;
    F.player.yaw = Math.atan2(-dx, -dz);
    F.player.pitch = Math.atan2(V.ty - 1.65, Math.hypot(dx, dz));
    F.camera.position.set(F.player.x, 1.65, F.player.z);
    F.camera.rotation.set(F.player.pitch, F.player.yaw, 0);
    F.renderer.shadowMap.enabled = false;
    F.renderer.setSize(720, 460, false);
    F.camera.aspect = 720 / 460;
    F.camera.updateProjectionMatrix();

    if ("${mode}" === 'solo' || "${mode}" === 'soloIso') {
      // 隔离渲染：只留僵尸（和灯光），背景换成中性灰，方便看轮廓与配色
      for (const c of F.scene.children) {
        if (c === z.mesh) continue;
        if (c.isMesh) c.visible = false;
      }
      F.camera.traverse(o => { if (o.isMesh || o.isSprite) o.visible = false; });
      F.renderer.setClearColor(0x6a6f78, 1);
      F.scene.background = null;
      // 隔离渲染时场景自带的灯也跟着被藏了，补两盏：环境光 + 一盏斜射主光
      console.log('DIAG THREE=' + (typeof window.THREE) + ' sceneChildren=' + F.scene.children.length);
      const amb = new THREE.AmbientLight(0xdfe8ff, 1.1); F.scene.add(amb);
      const dir = new THREE.DirectionalLight(0xffffff, 2.2);
      dir.position.set(24 + 2.5, 4.2, -2.5); F.scene.add(dir);
      const rim = new THREE.DirectionalLight(0x9ef0b0, 1.2);
      rim.position.set(24 - 3, 2.2, -9); F.scene.add(rim);
      const V2 = { px: 0, pz: -3.2, ty: 1.05, dist: 2.8 };
      F.player.x = 24 + V2.px; F.player.z = V2.pz; F.player.y = 1.65;
      const dx2 = 24 - F.player.x, dz2 = -6 - V2.pz;
      F.player.yaw = Math.atan2(-dx2, -dz2);
      F.player.pitch = Math.atan2(V2.ty - 1.65, Math.hypot(dx2, dz2));
      F.camera.position.set(F.player.x, 1.65, F.player.z);
      F.camera.rotation.set(F.player.pitch, F.player.yaw, 0);
    }

    setInterval(() => {
      z.mesh.updateMatrixWorld(true);
      const bb = new THREE.Box3().setFromObject(z.mesh);
      box.textContent = 'gameTime=' + F.gameTime.toFixed(2) +
        '  绘制调用=' + F.draws + ' 三角形=' + F.tris +
        '  AABB y ' + bb.min.y.toFixed(2) + '→' + bb.max.y.toFixed(2) +
        '  z ' + bb.min.z.toFixed(2) + '→' + bb.max.z.toFixed(2);
    }, 300);
  } catch (err) {
    box.textContent = '出错: ' + err.message;
  }
})();
</script>
`;

fs.writeFileSync(path.join(dir, 'zombie-shot.html'), src.replace('</body>', inject + '</body>'));
console.log('wrote zombie-shot.html (type=' + type + ' mode=' + mode + ')');
