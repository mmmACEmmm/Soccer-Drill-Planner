const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

const textureImages = {
  grass: loadImage("textures/grass.png"),
  white: loadImage("textures/white grass.png")
};
const ballImage = loadImage("textures/1-15444_soccer-ball-clip-art-3-soccer-ball-clipart-fans-soccer-ball-png.png");
const textureCache = {};

let W, H;
let tool = "select";
let objects = [];
let selected = null;
let pendingAttachBall = null;
let dragging = false;
let dragOffsetX = 0;
let dragOffsetY = 0;
let playing = false;
let animationId = null;
let lastFrameTime = 0;
let drillTime = 0;
let trashHot = false;
let historyStack = [];
let redoStack = [];
let suppressHistory = false;

const settings = {
  showGrid:true,
  showZones:false,
  snap:false,
  snapSize:20,
  showLabels:true,
  playbackSpeed:1,
  drillTitle:"",
  drillNotes:""
};

const trashBox = {x:0,y:18,w:58,h:58};

function loadImage(src){
  const img = new Image();
  img.src = src;
  img.onload = draw;
  return img;
}

function resize(){
  const oldW = W || 0;
  const oldH = H || 0;
  W = Math.max(280, window.innerWidth - 320);
  H = Math.max(360, window.innerHeight);
  if(oldW && oldH && (Math.abs(oldW - W) > 1 || Math.abs(oldH - H) > 1)){
    scaleAllObjects(W / oldW, H / oldH);
  }
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr,0,0,dpr,0,0);
  trashBox.x = W - trashBox.w - 18;
  draw();
}
window.addEventListener("resize", resize);

function scaleAllObjects(sx,sy){
  for(const o of objects){
    scalePoint(o,sx,sy);
    o.startX *= sx;
    o.startY *= sy;
    for(const p of o.path || []) scalePoint(p,sx,sy);
    if(o.pass){
      o.pass.fromX *= sx;
      o.pass.fromY *= sy;
    }
  }
}

function scalePoint(p,sx,sy){
  p.x *= sx;
  p.y *= sy;
}

function setTool(t){
  tool = t;
  pendingAttachBall = null;
  document.querySelectorAll("button").forEach(b=>b.classList.remove("active"));
  const btn = document.getElementById(t+"Btn");
  if(btn) btn.classList.add("active");
  updateInspector();
}

document.getElementById("mapType").addEventListener("change", draw);
document.getElementById("textureType").addEventListener("change", draw);
document.getElementById("drillTitleInput").addEventListener("input", ()=>{
  settings.drillTitle = document.getElementById("drillTitleInput").value;
});
document.getElementById("drillNotesInput").addEventListener("input", ()=>{
  settings.drillNotes = document.getElementById("drillNotesInput").value;
});
document.getElementById("gridToggle").addEventListener("change", ()=>{
  settings.showGrid = document.getElementById("gridToggle").checked;
  draw();
});
document.getElementById("zonesToggle").addEventListener("change", ()=>{
  settings.showZones = document.getElementById("zonesToggle").checked;
  draw();
});
document.getElementById("snapToggle").addEventListener("change", ()=>{
  settings.snap = document.getElementById("snapToggle").checked;
});
document.getElementById("labelsToggle").addEventListener("change", ()=>{
  settings.showLabels = document.getElementById("labelsToggle").checked;
  draw();
});
document.getElementById("snapSizeInput").addEventListener("input", ()=>{
  settings.snapSize = Math.max(10, Number(document.getElementById("snapSizeInput").value) || 20);
});
document.getElementById("playbackSpeedInput").addEventListener("input", ()=>{
  settings.playbackSpeed = Math.max(.25, Number(document.getElementById("playbackSpeedInput").value) || 1);
});
document.getElementById("playerNameInput").addEventListener("input", ()=>{
  if(isPlayer(selected)){
    selected.playerName = document.getElementById("playerNameInput").value.trim();
    draw();
  }
});
document.getElementById("playerNumberInput").addEventListener("input", ()=>{
  if(isPlayer(selected)){
    selected.number = document.getElementById("playerNumberInput").value.trim();
    draw();
  }
});
document.getElementById("playerRoleInput").addEventListener("input", ()=>{
  if(isPlayer(selected)){
    selected.role = document.getElementById("playerRoleInput").value.trim();
    updateInspector();
    draw();
  }
});
document.getElementById("delayInput").addEventListener("input", ()=>{
  if(selected){
    selected.delay = Math.max(0, Number(document.getElementById("delayInput").value) || 0);
    selected.startDelay = selected.delay;
  }
});
document.getElementById("speedInput").addEventListener("input", ()=>{
  if(selected) selected.speed = Math.max(.5, Number(document.getElementById("speedInput").value) || 2);
});

document.getElementById("playerNameInput").addEventListener("change", ()=>pushHistory("Edit player name"));
document.getElementById("playerNumberInput").addEventListener("change", ()=>pushHistory("Edit player number"));
document.getElementById("playerRoleInput").addEventListener("change", ()=>pushHistory("Edit player role"));
document.getElementById("delayInput").addEventListener("change", ()=>pushHistory("Edit timing"));
document.getElementById("speedInput").addEventListener("change", ()=>pushHistory("Edit speed"));

function makeObj(type,x,y){
  const obj = {
    id: Date.now()+Math.random(),
    type,
    x,y,
    startX:x,
    startY:y,
    startOwnerId:null,
    ownerId:null,
    path:[],
    pathIndex:0,
    delay:0,
    startDelay:0,
    speed:type==="ball" ? 4 : 2,
    pass:null,
    facing:0,
    dribblePhase:0,
    playerName:"",
    number:"",
    role:""
  };
  objects.push(obj);
  selected = obj;
  updateInspector();
  pushHistory(`Add ${type}`);
}

function getMouse(e){
  const r = canvas.getBoundingClientRect();
  return {x:e.clientX-r.left,y:e.clientY-r.top};
}

function maybeSnap(x,y){
  if(!settings.snap) return {x,y};
  const size = Math.max(10, settings.snapSize || 20);
  return {
    x:Math.round(x / size) * size,
    y:Math.round(y / size) * size
  };
}

canvas.addEventListener("mousedown", e=>{
  const raw = getMouse(e);
  const hit = getObjectAt(raw.x,raw.y);
  const m = maybeSnap(raw.x,raw.y);

  if(tool === "select"){
    selected = hit;
    if(hit){
      dragging = true;
      dragOffsetX = m.x - hit.x;
      dragOffsetY = m.y - hit.y;
    }
  }
  else if(tool === "arrow"){
    if(selected) addRoutePoint(selected,m.x,m.y,"move");
  }
  else if(tool === "drop"){
    if(selected && isPlayer(selected)) addRoutePoint(selected,m.x,m.y,"drop");
  }
  else if(tool === "attach"){
    handleAttachTool(hit);
  }
  else if(tool === "pass"){
    handlePassTool(hit);
  }
  else{
    makeObj(tool,m.x,m.y);
  }
  updateInspector();
  draw();
});

