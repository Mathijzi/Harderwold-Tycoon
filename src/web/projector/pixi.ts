// PixiJS (WebGL) compositor for the projector. The art itself stays procedural (Canvas 2D drawn once into textures:
// ground, bungalows, buildings, trees, props); PixiJS does the per-frame work: depth sorting of thousands of sprites,
// occlusion fading (alpha) and GPU compositing at 4K. Animated objects (flags, barrier arms) and moving actors
// (vehicles, pedestrians) re-render only their own small texture.
import { Application, Container, Sprite, Texture, TilingSprite } from 'pixi.js';
import { waveTile, glintTile } from './water.ts';
import { WeatherFx, WeatherView } from './weatherfx.ts';
import { cam, P, V2 } from './proj.ts';

export interface Drawable {
  key: number;
  draw: (ctx: CanvasRenderingContext2D, t: number) => void;
  /** prebuilt sprite canvas at a fixed screen position */
  img?: { canvas: HTMLCanvasElement; x: number; y: number };
  /** world anchor + bounds (radius, height in metres) for objects drawn with a draw function */
  at?: V2; box?: [number, number];
  /** redraw every frame */
  anim?: boolean;
  /** stable id for per-frame objects (vehicles, pedestrians) */
  id?: string;
  /** moving objects: the drawing only depends on this key (model, colour, heading step, lights, walk phase...).
   *  It is drawn once into a cached texture; per frame the sprite only moves (no redraw, no texture upload). */
  cacheKey?: string;
  cur?: number;
}

interface Entry { sp: Sprite; c?: HTMLCanvasElement; ctx?: CanvasRenderingContext2D; tex?: Texture; seen: number }
/** a cached actor image: texture + offset of its top-left corner from the object's ground point on screen */
interface Cached { tex: Texture; dx: number; dy: number; used: number }
const CACHE_MAX = 6000;

/** objects drawn with a draw function (vehicles, people, ducks, lamps...) are drawn ACTOR_SS times larger and reduced */
const ACTOR_SS = 3;
let ssCanvas: HTMLCanvasElement | null = null, ssCtx: CanvasRenderingContext2D | null = null;

export class PixiStage {
  app = new Application();
  world = new Container();
  private entries = new Map<Drawable | string, Entry>();
  private frame = 0;
  private texCache = new Map<HTMLCanvasElement, Texture>();
  private actorCache = new Map<string, Cached>();
  /** cached actor images created this frame (cost indicator for ?stats=1) */
  newImages = 0;

  async init(host: HTMLElement, before: Element | null, ground: HTMLCanvasElement) {
    this.weatherFx = new WeatherFx();
    await this.app.init({ width: cam.W, height: cam.H, backgroundAlpha: 0, antialias: false, autoStart: false, preference: 'webgl', autoDensity: false, resolution: 1 });
    this.app.ticker.stop();
    const cv = this.app.canvas as HTMLCanvasElement;
    cv.id = 'pixi';
    cv.style.cssText = 'position:absolute;inset:0;width:3840px;height:2160px;';
    host.insertBefore(cv, before);
    const g = new Sprite(Texture.from(ground));
    this.app.stage.addChild(g);
    this.world.sortableChildren = true;
    this.app.stage.addChild(this.world);
    this.app.stage.addChild(this.weatherFx.layer); // weather above the park, below pins and popups (2D layers)
  }
  weatherFx!: WeatherFx;
  weather: WeatherView | null = null;
  private lastT = 0;

  private waves: { sp: TilingSprite; vx: number; vy: number; pulse?: number }[] = [];
  /** animated wavelets on the open water (mask = open-water pixels from the ground render) */
  setWater(mask: { canvas: HTMLCanvasElement; x: number; y: number } | null) {
    if (!mask) return;
    const layer = new Container();
    layer.position.set(mask.x, mask.y);
    const w = mask.canvas.width, h = mask.canvas.height;
    const tileSize = Math.round(256 * cam.RS);
    const mk = (tex: HTMLCanvasElement, alpha: number, vx: number, vy: number, scaleY: number, pulse?: number) => {
      const sp = new TilingSprite({ texture: Texture.from(tex), width: w, height: h });
      sp.alpha = alpha; sp.tileScale.set(1, scaleY);
      layer.addChild(sp); this.waves.push({ sp, vx, vy, pulse });
    };
    mk(waveTile(3, tileSize, 120, '215,240,240'), 0.55, 5 * cam.RS, 1.6 * cam.RS, 0.62);
    mk(waveTile(9, Math.round(tileSize * 0.75), 90, '190,225,230'), 0.45, -3.5 * cam.RS, 2.4 * cam.RS, 0.55);
    mk(glintTile(17, tileSize), 0.9, 2 * cam.RS, -1 * cam.RS, 0.7, 1);
    const m = new Sprite(Texture.from(mask.canvas));
    layer.addChild(m); layer.mask = m;
    // between the ground and the depth-sorted world (trees, houses, vehicles stay on top)
    this.app.stage.addChildAt(layer, 1);
  }

  private texOf(c: HTMLCanvasElement) {
    let t = this.texCache.get(c);
    if (!t) { t = Texture.from(c); this.texCache.set(c, t); }
    return t;
  }

  /** screen-space box for a draw-function object */
  private boxOf(o: Drawable) {
    const [r, h] = o.box ?? [2, 2];
    const s = P(o.at!.x, o.at!.y);
    const w = Math.ceil(2 * r * cam.S) + 8;
    const up = Math.ceil(h * cam.S * cam.CE + r * cam.S * cam.SE) + 4;
    const down = Math.ceil(r * cam.S * cam.SE) + 4;
    return { x: Math.floor(s.x - w / 2), y: Math.floor(s.y - up), w, h: up + down };
  }

