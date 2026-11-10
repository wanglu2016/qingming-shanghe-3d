import * as THREE from 'three';
import { mergeGeometries } from './vendor/BufferGeometryUtils.js';

const $ = s => document.querySelector(s);
const app = $('#app'), mount = $('#world');
const TAU = Math.PI * 2;
let seed = 7391;
function rand(a=0,b=1){seed=(seed*1664525+1013904223)>>>0;return a+(seed/4294967296)*(b-a)}
const pick=a=>a[Math.floor(rand(0,a.length))];
const clamp=THREE.MathUtils.clamp;
const ink='#605643', dark='#514b3d';
const scene=new THREE.Scene();
scene.background=new THREE.Color('#ded1b1');scene.fog=new THREE.Fog('#ded1b1',190,490);
let renderer;
try{renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});}catch(e){$('#fatal').classList.remove('hidden');throw e;}
renderer.setPixelRatio(Math.min(devicePixelRatio,1.6));renderer.setSize(innerWidth,innerHeight);
renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.setClearColor('#ded1b1');mount.appendChild(renderer.domElement);
scene.add(new THREE.HemisphereLight('#fff4d9','#c1b192',1.15));
const sun=new THREE.DirectionalLight('#fff6d9',.65);sun.position.set(-80,160,70);scene.add(sun);
const perspective=new THREE.PerspectiveCamera(53,innerWidth/innerHeight,.15,600);
const ortho=new THREE.OrthographicCamera();
let camera=ortho,mode='view',started=false,reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
let modalOpen=false,selectedPlace=1,boatRide=false,nearest=null;
const player={x:-48,z:-39,y:2.4,yaw:Math.PI,pitch:-.04};
const view={target:new THREE.Vector3(-4,0,-12),yaw:.25,pitch:.66,zoom:190};
let viewTween=null;
const staticBuckets=new Map(),lineBuckets=new Map(),obstacles=[],people=[],boats=[],sails=[],animatedTrees=[];
const baseBox=new THREE.BoxGeometry(1,1,1),matrix=new THREE.Matrix4();
const materials={};

function canvasTexture(w,h,fn){const c=document.createElement('canvas');c.width=w;c.height=h;fn(c.getContext('2d'),w,h);const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.wrapS=t.wrapT=THREE.RepeatWrapping;return t;}
const roofTex=canvasTexture(256,256,(c,w,h)=>{
 c.fillStyle='#a29b83';c.fillRect(0,0,w,h);
 for(let y=0;y<256;y+=16){for(let x=-8;x<260;x+=16){c.strokeStyle=`rgba(64,62,48,${rand(.18,.4)})`;c.lineWidth=rand(.6,1.1);c.beginPath();c.moveTo(x,y);c.quadraticCurveTo(x+7,y+7,x+16,y);c.stroke();c.strokeStyle='#d7c9a355';c.beginPath();c.moveTo(x+2,y+1);c.lineTo(x+2,y+14);c.stroke();}}
 for(let i=0;i<1800;i++){c.fillStyle=`rgba(66,55,37,${rand(.01,.06)})`;c.fillRect(rand(0,256),rand(0,256),rand(1,4),1);}
});
const plasterTex=canvasTexture(256,256,(c,w,h)=>{c.fillStyle='#e0cfaa';c.fillRect(0,0,w,h);for(let i=0;i<4800;i++){c.fillStyle=pick(['#705e3020','#ffffff20','#97835b16']);c.fillRect(rand(0,w),rand(0,h),rand(1,3),rand(1,3));}for(let i=0;i<40;i++){c.strokeStyle='#937d4c18';c.beginPath();c.moveTo(rand(0,w),rand(0,h));c.lineTo(rand(0,w),rand(0,h));c.stroke();}});
const groundTex=canvasTexture(1024,1024,(c,w,h)=>{c.fillStyle='#dacaaa';c.fillRect(0,0,w,h);for(let i=0;i<16000;i++){c.fillStyle=pick(['#6b5b3520','#f4ebd126','#9a8b641a']);c.fillRect(rand(0,w),rand(0,h),rand(1,6),rand(.4,1.5));}for(let i=0;i<260;i++){let x=rand(0,w),y=rand(0,h),r=rand(15,90);const g=c.createRadialGradient(x,y,0,x,y,r);g.addColorStop(0,'#9d8a5d12');g.addColorStop(1,'#9d8a5d00');c.fillStyle=g;c.fillRect(x-r,y-r,r*2,r*2);}});groundTex.repeat.set(9,9);
function mat(key,color=key,extra={}){if(!materials[key])materials[key]=new THREE.MeshLambertMaterial({color,...extra});return materials[key];}
mat('roof','#b6ad91',{map:roofTex,side:THREE.DoubleSide});mat('wall','#efdfba',{map:plasterTex});mat('ground','#e5d3ac',{map:groundTex});
mat('road','#cfbd96');mat('water','#aeb19a');mat('wood','#a18b65');mat('beam','#6d624d');mat('shade','#7d705a',{transparent:true,opacity:.12,depthWrite:false});
function geom(geometry,material,pos=[0,0,0],rot=[0,0,0],scale=[1,1,1],parent=null,outline=false){
 const m=typeof material==='string'?(materials[material]||mat(material)):material;
 const mx=new THREE.Matrix4().compose(new THREE.Vector3(...pos),new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)),new THREE.Vector3(...scale));
 if(parent){const mesh=new THREE.Mesh(geometry,m);mesh.applyMatrix4(mx);parent.add(mesh);if(outline){const edge=new THREE.LineSegments(new THREE.EdgesGeometry(geometry,25),new THREE.LineBasicMaterial({color:ink,transparent:true,opacity:.6}));edge.applyMatrix4(mx);parent.add(edge);}return mesh;}
 const g=geometry.clone().applyMatrix4(mx);
 const ng=g.index?g.toNonIndexed():g;
 if(!ng.getAttribute('uv'))ng.setAttribute('uv',new THREE.Float32BufferAttribute(new Float32Array(ng.getAttribute('position').count*2),2));
 if(!staticBuckets.has(m))staticBuckets.set(m,[]);staticBuckets.get(m).push(ng);
 if(outline){const edge=new THREE.EdgesGeometry(g,25);const p=edge.getAttribute('position').array;lines(Array.from(p),ink,.57);edge.dispose();}
 return null;
}
function box(x,y,z,w,h,d,m='wood',outline=true,parent=null){return geom(baseBox,m,[x,y,z],[0,0,0],[w,h,d],parent,outline);}
function lines(points,color=ink,opacity=.55){const key=color+'|'+opacity;if(!lineBuckets.has(key))lineBuckets.set(key,{points:[],color,opacity});lineBuckets.get(key).points.push(...points);}
function line(points,color=ink,opacity=.55,parent=null){if(parent){const geo=new THREE.BufferGeometry().setFromPoints(points.map(p=>new THREE.Vector3(...p)));const l=new THREE.Line(geo,new THREE.LineBasicMaterial({color,transparent:true,opacity}));parent.add(l);return l;}const pts=[];for(let i=1;i<points.length;i++)pts.push(...points[i-1],...points[i]);lines(pts,color,opacity);}
function beam(a,b,r=.16,m='beam',parent=null){let av=new THREE.Vector3(...a),bv=new THREE.Vector3(...b),d=bv.clone().sub(av);const q=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),d.clone().normalize());const e=new THREE.Euler().setFromQuaternion(q);return geom(new THREE.CylinderGeometry(r*.85,r,d.length(),5),m,av.add(bv).multiplyScalar(.5).toArray(),[e.x,e.y,e.z],[1,1,1],parent,false);}
function surface(vertices,indices,m,uvs=null,parent=null){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));if(indices)g.setIndex(indices);if(uvs)g.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));g.computeVertexNormals();geom(g,m,[0,0,0],[0,0,0],[1,1,1],parent);return g;}
function flatShape(points,y,m){const s=new THREE.Shape();points.forEach((p,i)=>i?s.lineTo(p[0],p[1]):s.moveTo(p[0],p[1]));const g=new THREE.ShapeGeometry(s);g.rotateX(Math.PI/2);g.translate(0,y,0);geom(g,m);}
const riverZ=x=>Math.sin(x*.014)*12+Math.sin(x*.033)*3;
function land(){
 geom(new THREE.PlaneGeometry(850,650),'ground',[0,-.09,0],[-Math.PI/2,0,0]);
 const verts=[],idx=[],uv=[];
 for(let i=0;i<=120;i++){let x=-300+i*5,z=riverZ(x);verts.push(x,.015,z-24,x,.015,z+24);uv.push(i/5,0,i/5,1);if(i<120){let j=i*2;idx.push(j,j+1,j+2,j+1,j+3,j+2);}}
 surface(verts,idx,'water',uv);
 for(const side of [-1,1]){const bank=[];for(let x=-290;x<=290;x+=3)bank.push([x,.12,riverZ(x)+side*(24+rand(-.35,.35))]);line(bank,'#776e51',.7);for(let i=0;i<370;i++){let x=rand(-250,250),z=riverZ(x)+side*rand(24.3,27);line([[x,.04,z],[x+rand(.2,1.6),.04,z+rand(-.5,.5)]],'#857857',.3);}}
 for(let i=0;i<1850;i++){let x=rand(-270,270),z=riverZ(x)+rand(-22.5,22.5),l=rand(.3,3);line([[x,.09,z],[x+l*.5,.09,z+.08],[x+l,.09,z]],'#777e65',.23);}
 for(const z of [-55,58]){box(0,.005,z,460,.07,15,'road',false);for(let j=0;j<3;j++)line([[-235,.06,z-4+j*4],[230,.06,z-4+j*4]],'#a7926a',.24);}
 for(const x of [-150,-48,25,112])box(x,.012,-89,12,.08,130,'road',false);
 for(const x of [-150,-48,25])box(x,.012,86,12,.08,62,'road',false);
 // Light broken paving and cart tracks keep roads hand drawn.
 for(let i=0;i<360;i++){const x=rand(-230,225),z=pick([-55,58])+rand(-6.8,6.8);line([[x,.06,z],[x+rand(.3,2),.06,z+.08]],'#a08c66',.32);}
}

