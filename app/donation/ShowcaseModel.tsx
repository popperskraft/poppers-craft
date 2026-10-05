"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { humanParts, humanUV, readHumanPNG } from "@/lib/human-skin";
import { decodePixels, readAppearance, type PonySize, type Race } from "@/lib/character-models";
import { ponyGeometry, type PonyGeometryData } from "@/lib/pony-geometry";

/* 3D-модель для витрины доната: настоящий скин игрока или его пони.
   Модель не вращается мышью, а сама «смотрит» за курсором: голова
   поворачивается сильнее, корпус — чуть-чуть. Рисуем только пока что-то
   движется и пока модель на экране. */

type PonySnapshot = { pixelsBase64: string; race: Race; size: PonySize };

const HUMAN_SKIN = "/donation/showcase/human-skin.png";
const PONY_DATA = "/donation/showcase/pony.json";
const MAX_YAW = 0.85;
const MAX_PITCH = 0.45;
const BODY_SHARE = 0.3;
const EASE = 0.12;

export function ShowcaseModel({ kind, label }: { kind: "human" | "pony"; label: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");

  useEffect(() => {
    const container = host.current;
    if (!container) return;
    const abort = new AbortController();
    let active = true;
    let dispose = () => {};

    async function load() {
      let pixels: Uint8ClampedArray;
      let ponyData: PonyGeometryData | null = null;
      if (kind === "pony") {
        const snapshot = await (await fetch(PONY_DATA, { signal: abort.signal })).json() as PonySnapshot;
        pixels = decodePixels(snapshot.pixelsBase64);
        const { tailLength, snout } = readAppearance(pixels);
        const response = await fetch(`/models/geometry-v3/${snapshot.race}-${snapshot.size}-${tailLength}-${snout}.json`, { signal: abort.signal });
        if (!response.ok) throw new Error("geometry");
        ponyData = await response.json() as PonyGeometryData;
      } else {
        const response = await fetch(HUMAN_SKIN, { signal: abort.signal });
        if (!response.ok) throw new Error("skin");
        const skin = await readHumanPNG(new Blob([await response.blob()], { type: "image/png" }), "classic");
        pixels = skin.pixels;
      }
      if (!active || !container) return;

      const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      const canvasElement = renderer.domElement;
      canvasElement.setAttribute("aria-hidden", "true");
      container.appendChild(canvasElement);

      const scene = new THREE.Scene();
      const body = new THREE.Group();
      const head = new THREE.Group();
      head.rotation.order = "YXZ";
      scene.add(body);
      const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 400);
      const geometries: THREE.BufferGeometry[] = [];
      const materials: THREE.Material[] = [];

      const texCanvas = document.createElement("canvas");
      texCanvas.width = texCanvas.height = 64;
      texCanvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(pixels), 64, 64), 0, 0);
      const texture = new THREE.CanvasTexture(texCanvas);
      texture.flipY = false;
      texture.magFilter = texture.minFilter = THREE.NearestFilter;
      texture.generateMipmaps = false;
      texture.colorSpace = THREE.SRGBColorSpace;

      const pivot = new THREE.Vector3();
      // Куда смотрит лицо модели: человек — к +Z, пони — к −Z.
      const facing = ponyData ? -1 : 1;
      if (ponyData) {
        const material = new THREE.MeshLambertMaterial({ map: texture, alphaTest: 0.05, side: THREE.DoubleSide });
        materials.push(material);
        const headBox = new THREE.Box3();
        const headMeshes: THREE.Mesh[] = [];
        for (const entry of ponyGeometry(ponyData)) {
          geometries.push(entry.geometry);
          const mesh = new THREE.Mesh(entry.geometry, material);
          if (entry.part === "head" || entry.part === "horn") {
            headMeshes.push(mesh);
            if (entry.part === "head" && entry.layer === "base") headBox.union(entry.geometry.boundingBox!);
          } else body.add(mesh);
        }
        // Шея — у нижнего заднего края головы.
        const size = headBox.getSize(new THREE.Vector3());
        pivot.set((headBox.min.x + headBox.max.x) / 2, headBox.min.y, headBox.max.z - size.z * 0.2);
        headMeshes.forEach((mesh) => { mesh.position.sub(pivot); head.add(mesh); });
      } else {
        const base = new THREE.MeshLambertMaterial({ map: texture });
        const outer = new THREE.MeshLambertMaterial({ map: texture, alphaTest: 0.1, side: THREE.DoubleSide });
        materials.push(base, outer);
        for (const part of humanParts("classic")) {
          if (part.id === "head") pivot.set(part.x, part.y - part.h / 2, 0);
          for (const layer of ["base", "outer"] as const) {
            const pad = layer === "outer" ? (part.id === "head" ? 1 : 0.5) : 0;
            const geometry = new THREE.BoxGeometry(part.w + pad, part.h + pad, part.d + pad);
            geometry.setAttribute("uv", new THREE.Float32BufferAttribute(humanUV(part, layer), 2));
            geometries.push(geometry);
            const mesh = new THREE.Mesh(geometry, layer === "base" ? base : outer);
            mesh.position.set(part.x, part.y, 0);
            if (part.id === "head") { mesh.position.sub(pivot); head.add(mesh); } else body.add(mesh);
          }
        }
      }
      head.position.copy(pivot);
      body.add(head);

      const bounds = new THREE.Box3().setFromObject(body);
      const center = bounds.getCenter(new THREE.Vector3());
      const radius = Math.max(1, bounds.getBoundingSphere(new THREE.Sphere()).radius);
      const direction = (ponyData ? new THREE.Vector3(30, 12, -58) : new THREE.Vector3(20, 6, 60)).normalize();
      scene.add(new THREE.HemisphereLight(0xffffff, 0x667788, 2));
      const light = new THREE.DirectionalLight(0xffffff, 1.8);
      light.position.set(20, 40, 40 * facing);
      scene.add(light);

      const fit = () => {
        const width = Math.max(1, container.clientWidth);
        const height = Math.max(1, container.clientHeight);
        renderer.setSize(width, height);
        camera.aspect = width / height;
        const halfFov = Math.min(THREE.MathUtils.degToRad(camera.fov / 2), Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect));
        const distance = radius / Math.sin(halfFov) * 1.02;
        camera.position.copy(center).addScaledVector(direction, distance);
        camera.lookAt(center);
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld();
      };

      // Цель взгляда и текущее положение (сглаживаем, чтобы не дёргалось).
      const target = { yaw: 0, pitch: 0 };
      const current = { yaw: 0, pitch: 0 };
      const raycaster = new THREE.Raycaster();
      const plane = new THREE.Plane();
      const hit = new THREE.Vector3();
      const ndc = new THREE.Vector2();
      let pointer: { x: number; y: number } | null = null;
      let visible = true;
      let raf = 0;

      // Без курсора модель смотрит в камеру.
      const aim = () => {
        if (pointer) {
          const rect = container.getBoundingClientRect();
          if (!rect.width || !rect.height) return;
          ndc.set(
            THREE.MathUtils.clamp(((pointer.x - rect.left) / rect.width) * 2 - 1, -6, 6),
            THREE.MathUtils.clamp(-(((pointer.y - rect.top) / rect.height) * 2 - 1), -6, 6),
          );
          raycaster.setFromCamera(ndc, camera);
          plane.setFromNormalAndCoplanarPoint(camera.position.clone().sub(pivot).normalize(), pivot);
          if (!raycaster.ray.intersectPlane(plane, hit)) return;
          // Точка чуть ближе к зрителю: курсор над моделью — модель смотрит на нас.
          hit.lerp(camera.position, 0.45);
        } else {
          hit.copy(camera.position);
        }
        const look = hit.sub(pivot).normalize();
        target.yaw = THREE.MathUtils.clamp(Math.atan2(look.x * facing, look.z * facing), -MAX_YAW, MAX_YAW);
        target.pitch = THREE.MathUtils.clamp(-facing * Math.asin(THREE.MathUtils.clamp(look.y, -1, 1)), -MAX_PITCH, MAX_PITCH);
      };

      const frame = () => {
        raf = 0;
        current.yaw += (target.yaw - current.yaw) * EASE;
        current.pitch += (target.pitch - current.pitch) * EASE;
        body.rotation.y = current.yaw * BODY_SHARE;
        head.rotation.y = current.yaw * (1 - BODY_SHARE);
        head.rotation.x = current.pitch;
        renderer.render(scene, camera);
        const moving = Math.abs(target.yaw - current.yaw) > 0.0005 || Math.abs(target.pitch - current.pitch) > 0.0005;
        if (moving && visible) raf = requestAnimationFrame(frame);
      };
      const kick = () => { if (!raf && visible) raf = requestAnimationFrame(frame); };

      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const move = (event: PointerEvent) => {
        pointer = { x: event.clientX, y: event.clientY };
        aim();
        kick();
      };
      const leave = () => { pointer = null; aim(); kick(); };
      if (!reduce) {
        window.addEventListener("pointermove", move, { passive: true });
        window.addEventListener("pointerdown", move, { passive: true });
        document.documentElement.addEventListener("mouseleave", leave);
      }
      const onScroll = () => { if (pointer) { aim(); kick(); } };
      window.addEventListener("scroll", onScroll, { passive: true });

      const resize = new ResizeObserver(() => { fit(); aim(); kick(); renderer.render(scene, camera); });
      resize.observe(container);
      const seen = new IntersectionObserver(([entry]) => {
        visible = entry.isIntersecting;
        if (visible) kick();
      });
      seen.observe(container);
      const lost = (event: Event) => { event.preventDefault(); if (active) setStatus("failed"); };
      canvasElement.addEventListener("webglcontextlost", lost);

      dispose = () => {
        cancelAnimationFrame(raf);
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerdown", move);
        document.documentElement.removeEventListener("mouseleave", leave);
        window.removeEventListener("scroll", onScroll);
        canvasElement.removeEventListener("webglcontextlost", lost);
        resize.disconnect();
        seen.disconnect();
        geometries.forEach((item) => item.dispose());
        materials.forEach((item) => item.dispose());
        texture.dispose();
        renderer.dispose();
        canvasElement.remove();
      };
      fit();
      aim();
      current.yaw = target.yaw;
      current.pitch = target.pitch;
      frame();
      setStatus("ready");
    }

    load().catch(() => {
      if (!active) return;
      dispose();
      dispose = () => {};
      setStatus("failed");
    });
    return () => {
      active = false;
      abort.abort();
      dispose();
    };
  }, [kind]);

  return (
    <div className="dp-model" ref={host} role="img" aria-label={label}>
      {status === "loading" ? <p className="dp-model-note" role="status">ЗАГРУЖАЕМ 3D…</p> : null}
      {status === "failed" ? <p className="dp-model-note">3D недоступно в этом браузере.</p> : null}
    </div>
  );
}