canvas.addEventListener("mousemove", e=>{
  if(dragging && selected && !playing){
    const m = getMouse(e);
    const p = maybeSnap(m.x - dragOffsetX, m.y - dragOffsetY);
    selected.x = p.x;
    selected.y = p.y;
    selected.startX = selected.x;
    selected.startY = selected.y;
    if(selected.ownerId) detachOwnedBall(selected);
    updateBallsForOwners(0);
    trashHot = isInTrash(m.x,m.y);
    draw();
  }
});

canvas.addEventListener("mouseup", e=>{
  const m = getMouse(e);
  if(dragging && selected && isInTrash(m.x,m.y)){
    removeObject(selected);
    selected = null;
    pushHistory("Delete object");
  }else if(dragging && selected){
    pushHistory("Move object");
  }
  dragging = false;
  trashHot = false;
  updateInspector();
  draw();
});

function addRoutePoint(o,x,y,action){
  const style = action === "drop" ? "dashed" : document.getElementById("routeStyle").value;
  o.path.push({x,y,action,style,done:false});
  pushHistory(action === "drop" ? "Add drop-off" : "Add route point");
}

function handleAttachTool(hit){
  if(!hit) return;
  if(hit.type === "ball"){
    pendingAttachBall = hit;
    selected = hit;
    return;
  }
  if(isPlayer(hit)){
    const ball = pendingAttachBall || (selected && selected.type === "ball" ? selected : nearestFreeBall(hit.x,hit.y));
    if(ball){
      attachBall(ball,hit);
      selected = hit;
      pendingAttachBall = null;
      pushHistory("Attach ball");
    }
  }
}

function handlePassTool(hit){
  if(!hit || !isPlayer(hit) || !selected || !isPlayer(selected) || hit === selected) return;
  selected.path.push({
    x:selected.x,
    y:selected.y,
    action:"pass",
    style:"pass",
    targetId:hit.id,
    done:false
  });
  pushHistory("Add pass");
}

function attachBall(ball,player){
  ball.ownerId = player.id;
  ball.startOwnerId = player.id;
  ball.path = [];
  ball.pass = null;
  positionBallWithOwner(ball, player, 0);
}

function detachOwnedBall(player){
  for(const ball of objects.filter(o=>o.type==="ball" && o.ownerId===player.id)){
    ball.ownerId = null;
    ball.startOwnerId = null;
    ball.startX = ball.x;
    ball.startY = ball.y;
  }
}

function nearestFreeBall(x,y){
  let best = null;
  let bestDist = Infinity;
  for(const ball of objects.filter(o=>o.type==="ball" && !o.ownerId)){
    const d = Math.hypot(ball.x-x, ball.y-y);
    if(d < bestDist){ best = ball; bestDist = d; }
  }
  return bestDist < 70 ? best : null;
}

function isInTrash(x,y){
  return x >= trashBox.x && x <= trashBox.x + trashBox.w && y >= trashBox.y && y <= trashBox.y + trashBox.h;
}

function removeObject(obj){
  if(!obj) return;
  if(isPlayer(obj)){
    for(const ball of objects.filter(o=>o.type==="ball" && o.ownerId===obj.id)){
      ball.ownerId = null;
      ball.startOwnerId = null;
    }
  }
  objects = objects.filter(o=>o !== obj);
  for(const o of objects){
    o.path = (o.path || []).filter(p=>p.targetId !== obj.id);
    if(o.ownerId === obj.id) o.ownerId = null;
    if(o.startOwnerId === obj.id) o.startOwnerId = null;
  }
}

function getObjectAt(x,y){
  for(let i=objects.length-1;i>=0;i--){
    const o = objects[i];
    const r = radius(o);
    if(Math.hypot(x-o.x,y-o.y) < r+7) return o;
  }
  return null;
}

function radius(o){
  if(o.type==="ball") return 11;
  if(o.type==="cone") return 10;
  return 16;
}

function isPlayer(o){ return o && (o.type==="red" || o.type==="blue"); }
function findObj(id){ return objects.find(o=>o.id===id); }

function getGrassPattern(){
  const key = document.getElementById("textureType").value;
  const img = textureImages[key];
  if(!img.complete || !img.naturalWidth) return null;
  if(textureCache[key]) return textureCache[key];

  const tile = document.createElement("canvas");
  tile.width = 360;
  tile.height = 360;
  const t = tile.getContext("2d");
  t.drawImage(img,0,0,tile.width,tile.height);
  t.fillStyle = key === "white" ? "rgba(16,120,53,.28)" : "rgba(0,80,26,.12)";
  t.fillRect(0,0,tile.width,tile.height);
  textureCache[key] = ctx.createPattern(tile,"repeat");
  return textureCache[key];
}

function drawField(){
  const type = document.getElementById("mapType").value;
  const pattern = getGrassPattern();
  ctx.fillStyle = pattern || "#178b35";
  ctx.fillRect(0,0,W,H);
  drawMowingBands();
  if(settings.showGrid) drawSubtleGrid();
  if(settings.showZones) drawFieldZones();
  if(type==="empty") return;

  ctx.strokeStyle = "rgba(255,255,255,.92)";
  ctx.fillStyle = "rgba(255,255,255,.92)";
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.shadowColor = "rgba(0,0,0,.22)";
  ctx.shadowBlur = 3;
  ctx.shadowOffsetY = 1;

  const margin = Math.max(34, Math.min(W,H) * .055);
  const fw = W - margin*2;
  const fh = H - margin*2;
  ctx.strokeRect(margin,margin,fw,fh);

  if(type==="full"){
    ctx.beginPath(); ctx.moveTo(W/2,margin); ctx.lineTo(W/2,H-margin); ctx.stroke();
    ctx.beginPath(); ctx.arc(W/2,H/2,Math.min(68,fh*.14),0,Math.PI*2); ctx.stroke();
    ctx.beginPath(); ctx.arc(W/2,H/2,4,0,Math.PI*2); ctx.fill();
    drawPenaltyBoxes(margin, H/2, fw);
  }

  if(type==="half"){
    ctx.beginPath(); ctx.moveTo(margin,margin); ctx.lineTo(W-margin,margin); ctx.stroke();
    const boxW = Math.min(320, fw*.45);
    ctx.strokeRect(W/2-boxW/2, margin, boxW, Math.min(136,fh*.3));
    ctx.strokeRect(W/2-boxW*.23, margin, boxW*.46, Math.min(60,fh*.14));
    ctx.beginPath(); ctx.arc(W/2, margin+Math.min(136,fh*.3), 66, 0, Math.PI); ctx.stroke();
  }
  ctx.shadowColor = "transparent";
}

