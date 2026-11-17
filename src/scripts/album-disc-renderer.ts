import * as THREE from "three";
import { RectAreaLightUniformsLib } from "three/examples/jsm/lights/RectAreaLightUniformsLib.js";

const ALBUM_PIXEL_BUDGET = 3840 * 2160;
const QUALITY_SCALES = [1, .9, .8, .7] as const;

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
  artworkFailed: boolean;
  artworkPresented: boolean;
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
  private devicePixelRatio = 0;
  private resolutionDirty = true;
  private qualityLevel = 0;
  private qualitySamples = 0;
  private qualityDuration = 0;
  private fastWindows = 0;
  private contextLost = false;
  private disposed = false;
  private readonly artworkQueue = new Set<number>();
  private artworkFrame = 0;
  private artworkUploadsPaused = true;

  constructor(
    stage: HTMLElement,
    images: Array<HTMLImageElement | null>,
    brightArtwork: boolean,
    private readonly onArtworkReady: () => void,
  ) {
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
      // 显卡上下文丢失时立即露出仍在同步位置的 CSS 盘。
      if (this.disposed) return;
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
    // 预热时就启用封面的着色器分支，真实纹理接入时沿用同一套材质程序。
    const artworkPlaceholder = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    artworkPlaceholder.colorSpace = THREE.SRGBColorSpace;
    artworkPlaceholder.needsUpdate = true;
    this.sharedTexture.push(roughness, normals, artworkPlaceholder);
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

    // 每张盘内部按正反面、盘边、盘心绘制；相邻盘按序号整体叠放，侧转时不互相穿透。
    const discLayer = { depthTest: false, depthWrite: false };
    const backMaterial = new THREE.MeshPhysicalMaterial({
      ...discLayer,
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
      ...discLayer,
      color: 0xd5d9d9,
      metalness: .72,
      roughness: .19,
      clearcoat: .88,
      clearcoatRoughness: .08,
      envMapIntensity: 1.75,
      side: THREE.DoubleSide,
    });
    const hubMaterial = new THREE.MeshPhysicalMaterial({
      ...discLayer,
      color: 0xdfe3e3,
      metalness: .18,
      roughness: .27,
      clearcoat: 1,
      clearcoatRoughness: .09,
      side: THREE.DoubleSide,
    });
    const hubInnerMaterial = new THREE.MeshPhysicalMaterial({
      ...discLayer,
      color: 0xa8afb3,
      metalness: .66,
      roughness: .23,
      clearcoat: .7,
      side: THREE.DoubleSide,
    });
    this.sharedMaterial.push(backMaterial, rimMaterial, hubMaterial, hubInnerMaterial);

    images.forEach((image, index) => {
      const frontMaterial = new THREE.MeshPhysicalMaterial({
        ...discLayer,
        color: 0xffffff,
        map: artworkPlaceholder,
        metalness: .16,
        roughness: .58,
        roughnessMap: roughness,
        normalMap: normals,
        normalScale: new THREE.Vector2(.08, .08),
        clearcoat: .68,
        clearcoatRoughness: .19,
        envMapIntensity: .7,
        // 浅色预览舞台给印刷图案补一点中性光，保持图案和原图一样易辨认。
        emissive: brightArtwork ? 0xffffff : 0x000000,
        emissiveMap: brightArtwork ? artworkPlaceholder : null,
        emissiveIntensity: .32,
        side: THREE.FrontSide,
      });
      const group = new THREE.Group();
      group.renderOrder = index;
      const spin = new THREE.Group();
      spin.renderOrder = index;
      group.add(spin);
      const front = new THREE.Mesh(frontGeometry, frontMaterial);
      front.renderOrder = 0;
      spin.add(front);
      const back = new THREE.Mesh(backGeometry, backMaterial);
      back.renderOrder = 0;
      back.rotation.y = Math.PI;
      back.position.z = -.009;
      spin.add(back);
      const rim = new THREE.Mesh(rimGeometry, rimMaterial);
      rim.renderOrder = 1;
      spin.add(rim);
      // 盘心环在两侧各有一份；中孔保持真实透明，不用白色贴片遮挡。
      for (const side of [1, -1]) {
        const hub = new THREE.Mesh(hubGeometry, hubMaterial);
        const inner = new THREE.Mesh(hubInnerGeometry, hubInnerMaterial);
        hub.renderOrder = 2;
        inner.renderOrder = 3;
        hub.position.z = side * .012;
        inner.position.z = side * .013;
        spin.add(hub, inner);
      }
      this.scene.add(group);
      const disc: DiscMesh = {
        group, spin, material: frontMaterial, image,
        button: image?.closest<HTMLButtonElement>("[data-album-disc]") ?? null,
        texture: null, artworkFailed: false, artworkPresented: false,
      };
      this.discs.push(disc);
    });
  }

  /** 用实际场景预编译正反面、透光盘心和其他共享材质。 */
  async prepareMaterials() {
    await this.renderer.compileAsync(this.scene, this.camera);
  }

  /** 查询入场需要的盘面是否已上传。 */
  hasArtwork(index: number) {
    return !this.contextLost && Boolean(this.discs[index]?.texture);
  }

  /** 判断下一帧是否有新的盘面可接替 CSS。 */
  hasPendingArtwork() {
    return !this.contextLost && this.discs.some((disc) => disc.texture && !disc.artworkPresented);
  }

  /** 接收已解码的封面。当前正在移动时，仅将它加入上传队列。 */
  queueArtwork(index: number) {
    const disc = this.discs[index];
    if (disc.texture || disc.artworkFailed || this.disposed || this.contextLost) return;
    this.artworkQueue.add(index);
    this.scheduleArtworkUpload();
  }

  /** 把已解码的封面上传给 GPU，完成后这张盘才可以由 WebGL 绘制。 */
  private uploadArtwork(disc: DiscMesh) {
    const image = disc.image;
    if (!image?.naturalWidth || !image.naturalHeight) return;
    const texture = new THREE.Texture(image);
    try {
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
      this.renderer.initTexture(texture);
      disc.texture = texture;
      disc.material.map = texture;
      if (disc.material.emissiveMap) disc.material.emissiveMap = texture;
    } catch {
      texture.dispose();
      // 单张封面加载失败时仍保留对应 CSS 光碟，不阻断整个画廊。
      disc.artworkFailed = true;
    }
  }

  /** 静止时按入队顺序每帧上传一张，上传结果留到安全的绘制帧接入。 */
  private scheduleArtworkUpload() {
    if (this.artworkUploadsPaused || this.artworkFrame || this.disposed || this.contextLost || !this.artworkQueue.size) return;
    this.artworkFrame = requestAnimationFrame(() => {
      this.artworkFrame = 0;
      if (this.artworkUploadsPaused || this.contextLost) return;
      const index = this.artworkQueue.values().next().value;
      if (index === undefined) return;
      const disc = this.discs[index];
      this.artworkQueue.delete(index);
      this.uploadArtwork(disc);
      if (!this.artworkQueue.size) this.onArtworkReady();
      this.scheduleArtworkUpload();
    });
  }

  /** 在手指或页面开始移动时停掉后台上传，避免纹理更新与换页争用同一帧。 */
  suspendArtworkUploads() {
    this.artworkUploadsPaused = true;
    cancelAnimationFrame(this.artworkFrame);
    this.artworkFrame = 0;
  }

  /** 手势结束且盘列停稳后，接着处理未上传的封面。 */
  resumeArtworkUploads() {
    this.artworkUploadsPaused = false;
    this.scheduleArtworkUpload();
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
    if (milliseconds < 1) return;
    this.qualitySamples += 1;
    // 长任务只按一帧计入，持续超时仍能触发降档。
    this.qualityDuration += Math.min(milliseconds, 80);
    if (this.qualitySamples < 30) return;
    const average = this.qualityDuration / this.qualitySamples;
    this.qualitySamples = 0;
    this.qualityDuration = 0;
    if (average > 26.5 && this.qualityLevel < QUALITY_SCALES.length - 1) {
      this.qualityLevel += 1;
      this.fastWindows = 0;
      this.resolutionDirty = true;
    } else if (average < 17.5 && this.qualityLevel > 0) {
      this.fastWindows += 1;
      if (this.fastWindows >= 4) {
        this.qualityLevel -= 1;
        this.fastWindows = 0;
        this.resolutionDirty = true;
      }
    } else this.fastWindows = 0;
  }

  /** 调分辨率会清空画布，放在实际绘制之前，保证中间没有空白帧。 */
  private applyResolution() {
    this.resolutionDirty = false;
    // 动静共用接近设备 DPR 的基准，保留 CSS 像素清晰度直到视口本身超过预算。
    const base = Math.min(this.devicePixelRatio, Math.sqrt(ALBUM_PIXEL_BUDGET / (this.width * this.height)));
    const ratio = Math.min(base, Math.max(1, base * QUALITY_SCALES[this.qualityLevel]));
    const size = this.renderer.getSize(new THREE.Vector2());
    if (size.x !== this.width || size.y !== this.height || this.renderer.getPixelRatio() !== ratio) {
      this.renderer.setDrawingBufferSize(this.width, this.height, ratio);
    }
  }

  /** 以 CSS 舞台像素作为三维世界单位，使光碟和透明按钮保持同一轨迹。 */
  draw(layout: AlbumDiscLayout[], viewport: AlbumDiscViewport, presentArtwork = false) {
    if (this.contextLost || this.disposed) return false;
    const { width, height, radius, centerX, centerY } = viewport;
    if (!width || !height) return false;
    const devicePixelRatio = window.devicePixelRatio || 1;
    if (width !== this.width || height !== this.height || devicePixelRatio !== this.devicePixelRatio) {
      this.width = width;
      this.height = height;
      this.devicePixelRatio = devicePixelRatio;
      this.resolutionDirty = true;
      this.camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(height / (2 * 1450)));
      this.camera.aspect = width / height;
      this.camera.near = 1;
      this.camera.far = 5000;
      this.camera.position.set(0, 0, 1450);
      this.camera.lookAt(0, 0, 0);
      this.camera.updateProjectionMatrix();
    }
    if (this.resolutionDirty) this.applyResolution();
    layout.forEach((pose, index) => {
      const disc = this.discs[index];
      if (!disc) return;
      disc.group.visible = pose.visible && (disc.artworkPresented || (presentArtwork && Boolean(disc.texture)));
      if (!disc.group.visible) return;
      disc.group.position.set(centerX + pose.x, centerY - pose.y, pose.offset * 14);
      disc.group.rotation.order = "ZYX";
      disc.group.rotation.set(THREE.MathUtils.degToRad(-pose.pitch), THREE.MathUtils.degToRad(pose.yaw), THREE.MathUtils.degToRad(-pose.zAngle));
      disc.group.scale.setScalar(radius * pose.scale);
      disc.spin.rotation.y = THREE.MathUtils.degToRad(pose.flip);
    });
    this.renderer.render(this.scene, this.camera);
    if (!presentArtwork) return true;
    // 画布已经绘制本帧才隐藏对应 CSS 盘，避免上传完成和实际呈现之间露空。
    if (this.renderer.getContext().isContextLost()) return false;
    this.discs.forEach((disc) => {
      if (!disc.texture || disc.artworkPresented) return;
      disc.artworkPresented = true;
      disc.button?.classList.add("has-physical-artwork");
    });
    return true;
  }

  /** 关闭画廊或离开页面时释放画布与封面纹理。 */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.artworkFrame);
    this.artworkQueue.clear();
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
