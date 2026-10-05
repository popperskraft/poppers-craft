"use client";
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { humanParts, humanFaces, humanUV, type HumanModel, type HumanLayer } from '@/lib/human-skin';
import { partVisible, type ModelVisibility } from '@/lib/model-visibility';
import { bindSkinPainting, configureSkinControls } from '@/lib/skin-pointer';
import type { TextureTile } from '@/lib/pony-texture';
type Props={pixels:Uint8ClampedArray;model:HumanModel;layer:HumanLayer;visibility:ModelVisibility;tool:string;reset:number;onPaint:(x:number,y:number,bounds:TextureTile)=>void;onStart:()=>void;onEnd:()=>void};
export function HumanViewport(props:Props){
  const host=useRef<HTMLDivElement>(null),current=useRef(props);current.current=props;
  const [error,setError]=useState('');
  useEffect(()=>{
    const container=host.current!;let renderer:THREE.WebGLRenderer;
    try{renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});}catch{setError('3D недоступно в этом браузере. Включите аппаратное ускорение или попробуйте другой браузер.');return;}
    renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.outputColorSpace=THREE.SRGBColorSpace;
    renderer.domElement.setAttribute('aria-label','3D-модель человека. Рисуйте левой кнопкой, вращайте с зажатой правой. Колесо приближает.');renderer.domElement.tabIndex=0;container.appendChild(renderer.domElement);
    const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(35,1,.1,500);
    camera.position.set(44,30,60);const controls=new OrbitControls(camera,renderer.domElement);controls.target.set(0,16,0);controls.enablePan=false;controls.minDistance=24;controls.maxDistance=120;
    configureSkinControls(controls);
    const canvas=document.createElement('canvas');canvas.width=canvas.height=64;const ctx=canvas.getContext('2d')!;
    const texture=new THREE.CanvasTexture(canvas);texture.flipY=false;texture.magFilter=texture.minFilter=THREE.NearestFilter;texture.generateMipmaps=false;texture.colorSpace=THREE.SRGBColorSpace;
    const baseMaterial=new THREE.MeshLambertMaterial({map:texture,side:THREE.FrontSide});
    const outerMaterial=new THREE.MeshLambertMaterial({map:texture,alphaTest:.01,transparent:true,side:THREE.DoubleSide});
    scene.add(new THREE.HemisphereLight(0xe6f5ff,0x506384,2.5));const light=new THREE.DirectionalLight(0xffffff,2.1);light.position.set(25,45,35);scene.add(light);
    const grid=new THREE.GridHelper(64,16,0x55748e,0x29445c);scene.add(grid);
    type PaintedMesh=THREE.Mesh<THREE.BoxGeometry,THREE.MeshLambertMaterial>;
    let meshes:PaintedMesh[]=[],lastModel='',lastPixels:Uint8ClampedArray|null=null,lastReset=props.reset;
    function refresh(){
      const p=current.current;
      if(lastModel!==p.model){
        for(const mesh of meshes){scene.remove(mesh);mesh.geometry.dispose();}meshes=[];
        for(const part of humanParts(p.model))for(const layer of ['base','outer'] as const){
          const pad=layer==='outer'?(part.id==='head'?1:.5):0;
          const geometry=new THREE.BoxGeometry(part.w+pad,part.h+pad,part.d+pad);geometry.setAttribute('uv',new THREE.Float32BufferAttribute(humanUV(part,layer),2));
          const mesh=new THREE.Mesh(geometry,layer==='base'?baseMaterial:outerMaterial);mesh.position.set(part.x,part.y,0);mesh.userData={part:part.id,layer,faces:humanFaces(part,layer)};meshes.push(mesh);scene.add(mesh);
        }lastModel=p.model;
      }
      if(lastPixels!==p.pixels){ctx.putImageData(new ImageData(new Uint8ClampedArray(p.pixels),64,64),0,0);texture.needsUpdate=true;lastPixels=p.pixels;}
      for(const mesh of meshes)mesh.visible=partVisible(p.visibility,mesh.userData.part,mesh.userData.layer);
      if(lastReset!==p.reset){camera.position.set(44,30,60);controls.target.set(0,16,0);controls.update();lastReset=p.reset;}
    }
    const ray=new THREE.Raycaster(),pointer=new THREE.Vector2();
    function point(event:PointerEvent){
      refresh();const rect=renderer.domElement.getBoundingClientRect();pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);ray.setFromCamera(pointer,camera);
      const p=current.current;const hit=ray.intersectObjects(meshes.filter(m=>m.visible&&m.userData.layer===p.layer),false)[0];
      if(hit?.uv&&hit.faceIndex!==undefined){
        const face=hit.object.userData.faces[Math.floor(hit.faceIndex!/2)] as TextureTile;
        const x=Math.max(face.x,Math.min(face.x+face.w-1,Math.floor(hit.uv.x*64))),y=Math.max(face.y,Math.min(face.y+face.h-1,Math.floor(hit.uv.y*64)));
        p.onStart();p.onPaint(x,y,face);
      }
    }
    const unbindPainting = bindSkinPainting(renderer.domElement, point, () => current.current.onEnd());
    const resize=new ResizeObserver(()=>{const {width,height}=container.getBoundingClientRect();renderer.setSize(Math.max(1,width),Math.max(1,height));camera.aspect=Math.max(1,width)/Math.max(1,height);camera.updateProjectionMatrix();});resize.observe(container);
    renderer.setAnimationLoop(()=>{if(!container.clientWidth)return;refresh();controls.update();renderer.render(scene,camera);});
    return()=>{resize.disconnect();renderer.setAnimationLoop(null);unbindPainting();controls.dispose();for(const mesh of meshes)mesh.geometry.dispose();grid.geometry.dispose();(grid.material as THREE.Material).dispose();baseMaterial.dispose();outerMaterial.dispose();texture.dispose();renderer.dispose();renderer.domElement.remove();};
  },[]);
  return <div className="pony-viewport human-viewport" ref={host} data-tool={props.tool}>
    {error?<span className="viewport-message" role="alert">{error}</span>:null}
    <span className="viewport-caption">{!props.visibility[props.layer].visible?'Слой рисования скрыт · включите его справа':<><span className="desktop-gesture">ЛКМ — рисовать · зажмите ПКМ и двигайте мышь — вращать · колесо — масштаб</span><span className="touch-gesture">Один палец — рисовать · два — вращать и приближать</span></>}</span>
  </div>;
}
