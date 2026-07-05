// Globe built with Three.js. Procedural continents via equirectangular bitmap
// generated from a coastline dataset encoded below. Sepia day/night shader,
// atmospheric fresnel glow, pins + great-circle arcs.
(function () {
  const TAU = Math.PI * 2;

  // --------- Earth texture: procedurally paint continents on a canvas ---------
  // We use a low-res equirectangular land mask rendered from a tiny GeoJSON
  // of country polygons loaded via a small built-in outline dataset.
  // To keep things self-contained and fast, we generate continents from a
  // hand-authored coastline polyline set, then paint with warm sepia gradients.

  // Simple procedural noise (value noise) for terrain modulation.
  function hash(x, y, s) {
    let h = Math.sin(x * 374.73 + y * 912.13 + s * 73.1) * 43758.5453;
    return h - Math.floor(h);
  }
  function vnoise(x, y, s) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const a = hash(xi, yi, s), b = hash(xi + 1, yi, s);
    const c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s);
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
  }
  function fbm(x, y, s) {
    let v = 0, amp = 0.5, f = 1;
    for (let i = 0; i < 5; i++) { v += amp * vnoise(x * f, y * f, s); f *= 2; amp *= 0.5; }
    return v;
  }

  // Land mask: sum of inside-polygon tests for a small continents dataset.
  // We embed a compact world coastlines polyline set (lat, lon pairs) for 
  // major landmasses. The dataset is approximate but recognizable.
  // To keep the file compact, we rely on a fetchable GeoJSON. To stay fully
  // offline, we instead build continents using a collection of ellipses.
  const CONTINENTS = [
    // North America — approximate blobs in lon,lat
    { type: "blob", pts: [[-168,66],[-150,70],[-95,72],[-80,62],[-60,50],[-70,40],[-82,25],[-98,18],[-110,22],[-125,32],[-125,48],[-135,58],[-155,60]] },
    // Central America
    { type: "blob", pts: [[-98,18],[-88,17],[-83,12],[-77,8],[-82,15],[-92,15]] },
    // South America
    { type: "blob", pts: [[-82,10],[-65,10],[-50,5],[-35,-8],[-38,-22],[-55,-35],[-70,-55],[-72,-40],[-78,-10],[-80,0]] },
    // Europe
    { type: "blob", pts: [[-10,36],[-5,43],[0,50],[5,58],[20,60],[30,60],[35,55],[30,45],[28,40],[20,38],[10,38],[-5,36]] },
    // Scandinavia extra
    { type: "blob", pts: [[5,58],[10,63],[20,68],[28,70],[32,66],[25,60],[15,58]] },
    // Africa
    { type: "blob", pts: [[-17,20],[-5,30],[10,35],[20,32],[32,31],[42,12],[50,2],[40,-15],[30,-32],[18,-34],[10,-20],[5,0],[-5,5],[-15,12]] },
    // Middle East / Arabia
    { type: "blob", pts: [[35,30],[45,28],[55,24],[58,18],[52,14],[45,12],[40,18],[35,25]] },
    // Asia (large)
    { type: "blob", pts: [[30,50],[40,60],[60,70],[90,75],[130,72],[160,68],[170,62],[160,55],[140,50],[135,42],[125,35],[110,22],[98,10],[105,5],[95,18],[88,22],[75,25],[62,25],[55,35],[45,42],[38,45]] },
    // India peninsula
    { type: "blob", pts: [[68,22],[78,22],[82,18],[80,10],[76,8],[72,15]] },
    // Southeast Asia archipelago splotches
    { type: "blob", pts: [[95,5],[105,0],[115,-5],[120,-8],[110,-8],[100,-2]] },
    { type: "blob", pts: [[118,-2],[125,-2],[130,-5],[125,-10],[118,-8]] },
    { type: "blob", pts: [[118,15],[123,12],[125,7],[122,6],[118,10]] }, // Philippines approx
    // Japan
    { type: "blob", pts: [[130,33],[135,35],[140,38],[143,43],[138,40],[133,35]] },
    // Australia
    { type: "blob", pts: [[113,-22],[125,-15],[140,-12],[150,-20],[153,-28],[145,-38],[135,-35],[120,-33],[115,-28]] },
    // Indonesia big island (Sumatra+Borneo approx)
    { type: "blob", pts: [[95,5],[100,0],[108,-3],[115,2],[118,7],[112,5],[105,3]] },
    // New Zealand
    { type: "blob", pts: [[170,-36],[175,-40],[174,-46],[168,-46],[167,-41]] },
    // Greenland
    { type: "blob", pts: [[-50,60],[-35,62],[-20,70],[-25,80],[-45,82],[-55,75],[-55,65]] },
    // UK / Ireland
    { type: "blob", pts: [[-10,52],[-5,58],[-2,58],[0,54],[-3,50],[-8,50]] },
    // Iceland
    { type: "blob", pts: [[-24,63],[-14,64],[-14,67],[-22,67]] },
    // Madagascar
    { type: "blob", pts: [[43,-12],[50,-16],[50,-25],[44,-25],[43,-18]] },
    // Antarctica band (stylized)
    { type: "blob", pts: [[-180,-70],[-120,-72],[-60,-75],[0,-78],[60,-72],[120,-70],[180,-70],[180,-88],[-180,-88]] }
  ];

  // Point-in-polygon
  function pip(px, py, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1];
      const xj = poly[j][0], yj = poly[j][1];
      const intersect = ((yi > py) !== (yj > py)) &&
        (px < (xj - xi) * (py - yi) / (yj - yi + 1e-9) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function makeEarthTexture() {
    const W = 2048, H = 1024;
    const cvs = document.createElement('canvas');
    cvs.width = W; cvs.height = H;
    const ctx = cvs.getContext('2d');

    // Ocean base — warm charcoal with slight depth variation
    const oceanGrad = ctx.createLinearGradient(0, 0, 0, H);
    oceanGrad.addColorStop(0, '#0b0a08');
    oceanGrad.addColorStop(0.5, '#141110');
    oceanGrad.addColorStop(1, '#0b0a08');
    ctx.fillStyle = oceanGrad;
    ctx.fillRect(0, 0, W, H);

    // Subtle ocean noise
    const oceanImg = ctx.getImageData(0, 0, W, H);
    const od = oceanImg.data;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const n = fbm(x * 0.004, y * 0.004, 1) - 0.5;
        const i = (y * W + x) * 4;
        od[i] += n * 6;
        od[i+1] += n * 5;
        od[i+2] += n * 4;
      }
    }
    ctx.putImageData(oceanImg, 0, 0);

    // Build land mask
    const land = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      const lat = 90 - (y / H) * 180;
      for (let x = 0; x < W; x++) {
        const lon = (x / W) * 360 - 180;
        let inside = false;
        for (let k = 0; k < CONTINENTS.length; k++) {
          if (pip(lon, lat, CONTINENTS[k].pts)) { inside = true; break; }
        }
        if (inside) land[y * W + x] = 1;
      }
    }

    // Dilate slightly for softer coasts
    const land2 = new Uint8Array(land);
    for (let y = 1; y < H-1; y++) {
      for (let x = 1; x < W-1; x++) {
        if (land[y*W+x]) continue;
        let c = land[(y-1)*W+x] + land[(y+1)*W+x] + land[y*W+x-1] + land[y*W+x+1];
        if (c >= 2) land2[y*W+x] = 1;
      }
    }

    // Paint land with sepia/amber palette + fbm variation
    const img = ctx.getImageData(0, 0, W, H);
    const d = img.data;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const idx = y * W + x;
        if (!land2[idx]) continue;
        // multi-octave warmth
        const n1 = fbm(x * 0.008, y * 0.008, 2);
        const n2 = fbm(x * 0.03, y * 0.03, 3);
        const n3 = fbm(x * 0.1, y * 0.1, 4);
        const t = n1 * 0.6 + n2 * 0.3 + n3 * 0.1;

        // base amber -> gold -> deep umber
        // amber #e8a44c  gold #c77d2a  umber #6b4112  deep #2a1a08
        const lat = 90 - (y / H) * 180;
        const desertBand = Math.exp(-Math.pow((Math.abs(lat) - 25) / 12, 2)); // Sahara/Aus
        const polar = Math.max(0, (Math.abs(lat) - 55) / 35);

        let r = 60 + t * 140 + desertBand * 70;
        let g = 40 + t * 90  + desertBand * 40;
        let b = 20 + t * 40;

        // polar fade to parchment-white
        r = r * (1 - polar) + 220 * polar;
        g = g * (1 - polar) + 205 * polar;
        b = b * (1 - polar) + 170 * polar;

        // coast highlight
        const nearCoast = !land2[idx-1] || !land2[idx+1] || !land2[idx-W] || !land2[idx+W];
        if (nearCoast) { r += 30; g += 20; b += 10; }

        const i4 = idx * 4;
        d[i4]   = Math.max(0, Math.min(255, r));
        d[i4+1] = Math.max(0, Math.min(255, g));
        d[i4+2] = Math.max(0, Math.min(255, b));
        d[i4+3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);

    // City-light specks (for night side) — separate canvas
    const lightCvs = document.createElement('canvas');
    lightCvs.width = W; lightCvs.height = H;
    const lctx = lightCvs.getContext('2d');
    lctx.fillStyle = '#000';
    lctx.fillRect(0,0,W,H);
    // cities: use travel locations + a sprinkle of major world cities
    const seedCities = [
      [40.7,-74],[34,-118],[41.9,-87.6],[19.4,-99],[-23,-46],[-34.6,-58],[51.5,0],[48.8,2.3],
      [52.5,13.4],[55.7,37.6],[59.3,18],[41,29],[30,31],[26.8,30],[-33,18.4],[28.6,77.2],
      [19,72.8],[13,80.3],[22,88],[1.3,103.8],[13.7,100.5],[-6.2,106.8],[31.2,121.5],[39.9,116.4],
      [22.3,114.2],[35.6,139.7],[37.5,127],[14.6,120.9],[25.2,55.3],[-26.2,28],[-33.8,151],
      [-37.8,145],[45.4,-75.7],[49.3,-123],[43.6,-79.4],[21.3,-157.8],[18.6,-72.3],[25.8,-80.2]
    ];
    lctx.globalCompositeOperation = 'lighter';
    for (const [lat, lon] of seedCities) {
      const px = ((lon + 180) / 360) * W;
      const py = ((90 - lat) / 180) * H;
      const r = 8 + Math.random() * 6;
      const g = lctx.createRadialGradient(px, py, 0, px, py, r);
      g.addColorStop(0, 'rgba(255,200,120,1)');
      g.addColorStop(0.4, 'rgba(240,160,70,0.5)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      lctx.fillStyle = g;
      lctx.beginPath(); lctx.arc(px, py, r, 0, TAU); lctx.fill();
      // scatter smaller surrounding sparks
      for (let i = 0; i < 12; i++) {
        const rx = px + (Math.random()-0.5) * 40;
        const ry = py + (Math.random()-0.5) * 30;
        lctx.fillStyle = 'rgba(255,190,100,0.6)';
        lctx.fillRect(rx, ry, 1, 1);
      }
    }

    return { dayCanvas: cvs, nightCanvas: lightCvs };
  }

  // ---------- Globe class ----------
  class Globe {
    constructor(container, opts = {}) {
      this.container = container;
      this.opts = Object.assign({
        radius: 1,
        autoRotate: true,
        rotateSpeed: 0.05,
        sunLongitude: 20,   // degrees east
        showArcs: true,
        showNight: true
      }, opts);

      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
      this.camera.position.set(0, 0, 3.2);

      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      this.renderer.setClearColor(0x000000, 0);
      this.container.appendChild(this.renderer.domElement);

      this.group = new THREE.Group();
      this.scene.add(this.group);

      const { dayCanvas, nightCanvas } = makeEarthTexture();
      this.dayTex = new THREE.CanvasTexture(dayCanvas);
      this.dayTex.colorSpace = THREE.SRGBColorSpace;
      this.dayTex.anisotropy = 8;
      this.nightTex = new THREE.CanvasTexture(nightCanvas);
      this.nightTex.colorSpace = THREE.SRGBColorSpace;

      // Earth sphere with custom shader (day/night mix)
      const earthGeo = new THREE.SphereGeometry(this.opts.radius, 96, 96);
      const earthMat = new THREE.ShaderMaterial({
        uniforms: {
          uDay: { value: this.dayTex },
          uNight: { value: this.nightTex },
          uSunDir: { value: new THREE.Vector3(1, 0.1, 0.3).normalize() },
          uShowNight: { value: this.opts.showNight ? 1 : 0 },
          uSepia: { value: 0.18 }
        },
        vertexShader: `
          varying vec2 vUv;
          varying vec3 vNormal;
          varying vec3 vPos;
          void main() {
            vUv = uv;
            vNormal = normalize(normalMatrix * normal);
            vec4 wp = modelMatrix * vec4(position, 1.0);
            vPos = wp.xyz;
            gl_Position = projectionMatrix * viewMatrix * wp;
          }
        `,
        fragmentShader: `
          uniform sampler2D uDay;
          uniform sampler2D uNight;
          uniform vec3 uSunDir;
          uniform float uShowNight;
          uniform float uSepia;
          varying vec2 vUv;
          varying vec3 vNormal;
          varying vec3 vPos;

          void main() {
            // world-space normal (rotate with model)
            vec3 n = normalize((vec4(normalize(vPos), 0.0)).xyz);
            float lambert = dot(n, uSunDir);
            float day = smoothstep(-0.15, 0.25, lambert);

            vec3 d = texture2D(uDay, vUv).rgb;
            vec3 night = texture2D(uNight, vUv).rgb;

            // dusk warm tint
            float dusk = 1.0 - abs(lambert);
            dusk = pow(dusk, 3.0);
            vec3 duskTint = vec3(0.95, 0.55, 0.22) * dusk * 0.35;

            // shadowed side: deep umber + city lights
            vec3 shadow = d * 0.06 + vec3(0.02, 0.015, 0.01);
            vec3 lights = night * (1.0 - day) * uShowNight * 1.6;

            vec3 col = mix(shadow, d, day);
            col += duskTint * (1.0 - day) * day * 4.0; // rim at terminator
            col += lights;

            // sepia lift
            float lum = dot(col, vec3(0.299, 0.587, 0.114));
            vec3 sep = vec3(lum * 1.05, lum * 0.85, lum * 0.6);
            col = mix(col, sep, uSepia);

            // gentle vignette via fresnel-ish
            float edge = pow(1.0 - clamp(dot(normalize(vNormal), vec3(0.0,0.0,1.0)), 0.0, 1.0), 2.0);
            col *= 1.0 - edge * 0.25;

            gl_FragColor = vec4(col, 1.0);
          }
        `
      });
      this.earth = new THREE.Mesh(earthGeo, earthMat);
      this.group.add(this.earth);

      // Atmosphere glow (backside fresnel)
      const atmoGeo = new THREE.SphereGeometry(this.opts.radius * 1.14, 64, 64);
      const atmoMat = new THREE.ShaderMaterial({
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uColor: { value: new THREE.Color('#e8a44c') },
          uIntensity: { value: 1.0 }
        },
        vertexShader: `
          varying vec3 vNormal;
          void main() {
            vNormal = normalize(normalMatrix * normal);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform vec3 uColor;
          uniform float uIntensity;
          varying vec3 vNormal;
          void main() {
            float i = pow(0.75 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 3.0);
            gl_FragColor = vec4(uColor, 1.0) * i * uIntensity;
          }
        `
      });
      this.atmosphere = new THREE.Mesh(atmoGeo, atmoMat);
      this.group.add(this.atmosphere);

      // inner rim for warmth
      const rimGeo = new THREE.SphereGeometry(this.opts.radius * 1.012, 96, 96);
      const rimMat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uColor: { value: new THREE.Color('#ffd089') } },
        vertexShader: `
          varying vec3 vNormal;
          void main() {
            vNormal = normalize(normalMatrix * normal);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform vec3 uColor;
          varying vec3 vNormal;
          void main() {
            float f = pow(1.0 - dot(vNormal, vec3(0.0,0.0,1.0)), 4.0);
            gl_FragColor = vec4(uColor, f * 0.8);
          }
        `
      });
      this.rim = new THREE.Mesh(rimGeo, rimMat);
      this.group.add(this.rim);

      // Star field
      this.stars = this._makeStars();
      this.scene.add(this.stars);

      // Pin + arc groups
      this.pinGroup = new THREE.Group();
      this.arcGroup = new THREE.Group();
      this.group.add(this.pinGroup);
      this.group.add(this.arcGroup);

      // Interaction
      this._initInteraction();

      // Resize
      this._onResize = this._onResize.bind(this);
      window.addEventListener('resize', this._onResize);
      this._onResize();

      this.clock = new THREE.Clock();
      this._tick = this._tick.bind(this);
      requestAnimationFrame(this._tick);

      this.raycaster = new THREE.Raycaster();
      this.mouse = new THREE.Vector2(-2, -2);
      this.container.addEventListener('pointermove', (e) => {
        const r = this.container.getBoundingClientRect();
        this.mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1;
        this.mouse.y = -((e.clientY - r.top) / r.height) * 2 + 1;
      });
    }

    _makeStars() {
      const g = new THREE.BufferGeometry();
      const N = 1600;
      const pos = new Float32Array(N * 3);
      const col = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) {
        // on a far sphere
        const u = Math.random(), v = Math.random();
        const theta = u * TAU;
        const phi = Math.acos(2 * v - 1);
        const r = 25 + Math.random() * 10;
        pos[i*3  ] = r * Math.sin(phi) * Math.cos(theta);
        pos[i*3+1] = r * Math.cos(phi);
        pos[i*3+2] = r * Math.sin(phi) * Math.sin(theta);
        const warm = 0.6 + Math.random() * 0.4;
        col[i*3  ] = warm;
        col[i*3+1] = warm * (0.75 + Math.random() * 0.2);
        col[i*3+2] = warm * (0.5 + Math.random() * 0.2);
      }
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const m = new THREE.PointsMaterial({
        size: 0.06, sizeAttenuation: true, vertexColors: true,
        transparent: true, opacity: 0.85, depthWrite: false
      });
      return new THREE.Points(g, m);
    }

    // ---- lat/lon → unit vector ----
    static llToVec(lat, lon, r = 1) {
      const phi = (90 - lat) * Math.PI / 180;
      const theta = (lon + 180) * Math.PI / 180;
      const x = -r * Math.sin(phi) * Math.cos(theta);
      const z = r * Math.sin(phi) * Math.sin(theta);
      const y = r * Math.cos(phi);
      return new THREE.Vector3(x, y, z);
    }

    setLocations(locs) {
      this.locations = locs;
      this.pins = [];
      // pin mesh pool
      const pinGeo = new THREE.SphereGeometry(0.009, 12, 12);
      const pinMat = new THREE.MeshBasicMaterial({ color: 0xffc56b });
      for (const loc of locs) {
        const v = Globe.llToVec(loc.lat, loc.lon, this.opts.radius * 1.005);
        const m = new THREE.Mesh(pinGeo, pinMat.clone());
        m.position.copy(v);
        m.userData = { loc, base: 0.009 };
        this.pinGroup.add(m);

        // halo sprite
        const halo = this._haloSprite();
        halo.position.copy(v.clone().multiplyScalar(1.002));
        halo.userData = { loc };
        this.pinGroup.add(halo);

        // thin stem
        const stemGeo = new THREE.CylinderGeometry(0.001, 0.001, 0.025, 6);
        const stemMat = new THREE.MeshBasicMaterial({ color: 0xe8a44c, transparent: true, opacity: 0.6 });
        const stem = new THREE.Mesh(stemGeo, stemMat);
        const stemPos = v.clone().multiplyScalar(1.012);
        stem.position.copy(stemPos);
        stem.lookAt(v.clone().multiplyScalar(2));
        stem.rotateX(Math.PI / 2);
        this.pinGroup.add(stem);

        this.pins.push({ mesh: m, halo, stem, loc });
      }

      // Arcs connecting consecutive locations (travel journey)
      if (this.opts.showArcs) this._buildArcs(locs);
    }

    _haloSprite() {
      const size = 128;
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const g = c.getContext('2d');
      const grad = g.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
      grad.addColorStop(0,   'rgba(255,210,140,0.9)');
      grad.addColorStop(0.3, 'rgba(232,164,76,0.55)');
      grad.addColorStop(1,   'rgba(232,164,76,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, size, size);
      const tex = new THREE.CanvasTexture(c);
      const m = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
      const s = new THREE.Sprite(m);
      s.scale.set(0.055, 0.055, 1);
      return s;
    }

    _buildArcs(locs) {
      // Connect in a loop in visit-order feel (we don't know order; go by index)
      const mat = new THREE.LineBasicMaterial({
        color: 0xe8a44c, transparent: true, opacity: 0.35, depthWrite: false
      });
      for (let i = 0; i < locs.length - 1; i++) {
        const a = Globe.llToVec(locs[i].lat, locs[i].lon, this.opts.radius);
        const b = Globe.llToVec(locs[i+1].lat, locs[i+1].lon, this.opts.radius);
        const curve = this._greatCircle(a, b);
        const geo = new THREE.BufferGeometry().setFromPoints(curve);
        const line = new THREE.Line(geo, mat);
        line.userData.points = curve.length;
        this.arcGroup.add(line);
      }
    }

    _greatCircle(a, b) {
      const pts = [];
      const steps = 48;
      const dist = a.distanceTo(b);
      const arcHeight = 0.08 + dist * 0.15;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        // slerp
        const dot = Math.max(-1, Math.min(1, a.clone().normalize().dot(b.clone().normalize())));
        const theta = Math.acos(dot);
        const sinT = Math.sin(theta) || 1;
        const v = a.clone().multiplyScalar(Math.sin((1 - t) * theta) / sinT)
          .add(b.clone().multiplyScalar(Math.sin(t * theta) / sinT));
        // lift into arc
        const lift = Math.sin(t * Math.PI) * arcHeight;
        v.normalize().multiplyScalar(this.opts.radius + lift);
        pts.push(v);
      }
      return pts;
    }

    _initInteraction() {
      let down = false;
      let lx = 0, ly = 0;
      let vx = 0, vy = 0;
      this.rotX = 0; this.rotY = 0;
      const el = this.renderer.domElement;
      el.style.cursor = 'grab';
      el.addEventListener('pointerdown', (e) => {
        down = true; lx = e.clientX; ly = e.clientY;
        el.style.cursor = 'grabbing';
        el.setPointerCapture(e.pointerId);
      });
      el.addEventListener('pointermove', (e) => {
        if (!down) return;
        const dx = e.clientX - lx;
        const dy = e.clientY - ly;
        lx = e.clientX; ly = e.clientY;
        vx = dx * 0.005;
        vy = dy * 0.005;
        this.rotY += vx;
        this.rotX += vy;
        this.rotX = Math.max(-1.1, Math.min(1.1, this.rotX));
        this._userInteracting = true;
      });
      el.addEventListener('pointerup', () => {
        down = false; el.style.cursor = 'grab';
        setTimeout(()=> this._userInteracting = false, 2500);
      });
      el.addEventListener('pointerleave', () => {
        down = false; el.style.cursor = 'grab';
      });
    }

    focusLocation(loc, duration = 1200) {
      const target = Globe.llToVec(loc.lat, loc.lon, 1);
      // compute desired group rotation so that target appears at camera direction (0,0,1)
      // target rotated by (rotX around X, rotY around Y) should equal (0,0,1)
      // We want rotY so that lon goes to facing; rotX aligns lat.
      const lat = loc.lat * Math.PI / 180;
      const lon = loc.lon * Math.PI / 180;
      const targetRotY = -lon - Math.PI / 2;  // brings lon to front
      const targetRotX = lat;                  // tilts lat to center

      const fromX = this.rotX, fromY = this.rotY;
      const start = performance.now();
      const ease = t => 1 - Math.pow(1 - t, 3);
      const step = (now) => {
        const t = Math.min(1, (now - start) / duration);
        const k = ease(t);
        this.rotX = fromX + (targetRotX - fromX) * k;
        this.rotY = fromY + ((this._shortestAngle(fromY, targetRotY)) * k);
        if (t < 1) requestAnimationFrame(step);
      };
      this._userInteracting = true;
      setTimeout(()=> this._userInteracting = false, duration + 2500);
      requestAnimationFrame(step);
    }

    _shortestAngle(from, to) {
      let d = (to - from) % TAU;
      if (d > Math.PI) d -= TAU;
      if (d < -Math.PI) d += TAU;
      return d;
    }

    _onResize() {
      const w = this.container.clientWidth;
      const h = this.container.clientHeight;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }

    _tick() {
      const dt = this.clock.getDelta();
      const t = this.clock.elapsedTime;

      if (this.opts.autoRotate && !this._userInteracting) {
        this.rotY += dt * this.opts.rotateSpeed;
      }
      this.group.rotation.y = this.rotY;
      this.group.rotation.x = this.rotX;

      // stars barely drift
      this.stars.rotation.y = t * 0.005;

      // Pulse halos
      if (this.pins) {
        for (let i = 0; i < this.pins.length; i++) {
          const p = this.pins[i];
          const ph = (t * 0.8 + i * 0.17) % 1;
          const pulse = 1 + Math.sin(ph * TAU) * 0.15;
          p.halo.scale.set(0.055 * pulse, 0.055 * pulse, 1);
          p.halo.material.opacity = 0.65 + Math.sin(ph * TAU) * 0.2;
        }
      }

      // Sun direction — rotate slowly so terminator moves
      const sunLon = (this.opts.sunLongitude + t * 2) * Math.PI / 180;
      const sunLat = 15 * Math.PI / 180;
      const sx = Math.cos(sunLat) * Math.cos(sunLon);
      const sz = Math.cos(sunLat) * Math.sin(sunLon);
      const sy = Math.sin(sunLat);
      // sun in world space; we need it relative to the rotating earth (model space)
      // since earth rotates with group, invert group rotation:
      const sun = new THREE.Vector3(sx, sy, sz);
      const inv = new THREE.Matrix4().makeRotationY(-this.rotY).multiply(new THREE.Matrix4().makeRotationX(-this.rotX));
      sun.applyMatrix4(inv);
      this.earth.material.uniforms.uSunDir.value.copy(sun).normalize();

      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(this._tick);
    }

    setSepia(v)   { this.earth.material.uniforms.uSepia.value = v; }
    setGlow(v)    { this.atmosphere.material.uniforms.uIntensity.value = v; }
    setAutoRotate(b) { this.opts.autoRotate = b; }
    setShowNight(b)  { this.earth.material.uniforms.uShowNight.value = b ? 1 : 0; }
    setShowArcs(b) {
      this.arcGroup.visible = b;
    }
  }

  window.Globe = Globe;
})();
