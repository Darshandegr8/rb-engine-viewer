// SOURCE for app/main.js. Rebuild: npm i three@0.128.0 esbuild && npx esbuild main.src.js --bundle --splitting --format=esm --outdir=app --minify --target=es2020 --legal-comments=none --chunk-names=chunk-[hash]

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

(function () {
  'use strict';
  var RB = window.RB;

  // =========================================================
  // 1. STEP DATA (unchanged)
  // =========================================================
  var PROCESS_NAME = 'Assembly';
  var STAND_INDICES = [4, 6, 8, 9, 10];
  var EXPECTED_MESHES = 52;
  var STEPS = [
    { name: 'Fan Cowl / Nacelle Inlet', description: 'Fit the outer nacelle inlet ring around the fan case. This forms the front aerodynamic housing of the engine.', indices: [0, 1, 2, 5, 11, 26, 28, 31, 39, 40, 41, 42, 43, 48] },
    { name: 'Fan Rotor Blades', description: 'Mount the fan blade disk onto the low-pressure shaft. This is the first rotating stage air passes through.', indices: [15, 27, 34, 38, 45, 46, 51] },
    { name: 'Core Compressor & Gearbox', description: 'Attach the core compressor case and accessory gearbox module, which drives engine-mounted accessories.', indices: [3, 7, 23, 25, 32, 49, 50] },
    { name: 'Core Mounting Struts', description: 'Install the radial struts that suspend and stabilize the core engine within the outer casing.', indices: [12, 16, 20, 21, 22, 24, 30, 36, 37, 47] },
    { name: 'Rear Casing / Exhaust', description: 'Seal the rear casing and exhaust section, completing the airflow path through the engine.', indices: [13, 14, 17, 18, 19, 29, 33, 35, 44] }
  ];
  var EXPLODE_DISTANCE = 0.85;
  var EXPLODE_MS = 550;

  // =========================================================
  // 2. UI STATE  (works BEFORE the model arrives: shell is interactive immediately)
  // =========================================================
  var $ = function (id) { return document.getElementById(id); };
  var viewportEl = $('viewport');
  var elStepIndex = $('step-index'), elStepName = $('step-name'), elStepDesc = $('step-description');
  var elStateTag = $('state-tag'), elPrev = $('btn-prev'), elNext = $('btn-next');
  var elAutoBadge = $('autorotate-badge');
  var dots = STEPS.map(function (_, i) { return $('dot-' + i); });
  var currentStep = 0;
  var stepRt = [];               // per-step runtime: {entries, progress, target}

  function isRemoved(i) { return !!(stepRt[i] && stepRt[i].target === 1); }

  function refreshUI() {
    var step = STEPS[currentStep];
    elStepIndex.textContent = currentStep + 1;
    elStepName.textContent = step.name;
    elStepDesc.textContent = step.description;
    var removed = isRemoved(currentStep);
    elStateTag.textContent = removed ? 'Removed' : 'Installed';
    elStateTag.className = removed ? 'removed' : 'installed';
    elPrev.classList.toggle('disabled', currentStep === 0);
    elNext.classList.toggle('disabled', currentStep === STEPS.length - 1);
    for (var i = 0; i < dots.length; i++) {
      dots[i].classList.toggle('done', isRemoved(i));
      dots[i].classList.toggle('current', i === currentStep);
    }
  }
  function goToStep(i) { if (i < 0 || i >= STEPS.length) return; currentStep = i; refreshUI(); }

  function toggleCurrentPart() {
    var s = stepRt[currentStep];
    if (!s) return;                       // model not ready yet
    s.target = s.target === 1 ? 0 : 1;    // retargets smoothly even mid-animation
    refreshUI();
    requestRender();
  }
  elPrev.addEventListener('click', function () { goToStep(currentStep - 1); });
  elNext.addEventListener('click', function () { goToStep(currentStep + 1); });

  // =========================================================
  // 3. VIEW STATE + RENDER LOOP
  //    - Renders ONLY when something changes (idle = 0 CPU/GPU)
  //    - Hard-capped to the 30Hz panel; dt-based motion (no frame-rate coupling)
  //    - No per-frame allocations
  // =========================================================
  var VIEW_W = 420, VIEW_H = 600, FRAME_MS = 1000 / 30;
  var rotY = 0.6, rotYT = 0.6, rotX = 0.1, rotXT = 0.1, zoom = 4.6, zoomT = 4.6;
  var autoRotate = false;
  var renderer, scene, camera, engineGroup, glReady = false;
  var rafId = 0, running = false, lastT = 0, burst = 0;

  // adaptive internal resolution: degrade instead of dropping frames
  var SCALES = [1, 0.8, 0.65], scaleIdx = 0, slowFrames = 0;
  function applyScale() {
    renderer.setPixelRatio(SCALES[scaleIdx]);      // base DPR capped at 1: panel is 600x600
    renderer.setSize(VIEW_W, VIEW_H, false);       // CSS size is fixed in the stylesheet
  }

  function requestRender() {
    if (!glReady || running) return;
    running = true; lastT = 0; burst = 0;
    rafId = requestAnimationFrame(frame);
  }

  function frame(t) {
    // Throttle to 30Hz. 4ms slack so a 33.3ms vsync never gets skipped by jitter.
    if (lastT && t - lastT < FRAME_MS - 4) { rafId = requestAnimationFrame(frame); return; }
    var dt = lastT ? Math.min(t - lastT, 100) : FRAME_MS;

    // ---- adaptive quality (only judge continuous animation, never the first frame of a burst) ----
    if (lastT && burst > 3) {
      if (dt > 50) slowFrames++; else if (slowFrames > 0) slowFrames--;
      if (slowFrames >= 8 && scaleIdx < SCALES.length - 1) { scaleIdx++; applyScale(); slowFrames = 0; }
    }
    lastT = t; burst++;

    var active = false;

    // ---- smooth D-pad rotation/zoom (exponential approach; alloc-free) ----
    if (autoRotate) { rotYT += 0.72 * dt / 1000; active = true; }   // same speed as the old 0.012 rad @ 60fps
    var k = 1 - Math.exp(-dt / 90);
    rotY += (rotYT - rotY) * k; rotX += (rotXT - rotX) * k; zoom += (zoomT - zoom) * k;
    if (Math.abs(rotYT - rotY) > 0.0005 || Math.abs(rotXT - rotX) > 0.0005 || Math.abs(zoomT - zoom) > 0.001) active = true;
    else { rotY = rotYT; rotX = rotXT; zoom = zoomT; }

    // ---- explode/assemble tweens: one progress value per step, no closures/allocs ----
    var rate = dt / EXPLODE_MS;
    for (var i = 0; i < stepRt.length; i++) {
      var s = stepRt[i];
      if (!s || s.progress === s.target) continue;
      s.progress = s.target > s.progress ? Math.min(s.target, s.progress + rate) : Math.max(s.target, s.progress - rate);
      var e = 1 - Math.pow(1 - s.progress, 3);
      for (var j = 0; j < s.entries.length; j++) {
        var en = s.entries[j];
        en.mesh.position.lerpVectors(en.p0, en.p1, e);
      }
      if (s.progress !== s.target) active = true; else refreshUI();
    }

    engineGroup.rotation.y = rotY;
    engineGroup.rotation.x = rotX;
    camera.position.set(0, 0.3, zoom);
    camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);

    if (active) rafId = requestAnimationFrame(frame);
    else { running = false; lastT = 0; }
  }

  // =========================================================
  // 4. GL INIT (as soon as three.js arrives; model may still be downloading)
  // =========================================================
  function initGL() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    camera = new THREE.PerspectiveCamera(42, VIEW_W / VIEW_H, 0.05, 100);
    camera.position.set(0, 0.3, zoom);
    renderer = new THREE.WebGLRenderer({
      antialias: false,          // MSAA on a 2GHz SoC eats fill-rate; flip to true if the device has headroom
      alpha: false, stencil: false, powerPreference: 'high-performance', preserveDrawingBuffer: false
    });
    renderer.setClearColor(0x000000, 1);
    applyScale();
    viewportEl.insertBefore(renderer.domElement, $('loading'));

    scene.add(new THREE.AmbientLight(0x223344, 0.7));
    var key = new THREE.DirectionalLight(0x8fe6ff, 1.5); key.position.set(3, 4, 5); scene.add(key);
    var rim = new THREE.DirectionalLight(0xff8a3d, 0.6); rim.position.set(-4, -1, -4); scene.add(rim);
    engineGroup = new THREE.Group();
    scene.add(engineGroup);
    glReady = true;
  }

  // =========================================================
  // 5. BUILD MODEL (parse ArrayBuffer we already streamed; precompute everything once)
  // =========================================================
  function build(gltf) {
    var root = gltf.scene;
    engineGroup.add(root);
    engineGroup.rotation.set(0, 0, 0);
    engineGroup.updateMatrixWorld(true);       // deterministic frame for all bounds math

    var allMeshes = [];
    root.traverse(function (o) { if (o.isMesh) allMeshes.push(o); });
    if (allMeshes.length !== EXPECTED_MESHES) {
      console.warn('[model] expected ' + EXPECTED_MESHES + ' meshes, got ' + allMeshes.length +
        ' - step->mesh index mapping may be wrong (was the GLB re-exported with join/flatten?)');
    }

    // Fit to viewport
    var box = new THREE.Box3().setFromObject(root);
    var size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
    var scale = 2.6 / (Math.max(size.x, size.y, size.z) || 1);
    root.scale.setScalar(scale);
    root.position.sub(center.multiplyScalar(scale));
    root.updateMatrixWorld(true);

    // One bounding-box pass per mesh (old code did up to 3), all in the model's own local space
    var standSet = {}; STAND_INDICES.forEach(function (i) { standSet[i] = 1; });
    var centers = allMeshes.map(function (m) {
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      var c = m.geometry.boundingBox.getCenter(new THREE.Vector3());
      return root.worldToLocal(m.localToWorld(c));
    });
    var engineCenter = new THREE.Vector3(), n = 0;
    centers.forEach(function (c, i) { if (!standSet[i]) { engineCenter.add(c); n++; } });
    if (n) engineCenter.divideScalar(n);

    var inStep = {};
    STEPS.forEach(function (step, si) {
      var entries = [], g = new THREE.Vector3();
      step.indices.forEach(function (mi) {
        var m = allMeshes[mi]; if (!m) return;
        inStep[mi] = 1;
        entries.push({ mesh: m, p0: m.position.clone(), p1: null });
        g.add(centers[mi]);
      });
      if (entries.length) g.divideScalar(entries.length);
      var dir = g.sub(engineCenter);
      if (dir.length() < 0.05) {
        var a = (si / STEPS.length) * Math.PI * 2;
        dir.set(Math.cos(a), 0.3, Math.sin(a));
      }
      dir.normalize().multiplyScalar(EXPLODE_DISTANCE);
      entries.forEach(function (en) { en.p1 = en.p0.clone().add(dir); });   // precomputed once: zero allocs at runtime
      stepRt[si] = { entries: entries, progress: 0, target: 0 };
    });

    // Freeze local matrices of meshes that never move
    allMeshes.forEach(function (m, i) { if (!inStep[i]) { m.updateMatrix(); m.matrixAutoUpdate = false; } });

    // Pre-warm: compile shaders + upload geometry/textures NOW, while the loading screen is up
    engineGroup.rotation.set(rotX, rotY, 0);
    camera.lookAt(0, 0, 0);
    renderer.compile(scene, camera);
    renderer.render(scene, camera);

    $('loading').style.display = 'none';
    refreshUI();
    requestRender();
    registerServiceWorkerWhenIdle();
  }

  // =========================================================
  // 6. BOOT: libs + model download in parallel, then parse
  // =========================================================
  function fail(msg, err) {
    var t = $('ld-text'); if (t) t.textContent = msg;
    console.error(msg, err);
  }

  try { initGL(); } catch (e) { fail('WebGL unavailable', e); }

  RB.model.then(function (res) {
    RB.ui(0.99, 'Preparing model…');
    // Only pay for the meshopt decoder if the GLB actually requires it (tiny, and arrives while parse waits)
    var head = new TextDecoder().decode(new Uint8Array(res.buf, 20, Math.min(res.buf.byteLength - 20, new DataView(res.buf).getUint32(12, true))));
    var needsMeshopt = head.indexOf('EXT_meshopt_compression') !== -1;
    if (head.indexOf('KHR_draco_mesh_compression') !== -1) console.warn('[model] Draco not wired up - re-export with meshopt.');
    var decoderReady = needsMeshopt
      ? import('three/examples/jsm/libs/meshopt_decoder.module.js').then(function (m) { return m.MeshoptDecoder.ready.then(function () { return m.MeshoptDecoder; }); })
      : Promise.resolve(null);
    return decoderReady.then(function (decoder) {
      return new Promise(function (resolve, reject) {
        var loader = new GLTFLoader();
        if (decoder) loader.setMeshoptDecoder(decoder);
        loader.parse(res.buf, '', resolve, reject);
      });
    });
  }).then(function (gltf) {
    // Yield one frame so the "Preparing" text paints before the (synchronous) scene build
    return new Promise(function (ok) { requestAnimationFrame(function () { setTimeout(function () { ok(gltf); }, 0); }); });
  }).then(build).catch(function (e) { fail('Failed to load model', e); });

  // =========================================================
  // 7. D-PAD / FOCUS NAVIGATION (same bindings as before)
  // =========================================================
  var DPAD = { UP: 'ArrowUp', DOWN: 'ArrowDown', LEFT: 'ArrowLeft', RIGHT: 'ArrowRight', SELECT: 'Enter', BACK: 'Escape' };
  function getFocusables() { return Array.prototype.slice.call(document.querySelectorAll('.focusable:not(.disabled)')); }
  function moveFocus(dir) {
    var list = getFocusables(); if (!list.length) return;
    var idx = list.indexOf(document.activeElement);
    if (idx === -1) { list[0].focus(); return; }
    var next = dir === 'prev' ? (idx > 0 ? idx - 1 : list.length - 1) : (idx < list.length - 1 ? idx + 1 : 0);
    list[next].focus();
  }

  var lastEnterTime = 0, stepBeforeEnter = 0, lastLeftTime = 0, lastRightTime = 0, lastDownTime = 0;
  var DOUBLE_TAP_MS = 400;

  document.addEventListener('keydown', function (e) {
    var onViewport = document.activeElement === viewportEl;
    var onButton = document.activeElement && document.activeElement.classList.contains('nav-btn');
    var now = performance.now();

    switch (e.key) {
      case DPAD.LEFT:
        if (onViewport) {
          if (now - lastLeftTime < DOUBLE_TAP_MS) toggleCurrentPart(); else rotYT -= 0.18;
          lastLeftTime = now; requestRender();
        } else moveFocus('prev');
        break;
      case DPAD.RIGHT:
        if (onViewport) {
          if (now - lastRightTime < DOUBLE_TAP_MS) { autoRotate = !autoRotate; elAutoBadge.classList.toggle('on', autoRotate); }
          else rotYT += 0.18;
          lastRightTime = now; requestRender();
        } else moveFocus('next');
        break;
      case DPAD.UP:
        if (onViewport) { zoomT = Math.max(2.2, zoomT - 0.35); requestRender(); } else moveFocus('prev');
        break;
      case DPAD.DOWN:
        if (onViewport) {
          if (now - lastDownTime < DOUBLE_TAP_MS) $('btn-next').focus(); else { zoomT = Math.min(9, zoomT + 0.35); requestRender(); }
          lastDownTime = now;
        } else moveFocus('next');
        break;
      case DPAD.SELECT:
        if (onViewport) {
          // Single Enter = next (instant, no wait). Second Enter inside the window = undo that "next" AND go one further back.
          // (Old code did +1 then -1, so double-Enter netted out to "stay put".)
          if (now - lastEnterTime < DOUBLE_TAP_MS) goToStep(Math.max(0, stepBeforeEnter - 1));
          else { stepBeforeEnter = currentStep; goToStep(currentStep + 1); }
          lastEnterTime = now;
        } else if (onButton) document.activeElement.click();
        break;
      case DPAD.BACK: history.back(); break;
      case 'n': case 'N': goToStep(currentStep + 1); break;   // desktop testing only
      case 'p': case 'P': goToStep(currentStep - 1); break;
      default: return;
    }
    e.preventDefault();
  });

  // Desktop-only pointer input (glasses have no touch); rotates targets, clamped
  var dragging = false, lastX = 0, lastY = 0;
  viewportEl.addEventListener('pointerdown', function (e) {
    if (!e.target || e.target.tagName !== 'CANVAS') return;
    dragging = true; lastX = e.clientX; lastY = e.clientY; e.target.setPointerCapture(e.pointerId);
  });
  viewportEl.addEventListener('pointermove', function (e) {
    if (!dragging) return;
    rotYT += (e.clientX - lastX) * 0.008;
    rotXT = Math.max(-1.2, Math.min(1.2, rotXT + (e.clientY - lastY) * 0.008));
    lastX = e.clientX; lastY = e.clientY; requestRender();
  });
  viewportEl.addEventListener('pointerup', function () { dragging = false; });
  viewportEl.addEventListener('click', function (e) { if (e.target && e.target.tagName === 'CANVAS') toggleCurrentPart(); });

  // =========================================================
  // 8. VOICE (desktop testing only) - recognizer created lazily on first toggle, not at boot
  // =========================================================
  var elVoiceBtn = $('btn-voice');
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  var recognizer = null, voiceOn = false;
  if (!SR) {
    elVoiceBtn.textContent = '🎤 Voice: Unavailable';
    elVoiceBtn.classList.add('disabled');
  } else {
    elVoiceBtn.addEventListener('click', function () {
      if (!recognizer) {
        recognizer = new SR();
        recognizer.continuous = true; recognizer.interimResults = false; recognizer.lang = 'en-US';
        recognizer.onresult = function (ev) {
          var t = ev.results[ev.results.length - 1][0].transcript.trim().toLowerCase();
          if (/\b(next|forward)\b/.test(t)) goToStep(currentStep + 1);
          else if (/\b(previous|prev|back|before)\b/.test(t)) goToStep(currentStep - 1);
        };
        recognizer.onend = function () { if (voiceOn) { try { recognizer.start(); } catch (e) {} } };
        recognizer.onerror = function (ev) { console.warn('Speech recognition error:', ev.error); };
      }
      voiceOn = !voiceOn;
      elVoiceBtn.textContent = voiceOn ? '🎤 Voice: On' : '🎤 Voice: Off';
      if (voiceOn) { try { recognizer.start(); } catch (e) {} } else recognizer.stop();
    });
  }

  // =========================================================
  // 9. SERVICE WORKER: registered only AFTER the model is on screen, so its
  //    precache never competes with the 500Kbps download that matters.
  // =========================================================
  function registerServiceWorkerWhenIdle() {
    if (!('serviceWorker' in navigator)) return;
    var go = function () { navigator.serviceWorker.register('./sw.js').catch(function () {}); };
    if (window.requestIdleCallback) requestIdleCallback(go, { timeout: 5000 }); else setTimeout(go, 2000);
  }

  viewportEl.focus({ preventScroll: true });
})();
