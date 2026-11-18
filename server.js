const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");
const path = require("path");
const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  console.error("ERROR: Please set DATABASE_URL to a PostgreSQL connection string.");
  process.exit(1);
}
if (!process.env.ADMIN_PASSWORD) {
  console.error("ERROR: Please set ADMIN_PASSWORD in the Render environment.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

const DEFAULT_QUESTIONS = [
 ["สัตว์ชนิดใดสามารถนอนหลับโดยลืมตาได้?",["ปลา","สุนัข","แมว","กระต่าย"],0,"ปลาบางชนิดไม่มีเปลือกตา จึงหลับโดยลืมตา","ความรู้ทั่วไป"],
 ["1 กิโลกรัม เท่ากับกี่กรัม?",["10 กรัม","100 กรัม","1,000 กรัม","10,000 กรัม"],2,"1 กิโลกรัมเท่ากับ 1,000 กรัม","คณิตศาสตร์"],
 ["ดาวเคราะห์ดวงใดอยู่ใกล้ดวงอาทิตย์มากที่สุด?",["โลก","ดาวพุธ","ดาวศุกร์","ดาวอังคาร"],1,"ดาวพุธเป็นดาวเคราะห์วงในสุด","วิทยาศาสตร์"],
 ["ถ้ามีไข่ 6 ฟอง ตอกแตก 2 ฟอง จะเหลือไข่กี่ฟอง?",["2 ฟอง","4 ฟอง","6 ฟอง","8 ฟอง"],2,"ไข่ที่ตอกแตกก็ยังเป็นไข่อยู่ จึงยังมี 6 ฟอง","เชาวน์ปัญญา"],
 ["สีใดเกิดจากการผสมสีน้ำเงินกับสีเหลือง?",["สีม่วง","สีเขียว","สีส้ม","สีแดง"],1,"สีน้ำเงินผสมสีเหลืองได้สีเขียว","ความรู้ทั่วไป"],
 ["ประเทศไทยมีทั้งหมดกี่ภาคตามการแบ่งแบบ 6 ภาค?",["4 ภาค","5 ภาค","6 ภาค","7 ภาค"],2,"การแบ่งภูมิภาคแบบ 6 ภาคมี 6 ภาค","สังคมศึกษา"],
 ["อวัยวะใดทำหน้าที่สูบฉีดเลือด?",["ปอด","ตับ","หัวใจ","ไต"],2,"หัวใจทำหน้าที่สูบฉีดเลือดไปทั่วร่างกาย","วิทยาศาสตร์"],
 ["ถ้าวันนี้เป็นวันจันทร์ อีก 3 วันจะเป็นวันอะไร?",["วันอังคาร","วันพุธ","วันพฤหัสบดี","วันศุกร์"],2,"นับไป 3 วันคือ อังคาร พุธ พฤหัสบดี","คณิตศาสตร์"],
 ["มหาสมุทรที่มีขนาดใหญ่ที่สุดคือมหาสมุทรใด?",["แอตแลนติก","อินเดีย","อาร์กติก","แปซิฟิก"],3,"มหาสมุทรแปซิฟิกมีพื้นที่ใหญ่ที่สุด","สังคมศึกษา"],
 ["เลขใดเป็นจำนวนเฉพาะ?",["9","15","17","21"],2,"17 มีตัวหารบวกเพียง 1 และ 17","คณิตศาสตร์"]
];

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS questions (
      id BIGSERIAL PRIMARY KEY,
      question TEXT NOT NULL,
      options JSONB NOT NULL,
      correct_index INTEGER NOT NULL CHECK (correct_index BETWEEN 0 AND 3),
      explanation TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'ทั่วไป',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM questions");
  if (rows[0].n === 0) {
    for (const q of DEFAULT_QUESTIONS) {
      await pool.query(
        "INSERT INTO questions(question, options, correct_index, explanation, category) VALUES($1,$2,$3,$4,$5)",
        [q[0], JSON.stringify(q[1]), q[2], q[3], q[4]]
      );
    }
    console.log("Seeded 10 starter questions.");
  }
  console.log("Database ready.");
}

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.json({ limit: "200kb" }));
app.use(express.static(path.join(__dirname, "public")));
app.get("/admin", (_req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));
app.get("/health", (_req, res) => res.json({ ok: true }));

function safeEqual(a, b) {
  const aa = Buffer.from(String(a || ""));
  const bb = Buffer.from(String(b || ""));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
function requireAdmin(req, res, next) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const expected = crypto.createHash("sha256").update(process.env.ADMIN_PASSWORD).digest("hex");
  const actual = crypto.createHash("sha256").update(token).digest("hex");
  if (!safeEqual(actual, expected) || !token) return res.status(401).json({ error: "รหัสผู้ดูแลไม่ถูกต้องหรือหมดอายุ กรุณาเข้าสู่ระบบใหม่" });
  next();
}
function validateQuestion(body) {
  const question = String(body.question || "").trim();
  const options = Array.isArray(body.options) ? body.options.map(x => String(x || "").trim()) : [];
  const correct = Number(body.correct_index);
  const explanation = String(body.explanation || "").trim();
  const category = String(body.category || "ทั่วไป").trim().slice(0, 60) || "ทั่วไป";
  if (!question) return "กรุณากรอกโจทย์";
  if (options.length !== 4 || options.some(x => !x)) return "กรุณากรอกตัวเลือกให้ครบทั้ง 4 ข้อ";
  if (!Number.isInteger(correct) || correct < 0 || correct > 3) return "กรุณาเลือกคำตอบที่ถูกต้อง";
  if (question.length > 1000 || options.some(x => x.length > 300)) return "ข้อความยาวเกินกำหนด";
  return null;
}

app.post("/api/admin/login", (req, res) => {
  if (!safeEqual(req.body.password, process.env.ADMIN_PASSWORD)) return res.status(401).json({ error: "รหัสผ่านไม่ถูกต้อง" });
  res.json({ token: process.env.ADMIN_PASSWORD });
});
app.get("/api/admin/questions", requireAdmin, async (_req, res) => {
  try {
    const { rows } = await pool.query("SELECT id, question, options, correct_index, explanation, category FROM questions ORDER BY id DESC");
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ error: "อ่านคลังคำถามไม่สำเร็จ" }); }
});
app.post("/api/admin/questions", requireAdmin, async (req, res) => {
  const err = validateQuestion(req.body); if (err) return res.status(400).json({ error: err });
  const { question, options, correct_index, explanation = "", category = "ทั่วไป" } = req.body;
  try {
    const { rows } = await pool.query(
      "INSERT INTO questions(question, options, correct_index, explanation, category) VALUES($1,$2,$3,$4,$5) RETURNING id, question, options, correct_index, explanation, category",
      [question.trim(), JSON.stringify(options.map(x => x.trim())), Number(correct_index), String(explanation).trim(), String(category).trim() || "ทั่วไป"]
    );
    res.status(201).json(rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: "บันทึกคำถามไม่สำเร็จ" }); }
});
app.put("/api/admin/questions/:id", requireAdmin, async (req, res) => {
  const err = validateQuestion(req.body); if (err) return res.status(400).json({ error: err });
  const { question, options, correct_index, explanation = "", category = "ทั่วไป" } = req.body;
  try {
    const { rows } = await pool.query(
      "UPDATE questions SET question=$1, options=$2, correct_index=$3, explanation=$4, category=$5, updated_at=NOW() WHERE id=$6 RETURNING id, question, options, correct_index, explanation, category",
      [question.trim(), JSON.stringify(options.map(x => x.trim())), Number(correct_index), String(explanation).trim(), String(category).trim() || "ทั่วไป", req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "ไม่พบคำถามนี้" });
    res.json(rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: "แก้ไขคำถามไม่สำเร็จ" }); }
});
app.delete("/api/admin/questions/:id", requireAdmin, async (req, res) => {
  try {
    const result = await pool.query("DELETE FROM questions WHERE id=$1", [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ error: "ไม่พบคำถามนี้" });
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: "ลบคำถามไม่สำเร็จ" }); }
});