function roof(x,z,w,d,y,h,parent=null){
 const vertices=[],uv=[],indices=[],n=7;
 // Gently lifted eaves and a long, unbroken ridge; no pagoda silhouettes.
 for(let i=0;i<=n;i++){const t=i/n;let zz=-d/2+t*d;let yy=y+h*Math.pow(1-Math.abs(t*2-1),.76)+.22*Math.pow(Math.abs(t*2-1),10);vertices.push(x-w/2,yy,z+zz,x+w/2,yy,z+zz);uv.push(0,t*2,w/7,t*2);if(i<n){let k=i*2;indices.push(k,k+2,k+1,k+1,k+2,k+3);}}
 surface(vertices,indices,'roof',uv,parent);
 for(const side of [-1,1]){const ps=[];for(let i=0;i<=n;i++){let t=i/n;ps.push([x+side*w/2,y+h*Math.pow(1-Math.abs(t*2-1),.76)+.22*Math.pow(Math.abs(t*2-1),10),z-d/2+t*d]);}line(ps,ink,.72,parent);}
 for(const s of [-1,1])beam([x-w/2,y+.2,z+s*d/2],[x+w/2,y+.2,z+s*d/2],.09,'beam',parent);
 beam([x-w/2-.15,y+h,z],[x+w/2+.15,y+h,z],.11,'beam',parent);
 for(let i=0;i<Math.floor(w/.7);i++){const xx=x-w/2+i*.7;const p=[];for(let j=0;j<=n;j++){let t=j/n;p.push([xx,y+h*Math.pow(1-Math.abs(t*2-1),.76)+.23*Math.pow(Math.abs(t*2-1),10)+.025,z-d/2+t*d]);}line(p,'#6b6551',.34,parent);}
 // Gable infill, visible wood structure.
 for(const s of [-1,1]){surface([x+s*(w/2-.12),y,z-d*.39,x+s*(w/2-.12),y+h-.15,z,x+s*(w/2-.12),y,z+d*.39],null,'wall',null,parent);}
}

const textTextures=new Map();
function textPanel(text,x,y,z,w,h,front=1,parent=null,bg='#e1d2ac',color='#514936'){
 const key=text+bg+color;if(!textTextures.has(key)){const t=canvasTexture(256,256,(c)=>{c.fillStyle=bg;c.fillRect(0,0,256,256);c.strokeStyle='#806949';c.lineWidth=3;c.strokeRect(5,5,246,246);c.fillStyle=color;c.textAlign='center';c.textBaseline='middle';const vertical=h>w*1.25;c.font=`${vertical?Math.min(112,220/text.length):Math.min(90,220/text.length)}px 'Noto Serif CJK SC','Songti SC',serif`;[...text].forEach((s,i)=>{if(vertical)c.fillText(s,128,128+(i-(text.length-1)/2)*Math.min(110,220/text.length));else c.fillText(s,128+(i-(text.length-1)/2)*Math.min(90,220/text.length),128);});});textTextures.set(key,new THREE.MeshBasicMaterial({map:t,side:THREE.DoubleSide}));}
 geom(new THREE.PlaneGeometry(w,h),textTextures.get(key),[x,y,z],[0,front===1?0:Math.PI,0],[1,1,1],parent);
}

function building(x,z,w=12,d=10,h=5.8,options={}){
 const {two=false,front=1,label,open=false}=options;
 const height=two?h*1.7:h;
 box(x,.18,z,w+1,.36,d+1,'#b7a483');box(x,height/2+.4,z,w,height,d,'wall');
 // Dark timber framing, lattice windows, open shop bays.
 const fz=z+front*(d/2+.03),cols=Math.max(2,Math.round(w/3));
 for(let i=0;i<=cols;i++)box(x-w/2+i*w/cols,height/2+.4,fz,.15,height,.16,'beam',false);
 for(const y of [.6,h*.68,height+.3])box(x,y,fz,w,.13,.2,'beam',false);
 if(two)box(x,h+.2,fz,w,.22,.35,'wood');
 for(let i=0;i<cols;i++){let xx=x-w/2+(i+.5)*w/cols;
  if(i===Math.floor(cols/2)||open){box(xx,1.65,fz+front*.03,w/cols-.35,2.6,.06,'#68604d',false);if(open){box(xx,1.3,fz+front*.5,w/cols-.2,.18,1.2,'wood');}}
  else{box(xx,2.9,fz+front*.04,w/cols-.65,2.1,.07,'#ad9f7f',false);for(let j=0;j<4;j++)box(xx-(w/cols-.8)/2+j*(w/cols-.8)/3,2.9,fz+front*.11,.07,2.1,.08,'beam',false);box(xx,2.9,fz+front*.12,w/cols-.55,.08,.08,'beam',false);}
  if(two){box(xx,h+2.1,fz+front*.1,w/cols-.6,1.7,.07,'#b8ad8e',false);for(let j=0;j<4;j++)box(xx-.9+j*.6,h+2.1,fz+front*.16,.06,1.7,.05,'beam',false);box(xx,h+2.1,fz+front*.16,w/cols-.6,.06,.05,'beam',false);}
 }
 for(const s of [-1,1]){box(x+s*w/2,height/2+.4,z,.17,height,d,'wood',false);for(let j=1;j<3;j++)line([[x+s*(w/2+.02),.8,z-d/2+j*d/3],[x+s*(w/2+.02),height+.2,z-d/2+j*d/3]],ink,.3);}
 roof(x,z,w+2.1,d+2.2,height+.45,Math.min(d*.3,3.8));
 if(two){roof(x,z+front*(d*.26),w+1.7,d*.65,h+.35,1.3);for(let i=0;i<=cols*2;i++)box(x-w/2+i*w/(cols*2),h+.9,fz+front*.9,.1,1.25,.1,'wood',false);box(x,h+1.5,fz+front*.9,w,.13,.12,'beam');box(x,h+.3,fz+front*.65,w+.8,.2,1.5,'wood');}
 if(label){textPanel(label,x,height-.7,fz+front*.21,Math.min(w*.65,6),1.1,front);if(rand()<.65){let xx=x+w/2+.4;beam([xx,height-1,fz],[xx,height-1,fz+front*2],.06);textPanel(label.slice(0,2),xx,height-2.3,fz+front*1.7,1,2.4,front);}}
 if(options.awning){const zz=fz+front*2;roof(x,zz,w+.5,3.8,3.5,.5);for(const s of [-1,1])beam([x+s*w*.45,.15,zz+front*1.7],[x+s*w*.45,3.55,zz+front*1.7],.07,'wood');}
 obstacles.push({x,z,w:w/2+.4,d:d/2+.4});
 // Soft watercolor shade at the foundations.
 box(x+1,.04,z-1,w+3,.02,d+3,'shade',false);
}

