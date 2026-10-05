const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),THREE=require('three');
function moduleAt(path){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Uint8ClampedArray,require:n=>n==='three'?THREE:undefined});return exports;}
const visibility=moduleAt('lib/model-visibility.ts'),geometry=moduleAt('lib/pony-geometry.ts');
const directory='public/models/geometry-v3';
test('parts are independent in each layer and survive global layer toggles',()=>{
  const initial=visibility.allVisible();let state=visibility.togglePart(initial,'head','outer');
  assert.equal(visibility.partVisible(state,'head','base'),true);assert.equal(visibility.partVisible(state,'head','outer'),false);
  assert.equal(visibility.partVisible(state,'leftArm','outer'),true);assert.equal(initial.outer.hidden.length,0);
  state={...state,base:{...state.base,visible:false}};assert.equal(visibility.partVisible(state,'body','base'),false);assert.equal(visibility.partVisible(state,'body','outer'),true);
  state={...state,base:{...state.base,visible:true}};assert.equal(visibility.partVisible(state,'body','base'),true);assert.equal(visibility.partVisible(state,'head','outer'),false);
});
test('every pony variant retains exactly the old geometry, assigned once to a supported part and layer',()=>{
  const files=fs.readdirSync(directory);assert.equal(files.length,320);
  for(const file of files){
    const current=JSON.parse(fs.readFileSync(`${directory}/${file}`)),old=JSON.parse(fs.readFileSync(`public/models/geometry-v2/${file}`));
    assert.equal(current.scale,old.scale);const parts=visibility.visibilityParts('pony',file.split('-')[0]);const groups=new Set();
    for(const group of current.groups){const key=group.part+'/'+group.layer;assert.ok(!groups.has(key),`${file}: duplicate ${key}`);groups.add(key);
      const part=parts.find(p=>p.id===group.part);assert.ok(part,`${file}: unhandled ${group.part}`);assert.ok(group.layer==='base'||group.layer==='outer'&&part.outer);assert.equal(group.vertices.length%4,0);
    }
    assert.deepEqual(current.groups.flatMap(g=>g.vertices).map(v=>JSON.stringify(v)).sort(),old.vertices.map(v=>JSON.stringify(v)).sort(),file);
    for(const part of parts.filter(p=>p.outer))assert.ok(groups.has(part.id+'/outer'),`${file}: missing outer ${part.id}`);
  }
});
test('pony triangles keep face bounds inside the PNG and share one stable ground anchor',()=>{
  for(const file of fs.readdirSync(directory)){
    const data=JSON.parse(fs.readFileSync(`${directory}/${file}`)),groups=geometry.ponyGeometry(data),box=new THREE.Box3();
    for(const group of groups){assert.equal(group.geometry.attributes.position.count,group.faces.length*6);group.geometry.computeBoundingBox();box.union(group.geometry.boundingBox);
      for(const f of group.faces)assert.ok(f.x>=0&&f.y>=0&&f.x+f.w<=64&&f.y+f.h<=64,`${file}: ${JSON.stringify(f)}`);
      group.geometry.dispose();
    }
    assert.ok(Math.abs(box.min.y)<1e-4,file);assert.ok(Math.abs(box.min.x+box.max.x)<1e-4,file);assert.ok(Math.abs(box.min.z+box.max.z)<1e-4,file);
  }
});
test('hiding pony body parts and layers excludes them from painting rays without changing geometry or pixels',()=>{
  const data=JSON.parse(fs.readFileSync(`${directory}/alicorn-normal-full-rounded.json`)),groups=geometry.ponyGeometry(data);
  const material=new THREE.MeshBasicMaterial({side:THREE.DoubleSide}),meshes=groups.map(g=>{const m=new THREE.Mesh(g.geometry,material);m.userData=g;m.updateMatrixWorld();return m;});
  const head=meshes.find(m=>m.userData.part==='head'&&m.userData.layer==='outer'),center=head.geometry.boundingBox.getCenter(new THREE.Vector3());
  const ray=new THREE.Raycaster(center.clone().add(new THREE.Vector3(0,0,-100)),new THREE.Vector3(0,0,1));
  const state=visibility.allVisible(),target=layer=>meshes.filter(m=>m.userData.layer===layer&&visibility.partVisible(state,m.userData.part,layer));
  assert.ok(ray.intersectObjects(target('outer'),false).some(h=>h.object===head),'empty outer surfaces remain paintable');
  state.outer.hidden.push('head');assert.ok(ray.intersectObjects(target('outer'),false).every(h=>h.object!==head));
  assert.ok(ray.intersectObjects(target('base'),false).some(h=>h.object.userData.part==='head'));
  state.base.visible=false;assert.equal(ray.intersectObjects(target('base'),false).length,0);
  groups.forEach(g=>g.geometry.dispose());material.dispose();
});
