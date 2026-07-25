import * as THREE from "three";

interface GalleryItem {
  index: string;
  word: string;
  texture: string;
  accent: string;
  background: string;
  blob1: string;
  blob2: string;
}

interface GalleryPlane extends THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> {
  userData: {
    aspectRatio: number;
    baseX: number;
  };
}

// 对应原版每帧约 0.08 的追随强度，并换算为不受刷新率影响的指数阻尼。
const SCROLL_DAMPING = -Math.log(1 - 0.08) * 60;
const VELOCITY_DAMPING = -Math.log(1 - 0.12) * 60;
const POINTER_DAMPING = -Math.log(1 - 0.055) * 60;

const backgroundVertexShader = `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`;

const backgroundFragmentShader = `
  precision highp float;

  uniform float uTime;
  uniform float uVelocity;
  uniform float uAspect;
  uniform vec3 uBackground;
  uniform vec3 uBlob1;
  uniform vec3 uBlob2;
  varying vec2 vUv;

  float random(vec2 point) {
    return fract(sin(dot(point, vec2(12.9898, 78.233))) * 43758.5453);
  }

  void main() {
    vec2 uv = vUv;
    vec2 centered = uv - 0.5;
    centered.x *= uAspect;

    vec2 firstCenter = vec2(
      -0.34 * uAspect + sin(uTime * 0.10) * 0.10,
      0.24 + cos(uTime * 0.08) * 0.08
    );
    vec2 secondCenter = vec2(
      0.34 * uAspect + cos(uTime * 0.07) * 0.12,
      -0.22 + sin(uTime * 0.09) * 0.08
    );

    float firstBlob = smoothstep(0.92, 0.05, distance(centered, firstCenter));
    float secondBlob = smoothstep(1.02, 0.08, distance(centered, secondCenter));

    vec3 color = uBackground;
    color = mix(color, mix(uBlob1, uBackground, 0.28), firstBlob * 0.72);
    color = mix(color, mix(uBlob2, uBackground, 0.34), secondBlob * 0.68);
    color += abs(uVelocity) * 0.045;

    float grain = random(uv * vec2(1327.13, 947.91) + uTime * 0.01) - 0.5;
    color += grain * 0.022;

    gl_FragColor = vec4(color, 1.0);
  }
`;

/**
 * 挂载首页开场画廊；同一页面只初始化一次，避免开发热更新时重复绑定事件。
 */
export function mountDepthGallery(): void {
  const section = document.querySelector<HTMLElement>("#depth-intro");
  const homepage = document.querySelector<HTMLElement>(".page-shell");
  if (!section || !homepage || section.dataset.mounted === "true") return;

  section.dataset.mounted = "true";
  const items = JSON.parse(section.dataset.gallery ?? "[]") as GalleryItem[];
  const canvas = section.querySelector<HTMLCanvasElement>(".depth-canvas");
  if (!canvas || items.length === 0) return;

  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  if (prefersReducedMotion.matches) {
    document.body.classList.add("depth-gallery-reduced");
    mountStaticScroll(section);
    return;
  }

  try {
    const experience = new DepthGalleryExperience(section, canvas, items);
    experience.init().catch((error) => {
      // 纹理下载或初始化失败时同样回退，避免异步异常留下空白首屏。
      console.warn("Depth gallery assets could not be initialized.", error);
      document.body.classList.remove(
        "depth-gallery-active",
        "depth-gallery-ready",
        "depth-gallery-home",
      );
      document.body.classList.add("depth-gallery-fallback");
      mountStaticScroll(section);
    });
  } catch (error) {
    // WebGL 不可用时保留静态入口，避免画廊阻断主页访问。
    console.warn("Depth gallery switched to the static fallback.", error);
    document.body.classList.add("depth-gallery-fallback");
    mountStaticScroll(section);
  }
}

/**
 * 为减少动态效果和 WebGL 失败场景提供一屏静态封面及可逆的主页淡入。
 */