function jar(x,y,z,r=.4,parent=null){const pts=[new THREE.Vector2(0,0),new THREE.Vector2(r*.7,0),new THREE.Vector2(r,.3),new THREE.Vector2(r*.85,r*1.5),new THREE.Vector2(r*.42,r*1.8),new THREE.Vector2(r*.45,r*2)];geom(new THREE.LatheGeometry(pts,8),'#a58b63',[x,y,z],[0,0,0],[1,1,1],parent);}
function basket(x,y,z,r=.5,parent=null){geom(new THREE.CylinderGeometry(r,r*.7,r*1.1,9),'#bcaa7c',[x,y+r*.55,z],[0,0,0],[1,1,1],parent,true);if(!parent)for(let i=0;i<4;i++){const yy=y+i*r*.25;const pts=[];for(let j=0;j<=12;j++){let a=j/12*TAU;pts.push([x+Math.sin(a)*r*(.73+i*.07),yy,z+Math.cos(a)*r*(.73+i*.07)]);}line(pts,'#786746',.4);}}
function stall(x,z,label,type=0,front=1){
 box(x,1.05,z,5,.18,2.1,'wood');for(const s of [-1,1])for(const t of [-1,1])beam([x+s*2.1,.1,z+t*.8],[x+s*2.1,1.1,z+t*.8],.08,'wood');
 const cloth=pick(['#c1ad7e','#d5c29d','#a9a488','#b69775']);
 for(const s of [-1,1])beam([x+s*2.5,.1,z-1],[x+s*2.5,3.5,z-1],.07,'wood');
 surface([x-2.9,3.4,z-1.5,x+2.9,3.4,z-1.5,x-2.9,2.8,z+2,x+2.9,2.8,z+2],[0,2,1,1,2,3],mat(cloth,cloth,{side:THREE.DoubleSide}));
 for(let i=0;i<5;i++)line([[x-2.9+i*1.45,3.42,z-1.5],[x-2.9+i*1.45,2.82,z+2]],'#817054',.4);
 for(let i=0;i<8;i++){let xx=x+rand(-2.1,2.1),zz=z+rand(-.7,.7);if(type===0)basket(xx,1.17,zz,.28);else if(type===1)jar(xx,1.14,zz,.22);else geom(new THREE.SphereGeometry(.24,6,4),pick(['#aa9366','#ab9a70','#c4b187']),[xx,1.35,zz],[0,0,0],[1,.6,1]);}
 textPanel(label,x-2,2.25,z+1.18,.7,1.2);obstacles.push({x,z,w:2.5,d:1.1});
}

function bridge(){
 const x=-48,z0=riverZ(x),len=73,w=12,n=32;
 const top=z=>.55+7.1*Math.pow(Math.max(0,Math.cos((z-z0)/len*Math.PI)),1.6);
 const vs=[],uv=[],ids=[];
 for(let i=0;i<=n;i++){let z=z0-len/2+i*len/n,y=top(z);vs.push(x-w/2,y,z,x+w/2,y,z);uv.push(0,i/3,2,i/3);if(i<n){let j=i*2;ids.push(j,j+2,j+1,j+1,j+2,j+3);}line([[x-w/2,y+.03,z],[x+w/2,y+.03,z]],'#716247',.6);}
 surface(vs,ids,'wood',uv);
 for(const s of [-1,1]){
  for(let i=0;i<=n;i+=2){let z=z0-len/2+i*len/n,y=top(z);beam([x+s*w/2,y,z],[x+s*w/2,y+1.2,z],.09,'beam');}
  for(const yy of [.38,1.2]){const pts=[];for(let i=0;i<=n;i++) {let z=z0-len/2+i*len/n;pts.push([x+s*w/2,top(z)+yy,z]);}line(pts,ink,.85);}
  // Interlocking timber arch, characteristic of the rainbow bridge.
  for(let i=0;i<10;i++){let za=z0-len/2+i*len/10,zb=za+len/10;beam([x+s*5,top(za)-.65,za],[x+s*5,top(zb)-.65,zb],.28,'beam');beam([x+s*5,top(za)-.7,za],[x+s*5,top(zb)-2.1,zb],.16,'wood');}
 }
 for(let i=1;i<10;i++){let z=z0-len/2+i*len/10;beam([x-w/2-.7,top(z)-.7,z],[x+w/2+.7,top(z)-.7,z],.18,'beam');}
 for(const s of [-1,1])for(const t of [-1,1]){let z=z0+t*(len/2+1);beam([x+s*8,0,z],[x+s*8,11,z],.16,'wood');geom(new THREE.ConeGeometry(.8,1.6,4),'#aaa082',[x+s*8,11.7,z],[0,Math.PI/4,0]);line([[x+s*8-1,10.1,z],[x+s*8+1,10.1,z]],ink,.7);}
 // Small movable street trade at the bridge heads.
 for(const s of [-1,1]){stall(x-11,z0+s*40,'茶',0);stall(x+13,z0+s*41,'果',2);}
 return top;
}
let bridgeTop;
function cart(x,z,rotation=0){const group=new THREE.Group();group.position.set(x,0,z);group.rotation.y=rotation;scene.add(group);box(0,1.2,0,2.5,.24,4.2,'wood',true,group);for(const s of [-1,1]){box(s*1.2,1.65,0,.15,.9,4.3,'wood',true,group);const tor=new THREE.TorusGeometry(.9,.085,5,16);geom(tor,'beam',[s*1.6,.9,.1],[0,Math.PI/2,0],[1,1,1],group);for(let i=0;i<8;i++){let a=i/8*TAU;beam([s*1.6,.9,.1],[s*1.6,.9+Math.sin(a)*.86,.1+Math.cos(a)*.86],.035,'wood',group);}beam([s*.7,1.1,-1.8],[s*.7,.7,-5.5],.08,'wood',group);}for(let i=0;i<5;i++)basket(rand(-.6,.6),1.4,rand(-1.4,1.4),.5,group);return group;}

function tree(x,z,size=1,willow=false){
 const h=rand(8,13)*size;
 beam([x,0,z],[x+.3*size,h*.6,z],.28*size,'#80745a');
 for(let b=0;b<6;b++){let a=b/6*TAU+rand(-.3,.3),bx=x+Math.cos(a)*rand(2,4)*size,bz=z+Math.sin(a)*rand(2,4)*size,by=h*rand(.63,.95);beam([x+.3*size,h*.5,z],[bx,by,bz],.13*size,'#81745a');beam([bx,by,bz],[bx+Math.cos(a)*2*size,by+size,bz+Math.sin(a)*2*size],.065*size,'#81745a');
  if(willow){for(let i=0;i<9;i++){let xx=bx+rand(-1.7,1.7)*size,zz=bz+rand(-1.7,1.7)*size,yy=by+rand(-.5,1)*size;const ps=[];for(let j=0;j<=8;j++){let t=j/8;ps.push([xx+Math.sin(t*3+i)*.3*size,yy-t*rand(2.8,5)*size,zz+Math.sin(t*2)*.25*size]);}line(ps,'#777e58',.55);for(let k=0;k<7;k++){let t=k/7;geom(new THREE.PlaneGeometry(.32*size,1*size),mat('willow','#9caa79',{side:THREE.DoubleSide}),[xx,yy-t*3.4*size,zz],[rand(-.5,.5),rand(0,TAU),.25],[1,1,1]);}}}
  else{for(let i=0;i<24;i++){let xx=bx+rand(-2.4,2.4)*size,yy=by+rand(-1.2,1.5)*size,zz=bz+rand(-2.3,2.3)*size;const col=pick(['#a6ac80','#b4b28b','#929a72','#bcb78d','#9e9e76']);geom(new THREE.IcosahedronGeometry(rand(.28,.8)*size,0),mat(col,col,{flatShading:true}),[xx,yy,zz],[rand(0,1),rand(0,1),0],[1,.38,1]);line([[xx-.3*size,yy,zz],[xx+.4*size,yy+.08,zz+.3*size]],'#77815b',.32);}}
 }
 // Grass roots and several bare expressive twigs.
 for(let i=0;i<5;i++)line([[x+rand(-1,1)*size,.03,z+rand(-1,1)*size],[x+rand(-1,1)*size,rand(.3,.8)*size,z+rand(-1,1)*size]],'#887d57',.4);
 obstacles.push({x,z,w:.45*size,d:.45*size});
}

