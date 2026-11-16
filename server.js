const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static(path.join(__dirname, "public")));

const QUESTIONS = [
 {q:"สัตว์ชนิดใดสามารถนอนหลับโดยลืมตาได้?",a:["ปลา","สุนัข","แมว","กระต่าย"],c:0,why:"ปลาบางชนิดไม่มีเปลือกตา จึงหลับโดยลืมตา"},
 {q:"1 กิโลกรัม เท่ากับกี่กรัม?",a:["10 กรัม","100 กรัม","1,000 กรัม","10,000 กรัม"],c:2,why:"1 กิโลกรัมเท่ากับ 1,000 กรัม"},
 {q:"ดาวเคราะห์ดวงใดอยู่ใกล้ดวงอาทิตย์มากที่สุด?",a:["โลก","ดาวพุธ","ดาวศุกร์","ดาวอังคาร"],c:1,why:"ดาวพุธเป็นดาวเคราะห์วงในสุด"},
 {q:"ถ้ามีไข่ 6 ฟอง ตอกแตก 2 ฟอง จะเหลือไข่กี่ฟอง?",a:["2 ฟอง","4 ฟอง","6 ฟอง","8 ฟอง"],c:2,why:"ไข่ที่ตอกแตกก็ยังเป็นไข่อยู่ จึงยังมี 6 ฟอง"},
 {q:"สีใดเกิดจากการผสมสีน้ำเงินกับสีเหลือง?",a:["สีม่วง","สีเขียว","สีส้ม","สีแดง"],c:1,why:"สีน้ำเงินผสมสีเหลืองได้สีเขียว"},
 {q:"ประเทศไทยมีทั้งหมดกี่ภาคตามการแบ่งแบบ 6 ภาค?",a:["4 ภาค","5 ภาค","6 ภาค","7 ภาค"],c:2,why:"การแบ่งภูมิภาคแบบ 6 ภาคมี 6 ภาค"},
 {q:"อวัยวะใดทำหน้าที่สูบฉีดเลือด?",a:["ปอด","ตับ","หัวใจ","ไต"],c:2,why:"หัวใจทำหน้าที่สูบฉีดเลือดไปทั่วร่างกาย"},
 {q:"ถ้าวันนี้เป็นวันจันทร์ อีก 3 วันจะเป็นวันอะไร?",a:["วันอังคาร","วันพุธ","วันพฤหัสบดี","วันศุกร์"],c:2,why:"นับไป 3 วันคือ อังคาร พุธ พฤหัสบดี"},
 {q:"มหาสมุทรที่มีขนาดใหญ่ที่สุดคือมหาสมุทรใด?",a:["แอตแลนติก","อินเดีย","อาร์กติก","แปซิฟิก"],c:3,why:"มหาสมุทรแปซิฟิกมีพื้นที่ใหญ่ที่สุด"},
 {q:"เลขใดเป็นจำนวนเฉพาะ?",a:["9","15","17","21"],c:2,why:"17 มีตัวหารบวกเพียง 1 และ 17"}
];
const rooms = new Map();
function pin(){ let p; do { p=String(Math.floor(100000+Math.random()*900000)); } while(rooms.has(p)); return p; }
function publicRoom(r){
 const q = r.phase==="question" ? QUESTIONS[r.qIndex % QUESTIONS.length] : null;
 const counts=[0,0,0,0];
 for(const v of r.votes.values()) counts[v]++;
 return {pin:r.pin,phase:r.phase,level:r.level,qNumber:r.qNumber,players:[...r.players.values()],playerCount:r.players.size,
   question:q?{q:q.q,a:q.a}:null,counts,totalVotes:r.votes.size,deadline:r.deadline,
   result:r.result,hostName:r.hostName};
}
function broadcast(r){io.to(r.pin).emit("state",publicRoom(r));}
io.on("connection", socket=>{
 socket.on("host:create",({name},cb)=>{
   const p=pin(),r={pin:p,host:socket.id,hostName:String(name||"พิธีกร").slice(0,24),players:new Map(),votes:new Map(),phase:"lobby",level:1,qIndex:0,qNumber:1,deadline:null,result:null};
   rooms.set(p,r);socket.join(p);socket.data.pin=p;socket.data.role="host";
   cb({ok:true,pin:p});broadcast(r);
 });
 socket.on("player:join",({pin:p,name},cb)=>{
   const r=rooms.get(String(p||"").trim());
   const n=String(name||"").trim().slice(0,20);
   if(!r)return cb({ok:false,error:"ไม่พบห้องนี้ ตรวจสอบรหัสอีกครั้ง"});
   if(!n)return cb({ok:false,error:"กรุณาใส่ชื่อเล่น"});
   if(r.phase==="question"||r.phase==="result"){} // late joiners may watch and vote only if question open
   const id=socket.id;r.players.set(id,n);socket.join(r.pin);socket.data.pin=r.pin;socket.data.role="player";
   cb({ok:true,pin:r.pin});broadcast(r);
 });
 socket.on("host:start",()=>{
   const r=rooms.get(socket.data.pin);if(!r||r.host!==socket.id)return;
   r.phase="question";r.votes.clear();r.result=null;r.deadline=Date.now()+20000;broadcast(r);
 });
 socket.on("player:vote",({choice})=>{
   const r=rooms.get(socket.data.pin);if(!r||socket.data.role!=="player"||r.phase!=="question")return;
   if(!Number.isInteger(choice)||choice<0||choice>3)return;
   r.votes.set(socket.id,choice);socket.emit("vote:accepted");broadcast(r);
 });
 socket.on("host:reveal",()=>{
   const r=rooms.get(socket.data.pin);if(!r||r.host!==socket.id||r.phase!=="question")return;
   const q=QUESTIONS[r.qIndex%QUESTIONS.length],counts=[0,0,0,0];
   for(const v of r.votes.values())counts[v]++;
   const max=Math.max(...counts),winners=counts.map((v,i)=>v===max?i:-1).filter(i=>i>=0);
   if(max===0){r.result={tie:true,message:"ยังไม่มีคนโหวต"};r.phase="result";}
   else if(winners.length>1){r.result={tie:true,winners,counts,message:"คะแนนเสมอกัน! ให้โหวตใหม่"};r.phase="tie";}
   else{
     const winner=winners[0],correct=winner===q.c;
     if(correct)r.level=Math.min(10,r.level+1);else r.level=1;
     r.result={tie:false,winner,correct,correctAnswer:q.c,why:q.why,counts,level:r.level,won:r.level===10&&correct};
     r.phase="result";
   }
   r.deadline=null;broadcast(r);
 });
 socket.on("host:revote",()=>{
   const r=rooms.get(socket.data.pin);if(!r||r.host!==socket.id||r.phase!=="tie")return;
   r.votes.clear();r.result=null;r.phase="question";r.deadline=Date.now()+20000;broadcast(r);
 });
 socket.on("host:next",()=>{
   const r=rooms.get(socket.data.pin);if(!r||r.host!==socket.id||r.phase!=="result")return;
   if(r.result?.won){r.phase="finished";broadcast(r);return;}
   r.qIndex++;r.qNumber++;r.votes.clear();r.result=null;r.phase="question";r.deadline=Date.now()+20000;broadcast(r);
 });
 socket.on("host:reset",()=>{
   const r=rooms.get(socket.data.pin);if(!r||r.host!==socket.id)return;
   r.phase="lobby";r.level=1;r.qIndex=0;r.qNumber=1;r.votes.clear();r.result=null;r.deadline=null;broadcast(r);
 });
 socket.on("disconnect",()=>{
   const p=socket.data.pin,r=rooms.get(p);if(!r)return;
   if(socket.data.role==="player")r.players.delete(socket.id);
   if(r.host===socket.id){io.to(p).emit("room:closed");rooms.delete(p);return;}
   broadcast(r);
 });
});
const PORT=process.env.PORT||3000;
server.listen(PORT,()=>console.log(`ปริศนาฟ้าแลบพร้อมที่ http://localhost:${PORT}`));
