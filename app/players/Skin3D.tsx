"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { humanParts, humanUV, readHumanPNG, type HumanModel } from "@/lib/human-skin";
import { decodePixels, readAppearance } from "@/lib/character-models";
import { ponyGeometry, type PonyGeometryData } from "@/lib/pony-geometry";
import type { ProfilePony } from "@/lib/profile-pony";

export function Skin3D({ src, model, pony = null }: { src: string | null; model: HumanModel; pony?: ProfilePony | null }) {
  const host = useRef<HTMLDivElement>(null);
  const command = useRef<(action: string) => void>(() => {});
  const [status, setStatus] = useState("ЗАГРУЖАЕМ 3D…");
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const container = host.current!;
    const abort = new AbortController();
    let active = true, cleanScene = () => {};
    setStatus("ЗАГРУЖАЕМ 3D…");
    setFailed(false);
    async function load() {
      try {
        let pixels: Uint8ClampedArray, humanModel = model, ponyData: PonyGeometryData | null = null;
        if (pony) {
          pixels = decodePixels(pony.pixelsBase64);
          const { tailLength, snout } = readAppearance(pixels);
          const response = await fetch(`/models/geometry-v3/${pony.race}-${pony.size}-${tailLength}-${snout}.json`, { signal: abort.signal });
          if (!response.ok) throw new Error();
          ponyData = await response.json() as PonyGeometryData;
        } else {
          if (!src) throw new Error();
          const response = await fetch(src, { signal: abort.signal });
          if (!response.ok) throw new Error();
          const blob = await response.blob();
          const skin = await readHumanPNG(new Blob([blob], { type: "image/png" }), model);
          pixels = skin.pixels; humanModel = skin.model;
        }
        if (!active) return;
        let renderer: THREE.WebGLRenderer;
        try { renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false }); }
        catch { setStatus("3D недоступно в этом браузере. Включите аппаратное ускорение или попробуйте другой браузер."); setFailed(true); return; }
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        const element = renderer.domElement;
        element.tabIndex = 0;
        element.setAttribute("role", "img");
        element.setAttribute("aria-label", pony ? "3D-пони. Перетаскивайте для вращения. Стрелки вращают, плюс и минус меняют масштаб." : "3D-скин. Перетаскивайте для вращения. Стрелки вращают, плюс и минус меняют масштаб.");
        container.appendChild(element);
        const scene = new THREE.Scene(), group = new THREE.Group(); scene.add(group);
        const camera = new THREE.PerspectiveCamera(35, 1, .1, 300);
        const controls = new OrbitControls(camera, element);
        const geometries: THREE.BufferGeometry[] = [];
        const materials: THREE.Material[] = [];
        let texture: THREE.CanvasTexture | undefined;
        // Register cleanup before creating GPU resources so partial failures are safe too.
        cleanScene = () => { controls.dispose(); geometries.forEach(item => item.dispose()); materials.forEach(item => item.dispose()); texture?.dispose(); renderer.dispose(); element.remove(); };
        controls.enablePan = false; controls.enableDamping = false;
        controls.minPolarAngle = .15; controls.maxPolarAngle = Math.PI - .15;
        const canvas = document.createElement("canvas"); canvas.width = canvas.height = 64;
        canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(pixels), 64, 64), 0, 0);
        texture = new THREE.CanvasTexture(canvas);
        texture.flipY = false; texture.magFilter = texture.minFilter = THREE.NearestFilter;
        texture.generateMipmaps = false; texture.colorSpace = THREE.SRGBColorSpace;
        if (ponyData) {
          const material = new THREE.MeshLambertMaterial({ map: texture, alphaTest: .05, side: THREE.DoubleSide });
          materials.push(material);
          for (const entry of ponyGeometry(ponyData)) {
            geometries.push(entry.geometry); group.add(new THREE.Mesh(entry.geometry, material));
          }
        } else {
          const base = new THREE.MeshLambertMaterial({ map: texture });
          const outer = new THREE.MeshLambertMaterial({ map: texture, alphaTest: .1, side: THREE.DoubleSide });
          materials.push(base, outer);
          for (const part of humanParts(humanModel)) for (const layer of ["base", "outer"] as const) {
            const pad = layer === "outer" ? (part.id === "head" ? 1 : .5) : 0;
            const geometry = new THREE.BoxGeometry(part.w + pad, part.h + pad, part.d + pad);
            geometries.push(geometry); geometry.setAttribute("uv", new THREE.Float32BufferAttribute(humanUV(part, layer), 2));
            const mesh = new THREE.Mesh(geometry, layer === "base" ? base : outer);
            mesh.position.set(part.x, part.y, 0); group.add(mesh);
          }
        }
        // Fit both tall humans and wide ponies, including wings and all eight sizes.
        const bounds = new THREE.Box3().setFromObject(group);
        const center = bounds.getCenter(new THREE.Vector3());
        const radius = Math.max(1, bounds.getBoundingSphere(new THREE.Sphere()).radius);
        const direction = (pony ? new THREE.Vector3(54, 15, -38) : new THREE.Vector3(30, 6, 60)).normalize();
        let initialDistance = 70, userZoom = 1;
        const placeCamera = () => {
          const offset = camera.position.clone().sub(controls.target);
          if (offset.lengthSq() < .01) offset.copy(direction);
          controls.target.copy(center);
          camera.position.copy(center).add(offset.setLength(initialDistance * userZoom));
          controls.update();
        };
        const reset = () => { userZoom = 1; controls.target.copy(center); camera.position.copy(center).add(direction.clone().multiplyScalar(initialDistance)); group.rotation.y = 0; controls.update(); };
        reset();
        scene.add(new THREE.HemisphereLight(0xffffff, 0x667788, 2));
        const light = new THREE.DirectionalLight(0xffffff, 1.8); light.position.set(20, 40, pony ? -40 : 40); scene.add(light);
        const render = () => { if (active && container.clientWidth) renderer.render(scene, camera); };
        controls.addEventListener("change", render);
        command.current = action => {
          if (action === "reset") reset();
          else if (action === "left" || action === "right") group.rotation.y += action === "left" ? -.35 : .35;
          else { const offset = camera.position.clone().sub(controls.target); const distance = THREE.MathUtils.clamp(offset.length() * (action === "in" ? .9 : 1.1), controls.minDistance, controls.maxDistance); camera.position.copy(controls.target).add(offset.setLength(distance)); controls.update(); }
          render();
        };
        const keydown = (event: KeyboardEvent) => {
          const action = ({ ArrowLeft: "left", ArrowRight: "right", "+": "in", "=": "in", "-": "out", Home: "reset" } as Record<string, string>)[event.key];
          if (action) { event.preventDefault(); command.current(action); }
        };
        const lost = (event: Event) => { event.preventDefault(); command.current = () => {}; setStatus("Просмотр 3D прервался. Попробуйте ещё раз."); setFailed(true); };
        element.addEventListener("keydown", keydown); element.addEventListener("webglcontextlost", lost);
        const resize = new ResizeObserver(() => {
          const width = Math.max(1, container.clientWidth), height = Math.max(1, container.clientHeight);
          userZoom = THREE.MathUtils.clamp(camera.position.distanceTo(controls.target) / initialDistance, .5, 2.5);
          renderer.setSize(width, height); camera.aspect = width / height; camera.updateProjectionMatrix(); render();
          const halfFov = Math.min(THREE.MathUtils.degToRad(camera.fov / 2), Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect));
          initialDistance = radius / Math.sin(halfFov) * 1.12;
          controls.minDistance = initialDistance * .5; controls.maxDistance = initialDistance * 2.5;
          camera.far = Math.max(300, initialDistance * 4); camera.updateProjectionMatrix(); placeCamera(); render();
        }); resize.observe(container);
        const disposeResources = cleanScene;
        cleanScene = () => { resize.disconnect(); element.removeEventListener("keydown", keydown); element.removeEventListener("webglcontextlost", lost); disposeResources(); };
        setStatus(""); render();
      } catch { if (active) { cleanScene(); cleanScene = () => {}; command.current = () => {}; setStatus("Не удалось загрузить 3D-модель. Попробуйте ещё раз."); setFailed(true); } }
    }
    void load();
    return () => { active = false; abort.abort(); command.current = () => {}; cleanScene(); };
  }, [src, model, pony, attempt]);
  return <div className="skin-3d-view">
    <div className="skin-3d-canvas" ref={host}>{status ? <p role="status">{status}</p> : null}</div>
    {failed ? <button className="skin-3d-retry" type="button" onClick={() => setAttempt(value => value + 1)}>ПОВТОРИТЬ</button> : null}
  </div>;
}