function boat(x,z,scale=1,sail=false,moving=true){
 const g=new THREE.Group();g.position.set(x,0,z);g.rotation.y=Math.PI/2;g.scale.setScalar(scale);scene.add(g);
 // Hollow, pointed hull and gently rising bow.
 const outline=[[-1.8,-6],[-2.3,-3],[-2.5,1],[-1.8,5],[0,7],[1.8,5],[2.5,1],[2.3,-3],[1.8,-6],[0,-7.8]];
 const s=new THREE.Shape();outline.forEach((p,i)=>i?s.lineTo(...p):s.moveTo(...p));const hull=new THREE.ExtrudeGeometry(s,{depth:.65,bevelEnabled:true,bevelSegments:1,steps:1,bevelSize:.16,bevelThickness:.25});hull.rotateX(Math.PI/2);geom(hull,'#8f7c58',[0,.9,0],[0,0,0],[1,1,1],g,true);
 box(0,1,0,3.7,.15,9.4,'wood',true,g);
 for(const side of [-1,1])line([[side*1.8,1.1,-6],[side*2.2,1.35,-2],[side*2.2,1.4,2],[side*1.6,1.75,5],[0,2,7]],ink,.8,g);
 for(let zz=-4;zz<=3;zz+=.7)line([[-1.9,1.12,zz],[1.9,1.12,zz]],ink,.4,g);
 // Woven arched cabin canopy.
 const v=[],id=[];for(let j=0;j<=10;j++){let t=j/10*Math.PI;v.push(Math.cos(t)*1.9,1.2+Math.sin(t)*2.1,-3.5,Math.cos(t)*1.9,1.2+Math.sin(t)*2.1,2);if(j<10){let k=j*2;id.push(k,k+1,k+2,k+1,k+3,k+2);}}surface(v,id,mat('canopy','#c0ae83',{side:THREE.DoubleSide}),null,g);
 for(let zz=-3.5;zz<=2;zz+=.7){const p=[];for(let j=0;j<=12;j++){let a=j/12*Math.PI;p.push([Math.cos(a)*1.94,1.2+Math.sin(a)*2.13,zz]);}line(p,ink,.5,g);}
 for(let i=0;i<3;i++)basket(rand(-.9,.9),1.1,rand(3.1,4.7),.48,g);
 beam([-.5,1.1,5],[1.9,3.3,7.6],.045,'beam',g);
 if(sail){beam([0,1,-.4],[0,13,-.4],.1,'wood',g);const sailMat=mat('sail','#d6c8a5',{side:THREE.DoubleSide});const vv=[],ii=[];for(let i=0;i<=8;i++){let t=i/8;vv.push(-.1,4+t*8,-.7,-.1+Math.sin(t*Math.PI)*.9,4+t*8,4.8-t*2);if(i<8){let k=i*2;ii.push(k,k+1,k+2,k+1,k+3,k+2);}}surface(vv,ii,sailMat,null,g);for(let i=0;i<8;i++){let t=i/8;line([[-.1,4+t*8,-.7],[-.1+Math.sin(t*Math.PI)*.9,4+t*8,4.8-t*2]],ink,.45,g);}line([[0,12,-.5],[0,1,5]],ink,.6,g);}
 const item={group:g,startX:x,offset:z-riverZ(x),speed:rand(.6,1.5),scale,moving,dir:rand()<.5?1:-1};boats.push(item);return item;
}

const clothes=['#9b9b88','#b6a686','#8f8b78','#c4b38f','#9a8b74','#cbbd9b','#a4aa91','#a28c78'];
const personGeometry=new THREE.CylinderGeometry(.32,.54,1.5,6);
const headGeometry=new THREE.SphereGeometry(.24,6,5);
let bodyInstances,headInstances,hatInstances,legInstances,armInstances;
function createPeople(){
 const n=205;bodyInstances=new THREE.InstancedMesh(personGeometry,new THREE.MeshLambertMaterial({color:'#ffffff'}),n);headInstances=new THREE.InstancedMesh(headGeometry,mat('skin','#b8a17c'),n);hatInstances=new THREE.InstancedMesh(new THREE.ConeGeometry(.39,.21,7),mat('hat','#7d7560'),n);legInstances=new THREE.InstancedMesh(new THREE.CylinderGeometry(.075,.075,.42,4),mat('trouser','#6f6b58'),n*2);
 armInstances=new THREE.InstancedMesh(new THREE.CylinderGeometry(.16,.21,.8,5),new THREE.MeshLambertMaterial({color:'#ffffff'}),n*2);
 for(const m of [bodyInstances,headInstances,hatInstances,legInstances,armInstances]){m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);scene.add(m);}
 for(let i=0;i<n;i++){
  let x,z,axis='x',range=50;
  if(i<105){x=rand(-205,165);z=-55+rand(-5,5);range=rand(16,65);}
  else if(i<137){x=rand(-170,125);z=58+rand(-5,5);}
  else if(i<172){x=-48+rand(-4,4);z=riverZ(-48)+rand(-34,34);axis='z';range=25;}
  else if(i<188){x=112+rand(-4,4);z=rand(-130,-50);axis='z';range=22;}
  else{x=rand(0,60);z=-36+rand(-3,3);range=20;}
  people.push({x,z,baseX:x,baseZ:z,axis,range,phase:rand(0,TAU),speed:rand(.15,.45),s:rand(.86,1.12),angle:rand(0,TAU),walk:i%4!==0});const clothColor=new THREE.Color(pick(clothes));bodyInstances.setColorAt(i,clothColor);armInstances.setColorAt(i*2,clothColor);armInstances.setColorAt(i*2+1,clothColor);
 }
 updatePeople(0);
}
const dummy=new THREE.Object3D();
function instanceAt(mesh,i,x,y,z,ry=0,s=1,rx=0){dummy.position.set(x,y,z);dummy.rotation.set(rx,ry,0);dummy.scale.setScalar(s);dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);}
function groundY(x,z){const rz=riverZ(x);if(Math.abs(x+48)<6.25&&Math.abs(z-rz)<37)return bridgeTop(z);return .15;}
function updatePeople(t){
 for(let i=0;i<people.length;i++){const p=people[i];let x=p.x,z=p.z,ang=p.angle;
  if(p.walk&&!reduced){const off=Math.sin(t*p.speed*.11+p.phase)*p.range;ang=Math.cos(t*p.speed*.11+p.phase)>0?Math.PI/2:-Math.PI/2;if(p.axis==='x')x=p.baseX+off;else{z=p.baseZ+off;ang+=Math.PI/2;}if(p.axis==='z'&&Math.abs(p.x+48)<6)z=clamp(z,riverZ(-48)-34,riverZ(-48)+34);}
  const y=groundY(x,z),s=p.s,swing=p.walk&&!reduced?Math.sin(t*3+p.phase)*.28:0;
  instanceAt(bodyInstances,i,x,y+1.08*s,z,ang,s);instanceAt(headInstances,i,x,y+2.03*s,z,ang,s);instanceAt(hatInstances,i,x,y+2.24*s,z,ang,s);
  for(let k=0;k<2;k++){const side=k===0?-1:1;instanceAt(legInstances,i*2+k,x+Math.cos(ang)*side*.16*s,y+.24*s,z-Math.sin(ang)*side*.16*s,ang,s,swing*side);instanceAt(armInstances,i*2+k,x+Math.cos(ang)*side*.4*s,y+1.24*s,z-Math.sin(ang)*side*.4*s,ang,s,-swing*side);}
 }
 for(const m of [bodyInstances,headInstances,hatInstances,legInstances,armInstances])m.instanceMatrix.needsUpdate=true;
}

