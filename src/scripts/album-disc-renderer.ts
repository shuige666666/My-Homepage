import * as THREE from "three";
import { RectAreaLightUniformsLib } from "three/examples/jsm/lights/RectAreaLightUniformsLib.js";

export interface AlbumDiscLayout {
  x: number;
  y: number;
  scale: number;
  offset: number;
  zAngle: number;
  yaw: number;
  pitch: number;
  flip: number;
  visible: boolean;
}

export interface AlbumDiscViewport {
  width: number;
  height: number;
  radius: number;
  centerX: number;
  centerY: number;
}

interface DiscMesh {
  group: THREE.Group;
  spin: THREE.Group;
  material: THREE.MeshPhysicalMaterial;
  image: HTMLImageElement | null;
  button: HTMLButtonElement | null;
  texture: THREE.Texture | null;
  loadingArtwork: Promise<void> | null;
  artworkFailed: boolean;
}

/** 将现有十张封面装入真正有正反面、厚度与盘心的三维光碟。 */
export class AlbumDiscRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera();
  private readonly discs: DiscMesh[] = [];
  private readonly sharedGeometry: THREE.BufferGeometry[] = [];
  private readonly sharedMaterial: THREE.Material[] = [];
  private readonly sharedTexture: THREE.Texture[] = [];
  private readonly environment: THREE.WebGLRenderTarget;
  private width = 0;
  private height = 0;
  private basePixelRatio = 1;
  private idlePixelRatio = 1;
  private isIdle = false;
  private qualityLevel = 0;
  private qualitySamples = 0;
  private qualityDuration = 0;
  private fastWindows = 0;
  private lastLayout: AlbumDiscLayout[] = [];
  private lastViewport: AlbumDiscViewport | null = null;
  private contextLost = false;
  private disposed = false;

  constructor(stage: HTMLElement, images: Array<HTMLImageElement | null>) {
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "high-performance" });
    this.renderer.domElement.className = "album-gallery__webgl";
    this.renderer.domElement.setAttribute("aria-hidden", "true");
    // 盘心透光仍用物理材质，但把额外的透射通道控制在半分辨率。
    this.renderer.transmissionResolutionScale = .5;
    this.renderer.setClearColor(0xffffff, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.06;
    this.renderer.domElement.addEventListener("webglcontextlost", (event) => {
      // 显卡上下文丢失时立即露出仍在同步位置的 CSS 盘，避免弹窗变空白。
      event.preventDefault();
      this.contextLost = true;
      stage.closest(".album-gallery")?.classList.remove("has-webgl");
    });
    stage.querySelector(".album-gallery__orbit")?.prepend(this.renderer.domElement);

    RectAreaLightUniformsLib.init();
    this.environment = this.createEnvironment();
    this.scene.environment = this.environment.texture;
    this.addLights();

    const roughness = this.createSurfaceMap("roughness");
    const normals = this.createSurfaceMap("normal");
    this.sharedTexture.push(roughness, normals);
    const frontGeometry = new THREE.RingGeometry(.096, .985, 160, 1);
    const backGeometry = new THREE.RingGeometry(.096, .985, 160, 1);
    const hubGeometry = new THREE.RingGeometry(.096, .175, 128);
    const hubInnerGeometry = new THREE.RingGeometry(.096, .124, 128);
    const rimGeometry = new THREE.LatheGeometry([
      new THREE.Vector2(.974, -.008),
      new THREE.Vector2(.992, -.008),
      new THREE.Vector2(1, -.004),
      new THREE.Vector2(1, .004),
      new THREE.Vector2(.992, .008),
      new THREE.Vector2(.974, .008),
    ], 160);
    rimGeometry.rotateX(Math.PI / 2);
    this.sharedGeometry.push(frontGeometry, backGeometry, hubGeometry, hubInnerGeometry, rimGeometry);

    const backMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x426158,
      metalness: .46,
      roughness: .34,
      roughnessMap: roughness,
      normalMap: normals,
      normalScale: new THREE.Vector2(.2, .2),
      clearcoat: .68,
      clearcoatRoughness: .13,
      iridescence: .68,
      iridescenceIOR: 1.75,
      iridescenceThicknessRange: [180, 740],
      envMapIntensity: 1.3,
    });
    const rimMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xd5d9d9,
      metalness: .72,
      roughness: .19,
      clearcoat: .88,
      clearcoatRoughness: .08,
      envMapIntensity: 1.75,
      side: THREE.DoubleSide,
    });
    const hubMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xdfe3e3,
      metalness: .18,
      roughness: .27,
      transmission: .48,
      thickness: .3,
      ior: 1.48,
      clearcoat: 1,
      clearcoatRoughness: .09,
      transparent: true,
      side: THREE.DoubleSide,
    });
    const hubInnerMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xa8afb3,
      metalness: .66,
      roughness: .23,
      clearcoat: .7,
      side: THREE.DoubleSide,
    });
    this.sharedMaterial.push(backMaterial, rimMaterial, hubMaterial, hubInnerMaterial);

    images.forEach((image) => {
      const frontMaterial = new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        metalness: .16,
        roughness: .58,
        roughnessMap: roughness,
        normalMap: normals,
        normalScale: new THREE.Vector2(.08, .08),
        clearcoat: .68,
        clearcoatRoughness: .19,
        envMapIntensity: .7,
        side: THREE.FrontSide,
      });
      const group = new THREE.Group();
      const spin = new THREE.Group();
      group.add(spin);
      spin.add(new THREE.Mesh(frontGeometry, frontMaterial));
      const back = new THREE.Mesh(backGeometry, backMaterial);
      back.rotation.y = Math.PI;
      back.position.z = -.009;
      spin.add(back);
      const rim = new THREE.Mesh(rimGeometry, rimMaterial);
      spin.add(rim);
      // 盘心环在两侧各有一份；中孔保持真实透明，不用白色贴片遮挡。
      for (const side of [1, -1]) {
        const hub = new THREE.Mesh(hubGeometry, hubMaterial);
        const inner = new THREE.Mesh(hubInnerGeometry, hubInnerMaterial);
        hub.position.z = side * .012;
        inner.position.z = side * .013;
        spin.add(hub, inner);
      }
      this.scene.add(group);
      const disc: DiscMesh = {
        group, spin, material: frontMaterial, image,
        button: image?.closest<HTMLButtonElement>("[data-album-disc]") ?? null,
        texture: null, loadingArtwork: null, artworkFailed: false,
      };
      this.discs.push(disc);
    });
  }

  /** 只为进入视野附近的盘上传封面纹理，减少首次打开时的显存和上传峰值。 */
  private useArtwork(disc: DiscMesh): Promise<void> {
    const image = disc.image;
    if (!image || disc.texture || disc.artworkFailed) return Promise.resolve();
    if (disc.loadingArtwork) return disc.loadingArtwork;
    image.loading = "eager";
    disc.loadingArtwork = image.decode().then(() => {
      if (this.disposed || !image.naturalWidth || !image.naturalHeight) return;
      const texture = new THREE.Texture(image);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
      if (image.naturalWidth > image.naturalHeight) {
        texture.repeat.x = image.naturalHeight / image.naturalWidth;
        texture.offset.x = (1 - texture.repeat.x) / 2;
      } else if (image.naturalHeight > image.naturalWidth) {
        texture.repeat.y = image.naturalWidth / image.naturalHeight;
        texture.offset.y = (1 - texture.repeat.y) / 2;
      }
      texture.needsUpdate = true;
      disc.texture = texture;
      disc.material.map = texture;
      disc.material.needsUpdate = true;
      if (this.lastLayout.length && this.lastViewport) this.draw(this.lastLayout, this.lastViewport);
      // 首帧已画好后才隐藏 CSS 备用盘，避免首次载入时露出未贴图的盘面。
      disc.button?.classList.add("has-physical-artwork");
    }).catch(() => {
      // 单张封面加载失败时仍保留对应 CSS 光碟，不阻断整个画廊。
      disc.artworkFailed = true;
    }).finally(() => { disc.loadingArtwork = null; });
    return disc.loadingArtwork;
  }

  /** 等开场盘的实体贴图完成首帧，再让盘列开始长距离滑动。 */
  prepareOpeningArtwork() {
    return this.useArtwork(this.discs[0]);
  }

  /** 暗色环境中的几条柔和灯带让高光随盘面法线移动。 */
  private createEnvironment() {
    const canvas = document.createElement("canvas");
    canvas.width = 768;
    canvas.height = 384;
    const context = canvas.getContext("2d")!;
    const base = context.createLinearGradient(0, 0, 0, canvas.height);
    base.addColorStop(0, "#333943");
    base.addColorStop(.5, "#151a20");
    base.addColorStop(1, "#050607");
    context.fillStyle = base;
    context.fillRect(0, 0, canvas.width, canvas.height);
    for (const [center, spread, strength] of [[.13, .075, .54], [.39, .045, .4], [.67, .095, .27]]) {
      const y = canvas.height * center;
      const radius = canvas.height * spread;
      const strip = context.createLinearGradient(0, y - radius, 0, y + radius);
      strip.addColorStop(0, "rgba(255,255,255,0)");
      strip.addColorStop(.5, `rgba(255,250,238,${strength})`);
      strip.addColorStop(1, "rgba(255,255,255,0)");
      context.fillStyle = strip;
      context.fillRect(0, y - radius, canvas.width, radius * 2);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.mapping = THREE.EquirectangularReflectionMapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const environment = pmrem.fromEquirectangular(texture);
    texture.dispose();
    pmrem.dispose();
    return environment;
  }

  /** 粗糙度和法线贴图只改变微观反光，不把灰色划痕直接画在封面上。 */
  private createSurfaceMap(kind: "roughness" | "normal") {
    const size = 512;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const context = canvas.getContext("2d")!;
    const image = context.createImageData(size, size);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const dx = x - size / 2;
        const dy = y - size / 2;
        const radius = Math.hypot(dx, dy) || 1;
        const grain = ((x * 73 + y * 151 + x * y * 17) % 97) / 97 - .5;
        const index = (y * size + x) * 4;
        if (kind === "roughness") {
          const value = Math.round(255 * THREE.MathUtils.clamp(.75 + grain * .14 + Math.sin(radius * .68) * .035, .52, .95));
          image.data[index] = image.data[index + 1] = image.data[index + 2] = value;
        } else {
          const groove = Math.cos(radius * 2.1) * .23;
          image.data[index] = Math.round(128 + dx / radius * groove * 65 + grain * 3);
          image.data[index + 1] = Math.round(128 + dy / radius * groove * 65 + grain * 3);
          image.data[index + 2] = 254;
        }
        image.data[index + 3] = 255;
      }
    }
    context.putImageData(image, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    return texture;
  }

  /** 暖主光、冷轮廓光与顶部面光源共同塑造银边和涂层。 */
  private addLights() {
    this.scene.add(new THREE.AmbientLight(0xffffff, .56));
    const key = new THREE.DirectionalLight(0xfff7e8, 1.22);
    key.position.set(3, -5, 8);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xeaf0f5, .42);
    fill.position.set(-5, 2, 4);
    this.scene.add(fill);
    const rim = new THREE.DirectionalLight(0xa5c6ef, .45);
    rim.position.set(0, 3, -6);
    this.scene.add(rim);
    const strip = new THREE.RectAreaLight(0xffffff, 1.9, 7, .55);
    strip.position.set(0, 3, 4);
    strip.lookAt(0, 0, 0);
    this.scene.add(strip);
  }

  /** 连续慢帧时逐档降低渲染分辨率，避免高像素密度设备在拖动中持续掉帧。 */
  observeFrameTime(milliseconds: number) {
    if (milliseconds < 1 || milliseconds > 80) return;
    this.qualitySamples += 1;
    this.qualityDuration += milliseconds;
    if (this.qualitySamples < 30) return;
    const average = this.qualityDuration / this.qualitySamples;
    this.qualitySamples = 0;
    this.qualityDuration = 0;
    if (average > 26.5 && this.qualityLevel < 3) {
      this.qualityLevel = Math.min(3, this.qualityLevel + (average > 45 ? 2 : 1));
      this.fastWindows = 0;
      this.applyResolution();
    } else if (average < 17.5 && this.qualityLevel > 0) {
      this.fastWindows += 1;
      if (this.fastWindows >= 4) {
        this.qualityLevel -= 1;
        this.fastWindows = 0;
        this.applyResolution();
      }
    } else this.fastWindows = 0;
  }

  /** 拖动或悬停运动开始时使用动态分辨率，优先保持交互流畅。 */
  beginMotion() {
    if (!this.isIdle) return;
    this.isIdle = false;
    this.applyResolution();
  }

  /** 盘列停稳后恢复清晰画布，不让慢帧时降低的画质一直保留。 */
  settle() {
    if (this.isIdle) return;
    this.isIdle = true;
    this.applyResolution();
  }

  /** 尺寸或画质档位变化时才重建画布缓冲区。 */
  private applyResolution() {
    if (!this.width || !this.height) return;
    const ratio = this.isIdle
      ? this.idlePixelRatio
      : this.basePixelRatio * [1, .85, .7, .55][this.qualityLevel];
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(this.width, this.height, false);
  }

  /** 以 CSS 舞台像素作为三维世界单位，使光碟和透明按钮保持同一轨迹。 */
  draw(layout: AlbumDiscLayout[], viewport: AlbumDiscViewport) {
    this.lastLayout = layout;
    this.lastViewport = viewport;
    if (this.contextLost) return;
    const { width, height, radius, centerX, centerY } = viewport;
    if (!width || !height) return;
    if (width !== this.width || height !== this.height) {
      this.width = width;
      this.height = height;
      // 全屏物理材质以像素预算约束填充率，大屏幕不再按高 DPR 无限制放大画布。
      this.basePixelRatio = Math.max(.85, Math.min(window.devicePixelRatio || 1, 1.25, Math.sqrt(3_200_000 / (width * height))));
      // 静止时只绘制一帧，允许恢复更接近设备像素密度的封面细节。
      this.idlePixelRatio = Math.max(1, Math.min(window.devicePixelRatio || 1, width <= 760 ? 1.5 : 1.75, Math.sqrt(5_000_000 / (width * height))));
      this.applyResolution();
      this.camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(height / (2 * 1450)));
      this.camera.aspect = width / height;
      this.camera.near = 1;
      this.camera.far = 5000;
      this.camera.position.set(0, 0, 1450);
      this.camera.lookAt(0, 0, 0);
      this.camera.updateProjectionMatrix();
    }
    layout.forEach((pose, index) => {
      const disc = this.discs[index];
      if (!disc) return;
      if (pose.offset >= -3.2 && pose.offset <= 2) this.useArtwork(disc);
      disc.group.visible = pose.visible && Boolean(disc.texture);
      if (!pose.visible) return;
      disc.group.position.set(centerX + pose.x, centerY - pose.y, pose.offset * 14);
      disc.group.rotation.order = "ZYX";
      disc.group.rotation.set(THREE.MathUtils.degToRad(-pose.pitch), THREE.MathUtils.degToRad(pose.yaw), THREE.MathUtils.degToRad(-pose.zAngle));
      disc.group.scale.setScalar(radius * pose.scale);
      disc.spin.rotation.y = THREE.MathUtils.degToRad(pose.flip);
    });
    this.renderer.render(this.scene, this.camera);
  }

  /** 关闭画廊或离开页面时释放画布与封面纹理。 */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.discs.forEach((disc) => {
      disc.material.dispose();
      disc.texture?.dispose();
      disc.button?.classList.remove("has-physical-artwork");
    });
    this.sharedGeometry.forEach((geometry) => geometry.dispose());
    this.sharedMaterial.forEach((material) => material.dispose());
    this.sharedTexture.forEach((texture) => texture.dispose());
    this.environment.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