function mountStaticScroll(section: HTMLElement): void {
  const stage = section.querySelector<HTMLElement>(".depth-gallery-sticky");
  const update = () => {
    // 以实际舞台高度计算进度，避免手机地址栏变化后 CSS 与 innerHeight 使用不同基准。
    const stageHeight = stage?.getBoundingClientRect().height ?? window.innerHeight;
    const distance = Math.max(section.offsetHeight - stageHeight, 1);
    const progress = THREE.MathUtils.clamp(-section.getBoundingClientRect().top / distance, 0, 1);
    section.style.setProperty("--depth-progress", progress.toFixed(4));
    section.style.setProperty("--depth-handoff", progress.toFixed(4));
    document.documentElement.style.setProperty("--homepage-reveal", smoothstep(progress).toFixed(4));
    document.body.classList.toggle("depth-gallery-home", progress > 0.92);
    document.body.classList.toggle("depth-gallery-active", progress <= 0.92);
  };

  update();
  window.addEventListener("scroll", update, { passive: true });
  window.addEventListener("resize", update, { passive: true });
}

class DepthGalleryExperience {
  private readonly section: HTMLElement;
  private readonly stage: HTMLElement;
  private readonly items: GalleryItem[];
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly backgroundScene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(42, 1, 0.1, 80);
  private readonly backgroundCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly planes: GalleryPlane[] = [];
  private readonly pointerTarget = new THREE.Vector2();
  private readonly pointerCurrent = new THREE.Vector2();
  private readonly trailPoints = Array.from({ length: 18 }, () => new THREE.Vector3());
  private readonly trailCurve = new THREE.CatmullRomCurve3(
    this.trailPoints,
    false,
    "centripetal",
  );
  private readonly trailMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    depthTest: false,
    toneMapped: false,
  });
  private trail: THREE.Mesh<THREE.TubeGeometry, THREE.MeshBasicMaterial> | null = null;
  private readonly backgroundMaterial: THREE.ShaderMaterial;
  private readonly labelIndex: HTMLElement | null;
  private readonly labelWord: HTMLElement | null;
  private readonly colorChip: HTMLElement | null;
  private readonly colorCmyk: HTMLElement | null;
  private readonly colorRgb: HTMLElement | null;
  private readonly colorHex: HTMLElement | null;
  private readonly progressCurrent: HTMLElement | null;
  private renderProgress = 0;
  private scrollProgress = 0;
  private previousGalleryProgress = 0;
  private velocity = 0;
  private activeIndex = -1;
  private isVisible = true;
  private lastFrameTime = 0;
  private viewportWidth = 1;
  private viewportHeight = 1;

  constructor(
    section: HTMLElement,
    canvas: HTMLCanvasElement,
    items: GalleryItem[],
  ) {
    this.section = section;
    this.stage = canvas.parentElement ?? section;
    this.items = items;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: false,
      antialias: true,
      powerPreference: "high-performance",
    });

    this.backgroundMaterial = new THREE.ShaderMaterial({
      vertexShader: backgroundVertexShader,
      fragmentShader: backgroundFragmentShader,
      depthWrite: false,
      depthTest: false,
      uniforms: {
        uTime: { value: 0 },
        uVelocity: { value: 0 },
        uAspect: { value: 1 },
        uBackground: { value: new THREE.Color(items[0].background) },
        uBlob1: { value: new THREE.Color(items[0].blob1) },
        uBlob2: { value: new THREE.Color(items[0].blob2) },
      },
    });

    this.labelIndex = section.querySelector(".depth-index");
    this.labelWord = section.querySelector(".depth-word");
    this.colorChip = section.querySelector(".depth-chip");
    this.colorCmyk = section.querySelector('[data-color="cmyk"]');
    this.colorRgb = section.querySelector('[data-color="rgb"]');
    this.colorHex = section.querySelector('[data-color="hex"]');
    this.progressCurrent = section.querySelector(".depth-progress-current");
  }

  /**
   * 创建场景、预载纹理并启动渲染；加载完成前仍保留页面的基础背景。
   */
  async init(): Promise<void> {
    this.setupBackground();
    this.setupTrail();
    this.bindEvents();
    this.resize();
    this.updateScrollState();

    await this.createPlanes();
    // 纹理加载期间浏览器可能恢复历史滚动位置，因此启动前重新读取一次真实目标。
    this.updateScrollState();
    // 首次渲染从当前页面位置开始，避免刷新在中途时从第一幕长距离追赶。
    this.renderProgress = this.scrollProgress;
    this.previousGalleryProgress = THREE.MathUtils.clamp(this.renderProgress / 0.84, 0, 1);
    this.lastFrameTime = window.performance.now();
    document.body.classList.add("depth-gallery-ready");
    this.syncPresentationState(this.renderProgress);
    this.render();
  }

  /**
   * 创建独立的全屏着色器背景，使色彩氛围不受透视相机影响。
   */
  private setupBackground(): void {
    const geometry = new THREE.PlaneGeometry(2, 2);
    this.backgroundScene.add(new THREE.Mesh(geometry, this.backgroundMaterial));
  }

  /**
   * 创建位于图片前方的连续细管曲线，避免分段宽线在节点处产生重叠亮点。
   */
  private setupTrail(): void {
    this.updateTrailPoints(0);
    const geometry = new THREE.TubeGeometry(this.trailCurve, 72, 0.0028, 6, false);
    this.trail = new THREE.Mesh(geometry, this.trailMaterial);
    this.trail.frustumCulled = false;
    this.trail.renderOrder = 20;
    this.scene.add(this.trail);
  }

  /**
   * 并行加载六张优化纹理，并按原始比例创建交替分布的图片平面。
   */
  private async createPlanes(): Promise<void> {
    const loader = new THREE.TextureLoader();
    const textures = await Promise.all(
      this.items.map(
        (item) =>
          new Promise<THREE.Texture>((resolve, reject) => {
            loader.load(item.texture, resolve, undefined, reject);
          }),
      ),
    );

    textures.forEach((texture, index) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.magFilter = THREE.LinearFilter;

      const image = texture.image as HTMLImageElement;
      const aspectRatio = image.naturalWidth / image.naturalHeight;
      const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        opacity: index === 0 ? 1 : 0,
        depthWrite: false,
        toneMapped: false,
      });
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material) as GalleryPlane;
      plane.renderOrder = index + 1;
      plane.userData.aspectRatio = aspectRatio;
      plane.userData.baseX = index % 2 === 0 ? -1 : 1;
      plane.position.z = -index * 5;
      this.scene.add(plane);
      this.planes.push(plane);
    });

    this.layoutPlanes();
  }

  /**
   * 绑定滚动、指针和尺寸事件；滚动保持原生行为，因此主页交接天然可逆。
   */
  private bindEvents(): void {
    window.addEventListener("scroll", this.updateScrollState, { passive: true });
    window.addEventListener("resize", this.resize, { passive: true });
    window.addEventListener("pointermove", this.updatePointer, { passive: true });
    window.addEventListener("pointerleave", this.resetPointer, { passive: true });

    // 动态视口单位变化不一定稳定触发 window.resize，直接监听 sticky 舞台最可靠。
    const resizeObserver = new ResizeObserver(this.resize);
    resizeObserver.observe(this.stage);

    const observer = new IntersectionObserver(
      ([entry]) => {
        this.isVisible = entry?.isIntersecting ?? true;
      },
      { rootMargin: "120px" },
    );
    observer.observe(this.section);
  }

  private readonly updateScrollState = (): void => {
    const distance = Math.max(this.section.offsetHeight - this.viewportHeight, 1);
    this.scrollProgress = THREE.MathUtils.clamp(
      -this.section.getBoundingClientRect().top / distance,
      0,
      1,
    );
  };

  /**
   * 将 WebGL 的惯性进度同步给 DOM，保证画廊、主页淡入和导航状态始终同拍。
   */
  private syncPresentationState(progress: number): number {
    const handoff = smoothstep(
      THREE.MathUtils.clamp((progress - 0.84) / 0.16, 0, 1),
    );
    this.section.style.setProperty("--depth-progress", progress.toFixed(4));
    this.section.style.setProperty("--depth-handoff", handoff.toFixed(4));
    document.documentElement.style.setProperty("--homepage-reveal", handoff.toFixed(4));
    document.body.classList.toggle("depth-gallery-home", handoff > 0.92);
    document.body.classList.toggle("depth-gallery-active", handoff <= 0.92);
    return handoff;
  }

  private readonly updatePointer = (event: PointerEvent): void => {
    const bounds = this.stage.getBoundingClientRect();
    this.pointerTarget.set(
      ((event.clientX - bounds.left) / Math.max(bounds.width, 1)) * 2 - 1,
      -(((event.clientY - bounds.top) / Math.max(bounds.height, 1)) * 2 - 1),
    );
  };

  private readonly resetPointer = (): void => {
    this.pointerTarget.set(0, 0);
  };

  /**
   * 根据 sticky 舞台的真实尺寸重新计算渲染器、相机和画框，避免动态地址栏拉伸画布。
   */
  private readonly resize = (): void => {
    const bounds = this.stage.getBoundingClientRect();
    const width = Math.max(Math.round(bounds.width), 1);
    const height = Math.max(Math.round(bounds.height), 1);
    const isMobile = width <= 760;
    this.viewportWidth = width;
    this.viewportHeight = height;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1.25 : 1.75));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.backgroundMaterial.uniforms.uAspect.value = width / height;
    this.layoutPlanes();
    this.updateScrollState();
  };

  private layoutPlanes(): void {
    if (this.planes.length === 0) return;
    const isMobile = this.viewportWidth <= 760;
    const horizontalOffset = isMobile ? 0.23 : 0.72;
    const visibleHeight =
      2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 5;
    const visibleWidth = visibleHeight * this.camera.aspect;

    this.planes.forEach((plane, index) => {
      const planeHeight = this.getPlaneHeight(plane.userData.aspectRatio);
      const width = planeHeight * plane.userData.aspectRatio;
      let availableShift = Math.max((visibleWidth - width) * 0.46, 0);

      if (isMobile && index === 0) {
        // 只有首幕保留 20–28px 安全边距；后续图片恢复贴近边缘的左右交替构图。
        const minimumGutterPixels = THREE.MathUtils.clamp(this.viewportWidth * 0.055, 20, 28);
        const minimumGutter = visibleWidth * (minimumGutterPixels / this.viewportWidth);
        availableShift = Math.max((visibleWidth - width) / 2 - minimumGutter, 0);
      }

      plane.scale.set(width, planeHeight, 1);
      plane.userData.baseX =
        (index % 2 === 0 ? -1 : 1) * Math.min(horizontalOffset, availableShift);
    });
  }

  /**
   * 让画面逐帧追赶原生滚动目标，再统一更新相机、图片、情绪色和文字。
   */
  private render = (frameTime = window.performance.now()): void => {
    requestAnimationFrame(this.render);
    const deltaSeconds = THREE.MathUtils.clamp(
      (frameTime - this.lastFrameTime) / 1000,
      0,
      0.05,
    );
    this.lastFrameTime = frameTime;
    const isSettling = Math.abs(this.scrollProgress - this.renderProgress) >= 0.00001;
    // 快速滚出画廊后仍需完成惯性和主页交接，追上目标后才暂停离屏渲染。
    if ((!this.isVisible && !isSettling) || this.planes.length === 0) return;

    // 原生滚动只负责提供目标值；指数阻尼负责生成由快到慢、可逆的惯性尾巴。
    const scrollBlend = 1 - Math.exp(-SCROLL_DAMPING * deltaSeconds);
    this.renderProgress = THREE.MathUtils.lerp(
      this.renderProgress,
      this.scrollProgress,
      scrollBlend,
    );
    if (Math.abs(this.scrollProgress - this.renderProgress) < 0.00001) {
      this.renderProgress = this.scrollProgress;
    }

    const galleryProgress = THREE.MathUtils.clamp(this.renderProgress / 0.84, 0, 1);
    const activeFloat = galleryProgress * (this.items.length - 1);
    const handoff = this.syncPresentationState(this.renderProgress);

    const progressPerSecond =
      deltaSeconds > 0 ? (galleryProgress - this.previousGalleryProgress) / deltaSeconds : 0;
    const velocityBlend = 1 - Math.exp(-VELOCITY_DAMPING * deltaSeconds);
    this.velocity = THREE.MathUtils.lerp(
      this.velocity,
      progressPerSecond * 0.7,
      velocityBlend,
    );
    this.previousGalleryProgress = galleryProgress;
    this.pointerCurrent.lerp(
      this.pointerTarget,
      1 - Math.exp(-POINTER_DAMPING * deltaSeconds),
    );

    this.camera.position.z = 5 - activeFloat * 5;
    this.camera.position.x = this.pointerCurrent.x * 0.055;
    this.camera.position.y = this.pointerCurrent.y * 0.03;

    this.updatePlanes(activeFloat, handoff);
    this.updateMood(activeFloat);
    this.updateTrail(galleryProgress);
    this.updateLabels(activeFloat);

    this.backgroundMaterial.uniforms.uTime.value = window.performance.now() * 0.001;
    this.backgroundMaterial.uniforms.uVelocity.value = this.velocity;

    this.renderer.autoClear = true;
    this.renderer.render(this.backgroundScene, this.backgroundCamera);
    this.renderer.autoClear = false;
    this.renderer.clearDepth();
    this.renderer.render(this.scene, this.camera);
  };

  private updatePlanes(activeFloat: number, handoff: number): void {
    const isMobile = this.viewportWidth <= 760;
    const currentIndex = Math.floor(activeFloat);
    const nextIndex = Math.min(currentIndex + 1, this.planes.length - 1);
    const blend = activeFloat - currentIndex;

    this.planes.forEach((plane, index) => {
      const planeHeight = this.getPlaneHeight(plane.userData.aspectRatio);
      let opacity = 0;
      if (index === currentIndex) opacity = Math.pow(1 - blend, 2.6);
      if (index === nextIndex) opacity = Math.max(opacity, 1 - Math.pow(1 - blend, 2.2));
      const distanceFromCamera = this.camera.position.z - plane.position.z;
      const proximityFade = THREE.MathUtils.clamp((distanceFromCamera - 0.8) / 3.4, 0, 1);
      opacity *= proximityFade;
      const isLastPlane = index === this.planes.length - 1;
      const centerBlend = isLastPlane ? handoff : 0;
      const parallax = opacity * (isMobile ? 0.065 : 0.2);
      const baseX = THREE.MathUtils.lerp(plane.userData.baseX, 0, centerBlend);

      plane.material.opacity = opacity * (1 - handoff * 0.82);
      plane.position.x = baseX + this.pointerCurrent.x * parallax;
      plane.position.y =
        this.pointerCurrent.y * parallax * 0.45 +
        THREE.MathUtils.clamp(this.velocity, -1, 1) * (isMobile ? 0.025 : 0.07);
      plane.rotation.x = -this.pointerCurrent.y * opacity * this.velocity * 0.035;
      plane.rotation.y = this.pointerCurrent.x * opacity * this.velocity * 0.04;

      const pulse = 1 + Math.min(Math.abs(this.velocity), 1) * 0.025 + centerBlend * 0.055;
      plane.scale.set(
        planeHeight * plane.userData.aspectRatio * pulse,
        planeHeight * pulse,
        1,
      );
    });
  }

  /**
   * 同时限制画框的可见宽高，确保不同横竖比例在窄屏上也不会被裁切。
   */
  private getPlaneHeight(aspectRatio: number): number {
    const isMobile = this.viewportWidth <= 760;
    const cameraDistance = 5;
    const visibleHeight =
      2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * cameraDistance;
    const visibleWidth = visibleHeight * this.camera.aspect;
    const preferredHeight = isMobile ? 2.42 : 3.02;
    const maximumHeight = visibleHeight * (isMobile ? 0.66 : 0.79);
    const maximumWidth = visibleWidth * (isMobile ? 0.84 : 0.9);
    return Math.min(preferredHeight, maximumHeight, maximumWidth / aspectRatio);
  }

  private updateMood(activeFloat: number): void {
    const currentIndex = Math.floor(activeFloat);
    const nextIndex = Math.min(currentIndex + 1, this.items.length - 1);
    const blend = activeFloat - currentIndex;
    const current = this.items[currentIndex];
    const next = this.items[nextIndex];
    if (!current || !next) return;

    this.backgroundMaterial.uniforms.uBackground.value
      .set(current.background)
      .lerp(new THREE.Color(next.background), blend);
    this.backgroundMaterial.uniforms.uBlob1.value
      .set(current.blob1)
      .lerp(new THREE.Color(next.blob1), blend);
    this.backgroundMaterial.uniforms.uBlob2.value
      .set(current.blob2)
      .lerp(new THREE.Color(next.blob2), blend);
  }

  private updateTrail(progress: number): void {
    if (!this.trail) return;

    this.updateTrailPoints(progress);
    const radius = this.viewportWidth <= 760 ? 0.0024 : 0.0028;
    const nextGeometry = new THREE.TubeGeometry(this.trailCurve, 72, radius, 6, false);
    this.trail.geometry.dispose();
    this.trail.geometry = nextGeometry;

    const speed = Math.min(Math.abs(this.velocity), 1);
    // 首幕先保持克制，滚过开场后再恢复后续画面的正常线条强度。
    const entrance = THREE.MathUtils.lerp(
      0.12,
      1,
      smoothstep(THREE.MathUtils.clamp(progress / 0.14, 0, 1)),
    );
    // 第六张开始参与混合时淡出，并在第六张完全到位时隐藏轨迹。
    const exit = 1 - smoothstep(THREE.MathUtils.clamp((progress - 0.8) / 0.2, 0, 1));
    this.trailMaterial.opacity = (0.46 + speed * 0.18) * entrance * exit;
  }

  /**
   * 根据画廊进度移动曲线控制点，空间路径保持平滑且不产生独立节点图形。
   */
  private updateTrailPoints(progress: number): void {
    const count = this.trailPoints.length;
    for (let index = 0; index < count; index += 1) {
      const t = index / Math.max(count - 1, 1);
      const phase = progress * Math.PI * 5.2 + t * Math.PI * 1.8;
      const x = Math.sin(phase) * (1.15 + t * 1.4);
      const y = Math.cos(phase * 0.58) * 0.48 - 0.65 + t * 0.28;
      const z = this.camera.position.z - 1.4 - t * 3.2;
      this.trailPoints[index].set(x, y, z);
    }
  }

  private updateLabels(activeFloat: number): void {
    const nextIndex = Math.min(Math.round(activeFloat), this.items.length - 1);
    if (nextIndex === this.activeIndex) return;

    this.activeIndex = nextIndex;
    const item = this.items[nextIndex];
    if (!item) return;

    const rgbValues = hexToRgb(item.accent);

    if (this.labelIndex) this.labelIndex.textContent = item.index;
    if (this.labelWord) this.labelWord.textContent = item.word;
    if (this.progressCurrent) this.progressCurrent.textContent = item.index;
    if (this.colorChip) {
      this.colorChip.style.backgroundColor = item.accent;
      this.colorChip.style.boxShadow = `0 0 26px ${item.accent}88`;
    }
    if (this.colorRgb) this.colorRgb.textContent = rgbValues.join(", ");
    if (this.colorHex) this.colorHex.textContent = item.accent.slice(1).toUpperCase();
    if (this.colorCmyk) this.colorCmyk.textContent = rgbToCmyk(rgbValues).join(", ");
  }
}

function smoothstep(value: number): number {
  return value * value * (3 - 2 * value);
}

function rgbToCmyk([red, green, blue]: number[]): number[] {
  const normalizedRed = red / 255;
  const normalizedGreen = green / 255;
  const normalizedBlue = blue / 255;
  const black = 1 - Math.max(normalizedRed, normalizedGreen, normalizedBlue);

  if (black >= 0.999) return [0, 0, 0, 100];

  const cyan = (1 - normalizedRed - black) / (1 - black);
  const magenta = (1 - normalizedGreen - black) / (1 - black);
  const yellow = (1 - normalizedBlue - black) / (1 - black);
  return [cyan, magenta, yellow, black].map((value) => Math.round(value * 100));
}

function hexToRgb(hex: string): number[] {
  const normalized = hex.replace("#", "");
  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
  ];
}