function gate(){
 // City wall runs across the street, leaving a genuinely walkable central passage.
 for(const [zz,length] of [[-116,91],[-4,79]])box(112,6,zz,7,12,length,'#b5a786');
 for(const zz of [-70,-40])box(112,6.2,zz,14,12.4,14,'#ac9c7c');
 box(112,12.6,-55,14,2,19,'#b0a17e');
 for(let i=0;i<52;i++){let zz=-162+i*4;box(112,12.65,zz,7,.9,2.2,'#b5a786');}
 for(let y=1;y<12;y+=1.4)for(const z0 of [-158,-98,-35,15]){for(let i=0;i<12;i++){let zz=z0+i*2.9+(y%2)*.7;line([[108.47,y,zz],[108.47,y,zz+2.6]],'#81765a',.35);line([[108.47,y,zz],[108.47,y+1.3,zz]],'#81765a',.3);}}
 box(112,16.1,-55,10,6,16,'wall');roof(112,-55,14,21,19.2,4.6);
 for(let i=0;i<6;i++){let zz=-62+i*2.8;box(106.9,16.3,zz,.12,3.8,1.1,'#6e6955',false);}
 roof(112,-55,16,23,13.9,2);
 const t=canvasTexture(256,128,c=>{c.fillStyle='#cbbb95';c.fillRect(0,0,256,128);c.fillStyle='#5b503a';c.font="64px serif";c.textAlign='center';c.fillText('汴京',128,88);});geom(new THREE.PlaneGeometry(4.5,2.1),new THREE.MeshBasicMaterial({map:t}),[104.8,10.4,-55],[0,-Math.PI/2,0]);
 obstacles.push({x:112,z:-116,w:3.8,d:45.5},{x:112,z:-4,w:3.8,d:39.5},{x:112,z:-70,w:7,d:7},{x:112,z:-40,w:7,d:7});
 for(const zz of [-68,-42]){beam([100,.1,zz],[100,6,zz],.15,'wood');geom(new THREE.ConeGeometry(.7,.9,4),'#a49c7c',[100,6.4,zz],[0,Math.PI/4,0]);}
}

function town(){
 const labels=['孙羊正店','香饮子','绸缎庄','赵太丞家','脚店','茶坊','解库','刘家香铺','纸马铺','王家罗锦'];
 // Main commercial street: a porous rhythm of shop fronts, courtyards, and lanes.
 for(const zz of [-72,-39]){let x=-183;let i=0;while(x<91){if(Math.abs(x+48)<14||Math.abs(x-25)<10||Math.abs(x+150)<9){x+=18;continue;}let w=rand(10,18),d=rand(9,14);building(x,zz,w,d,rand(4.2,6.1),{two:rand()<.36,front:zz<-55?1:-1,label:labels[i%labels.length],open:rand()<.45,awning:rand()<.4});x+=w+rand(2,7);i++;}}
 // Side streets and enclosed residential yards.
 for(const zz of [-105,-133,88,116]){for(let x=-171;x<171;x+=rand(20,29)){if(Math.abs(x+48)<15||Math.abs(x-25)<12||Math.abs(x-112)<12)continue;const w=rand(10,17);building(x,zz,w,rand(8,12),rand(3.8,5.8),{two:rand()<.1,front:zz<0?1:-1});if(rand()<.5){box(x,1.2,zz+11,w+3,2.4,.4,'wall');box(x+w/2+1.2,1.2,zz+5,.4,2.4,12,'wall');}}}
 // Outside the wall: dense shops fade into the countryside.
 for(const z of [-72,-38])for(let x=138;x<205;x+=22)building(x,z,rand(12,17),11,rand(4.5,6),{two:rand()<.45,front:z<-55?1:-1,label:pick(labels),open:true});
 building(17,-79,23,16,6.5,{two:true,front:1,label:'孙羊正店',awning:true});
 building(47,43,19,12,6,{two:true,front:1,label:'临河茶坊',awning:true});
 for(let i=0;i<14;i++){let x=-174+i*19;if(Math.abs(x+48)<15||x>91)continue;stall(x,-46,pick(['茶','香','果','饼','绢']),i%3);}
 for(let i=0;i<7;i++)stall(-155+i*38,66,pick(['茶','面','果']),i%3);
 cart(-104,-55,.6);cart(65,-57,-Math.PI/2);cart(148,-54,Math.PI/2);cart(-81,57,Math.PI/2);
 for(let i=0;i<40;i++){let x=rand(-185,190),z=pick([-28,-83,78,100]);if(rand()<.5)jar(x,0,z,rand(.25,.6));else basket(x,0,z,rand(.3,.65));}
 // River landing with timber poles, mooring ropes and cargo.
 box(9,.45,riverZ(9)-22,25,.65,7,'wood');for(let x=-3;x<23;x+=1.1)line([[x,.79,riverZ(9)-25.5],[x,.79,riverZ(9)-18.5]],ink,.45);
 for(const x of [-2,21])beam([x,-.1,riverZ(9)-19],[x,2,riverZ(9)-19],.15,'wood');
 for(let i=0;i<13;i++)basket(rand(-1,20),.81,rand(-22,-18)+riverZ(9),rand(.4,.7));
 for(let i=0;i<6;i++)tree(-210+i*13,rand(-98,-40),rand(.9,1.4));
 for(const [x,z,s] of [[-180,24,1.1],[-144,14,.9],[-97,18,1.1],[-72,-30,.9],[-29,26,1],[75,37,1.1],[98,31,1.3],[146,38,1.1],[-121,-90,1.1],[0,-114,.9],[65,-99,.9],[-15,99,1.15],[-104,83,1],[-181,107,1],[-220,60,1.2],[-233,-10,1.1]])tree(x,z,s,true);
 for(let i=0;i<20;i++)tree(rand(-222,220),pick([-153,145])+rand(-12,12),rand(.65,1.2));
 // Distant cultivated fields, with thin brush lines instead of a hard map boundary.
 for(let j=0;j<8;j++){let z=155+j*3.5;line([[-230,.02,z],[-90,.02,z+3]],'#95885e',.3);}
 for(let i=0;i<11;i++)line([[-237+i*14,.02,157],[-230+i*14,.02,184]],'#9d8d61',.22);
 for(let i=0;i<20;i++){let x=rand(-230,-180),z=rand(-3,17);line([[x,.03,z],[x+1,.03,z+.3]],'#9d8d61',.3);}
}

function finalizeStatic(){
 for(const [material,gs] of staticBuckets){try{const merged=mergeGeometries(gs,false);const mesh=new THREE.Mesh(merged,material);mesh.frustumCulled=false;scene.add(mesh);}catch(e){console.error('geometry',e);}gs.forEach(g=>g.dispose());}
 staticBuckets.clear();
 for(const {points,color,opacity} of lineBuckets.values()){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(points,3));const l=new THREE.LineSegments(g,new THREE.LineBasicMaterial({color,transparent:true,opacity,depthWrite:false}));l.frustumCulled=false;scene.add(l);}lineBuckets.clear();
}

// A restrained paper-grain pass unifies geometry, line work, water and silhouettes.
const target=new THREE.WebGLRenderTarget(innerWidth,innerHeight,{depthBuffer:true});
const postScene=new THREE.Scene(),postCamera=new THREE.OrthographicCamera(-1,1,1,-1,0,1);
const postMaterial=new THREE.ShaderMaterial({uniforms:{tDiffuse:{value:target.texture},resolution:{value:new THREE.Vector2(innerWidth,innerHeight)}},vertexShader:`varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}`,fragmentShader:`uniform sampler2D tDiffuse;uniform vec2 resolution;varying vec2 vUv;float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}void main(){vec3 c=texture2D(tDiffuse,vUv).rgb;float noise=hash(floor(vUv*resolution*1.2));float fiber=sin(vUv.x*resolution.x*1.5)*sin(vUv.y*resolution.y*1.7);c*=.975+noise*.045+fiber*.006;vec2 p=abs(vUv-.5)*2.;float edge=pow(max(p.x,p.y),8.)*.07;c=mix(c,vec3(.72,.64,.48),edge);gl_FragColor=vec4(c,1.);#include <colorspace_fragment>}`.replace(';#include',';\n#include')});
postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),postMaterial));