const rooms = new Map();
function makePin() { let p; do { p = String(Math.floor(100000 + Math.random() * 900000)); } while (rooms.has(p)); return p; }
function roomState(r) {
  const q = r.phase === "question" ? r.questions[r.qIndex] : null;
  const counts = [0, 0, 0, 0]; for (const v of r.votes.values()) counts[v]++;
  return { pin:r.pin, phase:r.phase, level:r.level, qNumber:r.qNumber, players:[...r.players.values()],
    playerCount:r.players.size, question:q ? { q:q.question, a:q.options } : null,
    endsAt:r.phase === "question" ? r.endsAt : null,
    counts, totalVotes:r.votes.size, result:r.result };
}
function broadcast(r) { io.to(r.pin).emit("state", roomState(r)); }
function resolveQuestion(r) {
  if (!r || r.phase !== "question") return;
  if (r.timer) clearTimeout(r.timer);
  r.timer = null;
  r.endsAt = null;
  const q=r.questions[r.qIndex], counts=[0,0,0,0];
  for(const v of r.votes.values()) counts[v]++;
  const max=Math.max(...counts), winners=counts.map((v,i)=>v===max?i:-1).filter(i=>i>=0);
  if(max===0||winners.length>1){
    r.result={tie:true,winners,counts,message:max===0?"หมดเวลาและไม่มีคนโหวต":"คะแนนเสมอกัน! ให้โหวตใหม่"};
    r.phase="tie";
  } else {
    const winner=winners[0],correct=winner===q.correct_index;
    if(correct) r.level=Math.min(10,r.level+1); else r.level=1;
    r.result={tie:false,winner,correct,correctAnswer:q.correct_index,why:q.explanation,counts,level:r.level,won:r.level===10&&correct};
    r.phase="result";
  }
  broadcast(r);
}
function startQuestion(r) {
  if (r.timer) clearTimeout(r.timer);
  r.phase="question"; r.votes.clear(); r.result=null;
  r.endsAt=Date.now()+60000;
  r.timer=setTimeout(()=>resolveQuestion(r),60000);
  broadcast(r);
}