function drawMowingBands(){
  const bandW = Math.max(80, W / 12);
  for(let x=-bandW;x<W+bandW;x+=bandW){
    ctx.fillStyle = Math.floor(x / bandW) % 2 === 0 ? "rgba(255,255,255,.045)" : "rgba(0,0,0,.035)";
    ctx.fillRect(x,0,bandW,H);
  }
}

function drawSubtleGrid(){
  ctx.save();
  ctx.globalAlpha = .14;
  ctx.strokeStyle = "#d9f1dc";
  ctx.lineWidth = 1;
  for(let x=0;x<W;x+=60){ ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
  for(let y=0;y<H;y+=60){ ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }
  ctx.restore();
}

function drawFieldZones(){
  const margin = Math.max(34, Math.min(W,H) * .055);
  const fw = W - margin*2;
  const fh = H - margin*2;
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,.34)";
  ctx.fillStyle = "rgba(255,255,255,.07)";
  ctx.lineWidth = 2;
  ctx.setLineDash([12,10]);
  for(let i=1;i<3;i++){
    const x = margin + fw * i / 3;
    ctx.beginPath();
    ctx.moveTo(x,margin);
    ctx.lineTo(x,margin+fh);
    ctx.stroke();
  }
  for(let i=1;i<5;i++){
    const y = margin + fh * i / 5;
    ctx.beginPath();
    ctx.moveTo(margin,y);
    ctx.lineTo(margin+fw,y);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.font = "bold 11px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const labels = [
    ["Build", margin + fw * .16, margin + 18],
    ["Middle", margin + fw * .50, margin + 18],
    ["Attack", margin + fw * .84, margin + 18],
    ["Wide", margin + fw * .04, margin + fh * .50],
    ["Wide", margin + fw * .96, margin + fh * .50]
  ];
  for(const [text,x,y] of labels) ctx.fillText(text,x,y);
  ctx.restore();
}

function drawPenaltyBoxes(margin, centerY, fieldW){
  const bigW = Math.min(132, fieldW*.16);
  const bigH = Math.min(240, H*.28);
  const smallW = Math.min(52, fieldW*.07);
  const smallH = Math.min(120, H*.14);
  ctx.strokeRect(margin, centerY-bigH/2, bigW, bigH);
  ctx.strokeRect(W-margin-bigW, centerY-bigH/2, bigW, bigH);
  ctx.strokeRect(margin, centerY-smallH/2, smallW, smallH);
  ctx.strokeRect(W-margin-smallW, centerY-smallH/2, smallW, smallH);
}

function drawObjects(){
  for(const o of objects) drawPath(o);
  for(const o of objects.filter(o=>o.type!=="ball")) drawObject(o);
  for(const o of objects.filter(o=>o.type==="ball")) drawObject(o);
  if(pendingAttachBall) drawPulse(pendingAttachBall.x,pendingAttachBall.y,22,"#61d4ff");
  drawTrash();
}

function drawObject(o){
  if(o.type==="red" || o.type==="blue") drawPlayer(o, o.type==="red" ? "#d92d2d" : "#1d70e0");
  if(o.type==="ball") drawBall(o);
  if(o.type==="cone") drawCone(o);
  if(o===selected) drawPulse(o.x,o.y,radius(o)+8,"#ffe45f");
}

function drawPulse(x,y,r,color){
  ctx.strokeStyle=color;
  ctx.lineWidth=3;
  ctx.setLineDash([7,5]);
  ctx.beginPath();
  ctx.arc(x,y,r,0,Math.PI*2);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawPlayer(o, color){
  const grad = ctx.createRadialGradient(o.x-5,o.y-7,2,o.x,o.y,18);
  grad.addColorStop(0,"#ffffff"); grad.addColorStop(.18,color); grad.addColorStop(1,"#09141d");
  ctx.fillStyle = grad;
  ctx.beginPath(); ctx.arc(o.x,o.y,16,0,Math.PI*2); ctx.fill();
  ctx.strokeStyle="rgba(255,255,255,.9)"; ctx.lineWidth=2; ctx.stroke();
  ctx.fillStyle="white"; ctx.font="bold 12px Arial"; ctx.textAlign="center"; ctx.textBaseline="middle";
  ctx.fillText(o.number || "P",o.x,o.y+1);
  if(!settings.showLabels) return;
  const labelParts = [o.role, o.playerName].filter(Boolean);
  const label = labelParts[0] === labelParts[1] ? labelParts[0] : labelParts.join(" ");
  if(label){
    ctx.font="bold 11px Arial";
    ctx.fillStyle="rgba(255,255,255,.96)";
    ctx.strokeStyle="rgba(0,0,0,.65)";
    ctx.lineWidth=3;
    ctx.strokeText(label,o.x,o.y+30);
    ctx.fillText(label,o.x,o.y+30);
  }
}

function drawTrash(){
  ctx.save();
  ctx.globalAlpha = trashHot ? 1 : .82;
  ctx.fillStyle = trashHot ? "rgba(214,58,58,.96)" : "rgba(17,22,26,.82)";
  ctx.strokeStyle = trashHot ? "#ffd2d2" : "rgba(255,255,255,.7)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  roundRect(trashBox.x,trashBox.y,trashBox.w,trashBox.h,12);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 2.4;
  const cx = trashBox.x + trashBox.w/2;
  const cy = trashBox.y + trashBox.h/2;
  ctx.beginPath();
  ctx.moveTo(cx-13,cy-13);
  ctx.lineTo(cx+13,cy-13);
  ctx.moveTo(cx-7,cy-18);
  ctx.lineTo(cx+7,cy-18);
  ctx.moveTo(cx-9,cy-9);
  ctx.lineTo(cx-7,cy+16);
  ctx.lineTo(cx+7,cy+16);
  ctx.lineTo(cx+9,cy-9);
  ctx.stroke();
  ctx.restore();
}

function roundRect(x,y,w,h,r){
  ctx.moveTo(x+r,y);
  ctx.arcTo(x+w,y,x+w,y+h,r);
  ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r);
  ctx.arcTo(x,y,x+w,y,r);
  ctx.closePath();
}