const places=[
 {name:'郊野春树',short:'郊野',x:-201,z:61,view:[-155,10,20],zoom:95,desc:'疏林小径，驮队渐近。城外的安静，衬出城中的繁华。',note:'春树下，且听一声鸟鸣'},
 {name:'虹桥争渡',short:'虹桥',x:-48,z:-36,view:[-43,0,-6],zoom:105,desc:'木梁相叠，凌空如虹。行人、商贩与过往舟楫，在这里交汇。',note:'桥上人来人往，桥下舟楫相接'},
 {name:'汴河舟楫',short:'汴河码头',x:10,z:-26,view:[10,0,-1],zoom:91,desc:'一船货物靠岸，也带来远方的消息。到码头找船家，可以乘舟看两岸。',note:'近岸寻船家，乘一叶舟看汴河'},
 {name:'十字街市',short:'十字街市',x:24,z:-55,view:[28,0,-60],zoom:82,desc:'茶坊、香铺、脚店与酒楼，招幌交错。循着街巷，慢慢逛进市井深处。',note:'市招与人声里，皆是寻常日子'},
 {name:'城门内外',short:'城门',x:94,z:-55,view:[109,0,-51],zoom:100,desc:'城楼下是一条通行的大路。穿过城门，繁华仍在沿路延伸。',note:'穿过城门，城外仍有烟火人家'}
];
const visited=new Set();
try{const v=JSON.parse(localStorage.getItem('bianjing-visits')||'[]');for(const n of v)if(Number.isInteger(n)&&n>=0&&n<5)visited.add(n);}catch{}
const npcs=[
 {x:-62,z:-40,title:'桥头茶博士',seal:'茶',kind:'talk',text:'客官走得乏了，歇一歇脚。桥上南来北往的人，问路的、卖货的、看热闹的，都爱到这里吃口茶。您若想看船，到桥中央往河上望便是。',fact:'画中细节 · 虹桥附近的摊贩和人流，是整卷最热闹的段落之一。'},
 {x:11,z:-25,title:'汴河船家',seal:'舟',kind:'boat',text:'两岸好景，水上看又是一番光景。客官上船坐稳，我们沿汴河走一段。看够了，随时招呼我靠岸。',fact:'游览玩法 · 登船后沿河自动前行，点击“靠岸下船”回到码头。'},
 {x:25,z:-55,title:'街口卖香人',seal:'香',kind:'talk',text:'这条街的招幌，一眼望不到头。您瞧，前头正店门面阔，旁边有脚店，拐过去又是茶坊。要看这座城，就得在街上多走几步。',fact:'画中细节 · 店铺的招幌、铺面与货品，让画里的商业生活变得可见。'},
 {x:96,z:-55,title:'城门行旅',seal:'行',kind:'talk',text:'进城的路就在楼下，沿大街直走便能过去。我赶着进城办事，您若有闲，不妨回望虹桥，那里最能见汴河的忙碌。',fact:'创作说明 · 这里依据宋本的视觉元素重新组织空间，供自由游览，未作逐尺复原。'}
];

function setOrtho(){const aspect=innerWidth/innerHeight;ortho.left=-view.zoom*aspect/2;ortho.right=view.zoom*aspect/2;ortho.top=view.zoom/2;ortho.bottom=-view.zoom/2;ortho.near=.1;ortho.far=700;ortho.updateProjectionMatrix();const dist=210;ortho.position.set(view.target.x+Math.sin(view.yaw)*Math.cos(view.pitch)*dist,Math.sin(view.pitch)*dist,view.target.z+Math.cos(view.yaw)*Math.cos(view.pitch)*dist);ortho.lookAt(view.target);}
function setMode(next){mode=next;camera=mode==='view'?ortho:perspective;app.classList.toggle('walk-mode',mode==='walk');$('#viewButton').classList.toggle('selected',mode==='view');$('#walkButton').classList.toggle('selected',mode==='walk');$('#walkHint').classList.toggle('hidden',mode!=='walk');$('#crosshair').classList.toggle('hidden',mode!=='walk');$('#touchControls').classList.toggle('hidden',mode!=='walk'||!matchMedia('(pointer:coarse)').matches);$('#intro').classList.toggle('away',started||mode==='walk');if(mode==='walk')started=true;if(next==='view'&&boatRide)leaveBoat();if(next==='view')$('#landmarkLabel').classList.remove('hidden');keys.clear();}
function goPlace(i,walk=mode==='walk'){
 selectedPlace=i;const p=places[i];if(boatRide)leaveBoat();
 document.querySelectorAll('[data-place]').forEach(b=>b.classList.toggle('active',Number(b.dataset.place)===i));
 if(walk){setMode('walk');player.x=p.x;player.z=p.z;player.y=groundY(p.x,p.z)+2.4;player.yaw=i===1?Math.PI:i===4?Math.PI/2:0;player.pitch=-.06;markVisited(i);}
 else{setMode('view');started=true;$('#intro').classList.add('away');viewTween={fromTarget:view.target.clone(),toTarget:new THREE.Vector3(...p.view),fromZoom:view.zoom,toZoom:p.zoom,start:performance.now(),duration:reduced?0:1200};}
 updateLocation(i);
}
let toastTimeout;
function markVisited(i){if(visited.has(i))return;visited.add(i);try{localStorage.setItem('bianjing-visits',JSON.stringify([...visited]));}catch{}$('#visitCount').textContent=`寻迹 ${visited.size} / 5`;const d=$('#discoveryToast');d.querySelector('strong').textContent=places[i].name+' · 已抵达';d.classList.remove('hidden');clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>d.classList.add('hidden'),3500);}
function updateLocation(i){$('#locationName').textContent=places[i].name;$('#locationNote').textContent=mode==='walk'?places[i].note:'拖动览卷 · 滚轮拉近 · 点击下方前往';}
function openModal(html){$('#modalContent').innerHTML=html;$('#modal').classList.remove('hidden');modalOpen=true;keys.clear();}
function closeModal(){$('#modal').classList.add('hidden');modalOpen=false;keys.clear();}
function help(){openModal(`<p class="eyebrow">游园小笺</p><h2>慢慢走，处处可看。</h2><p>这是一座取意《清明上河图》宋本的三维世界。可在高处览卷，也可进入街巷，走过虹桥、城门，寻找茶博士与船家。</p><div class="help-grid"><div><strong>览卷</strong><br>拖动画面：旋转视角<br>滚轮 / 双指：拉近或拉远<br>下方五个地名：前往该处</div><div><strong>漫游</strong><br><kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> 或方向键：行走<br>按住画面拖动：转向<br><kbd>Shift</kbd> 快行 · <kbd>E</kbd> 交谈 / 乘船</div></div><p>按 <kbd>M</kbd> 打开舆图，<kbd>V</kbd> 切换视角，<kbd>Esc</kbd> 关闭弹窗。手机可使用屏幕方向键行走，拖动右侧画面转向。</p><p style="font-size:10px">画风依据：张择端《清明上河图》宋本的绢本淡设色、界画线条与市井题材。空间为游园创作，并非原画建筑布局的精确复原。<a href="https://www.dpm.org.cn/collection/paint/228226.html" target="_blank" rel="noopener" style="text-decoration:underline">参看故宫藏品介绍 ↗</a></p>`);}
function showMap(){openModal(`<p class="eyebrow">一城烟火 · 随处可往</p><h2>汴京舆图</h2><canvas id="atlas" width="1000" height="420" aria-label="标有五个游览点和当前位置的汴京地图"></canvas><div class="place-list">${places.map((p,i)=>`<button data-map-place="${i}">${p.name}<span>${visited.has(i)?'已留足迹':'前往此处 ↗'}</span></button>`).join('')}</div><p>选择一处即可前往。五处都留下足迹，便收齐了这一卷市井。</p>`);drawMap();document.querySelectorAll('[data-map-place]').forEach(b=>b.onclick=()=>{closeModal();goPlace(+b.dataset.mapPlace,true);});}
function drawMap(){const c=$('#atlas').getContext('2d'),W=1000,H=420;const mx=x=>(x+245)/490*W,mz=z=>(z+160)/320*H;
 c.clearRect(0,0,W,H);c.fillStyle='#e1d3b4';c.fillRect(0,0,W,H);c.fillStyle='#a7ac925f';c.beginPath();for(let x=-245;x<=245;x+=5)c.lineTo(mx(x),mz(riverZ(x)-24));for(let x=245;x>=-245;x-=5)c.lineTo(mx(x),mz(riverZ(x)+24));c.closePath();c.fill();c.strokeStyle='#968260';c.lineWidth=6;for(const z of [-55,58]){c.beginPath();c.moveTo(0,mz(z));c.lineTo(W,mz(z));c.stroke();}c.lineWidth=5;c.beginPath();c.moveTo(mx(-48),mz(-50));c.lineTo(mx(-48),mz(60));c.stroke();c.fillStyle='#7e755c';c.fillRect(mx(108),20,12,mz(-65)-20);c.fillRect(mx(108),mz(-43),12,H-mz(-43));c.fillStyle='#b8a27a';for(const o of obstacles){if(o.w<4)continue;c.fillRect(mx(o.x-o.w),mz(o.z-o.d),o.w*2/490*W,o.d*2/320*H);}c.font="20px serif";c.textAlign='center';for(let i=0;i<places.length;i++){const p=places[i];c.fillStyle='#eee2c5';c.beginPath();c.arc(mx(p.x),mz(p.z),12,0,TAU);c.fill();c.strokeStyle=visited.has(i)?'#8c4435':'#6c6048';c.lineWidth=2;c.stroke();c.fillStyle='#554631';c.fillText(p.name,mx(p.x),mz(p.z)-20);}c.fillStyle='#8c4435';c.beginPath();c.arc(mx(player.x),mz(player.z),6,0,TAU);c.fill();c.fillText('你',mx(player.x)+19,mz(player.z)+8);}