io.on("connection", socket => {
  socket.on("host:create", async (_data, cb) => {
    try {
      const { rows } = await pool.query("SELECT id, question, options, correct_index, explanation, category FROM questions ORDER BY random()");
      if (!rows.length) return cb({ ok:false, error:"ยังไม่มีคำถาม กรุณาเพิ่มคำถามในหน้าแอดมินก่อน" });
      const pin = makePin();
      const r = { pin, host:socket.id, players:new Map(), votes:new Map(), phase:"lobby", level:1, qIndex:0, qNumber:1, result:null, questions:rows, endsAt:null, timer:null };
      rooms.set(pin,r); socket.join(pin); socket.data.pin=pin; socket.data.role="host";
      cb({ ok:true, pin }); broadcast(r);
    } catch (e) { console.error(e); cb({ ok:false, error:"โหลดคำถามไม่สำเร็จ กรุณาลองใหม่" }); }
  });
  socket.on("player:join", ({pin,name}, cb) => {
    const r=rooms.get(String(pin||"").trim()), n=String(name||"").trim().slice(0,20);
    if (!r) return cb({ok:false,error:"ไม่พบห้องนี้ ตรวจสอบรหัสอีกครั้ง"});
    if (!n) return cb({ok:false,error:"กรุณาใส่ชื่อเล่น"});
    r.players.set(socket.id,n); socket.join(r.pin); socket.data.pin=r.pin; socket.data.role="player";
    cb({ok:true,pin:r.pin}); broadcast(r);
  });
  socket.on("host:start", () => {
    const r=rooms.get(socket.data.pin); if(!r||r.host!==socket.id||r.phase!=="lobby")return;
    startQuestion(r);
  });
  socket.on("player:vote", ({choice}) => {
    const r=rooms.get(socket.data.pin); if(!r||socket.data.role!=="player"||r.phase!=="question")return;
    if(!Number.isInteger(choice)||choice<0||choice>3||r.votes.has(socket.id))return;
    r.votes.set(socket.id,choice); socket.emit("vote:accepted"); broadcast(r);
  });
  socket.on("host:reveal", () => {
    const r=rooms.get(socket.data.pin); if(!r||r.host!==socket.id||r.phase!=="question")return;
    resolveQuestion(r);
  });
  socket.on("host:revote", () => {
    const r=rooms.get(socket.data.pin); if(!r||r.host!==socket.id||r.phase!=="tie")return;
    startQuestion(r);
  });
  socket.on("host:next", () => {
    const r=rooms.get(socket.data.pin);if(!r||r.host!==socket.id||r.phase!=="result")return;
    if(r.result?.won){r.phase="finished";broadcast(r);return;}
    r.qIndex++;r.qNumber++;
    if(r.qIndex>=r.questions.length)r.qIndex=0;
    startQuestion(r);
  });
  socket.on("host:reset", () => {
    const r=rooms.get(socket.data.pin);if(!r||r.host!==socket.id)return;
    if(r.timer) clearTimeout(r.timer);
    r.timer=null;r.endsAt=null;r.phase="lobby";r.level=1;r.qIndex=0;r.qNumber=1;r.votes.clear();r.result=null;broadcast(r);
  });
  socket.on("disconnect", () => {
    const r=rooms.get(socket.data.pin);if(!r)return;
    if(socket.data.role==="player")r.players.delete(socket.id);
    if(r.host===socket.id){if(r.timer)clearTimeout(r.timer);io.to(r.pin).emit("room:closed");rooms.delete(r.pin);return;}
    broadcast(r);
  });
});

const PORT=process.env.PORT||3000;
initDb().then(()=>server.listen(PORT,"0.0.0.0",()=>console.log(`Server listening on ${PORT}`)))
  .catch(err=>{console.error("Database initialization failed:",err);process.exit(1);});