function drawBall(o){
  ctx.save();
  ctx.translate(o.x,o.y);
  ctx.rotate((drillTime * 4 + o.dribblePhase) % (Math.PI*2));
  ctx.shadowColor="rgba(0,0,0,.32)";
  ctx.shadowBlur=5;
  ctx.shadowOffsetY=3;
  if(ballImage.complete && ballImage.naturalWidth){
    ctx.drawImage(ballImage,-12,-12,24,24);
  }else{
    ctx.fillStyle="white";
    ctx.beginPath(); ctx.arc(0,0,10,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle="#121212"; ctx.lineWidth=1.5; ctx.stroke();
  }
  ctx.restore();
}

function drawCone(o){
  ctx.fillStyle="rgba(0,0,0,.28)";
  ctx.beginPath(); ctx.ellipse(o.x,o.y+8,11,4,0,0,Math.PI*2); ctx.fill();
  ctx.fillStyle="#ff8c19";
  ctx.beginPath(); ctx.moveTo(o.x,o.y-10); ctx.lineTo(o.x-10,o.y+10); ctx.lineTo(o.x+10,o.y+10); ctx.closePath(); ctx.fill();
  ctx.strokeStyle="#ffd099"; ctx.lineWidth=2;
  ctx.beginPath(); ctx.moveTo(o.x-5,o.y); ctx.lineTo(o.x+5,o.y); ctx.stroke();
}

function drawPath(o){
  if(!o.path.length) return;
  let px=o.startX, py=o.startY;
  for(const p of o.path){
    if(p.action === "pass"){
      const receiver = findObj(p.targetId);
      if(receiver) drawArrow(px,py,receiver.startX,receiver.startY,"pass","pass",p.targetId);
      continue;
    }
    const style = p.action === "drop" ? "drop" : p.style || "straight";
    drawArrow(px,py,p.x,p.y,style,p.action,p.targetId);
    px=p.x; py=p.y;
  }
}

function drawArrow(x1,y1,x2,y2,style,action,targetId){
  const color = style === "pass" ? "rgba(247,247,247,.95)" : action === "drop" ? "rgba(255,200,63,.95)" : "rgba(12,18,22,.9)";
  ctx.save();
  ctx.strokeStyle=color; ctx.fillStyle=color; ctx.lineWidth=style==="pass" ? 3 : 4; ctx.lineCap="round";
  if(style==="dashed" || action==="drop") ctx.setLineDash([10,8]);
  if(style==="curve" || style==="pass"){
    const midX=(x1+x2)/2, midY=(y1+y2)/2;
    const dx=x2-x1, dy=y2-y1;
    const bend = style==="pass" ? 44 : 34;
    const len=Math.hypot(dx,dy) || 1;
    const cx=midX-dy/len*bend, cy=midY+dx/len*bend;
    ctx.beginPath(); ctx.moveTo(x1,y1); ctx.quadraticCurveTo(cx,cy,x2,y2); ctx.stroke();
    const t=.92;
    const tx=(1-t)*(1-t)*x1+2*(1-t)*t*cx+t*t*x2;
    const ty=(1-t)*(1-t)*y1+2*(1-t)*t*cy+t*t*y2;
    const sx=(1-(t-.04))*(1-(t-.04))*x1+2*(1-(t-.04))*(t-.04)*cx+(t-.04)*(t-.04)*x2;
    const sy=(1-(t-.04))*(1-(t-.04))*y1+2*(1-(t-.04))*(t-.04)*cy+(t-.04)*(t-.04)*y2;
    drawArrowHead(sx,sy,tx,ty);
  }else{
    ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
    drawArrowHead(x1,y1,x2,y2);
  }
  if(action==="drop"){
    ctx.setLineDash([]);
    ctx.fillStyle="#ffd449";
    ctx.beginPath(); ctx.arc(x2,y2,5,0,Math.PI*2); ctx.fill();
  }
  if(targetId){
    ctx.setLineDash([]);
    ctx.font="bold 11px Arial"; ctx.textAlign="center"; ctx.fillText("PASS", (x1+x2)/2, (y1+y2)/2 - 8);
  }
  ctx.restore();
}

function drawArrowHead(x1,y1,x2,y2){
  const angle = Math.atan2(y2-y1,x2-x1);
  ctx.beginPath();
  ctx.moveTo(x2,y2);
  ctx.lineTo(x2-13*Math.cos(angle-Math.PI/6), y2-13*Math.sin(angle-Math.PI/6));
  ctx.lineTo(x2-13*Math.cos(angle+Math.PI/6), y2-13*Math.sin(angle+Math.PI/6));
  ctx.closePath();
  ctx.fill();
}

function draw(){
  drawField();
  drawObjects();
}

function play(){
  if(playing) return;
  drillTime = 0;
  lastFrameTime = performance.now();
  for(const o of objects){
    o.x=o.startX; o.y=o.startY; o.ownerId=o.startOwnerId || null; o.pathIndex=0; o.pass=null; o.startDelay=o.delay || 0;
    for(const p of o.path) p.done=false;
  }
  updateBallsForOwners(0);
  playing=true;
  animate(lastFrameTime);
}

function animate(now){
  const dt = Math.min(.05, (now-lastFrameTime)/1000 || .016) * (settings.playbackSpeed || 1);
  lastFrameTime = now;
  drillTime += dt;
  let allDone = true;

  for(const o of objects.filter(o=>isPlayer(o) || (o.type==="ball" && !o.ownerId && !o.pass))){
    if(updateMover(o,dt)) allDone = false;
  }
  updateBallPasses(dt);
  updateBallsForOwners(dt);
  if(objects.some(o=>o.type==="ball" && o.pass)) allDone = false;

  draw();

  if(allDone){
    if(document.getElementById("loopBox").checked){
      playing=false;
      play();
      return;
    }
    playing=false;
    return;
  }
  animationId = requestAnimationFrame(animate);
}

function updateMover(o,dt){
  if(o.startDelay > 0){
    o.startDelay -= dt;
    return o.path.length > 0;
  }
  if(o.pathIndex >= o.path.length) return false;

  const target = o.path[o.pathIndex];
  if(target.action === "pass"){
    triggerPass(o,target);
    o.pathIndex++;
    target.done=true;
    return o.pathIndex < o.path.length;
  }

  const dx = target.x - o.x;
  const dy = target.y - o.y;
  const dist = Math.hypot(dx,dy);
  const step = (o.speed || 2) * 60 * dt;
  if(dist > .01) o.facing = Math.atan2(dy,dx);

  if(dist <= step){
    o.x = target.x;
    o.y = target.y;
    if(target.action === "drop") dropBallFrom(o);
    target.done = true;
    o.pathIndex++;
  }else{
    o.x += dx/dist * step;
    o.y += dy/dist * step;
  }
  return true;
}

function triggerPass(player,command){
  const ball = objects.find(o=>o.type==="ball" && o.ownerId===player.id);
  const target = findObj(command.targetId);
  if(!ball || !target) return;
  ball.ownerId = null;
  ball.pass = {
    fromX: ball.x,
    fromY: ball.y,
    toId: target.id,
    progress: 0,
    duration: Math.max(.35, Math.hypot(target.x-ball.x,target.y-ball.y)/420)
  };
}

function updateBallPasses(dt){
  for(const ball of objects.filter(o=>o.type==="ball" && o.pass)){
    const target = findObj(ball.pass.toId);
    if(!target){ ball.pass=null; continue; }
    ball.pass.progress += dt / ball.pass.duration;
    const t = Math.min(1, ball.pass.progress);
    const eased = t < .5 ? 2*t*t : 1 - Math.pow(-2*t+2,2)/2;
    ball.x = lerp(ball.pass.fromX,target.x,eased);
    ball.y = lerp(ball.pass.fromY,target.y,eased) - Math.sin(t*Math.PI)*28;
    if(t >= 1){
      ball.pass = null;
      attachBall(ball,target);
    }
  }
}

function updateBallsForOwners(dt){
  for(const ball of objects.filter(o=>o.type==="ball" && o.ownerId && !o.pass)){
    const owner = findObj(ball.ownerId);
    if(owner) positionBallWithOwner(ball,owner,dt);
  }
}

function positionBallWithOwner(ball,owner,dt){
  const phase = performance.now()/140;
  const pulse = Math.sin(phase) * 7;
  const angle = owner.facing || 0;
  const dist = 24 + pulse;
  ball.x = owner.x + Math.cos(angle) * dist;
  ball.y = owner.y + Math.sin(angle) * dist + Math.sin(phase*1.7) * 2;
  ball.dribblePhase += dt * 8;
}

function dropBallFrom(player){
  for(const ball of objects.filter(o=>o.type==="ball" && o.ownerId===player.id)){
    ball.ownerId = null;
    ball.startOwnerId = null;
    ball.startX = ball.x;
    ball.startY = ball.y;
  }
}

function lerp(a,b,t){ return a + (b-a)*t; }

function currentState(){
  return {
    map:document.getElementById("mapType").value,
    texture:document.getElementById("textureType").value,
    routeStyle:document.getElementById("routeStyle").value,
    settings:{...settings},
    objects:cloneObjects(objects),
    selectedId:selected ? selected.id : null
  };
}

function cloneObjects(list){
  return JSON.parse(JSON.stringify(list));
}

function restoreState(state){
  if(!state) return;
  suppressHistory = true;
  document.getElementById("mapType").value = state.map || "full";
  document.getElementById("textureType").value = state.texture || "grass";
  document.getElementById("routeStyle").value = state.routeStyle || "straight";
  Object.assign(settings, {
    showGrid:true,
    showZones:false,
    snap:false,
    snapSize:20,
    showLabels:true,
    playbackSpeed:1,
    drillTitle:"",
    drillNotes:""
  }, state.settings || {});
  syncSettingsControls();
  objects = (state.objects || []).map(normalizeObject);
  selected = state.selectedId ? findObj(state.selectedId) : null;
  pendingAttachBall = null;
  suppressHistory = false;
  updateInspector();
  updateBallsForOwners(0);
  draw();
}

function normalizeObject(o){
  return {
    ...o,
    startOwnerId:o.startOwnerId || o.ownerId || null,
    ownerId:o.ownerId || o.startOwnerId || null,
    path:o.path || [],
    pathIndex:0,
    delay:o.delay || 0,
    startDelay:o.delay || 0,
    speed:o.speed || (o.type==="ball" ? 4 : 2),
    pass:null,
    facing:o.facing || 0,
    dribblePhase:0,
    playerName:o.playerName || "",
    number:o.number || "",
    role:o.role || ""
  };
}

function pushHistory(label){
  if(suppressHistory) return;
  historyStack.push(currentState());
  if(historyStack.length > 80) historyStack.shift();
  redoStack = [];
  showStatus(label || "Updated");
}

function undo(){
  if(historyStack.length <= 1){
    showStatus("Nothing to undo");
    return;
  }
  redoStack.push(historyStack.pop());
  restoreState(historyStack[historyStack.length - 1]);
  showStatus("Undid last change");
}

function redo(){
  if(!redoStack.length){
    showStatus("Nothing to redo");
    return;
  }
  const state = redoStack.pop();
  historyStack.push(state);
  restoreState(state);
  showStatus("Redid change");
}

function syncSettingsControls(){
  document.getElementById("gridToggle").checked = settings.showGrid;
  document.getElementById("zonesToggle").checked = settings.showZones;
  document.getElementById("snapToggle").checked = settings.snap;
  document.getElementById("labelsToggle").checked = settings.showLabels;
  document.getElementById("snapSizeInput").value = settings.snapSize;
  document.getElementById("playbackSpeedInput").value = settings.playbackSpeed;
  document.getElementById("drillTitleInput").value = settings.drillTitle;
  document.getElementById("drillNotesInput").value = settings.drillNotes;
}

function showStatus(text){
  const status = document.getElementById("statusText");
  if(!status) return;
  status.textContent = text;
  clearTimeout(showStatus.timer);
  showStatus.timer = setTimeout(()=>{ status.textContent = ""; }, 2600);
}

function deleteSelected(){
  if(!selected) return;
  removeObject(selected);
  selected = null;
  updateInspector();
  pushHistory("Deleted selection");
  draw();
}

function duplicateSelected(){
  if(!selected) return;
  const copy = normalizeObject(JSON.parse(JSON.stringify(selected)));
  copy.id = Date.now()+Math.random();
  copy.x += 28;
  copy.y += 28;
  copy.startX = copy.x;
  copy.startY = copy.y;
  copy.ownerId = null;
  copy.startOwnerId = null;
  copy.path = [];
  objects.push(copy);
  selected = copy;
  updateInspector();
  pushHistory("Duplicated selection");
  draw();
}

function clearSelectedRoute(){
  if(!selected) return;
  selected.path = [];
  selected.pathIndex = 0;
  pushHistory("Cleared selected route");
  draw();
}

function removeLastRoutePoint(){
  if(!selected || !selected.path || !selected.path.length) return;
  selected.path.pop();
  pushHistory("Removed route point");
  draw();
}

function saveSlot(slot){
  localStorage.setItem(`soccerPlannerSlot${slot}`, JSON.stringify(currentState()));
  showStatus(`Saved slot ${slot}`);
}

function loadSlot(slot){
  const raw = localStorage.getItem(`soccerPlannerSlot${slot}`);
  if(!raw){
    showStatus(`Slot ${slot} is empty`);
    return;
  }
  try{
    restoreState(JSON.parse(raw));
    pushHistory(`Loaded slot ${slot}`);
  }catch(e){
    showStatus(`Slot ${slot} could not load`);
  }
}

function exportImage(){
  const link = document.createElement("a");
  const safeTitle = (settings.drillTitle || "soccer-drill").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
  link.download = `${safeTitle || "soccer-drill"}.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();
  showStatus("PNG exported");
}

function copyShareCode(){
  exportDrill();
  const text = document.getElementById("dataBox").value;
  if(navigator.clipboard){
    navigator.clipboard.writeText(text).then(()=>showStatus("Export code copied"));
  }else{
    document.getElementById("dataBox").select();
    document.execCommand("copy");
    showStatus("Export code copied");
  }
}

const presets = {
  "433":[
    ["GK","1","Keeper",.08,.50],["RB","2","RB",.23,.78],["RCB","4","RCB",.20,.58],["LCB","5","LCB",.20,.42],["LB","3","LB",.23,.22],
    ["6","6","6",.40,.50],["8","8","8",.52,.36],["10","10","10",.55,.64],["RW","7","RW",.75,.78],["ST","9","ST",.82,.50],["LW","11","LW",.75,.22]
  ],
  "4231":[
    ["GK","1","Keeper",.08,.50],["RB","2","RB",.24,.78],["RCB","4","RCB",.20,.58],["LCB","5","LCB",.20,.42],["LB","3","LB",.24,.22],
    ["6","6","6",.40,.42],["8","8","8",.40,.58],["RW","7","RW",.62,.76],["10","10","10",.64,.50],["LW","11","LW",.62,.24],["ST","9","ST",.82,.50]
  ],
  "352":[
    ["GK","1","Keeper",.08,.50],["RCB","4","RCB",.22,.68],["CB","5","CB",.19,.50],["LCB","3","LCB",.22,.32],
    ["RWB","2","RWB",.48,.84],["6","6","6",.42,.50],["8","8","8",.54,.38],["10","10","10",.58,.62],["LWB","11","LWB",.48,.16],["ST","9","ST",.78,.42],["ST","7","ST",.78,.58]
  ],
  "box":[
    ["GK","1","Keeper",.08,.50],["RCB","4","RCB",.22,.58],["LCB","5","LCB",.22,.42],["RB","2","RB",.30,.78],["LB","3","LB",.30,.22],
    ["6","6","6",.44,.42],["6","8","6",.44,.58],["10","10","10",.61,.42],["10","11","10",.61,.58],["9","9","ST",.80,.50]
  ]
};

const scenarios = {
  kickoff:{
    title:"Kickoff Pattern",
    notes:"9 checks short, 10 receives the set, 7 and 11 stretch the line, 8 arrives late for the third action.",
    map:"full",
    players:[
      ["r9","red","ST","9","9",.50,.50],["r10","red","10","10","10",.45,.48],["r8","red","8","8","8",.38,.43],
      ["r6","red","6","6","6",.31,.55],["r7","red","RW","7","7",.62,.75],["r11","red","LW","11","11",.62,.25],
      ["b6","blue","6","6","6",.68,.50],["b4","blue","CB","4","CB",.78,.42],["b5","blue","CB","5","CB",.78,.58]
    ],
    ball:["ball",.50,.50,"r9"],
    routes:[
      ["r9",[["move",.46,.50],["pass","r10"]]],
      ["r10",[["move",.53,.46],["pass","r8"]]],
      ["r8",[["move",.58,.38]]],
      ["r7",[["move",.72,.78]]],
      ["r11",[["move",.72,.22]]]
    ]
  },
  goalKick:{
    title:"Goal Kick Buildout",
    notes:"Keeper splits center backs, 6 drops into the pocket, fullback pins wide, then pass through the 6 or around pressure.",
    map:"full",
    players:[
      ["gk","red","GK","1","Keeper",.08,.50],["rcb","red","RCB","4","RCB",.18,.60],["lcb","red","LCB","5","LCB",.18,.40],
      ["rb","red","RB","2","RB",.28,.82],["lb","red","LB","3","LB",.28,.18],["six","red","6","6","6",.34,.50],
      ["eight","red","8","8","8",.46,.40],["nine","red","ST","9","9",.70,.50],
      ["p9","blue","ST","9","Press",.31,.50],["p7","blue","RW","7","Press",.36,.70],["p11","blue","LW","11","Press",.36,.30]
    ],
    ball:["ball",.08,.50,"gk"],
    routes:[
      ["gk",[["pass","lcb"]]],["lcb",[["move",.24,.36],["pass","six"]]],["six",[["move",.42,.50],["pass","eight"]]],
      ["rb",[["move",.42,.84]]],["lb",[["move",.42,.16]]],["p9",[["move",.24,.50]]],["p7",[["move",.31,.62]]],["p11",[["move",.31,.38]]]
    ]
  },
  corner:{
    title:"Corner Kick Routine",
    notes:"Near-post runner clears space, 9 attacks the penalty spot, 5 attacks back post, 10 delays for the second ball.",
    map:"full",
    players:[
      ["taker","red","W","7","Taker",.94,.08],["near","red","ST","9","Near",.86,.38],["spot","red","9","9","Spot",.82,.50],
      ["back","red","CB","5","Back",.86,.64],["edge","red","10","10","Edge",.75,.50],["cover","red","6","6","Cover",.70,.30],
      ["d1","blue","CB","4","Mark",.88,.42],["d2","blue","CB","5","Mark",.88,.58],["gk","blue","GK","1","GK",.95,.50]
    ],
    ball:["ball",.94,.08,"taker"],
    cones:[[.84,.38],[.82,.50],[.86,.64],[.75,.50]],
    routes:[
      ["near",[["move",.92,.33]]],["spot",[["move",.88,.49]]],["back",[["move",.91,.67]]],
      ["edge",[["move",.79,.52]]],["taker",[["pass","spot"]]]
    ]
  },
  throwIn:{
    title:"Throw-In Combination",
    notes:"Bounce pass into the 8, blind-side run by winger, return pass behind the line.",
    map:"full",
    players:[
      ["thrower","red","RB","2","Throw",.52,.88],["eight","red","8","8","Check",.55,.72],["wing","red","RW","7","Runner",.64,.82],
      ["six","red","6","6","Support",.44,.68],["nine","red","ST","9","Pin",.75,.58],
      ["d1","blue","LB","3","Def",.60,.78],["d2","blue","6","6","Def",.62,.65]
    ],
    ball:["ball",.52,.88,"thrower"],
    routes:[
      ["thrower",[["pass","eight"]]],["eight",[["move",.58,.72],["pass","wing"]]],["wing",[["move",.72,.83]]],
      ["six",[["move",.49,.64]]],["nine",[["move",.80,.54]]]
    ]
  },
  pressTrap:{
    title:"Pressing Trap",
    notes:"Show play into the fullback, winger jumps outside shoulder, 9 blocks the return, 8 steps to the 6.",
    map:"full",
    players:[
      ["bcb","blue","CB","5","CB",.78,.42],["blb","blue","LB","3","LB",.68,.18],["bsix","blue","6","6","6",.63,.50],
      ["r9","red","ST","9","9",.62,.42],["r7","red","RW","7","Press",.58,.20],["r8","red","8","8","Step",.52,.50],["r6","red","6","6","Cover",.45,.60]
    ],
    ball:["ball",.78,.42,"bcb"],
    routes:[
      ["bcb",[["pass","blb"]]],["r7",[["move",.66,.19]]],["r9",[["move",.69,.39]]],["r8",[["move",.61,.50]]],["r6",[["move",.53,.57]]]
    ]
  },
  rondo:{
    title:"4v2 Rondo",
    notes:"Four outside players keep the ball, two defenders press. Use delayed movement to show the next passing lane.",
    map:"empty",
    players:[
      ["a","red","A","1","A",.38,.35],["b","red","B","2","B",.62,.35],["c","red","C","3","C",.62,.65],["d","red","D","4","D",.38,.65],
      ["p1","blue","P","1","Press",.48,.50],["p2","blue","P","2","Press",.54,.50]
    ],
    ball:["ball",.38,.35,"a"],
    cones:[[.35,.32],[.65,.32],[.65,.68],[.35,.68]],
    routes:[
      ["a",[["pass","b"]]],["b",[["pass","c"]]],["c",[["pass","d"]]],["d",[["pass","a"]]],
      ["p1",[["move",.56,.42],["move",.48,.58]]],["p2",[["move",.46,.58],["move",.55,.43]]]
    ]
  },
  overlap:{
    title:"Wide Overlap Pattern",
    notes:"Winger checks inside with the ball, fullback overlaps, 8 supports underneath, 9 attacks the box.",
    map:"full",
    players:[
      ["wing","red","RW","7","Winger",.54,.78],["fb","red","RB","2","Overlap",.42,.82],["eight","red","8","8","Support",.46,.62],
      ["nine","red","ST","9","9",.72,.50],["ten","red","10","10","Edge",.66,.60],
      ["d1","blue","LB","3","Def",.62,.76],["d2","blue","CB","5","Def",.78,.54]
    ],
    ball:["ball",.54,.78,"wing"],
    routes:[
      ["wing",[["move",.59,.70],["pass","fb"]]],["fb",[["move",.68,.84],["move",.78,.76]]],
      ["eight",[["move",.56,.62]]],["nine",[["move",.82,.50]]],["ten",[["move",.74,.60]]]
    ]
  },
  thirdMan:{
    title:"Third-Man Run",
    notes:"6 plays into 9, 9 sets to 10, 8 runs beyond as the third player.",
    map:"full",
    players:[
      ["six","red","6","6","6",.36,.50],["nine","red","ST","9","Set",.56,.50],["ten","red","10","10","Link",.49,.42],["eight","red","8","8","Runner",.48,.60],
      ["cb1","blue","CB","4","Def",.67,.46],["cb2","blue","CB","5","Def",.67,.58],["sixb","blue","6","6","Def",.55,.55]
    ],
    ball:["ball",.36,.50,"six"],
    routes:[
      ["six",[["pass","nine"]]],["nine",[["pass","ten"]]],["ten",[["pass","eight"]]],["eight",[["move",.68,.64]]]
    ]
  },
  counter:{
    title:"Counterattack 3v2",
    notes:"Ball carrier drives central, wide runners split defenders, pass when the center back steps.",
    map:"full",
    players:[
      ["carrier","red","10","10","Carry",.34,.50],["left","red","LW","11","Left",.36,.30],["right","red","RW","7","Right",.36,.70],
      ["def1","blue","CB","4","Def",.68,.44],["def2","blue","CB","5","Def",.68,.58],["gk","blue","GK","1","GK",.93,.50]
    ],
    ball:["ball",.34,.50,"carrier"],
    routes:[
      ["carrier",[["move",.54,.50],["pass","right"]]],["left",[["move",.68,.28]]],["right",[["move",.70,.70]]],
      ["def1",[["move",.58,.48]]],["def2",[["move",.66,.62]]]
    ]
  }
};

function loadScenario(){
  const key = document.getElementById("scenarioPreset").value;
  const scenario = scenarios[key] || scenarios.kickoff;
  stop();
  objects = [];
  selected = null;
  pendingAttachBall = null;
  document.getElementById("mapType").value = scenario.map || "full";
  settings.drillTitle = scenario.title || "";
  settings.drillNotes = scenario.notes || "";
  syncSettingsControls();

  const map = {};
  for(const item of scenario.players || []){
    const [key,team,role,number,name,xPct,yPct] = item;
    const player = scenarioPlayer(team, role, number, name, xPct, yPct);
    map[key] = player;
    objects.push(player);
  }
  for(const item of scenario.cones || []){
    const [xPct,yPct] = item;
    objects.push(scenarioObject("cone", xPct, yPct));
  }
  if(scenario.ball){
    const [key,xPct,yPct,ownerKey] = scenario.ball;
    const ball = scenarioObject("ball", xPct, yPct);
    map[key] = ball;
    objects.push(ball);
    if(ownerKey && map[ownerKey]) attachBall(ball, map[ownerKey]);
  }
  for(const route of scenario.routes || []){
    const [actorKey,steps] = route;
    const actor = map[actorKey];
    if(!actor) continue;
    actor.path = [];
    for(const step of steps){
      if(step[0] === "pass"){
        const target = map[step[1]];
        if(target){
          actor.path.push({x:actor.x,y:actor.y,action:"pass",style:"pass",targetId:target.id,done:false});
        }
      }else{
        const [,xPct,yPct,style] = step;
        const p = fieldPoint(xPct,yPct);
        actor.path.push({x:p.x,y:p.y,action:step[0] || "move",style:style || document.getElementById("routeStyle").value,done:false});
      }
    }
  }
  updateInspector();
  pushHistory(`Loaded ${scenario.title}`);
  draw();
}

function scenarioPlayer(team,role,number,name,xPct,yPct){
  const point = fieldPoint(xPct,yPct);
  return {
    id: Date.now()+Math.random(),
    type:team,
    x:point.x,
    y:point.y,
    startX:point.x,
    startY:point.y,
    startOwnerId:null,
    ownerId:null,
    path:[],
    pathIndex:0,
    delay:0,
    startDelay:0,
    speed:2,
    pass:null,
    facing:team==="blue" ? Math.PI : 0,
    dribblePhase:0,
    playerName:name || role,
    number:number || "",
    role:role || ""
  };
}

function scenarioObject(type,xPct,yPct){
  const point = fieldPoint(xPct,yPct);
  return {
    id: Date.now()+Math.random(),
    type,
    x:point.x,
    y:point.y,
    startX:point.x,
    startY:point.y,
    startOwnerId:null,
    ownerId:null,
    path:[],
    pathIndex:0,
    delay:0,
    startDelay:0,
    speed:type==="ball" ? 4 : 2,
    pass:null,
    facing:0,
    dribblePhase:0,
    playerName:"",
    number:"",
    role:""
  };
}

function fieldPoint(xPct,yPct){
  const b = fieldBounds();
  return {
    x:b.margin + b.fw * xPct,
    y:b.margin + b.fh * yPct
  };
}

function fieldBounds(){
  const margin = Math.max(34, Math.min(W,H) * .055);
  return {
    margin,
    fw:W - margin*2,
    fh:H - margin*2
  };
}

function loadPreset(team){
  stop();
  const shape = presets[document.getElementById("formationPreset").value] || presets["433"];
  const currentTeam = objects.filter(o=>o.type===team);
  for(const player of currentTeam) removeObject(player);
  const margin = Math.max(34, Math.min(W,H) * .055);
  const fw = W - margin*2;
  const fh = H - margin*2;
  for(const [role,number,name,xPct,yPct] of shape){
    const x = team === "blue" ? margin + fw * (1 - xPct) : margin + fw * xPct;
    const y = margin + fh * yPct;
    const obj = {
      id: Date.now()+Math.random(),
      type:team,
      x,y,startX:x,startY:y,
      startOwnerId:null,ownerId:null,path:[],pathIndex:0,
      delay:0,startDelay:0,speed:2,pass:null,facing:team==="blue" ? Math.PI : 0,dribblePhase:0,
      playerName:name,number,role
    };
    objects.push(obj);
  }
  selected = null;
  updateInspector();
  pushHistory(`Loaded ${team} preset`);
  draw();
}

function stop(){
  playing=false;
  cancelAnimationFrame(animationId);
  for(const o of objects){
    o.x=o.startX; o.y=o.startY; o.ownerId=o.startOwnerId || null; o.pathIndex=0; o.pass=null; o.startDelay=o.delay || 0;
    for(const p of o.path) p.done=false;
  }
  drillTime = 0;
  updateBallsForOwners(0);
  draw();
}

function clearArrows(){
  for(const o of objects) o.path=[];
  pushHistory("Cleared all routes");
  draw();
}

function clearAll(){
  objects=[]; selected=null; pendingAttachBall=null; updateInspector(); pushHistory("Cleared all"); draw();
}

function updateInspector(){
  const name = document.getElementById("selectedName");
  const delay = document.getElementById("delayInput");
  const speed = document.getElementById("speedInput");
  const playerFields = document.getElementById("playerFields");
  const playerName = document.getElementById("playerNameInput");
  const playerNumber = document.getElementById("playerNumberInput");
  const playerRole = document.getElementById("playerRoleInput");
  if(!selected){
    name.textContent = tool === "attach" ? "Click a ball, then a player" : "No selection";
    playerFields.classList.remove("active");
    playerName.value = "";
    playerNumber.value = "";
    playerRole.value = "";
    delay.value = 0; speed.value = 2;
    return;
  }
  const owner = selected.type === "ball" && selected.ownerId ? findObj(selected.ownerId) : null;
  const title = isPlayer(selected) ? `${selected.type === "red" ? "Red" : "Blue"} ${selected.role || "player"}` : selected.type.charAt(0).toUpperCase() + selected.type.slice(1);
  name.textContent = owner ? "Ball attached to player" : title;
  playerFields.classList.toggle("active", isPlayer(selected));
  playerName.value = selected.playerName || "";
  playerNumber.value = selected.number || "";
  playerRole.value = selected.role || "";
  delay.value = selected.delay || 0;
  speed.value = selected.speed || 2;
}

function exportDrill(){
  const data = {
    map: document.getElementById("mapType").value,
    texture: document.getElementById("textureType").value,
    routeStyle: document.getElementById("routeStyle").value,
    settings:{...settings},
    objects
  };
  document.getElementById("dataBox").value = JSON.stringify(data,null,2);
}

function importDrill(){
  try{
    const data = JSON.parse(document.getElementById("dataBox").value);
    document.getElementById("mapType").value = data.map || "full";
    document.getElementById("textureType").value = data.texture || "grass";
    document.getElementById("routeStyle").value = data.routeStyle || "straight";
    Object.assign(settings, data.settings || {});
    syncSettingsControls();
    objects = (data.objects || []).map(normalizeObject);
    selected = null;
    pendingAttachBall = null;
    updateInspector();
    updateBallsForOwners(0);
    pushHistory("Imported drill");
    draw();
  }catch(e){
    alert("Invalid drill data");
  }
}

document.addEventListener("keydown", e=>{
  const tag = document.activeElement ? document.activeElement.tagName : "";
  const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
  if((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z"){
    e.preventDefault();
    undo();
    return;
  }
  if((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y"){
    e.preventDefault();
    redo();
    return;
  }
  if(typing) return;
  if(e.key === "Delete" || e.key === "Backspace"){
    e.preventDefault();
    deleteSelected();
  }
  if(e.key === "Escape"){
    setTool("select");
    selected = null;
    updateInspector();
    draw();
  }
  const step = e.shiftKey ? 10 : 2;
  const moveKeys = {
    ArrowLeft:[-step,0],
    ArrowRight:[step,0],
    ArrowUp:[0,-step],
    ArrowDown:[0,step]
  };
  if(selected && moveKeys[e.key]){
    e.preventDefault();
    const [dx,dy] = moveKeys[e.key];
    selected.x += dx;
    selected.y += dy;
    selected.startX = selected.x;
    selected.startY = selected.y;
    updateBallsForOwners(0);
    pushHistory("Nudged selection");
    draw();
  }
});

syncSettingsControls();
pushHistory("Initial state");
resize();