function interact(){if(modalOpen||mode!=='walk')return;if(boatRide){leaveBoat();return;}if(!nearest)return;const n=nearest;openModal(`<span class="npc-seal">${n.seal}</span><p class="eyebrow">画中偶遇</p><h2>${n.title}</h2><p class="dialogue">“${n.text}”</p><p>${n.fact}</p>${n.kind==='boat'?'<button class="action" id="boardBoat">上船游河 ↗</button>':'<button class="action" id="thankNpc">再逛一逛</button>'}`);if(n.kind==='boat')$('#boardBoat').onclick=()=>{closeModal();boatRide=true;rideX=8;rideDirection=1;$('#boatControls').classList.remove('hidden');$('#interaction').classList.add('hidden');};else $('#thankNpc').onclick=closeModal;}
let rideX=8,rideDirection=1;
function leaveBoat(){boatRide=false;$('#boatControls').classList.add('hidden');player.x=10;player.z=-26;player.y=2.55;player.yaw=Math.PI;}

const keys=new Set();
window.addEventListener('keydown',e=>{if(/INPUT|SELECT|TEXTAREA/.test(e.target.tagName))return;if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(e.key))e.preventDefault();if(e.code==='Escape'){closeModal();$('#settings').classList.add('hidden');keys.clear();return;}if(modalOpen)return;if(e.code==='KeyE'&&!e.repeat){interact();return;}if(e.code==='KeyM'&&!e.repeat){showMap();return;}if(e.code==='KeyV'&&!e.repeat){setMode(mode==='view'?'walk':'view');return;}keys.add(e.code);});
window.addEventListener('keyup',e=>keys.delete(e.code));window.addEventListener('blur',()=>keys.clear());document.addEventListener('visibilitychange',()=>keys.clear());
let pointer=null,touchDistance=null,hasDragged=false;
mount.addEventListener('pointerdown',e=>{if(modalOpen)return;pointer={id:e.pointerId,x:e.clientX,y:e.clientY};mount.setPointerCapture(e.pointerId);hasDragged=false;});
mount.addEventListener('pointermove',e=>{if(!pointer||pointer.id!==e.pointerId||modalOpen)return;const dx=e.clientX-pointer.x,dy=e.clientY-pointer.y;pointer.x=e.clientX;pointer.y=e.clientY;hasDragged=true;if(mode==='view'){viewTween=null;view.yaw-=dx*.005;view.pitch=clamp(view.pitch+dy*.003,.3,1.27);if(!started&&Math.abs(dx)+Math.abs(dy)>2){$('#intro').classList.add('away');started=true;}}else{player.yaw-=dx*.004;player.pitch=clamp(player.pitch-dy*.003,-1.05,1.05);}});
mount.addEventListener('pointerup',()=>pointer=null);mount.addEventListener('pointercancel',()=>pointer=null);
mount.addEventListener('wheel',e=>{e.preventDefault();if(modalOpen)return;if(mode==='view'){view.zoom=clamp(view.zoom+e.deltaY*.07,30,230);viewTween=null;}else player.pitch=clamp(player.pitch-e.deltaY*.0005,-1,1);},{passive:false});
mount.addEventListener('touchstart',e=>{if(e.touches.length===2){pointer=null;touchDistance=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);}},{passive:true});
mount.addEventListener('touchmove',e=>{if(e.touches.length===2&&touchDistance&&mode==='view'){const d=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);view.zoom=clamp(view.zoom*touchDistance/d,30,230);touchDistance=d;}},{passive:true});mount.addEventListener('touchend',()=>touchDistance=null);
document.querySelectorAll('[data-key]').forEach(b=>{b.onpointerdown=e=>{e.preventDefault();keys.add(b.dataset.key);b.setPointerCapture(e.pointerId);};b.onpointerup=b.onpointercancel=()=>keys.delete(b.dataset.key);});
$('#touchInteract').onclick=interact;$('#enterButton').onclick=()=>goPlace(1,true);$('#viewButton').onclick=()=>setMode('view');$('#walkButton').onclick=()=>{if(!started)goPlace(1,true);else setMode('walk');};$('.brand').onclick=e=>{e.preventDefault();if(boatRide)leaveBoat();setMode('view');viewTween={fromTarget:view.target.clone(),toTarget:new THREE.Vector3(-4,0,-12),fromZoom:view.zoom,toZoom:190,start:performance.now(),duration:reduced?0:1000};};
document.querySelectorAll('[data-place]').forEach(b=>b.onclick=()=>goPlace(+b.dataset.place));$('#mapButton').onclick=showMap;$('#helpButton').onclick=help;$('#closeModal').onclick=closeModal;$('.modal-backdrop').onclick=closeModal;$('#settingsButton').onclick=()=>{$('#settings').classList.toggle('hidden');keys.clear();};document.querySelector('[data-close="settings"]').onclick=()=>$('#settings').classList.add('hidden');$('#resetButton').onclick=()=>{goPlace(1,mode==='walk');$('#settings').classList.add('hidden');};$('#leaveBoat').onclick=leaveBoat;$('#reducedMotion').checked=reduced;$('#reducedMotion').onchange=e=>{reduced=e.target.checked;};$('#quality').onchange=e=>{renderer.setPixelRatio(e.target.value==='low'?1:Math.min(devicePixelRatio,1.6));resize();};$('#visitCount').textContent=`寻迹 ${visited.size} / 5`;

// Optional, locally synthesized ambience; never starts before a user gesture.
let audioCtx=null,audioMaster=null,audioTimer=null;
function toggleAudio(on){if(on){if(!audioCtx){audioCtx=new AudioContext();audioMaster=audioCtx.createGain();audioMaster.gain.value=.18;audioMaster.connect(audioCtx.destination);const len=audioCtx.sampleRate*3,buf=audioCtx.createBuffer(1,len,audioCtx.sampleRate),data=buf.getChannelData(0);let v=0;for(let i=0;i<len;i++){v=(v+Math.random()*.04-.02)*.985;data[i]=v;}const noise=audioCtx.createBufferSource();noise.buffer=buf;noise.loop=true;const filter=audioCtx.createBiquadFilter();filter.type='lowpass';filter.frequency.value=520;noise.connect(filter).connect(audioMaster);noise.start();audioTimer=setInterval(()=>{if(audioCtx.state!=='running')return;const o=audioCtx.createOscillator(),g=audioCtx.createGain();o.type='sine';o.frequency.setValueAtTime(1600+Math.random()*800,audioCtx.currentTime);o.frequency.exponentialRampToValueAtTime(1100,audioCtx.currentTime+.25);g.gain.setValueAtTime(0,audioCtx.currentTime);g.gain.linearRampToValueAtTime(.035,audioCtx.currentTime+.04);g.gain.exponentialRampToValueAtTime(.0001,audioCtx.currentTime+.3);o.connect(g).connect(audioMaster);o.start();o.stop(audioCtx.currentTime+.35);},4900);}audioCtx.resume();}else audioCtx?.suspend();}
$('#audioToggle').onchange=e=>toggleAudio(e.target.checked);