  private raster(e: Entry, o: Drawable, t: number) {
    const b = this.boxOf(o);
    if (!e.c || e.c.width < b.w || e.c.height < b.h) {
      e.c = document.createElement('canvas'); e.c.width = b.w; e.c.height = b.h;
      e.ctx = e.c.getContext('2d')!;
      e.tex?.destroy(true);
      e.tex = Texture.from(e.c);
      e.sp.texture = e.tex;
    }
    const ctx = e.ctx!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, e.c.width, e.c.height);
    // supersampling: draw ACTOR_SS times larger in a shared scratch canvas, then reduce into the sprite
    const k = ACTOR_SS, W = b.w * k, H = b.h * k;
    if (!ssCanvas || ssCanvas.width < W || ssCanvas.height < H) {
      ssCanvas = document.createElement('canvas'); ssCanvas.width = Math.max(W, ssCanvas?.width ?? 0); ssCanvas.height = Math.max(H, ssCanvas?.height ?? 0);
      ssCtx = ssCanvas.getContext('2d', { willReadFrequently: false })!;
    }
    const sx = ssCtx!;
    sx.setTransform(1, 0, 0, 1, 0, 0); sx.clearRect(0, 0, W, H);
    sx.setTransform(k, 0, 0, k, -b.x * k, -b.y * k);
    o.draw(sx, t);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(ssCanvas, 0, 0, W, H, 0, 0, b.w, b.h);
    e.tex!.source.update();
    e.sp.position.set(b.x, b.y);
  }

  /** draw an actor once (supersampled) into its own small texture, keyed by what it looks like */
  private cached(o: Drawable, t: number): Cached {
    let c = this.actorCache.get(o.cacheKey!);
    if (c) { c.used = this.frame; return c; }
    const b = this.boxOf(o);
    const k = ACTOR_SS, W = b.w * k, H = b.h * k;
    const big = document.createElement('canvas'); big.width = W; big.height = H;
    const bx = big.getContext('2d')!;
    bx.setTransform(k, 0, 0, k, -b.x * k, -b.y * k);
    o.draw(bx, t);
    const small = document.createElement('canvas'); small.width = b.w; small.height = b.h;
    const sx = small.getContext('2d')!;
    sx.imageSmoothingEnabled = true; sx.imageSmoothingQuality = 'high';
    sx.drawImage(big, 0, 0, b.w, b.h);
    const g = P(o.at!.x, o.at!.y);
    c = { tex: Texture.from(small), dx: b.x - g.x, dy: b.y - g.y, used: this.frame };
    this.actorCache.set(o.cacheKey!, c);
    this.newImages++;
    if (this.actorCache.size > CACHE_MAX) {
      // forget the images that were not used for the longest time
      const old = [...this.actorCache.entries()].sort((a, z) => a[1].used - z[1].used).slice(0, Math.round(CACHE_MAX * 0.2));
      for (const [key, v] of old) { if (v.used >= this.frame - 1) continue; v.tex.destroy(true); this.actorCache.delete(key); }
    }
    return c;
  }

  /** objects must already carry their eased alpha in `cur` */
  render(objs: Drawable[], t: number) {
    this.frame++;
    this.weatherFx.update(this.weather, t, this.lastT ? Math.min(0.1, t - this.lastT) : 0); this.lastT = t;
    for (const wv of this.waves) {
      wv.sp.tilePosition.set(t * wv.vx, t * wv.vy);
      if (wv.pulse) wv.sp.alpha = 0.55 + 0.4 * Math.sin(t * 1.7); // glints come and go
    }
    for (const o of objs) {
      const k = o.id ?? o;
      let e = this.entries.get(k);
      if (!e) {
        e = { sp: new Sprite(), seen: 0 };
        if (o.img) { e.sp.texture = this.texOf(o.img.canvas); e.sp.position.set(o.img.x, o.img.y); }
        else if (o.at && !o.cacheKey) this.raster(e, o, t);
        this.world.addChild(e.sp);
        this.entries.set(k, e);
      } else if (!o.img && o.at && !o.cacheKey && (o.anim || o.id)) this.raster(e, o, t);
      if (o.cacheKey && o.at) {
        // moving object: swap to the cached image for its current look, place it with sub-pixel precision
        const c = this.cached(o, t);
        if (e.sp.texture !== c.tex) e.sp.texture = c.tex;
        const g = P(o.at.x, o.at.y);
        e.sp.position.set(g.x + c.dx, g.y + c.dy);
      }
      e.seen = this.frame;
      if (e.sp.zIndex !== o.key) e.sp.zIndex = o.key;
      const a = o.cur ?? 1;
      if (e.sp.alpha !== a) e.sp.alpha = a;
      e.sp.visible = true;
    }
    // per-frame actors that left the scene
    for (const [k, e] of this.entries) {
      if (e.seen === this.frame) continue;
      if (typeof k === 'string') { e.sp.destroy(); e.tex?.destroy(true); this.entries.delete(k); } // (cached textures stay in the cache)
      else e.sp.visible = false;
    }
    this.app.render();
    // no gl.finish(): the browser paces frames with requestAnimationFrame; waiting for the GPU every frame stalled
    // the pipeline (measured 13-17 fps at 4K)
  }
}
