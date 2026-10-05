"use client";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { Race, PonySize, TailLength, Snout } from "@/lib/character-models";
import { partVisible, type ModelVisibility, type ModelLayer } from "@/lib/model-visibility";
import { ponyGeometry, type PonyGeometryData } from "@/lib/pony-geometry";
import { bindSkinPainting, configureSkinControls } from '@/lib/skin-pointer';
import type { TextureTile } from "@/lib/pony-texture";
type Props = { pixels: Uint8ClampedArray; race: Race; size: PonySize; tailLength: TailLength; snout: Snout; tool: string; visibility: ModelVisibility; layer: ModelLayer;
  onPaint: (x:number,y:number,bounds:TextureTile) => void; onStart: () => void; onEnd: () => void; reset: number };

export function PonyViewport(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const current = useRef(props); current.current = props;
  const runtime = useRef<{ texture: THREE.CanvasTexture; canvas: HTMLCanvasElement; group: THREE.Group; material: THREE.MeshLambertMaterial; controls: OrbitControls; camera: THREE.PerspectiveCamera } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const container = host.current!;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); }
    catch { setError("3D недоступно в этом браузере. Включите аппаратное ускорение или попробуйте другой браузер."); return; }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.setAttribute("aria-label", "3D-модель пони. Рисуйте левой кнопкой, вращайте с зажатой правой. Колесо приближает.");
    renderer.domElement.tabIndex = 0;
    container.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 500);
    camera.position.set(54, 27, -38);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 12, 0); controls.minDistance = 22; controls.maxDistance = 110;
    controls.maxPolarAngle = Math.PI; controls.enablePan = false;
    configureSkinControls(controls);
    const canvas = document.createElement("canvas");canvas.width = canvas.height = 64;
    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = texture.minFilter = THREE.NearestFilter;texture.generateMipmaps = false;
    texture.colorSpace = THREE.SRGBColorSpace;texture.flipY = false;
    canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(current.current.pixels), 64, 64), 0, 0);
    const material = new THREE.MeshLambertMaterial({ map: texture, alphaTest: 0.05, side: THREE.DoubleSide });
    const group = new THREE.Group();scene.add(group);
    scene.add(new THREE.HemisphereLight(0xe6f5ff, 0x506384, 2.5));
    const light = new THREE.DirectionalLight(0xffffff, 2.1);light.position.set(25, 45, -35);scene.add(light);
    const fill = new THREE.DirectionalLight(0xb6dbff, 1);fill.position.set(-25, 10, 15);scene.add(fill);
    const grid = new THREE.GridHelper(64, 16, 0x55748e, 0x29445c);scene.add(grid);
    runtime.current = { texture, canvas, group, material, controls, camera };setReady(true);
    const ray = new THREE.Raycaster();const pointer = new THREE.Vector2();
    const point = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set((event.clientX-rect.left)/rect.width*2-1, -(event.clientY-rect.top)/rect.height*2+1);
      ray.setFromCamera(pointer, camera);
      for(const mesh of group.children)mesh.visible=partVisible(current.current.visibility,mesh.userData.part,mesh.userData.layer);
      const hits = ray.intersectObjects(group.children.filter(m=>m.visible&&m.userData.layer===current.current.layer),false);
      for(const hit of hits) if(hit.uv&&hit.faceIndex!==undefined) {
        const face=hit.object.userData.faces[Math.floor(hit.faceIndex!/2)] as TextureTile;
        const x=Math.max(face.x,Math.min(face.x+face.w-1,Math.floor(hit.uv.x*64)));
        const y=Math.max(face.y,Math.min(face.y+face.h-1,Math.floor(hit.uv.y*64)));
        current.current.onStart();current.current.onPaint(x,y,face);return;
      }
    };
    const unbindPainting = bindSkinPainting(renderer.domElement, point, () => current.current.onEnd());
    const resize = new ResizeObserver(() => {
      const {width,height} = container.getBoundingClientRect();
      renderer.setSize(Math.max(1,width),Math.max(1,height));camera.aspect=Math.max(1,width)/Math.max(1,height);camera.updateProjectionMatrix();
    });resize.observe(container);
    renderer.setAnimationLoop(() => {if(!container.clientWidth)return;for(const mesh of group.children)mesh.visible=partVisible(current.current.visibility,mesh.userData.part,mesh.userData.layer);controls.update();renderer.render(scene,camera);});
    return () => {
      setReady(false);runtime.current=null;resize.disconnect();renderer.setAnimationLoop(null);unbindPainting();controls.dispose();
      scene.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();if(o.material!==material)(o.material as THREE.Material).dispose();}});
      grid.geometry.dispose();(grid.material as THREE.Material).dispose();material.dispose();texture.dispose();renderer.dispose();renderer.domElement.remove();
    };
  }, []);
  useEffect(() => {
    const r = runtime.current;if(!r)return;
    r.canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(props.pixels),64,64),0,0);
    r.texture.needsUpdate=true;
  }, [props.pixels, ready]);
  useEffect(() => {
    const r=runtime.current;if(!r)return;
    const controller=new AbortController();setLoading(true);setError("");
    for(const mesh of [...r.group.children]){r.group.remove(mesh);(mesh as THREE.Mesh).geometry.dispose();}
    fetch(`/models/geometry-v3/${props.race}-${props.size}-${props.tailLength}-${props.snout}.json`, { signal:controller.signal }).then(async response=>{
      if(!response.ok)throw new Error("Не удалось загрузить модель. Обновите страницу.");
      const data=await response.json() as PonyGeometryData;
      if(controller.signal.aborted)return;
      const groups=ponyGeometry(data);
      for(const mesh of [...r.group.children]){r.group.remove(mesh);(mesh as THREE.Mesh).geometry.dispose();}
      for(const entry of groups){
        const mesh=new THREE.Mesh(entry.geometry,r.material);mesh.userData={part:entry.part,layer:entry.layer,faces:entry.faces};
        mesh.visible=partVisible(current.current.visibility,entry.part,entry.layer);r.group.add(mesh);
      }
      setLoading(false);
    }).catch(e=>{if(!controller.signal.aborted){setError(e.message);setLoading(false);}});
    return()=>controller.abort();
  },[props.race,props.size,props.tailLength,props.snout,ready]);
  useEffect(()=>{const r=runtime.current;if(r){r.camera.position.set(54,27,-38);r.controls.target.set(0,12,0);r.controls.update();}},[props.reset]);
  return <div className="pony-viewport" ref={host} data-tool={props.tool}>
    {loading&&!error?<span className="viewport-message">Загружаем модель…</span>:null}
    {error?<span role="alert" className="viewport-message">{error}</span>:null}
    <span className="viewport-caption">{!props.visibility[props.layer].visible?'Слой рисования скрыт · включите его справа':<><span className="desktop-gesture">ЛКМ — рисовать · зажмите ПКМ и двигайте мышь — вращать · колесо — масштаб</span><span className="touch-gesture">Один палец — рисовать · два — вращать и приближать</span></>}</span>
  </div>;
}
