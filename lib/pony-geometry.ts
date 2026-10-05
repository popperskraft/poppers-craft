import * as THREE from 'three';
import type { ModelLayer, ModelPartId } from './model-visibility';
import type { TextureTile } from './pony-texture';
export type PonyGeometryData = {scale:number;groups:{part:ModelPartId;layer:ModelLayer;vertices:number[][]}[]};

export function ponyGeometry(data:PonyGeometryData) {
  const box=new THREE.Box3();
  const groups=data.groups.map(group=>{
    const positions:number[]=[],uv:number[]=[],faces:TextureTile[]=[];
    for(let i=0;i<group.vertices.length;i+=4){
      const quad=group.vertices.slice(i,i+4);
      const x=Math.round(Math.min(...quad.map(v=>v[3]))*64),y=Math.round(Math.min(...quad.map(v=>v[4]))*64);
      faces.push({label:group.part,x,y,w:Math.max(1,Math.round(Math.max(...quad.map(v=>v[3]))*64)-x),h:Math.max(1,Math.round(Math.max(...quad.map(v=>v[4]))*64)-y),dx:0,dy:0});
      for(const n of [0,1,2,0,2,3]){
        const v=quad[n];positions.push(v[0]*16*data.scale,-v[1]*16*data.scale,v[2]*16*data.scale);uv.push(v[3],v[4]);
      }
    }
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geometry.computeVertexNormals();geometry.computeBoundingBox();box.union(geometry.boundingBox!);
    return {part:group.part,layer:group.layer,geometry,faces};
  });
  // Use the complete model's anchor; hiding parts must never move the remaining ones.
  const center=box.getCenter(new THREE.Vector3());
  for(const group of groups)group.geometry.translate(-center.x,-box.min.y,-center.z);
  return groups;
}