function validPosition(x,z){
 if(x<-238||x>228||z<-156||z>148)return false;
 const rz=riverZ(x);const onBridge=Math.abs(x+48)<5.75&&Math.abs(z-rz)<38;
 if(Math.abs(z-rz)<24.3&&!onBridge){const onDock=x>-4&&x<22&&z<riverZ(9)-18.8&&z>riverZ(9)-26; if(!onDock)return false;}
 for(const o of obstacles)if(Math.abs(x-o.x)<o.w+.4&&Math.abs(z-o.z)<o.d+.4)return false;
 return true;
}
function movePlayer(dt){
 if(boatRide){if(!reduced)rideX+=dt*3.8*rideDirection;if(rideX>182)rideDirection=-1;if(rideX<-180)rideDirection=1;player.x=rideX;player.z=riverZ(rideX)-7;player.y=3.9;return;}
 let f=(keys.has('KeyW')||keys.has('ArrowUp')?1:0)-(keys.has('KeyS')||keys.has('ArrowDown')?1:0),s=(keys.has('KeyD')||keys.has('ArrowRight')?1:0)-(keys.has('KeyA')||keys.has('ArrowLeft')?1:0);if(f||s){const n=Math.hypot(f,s),speed=(keys.has('ShiftLeft')||keys.has('ShiftRight')?12:6.5)*dt;f/=n;s/=n;const dx=(Math.sin(player.yaw)*f+Math.cos(player.yaw)*s)*speed,dz=(-Math.cos(player.yaw)*f+Math.sin(player.yaw)*s)*speed;const steps=Math.max(1,Math.ceil(Math.hypot(dx,dz)/.45));for(let i=0;i<steps;i++){if(validPosition(player.x+dx/steps,player.z))player.x+=dx/steps;if(validPosition(player.x,player.z+dz/steps))player.z+=dz/steps;}}
 const targetY=groundY(player.x,player.z)+2.4;player.y=THREE.MathUtils.lerp(player.y,targetY,Math.min(1,dt*12));
}
function updateCamera(dt){
 if(mode==='view'){if(viewTween){const t=viewTween.duration?clamp((performance.now()-viewTween.start)/viewTween.duration,0,1):1;const e=t*t*(3-2*t);view.target.lerpVectors(viewTween.fromTarget,viewTween.toTarget,e);view.zoom=THREE.MathUtils.lerp(viewTween.fromZoom,viewTween.toZoom,e);if(t===1)viewTween=null;}setOrtho();}
 else{if(!modalOpen)movePlayer(dt);perspective.position.set(player.x,player.y,player.z);perspective.rotation.order='YXZ';perspective.rotation.set(player.pitch,-player.yaw,0); // Positive yaw follows eastward movement.
 // Explicit look direction keeps keyboard and dragging in the same frame.
 const direction=new THREE.Vector3(Math.sin(player.yaw)*Math.cos(player.pitch),Math.sin(player.pitch),-Math.cos(player.yaw)*Math.cos(player.pitch));perspective.lookAt(perspective.position.clone().add(direction));}
}
let nearestPlace=1;
function checkNearby(){
 if(mode!=='walk')return;let best=Infinity,bestI=1;places.forEach((p,i)=>{let d=Math.hypot(player.x-p.x,player.z-p.z);if(d<best){best=d;bestI=i;}if(d<17)markVisited(i);});if(bestI!==nearestPlace){nearestPlace=bestI;selectedPlace=bestI;updateLocation(bestI);document.querySelectorAll('[data-place]').forEach(b=>b.classList.toggle('active',+b.dataset.place===bestI));}
 nearest=null;let nd=7;for(const n of npcs){let d=Math.hypot(player.x-n.x,player.z-n.z);if(d<nd){nearest=n;nd=d;}}
 $('#interaction').classList.toggle('hidden',!nearest||boatRide||modalOpen);if(nearest)$('#interaction span').textContent=nearest.kind==='boat'?'与船家交谈 · 乘船游河':'与'+nearest.title+'闲谈';$('#touchInteract').classList.toggle('hidden',!nearest&&!boatRide);
}
const labelVec=new THREE.Vector3();
function updateLabel(){if(mode!=='view')return;const p=places[selectedPlace];const x=selectedPlace===1?-48:p.x;let y=selectedPlace===1?12:12;labelVec.set(x,y,p.z).project(camera);const xx=(labelVec.x*.5+.5)*innerWidth,yy=(-labelVec.y*.5+.5)*innerHeight;const l=$('#landmarkLabel');l.style.left=clamp(xx,30,innerWidth-140)+'px';l.style.top=clamp(yy,100,innerHeight-190)+'px';$('#landmarkText').textContent=p.short;}
function resize(){renderer.setSize(innerWidth,innerHeight);target.setSize(Math.round(innerWidth*renderer.getPixelRatio()),Math.round(innerHeight*renderer.getPixelRatio()));postMaterial.uniforms.resolution.value.set(innerWidth*renderer.getPixelRatio(),innerHeight*renderer.getPixelRatio());perspective.aspect=innerWidth/innerHeight;perspective.updateProjectionMatrix();setOrtho();}window.addEventListener('resize',resize);

let last=performance.now(),elapsed=0,frame=0;
function animate(now){requestAnimationFrame(animate);const dt=Math.min((now-last)/1000,.05);last=now;elapsed+=dt;frame++;updateCamera(dt);if(frame%3===0){if(!reduced)updatePeople(elapsed);checkNearby();updateLabel();}
 if(!reduced)for(const b of boats){if(!b.moving)continue;let x=b.startX+Math.sin(elapsed*.013+b.startX)*25; // Slow, uninterrupted waterborne movement.
  b.group.position.x=x;b.group.position.z=riverZ(x)+b.offset;b.group.position.y=Math.sin(elapsed*.8+b.startX)*.055;b.group.rotation.y=Math.PI/2-Math.atan(Math.cos(x*.014)*.168+Math.cos(x*.033)*.099);}
 if(rideBoat){rideBoat.group.visible=boatRide;if(boatRide){rideBoat.group.position.set(player.x,.1,player.z);rideBoat.group.rotation.y=rideDirection>0?Math.PI/2:-Math.PI/2;}}
 renderer.setRenderTarget(target);renderer.render(scene,camera);renderer.setRenderTarget(null);renderer.render(postScene,postCamera);
}
let rideBoat;
async function init(){
 try{await new Promise(r=>setTimeout(r,60));land();bridgeTop=bridge();town();gate();
 for(const [x,off,s,sail,moving] of [[-161,4,1.3,true,true],[-112,-5,1,false,true],[-67,5,1.2,false,true],[-17,6,1.1,true,true],[38,8,1.45,true,true],[89,-7,1,false,true],[148,1,1.2,true,true],[7,-17,.85,false,false],[-132,19,.8,false,false]])boat(x,riverZ(x)+off,s,sail,moving);
 rideBoat=boat(10,riverZ(10)-7,.8,false,false);rideBoat.group.visible=false;
 finalizeStatic();createPeople();resize();updateLocation(1);requestAnimationFrame(animate);$('#loading').classList.add('done');setTimeout(()=>$('#loading').remove(),800);
 window.__world={getState:()=>({mode,player:{...player},visited:[...visited],boatRide,reduced,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,objects:scene.children.length}),goPlace,setMode,validPosition,places,interact,scene};
 }catch(e){console.error(e);$('#loading').classList.add('hidden');$('#fatal').classList.remove('hidden');}
}
init();
