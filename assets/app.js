
const ALL_CARDS=Object.values(CARD_POOLS).flat();
const IMPLEMENTED_PACKS=["JP-HISTORY","ENGLISH","MODERN-JP","CLASSICAL-JP"];
const PACK_CONFIG={
  "MODERN-JP":{normal:[["U",75],["R",20],["SR",4],["SSR",1]],fifth:[["R",85],["SR",12],["SSR",3]]},
  "JP-HISTORY":{normal:[["U",75],["R",20],["SR",4],["SSR",1]],fifth:[["R",85],["SR",12],["SSR",3]]},
  "ENGLISH":{normal:[["C",30],["U",45],["R",20],["SR",4],["SSR",1]],fifth:[["R",85],["SR",12],["SSR",3]]},
  "CLASSICAL-JP":{normal:[["U",75],["R",20],["SR",4],["SSR",1]],fifth:[["R",85],["SR",12],["SSR",3]]}
};
const SUBJECT_SYMBOLS={"JP-HISTORY":"史","ENGLISH":"英","MODERN-JP":"現","CLASSICAL-JP":"古"};
const KEY="study_tcg_proto_save_v1";
const CURRENT_SCHEMA=3;
const APP_VERSION="1.8";
const THRESHOLD=1800;
const SUBJECTS={"JP-HISTORY":"日本史","ENGLISH":"英語","MODERN-JP":"現代文","CLASSICAL-JP":"古文"};
const SUBJECT_IDS=Object.keys(SUBJECTS);
const RANK={C:0,U:1,R:2,SR:3,SSR:4};

function defaultSave(){
  return {
    schemaVersion:CURRENT_SCHEMA,
    appVersion:APP_VERSION,
    collection:{},
    firstAcquired:{},
    parallels:{},
    packs:{},
    studyCarrySeconds:{},
    studyRecords:{},
    timerState:null,
    openingHistory:[],
    pendingOpen:null,
    meta:{
      createdAt:new Date().toISOString(),
      lastUpdatedAt:new Date().toISOString()
    }
  };
}
function migrateSave(raw){
  let s=(raw && typeof raw==="object") ? raw : {};

  // v0 / 旧版 → v1相当
  s.collection=s.collection||{};
  s.firstAcquired=s.firstAcquired||{};
  s.parallels=s.parallels||{};
  s.packs=s.packs||{};
  s.studyCarrySeconds=s.studyCarrySeconds||{};
  s.studyRecords=s.studyRecords||{};
  s.timerState=s.timerState||null;
  s.openingHistory=Array.isArray(s.openingHistory)?s.openingHistory:[];
  if(!("pendingOpen" in s))s.pendingOpen=null;

  // v1 → v2: メタ情報を追加。既存のゲーム進捗はそのまま。
  if(!s.meta || typeof s.meta!=="object")s.meta={};
  if(!s.meta.createdAt)s.meta.createdAt=new Date().toISOString();
  if(!s.meta.lastUpdatedAt)s.meta.lastUpdatedAt=new Date().toISOString();

  if(s.pendingOpen)normalizeOpening(s.pendingOpen);
  s.schemaVersion=CURRENT_SCHEMA;
  s.appVersion=APP_VERSION;
  return s;
}
function load(){
  let raw=null;
  try{raw=JSON.parse(localStorage.getItem(KEY)||"null")}catch(e){}
  return migrateSave(raw||defaultSave());
}
let save=load();

function persist(){
  save.schemaVersion=CURRENT_SCHEMA;
  save.appVersion=APP_VERSION;
  save.meta=save.meta||{};
  if(!save.meta.createdAt)save.meta.createdAt=new Date().toISOString();
  save.meta.lastUpdatedAt=new Date().toISOString();
  localStorage.setItem(KEY,JSON.stringify(save));
}
const pad=n=>String(n).padStart(2,"0");
const fmt=sec=>{sec=Math.max(0,Math.floor(sec));return `${pad(Math.floor(sec/3600))}:${pad(Math.floor((sec%3600)/60))}:${pad(sec%60)}`};
const localDateKey=ms=>{const d=new Date(ms);return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`};
const nextMidnight=ms=>{const d=new Date(ms);d.setHours(24,0,0,0);return d.getTime()};
const getPack=id=>Number(save.packs[id]||0), setPack=(id,n)=>save.packs[id]=Math.max(0,Number(n)||0), owned=id=>Number(save.collection[id]||0);
const dayTotal=obj=>Object.values(obj||{}).reduce((a,b)=>a+Number(b||0),0);

/* navigation */
document.querySelectorAll(".navbtn").forEach(b=>b.onclick=()=>{
  document.querySelectorAll(".navbtn").forEach(x=>x.classList.remove("active"));b.classList.add("active");
  document.querySelectorAll(".view").forEach(v=>v.classList.remove("active"));document.getElementById("view-"+b.dataset.view).classList.add("active");
  renderAll();
});

/* timer */
function getCarry(id){
  return Math.max(0,Number(save.studyCarrySeconds[id]||0));
}
function addRecord(date,id,sec){
  if(sec<=0)return;
  save.studyRecords[date]=save.studyRecords[date]||{};
  save.studyRecords[date][id]=Number(save.studyRecords[date][id]||0)+sec;
}
function splitRecord(start,end,id){
  let cur=start;
  while(cur<end){
    const edge=Math.min(nextMidnight(cur),end);
    addRecord(localDateKey(cur),id,(edge-cur)/1000);
    cur=edge;
  }
}
function applyStudySeconds(id,seconds){
  seconds=Math.max(0,Math.floor(seconds));
  const total=getCarry(id)+seconds;
  const earn=Math.floor(total/THRESHOLD);
  save.studyCarrySeconds[id]=total%THRESHOLD;
  if(earn>0)setPack(id,getPack(id)+earn);
  return {seconds,packs:earn,carry:save.studyCarrySeconds[id]};
}
function commitStudy(id,start,end){
  if(end<=start)return {seconds:0,packs:0,carry:getCarry(id)};
  const sec=Math.max(0,Math.floor((end-start)/1000));
  splitRecord(start,end,id);
  const result=applyStudySeconds(id,sec);
  persist();
  return result;
}
function commitTimerSession(timer,end){
  if(!timer?.running)return {seconds:0,packs:0,carry:0};

  const sec=Math.max(0,Math.floor((end-timer.startedAt)/1000));
  splitRecord(timer.startedAt,end,timer.subjectId);

  // STARTした瞬間の繰越値を固定して使う。
  // STOP→再開やページ再読み込みを挟んでも余り時間を失わない。
  const baseCarry=Math.max(0,Number(
    timer.carryAtStart ?? save.studyCarrySeconds[timer.subjectId] ?? 0
  ));
  const total=baseCarry+sec;
  const earn=Math.floor(total/THRESHOLD);

  save.studyCarrySeconds[timer.subjectId]=total%THRESHOLD;
  if(earn>0)setPack(timer.subjectId,getPack(timer.subjectId)+earn);

  persist();
  return {
    seconds:sec,
    packs:earn,
    carry:save.studyCarrySeconds[timer.subjectId]
  };
}
function runningElapsed(){
  return save.timerState?.running
    ? Math.max(0,Math.floor((Date.now()-save.timerState.startedAt)/1000))
    : 0;
}
function selectedStudy(){
  return save.timerState?.running
    ? save.timerState.subjectId
    : document.getElementById("studySubject").value;
}
function projectedTotal(id){
  if(save.timerState?.running && save.timerState.subjectId===id){
    const base=Math.max(0,Number(
      save.timerState.carryAtStart ?? save.studyCarrySeconds[id] ?? 0
    ));
    return base+runningElapsed();
  }
  return getCarry(id);
}
function formatBreak(obj){
  const p=SUBJECT_IDS
    .map(id=>[id,Math.floor(Number(obj?.[id]||0)/60)])
    .filter(x=>x[1]>0)
    .map(([id,m])=>`${SUBJECTS[id]} ${m}分`);
  return p.length?p.join(" / "):"記録なし";
}
function formatMS(sec){
  sec=Math.max(0,Math.floor(sec));
  return `${pad(Math.floor(sec/60))}:${pad(sec%60)}`;
}
function renderStudy(){
  const running=!!save.timerState?.running;
  const s=document.getElementById("studySubject");

  s.disabled=running;
  document.getElementById("startTimer").disabled=running;
  document.getElementById("stopTimer").disabled=!running;

  const elapsed=running?runningElapsed():0;
  document.getElementById("timer").textContent=fmt(elapsed);
  document.getElementById("timerState").textContent=running
    ? `${SUBJECTS[save.timerState.subjectId]}を計測中`
    : "停止中";

  const id=selectedStudy();
  const savedCarry=getCarry(id);
  const total=projectedTotal(id);
  const progress=total%THRESHOLD;
  const earn=Math.floor(total/THRESHOLD);
  const carryBase=running
    ? Math.max(0,Number(save.timerState.carryAtStart ?? savedCarry))
    : savedCarry;
  const remain=progress===0 ? THRESHOLD : THRESHOLD-progress;

  document.getElementById("carryState").textContent=running
    ? `前回繰越 ${formatMS(carryBase)} ＋ 今回 ${formatMS(elapsed)}`
    : `現在の繰越 ${formatMS(savedCarry)} → 次のPACKまで ${formatMS(remain)}`;

  document.getElementById("progressText").textContent=
    `${Math.floor(progress/60)}分 / 30分${earn?`（今回 +${earn}PACK予定）`:""}`;
  document.getElementById("studyBar").style.width=`${progress/THRESHOLD*100}%`;
  document.getElementById("studyReward").textContent=
    `${SUBJECTS[id]}：${getPack(id)} PACK${earn?` → STOP時 ${getPack(id)+earn}`:""}`;

  const now=new Date();
  const today=localDateKey(Date.now());
  const to=save.studyRecords[today]||{};
  document.getElementById("todayTotal").textContent=`${Math.floor(dayTotal(to)/60)}分`;
  document.getElementById("todayBreak").textContent=formatBreak(to);

  const ym=`${now.getFullYear()}-${pad(now.getMonth()+1)}`;
  const mo={};
  for(const [d,o] of Object.entries(save.studyRecords)){
    if(d.startsWith(ym+"-")){
      for(const [sid,sec] of Object.entries(o)){
        mo[sid]=Number(mo[sid]||0)+Number(sec||0);
      }
    }
  }
  document.getElementById("monthStudyTotal").textContent=`${Math.floor(dayTotal(mo)/60)}分`;
  document.getElementById("monthBreak").textContent=formatBreak(mo);

  document.getElementById("subjectStats").innerHTML=SUBJECT_IDS.map(sid=>
    `<div class="subject-card">
      <b>${SUBJECTS[sid]}</b>
      <span>繰越 ${formatMS(getCarry(sid))}</span>
      <span>${getPack(sid)} PACK</span>
    </div>`
  ).join("");
}
document.getElementById("startTimer").onclick=()=>{
  const id=document.getElementById("studySubject").value;
  save.timerState={
    running:true,
    subjectId:id,
    startedAt:Date.now(),
    carryAtStart:getCarry(id)
  };
  persist();
  renderStudy();
};
document.getElementById("stopTimer").onclick=()=>{
  if(!save.timerState?.running)return;

  const t={...save.timerState};
  const end=Date.now();
  save.timerState=null;

  const r=commitTimerSession(t,end);
  renderAll();

  document.getElementById("timerState").textContent=
    `${SUBJECTS[t.subjectId]} ${Math.floor(r.seconds/60)}分`
    +(r.packs?`・${r.packs}PACK獲得`:"")
    +`・繰越 ${formatMS(r.carry)}`;
};
document.getElementById("studySubject").onchange=renderStudy;

function devAdd(sec){
  const id=document.getElementById("studySubject").value;
  const end=Date.now();
  commitStudy(id,end-sec*1000,end);
  renderAll();
}
document.getElementById("dev15").onclick=()=>devAdd(900);
document.getElementById("dev30").onclick=()=>devAdd(1800);

/* opening */
let packSubject="JP-HISTORY",boxSubject="JP-HISTORY";
function subjectChips(container,selected,callback,onlyImplemented=false){
  const ids=onlyImplemented?IMPLEMENTED_PACKS:SUBJECT_IDS;
  container.innerHTML=ids.map(id=>`<button class="chip ${id===selected?"active":""}" data-id="${id}">${SUBJECTS[id]}</button>`).join("");
  container.querySelectorAll("button").forEach(b=>b.onclick=()=>callback(b.dataset.id));
}
function rand(){
  if(window.crypto?.getRandomValues){
    const a=new Uint32Array(1);
    crypto.getRandomValues(a);
    return a[0]/4294967296;
  }
  return Math.random();
}
function weighted(table){
  const x=rand()*100;
  let a=0;
  for(const [k,p] of table){
    a+=p;
    if(x<a)return k;
  }
  return table.at(-1)[0];
}
function cardsFor(subjectId){
  return CARD_POOLS[subjectId]||[];
}
function drawR(subjectId,rarity){
  let p=cardsFor(subjectId).filter(c=>c.rarity===rarity);
  if(!p.length)p=cardsFor(subjectId).filter(c=>c.rarity==="U");
  if(!p.length)throw new Error("この科目のカードプールが空です。");
  return p[Math.floor(rand()*p.length)];
}
function drawPack(subjectId,no=1){
  const cfg=PACK_CONFIG[subjectId];
  if(!cfg)throw new Error("この科目の抽選設定がありません。");
  const out=[];
  for(let i=1;i<=4;i++){
    const c=drawR(subjectId,weighted(cfg.normal));
    out.push({packNo:no,slot:i,cardId:c.id,rarity:c.rarity,isGuaranteed:false});
  }
  const c=drawR(subjectId,weighted(cfg.fifth));
  out.push({packNo:no,slot:5,cardId:c.id,rarity:c.rarity,isGuaranteed:false});
  return out;
}
function drawBox(subjectId){
  let r=[];
  for(let i=1;i<=10;i++)r=r.concat(drawPack(subjectId,i));

  const trig=!r.some(x=>RANK[x.rarity]>=RANK.SR);
  if(trig){
    const cand=r.map((x,i)=>[x,i]).filter(([x])=>x.rarity==="R");
    if(cand.length){
      const [,idx]=cand[Math.floor(rand()*cand.length)];
      const c=drawR(subjectId,weighted([["SR",80],["SSR",20]]));
      r[idx]={...r[idx],cardId:c.id,rarity:c.rarity,isGuaranteed:true};
    }
  }
  return [r,trig];
}
function createOpenCommitted(mode,id){
  const cost=mode==="box"?10:1;
  if(!IMPLEMENTED_PACKS.includes(id))return "この科目のカードはまだ準備中です。";
  if(getPack(id)<cost)return `未開封パックが${cost}個必要です。`;
  if(save.pendingOpen)return "保存済みの開封結果があります。先に閉じてください。";

  let result,trig=false;
  try{
    if(mode==="box"){
      [result,trig]=drawBox(id);
    }else{
      result=drawPack(id,1);
    }
  }catch(e){
    return e.message;
  }

  const before={...save.collection};
  const now=new Date().toISOString();
  setPack(id,getPack(id)-cost);

  result=result.map(x=>{
    const prev=Number(before[x.cardId]||0);
    save.collection[x.cardId]=owned(x.cardId)+1;
    if(prev===0&&!save.firstAcquired[x.cardId])save.firstAcquired[x.cardId]=now.slice(0,10);
    before[x.cardId]=prev+1;
    return {...x,isNew:prev===0};
  });

  const oid="open_"+Date.now()+"_"+Math.floor(rand()*1e8);
  save.pendingOpen={
    id:oid,mode,packId:id,openedAt:now,
    guaranteeTriggered:trig,results:result,revealIndex:0,sceneVersion:1,phase:"sealed",revealedSlots:[]
  };
  save.openingHistory.unshift({
    id:oid,mode,packId:id,openedAt:now,guaranteeTriggered:trig,
    results:result.map(x=>({
      cardId:x.cardId,rarity:x.rarity,isNew:x.isNew,isGuaranteed:x.isGuaranteed
    }))
  });
  save.openingHistory=save.openingHistory.slice(0,100);
  persist();
  return null;
}
function sym(c){
  if(c.subject==="現代文"){
    if(c.card_type==="モンスター")return "筆";
    if(c.species.includes("読解概念"))return "読";
    if(c.species.includes("表現技法"))return "技";
    return "作";
  }
  if(c.subject==="古文"){
    if(c.card_type==="呪文"){
      if(c.species.includes("助動詞"))return "助";
      if(c.species.includes("古典文法"))return "文";
      if(c.species.includes("読解"))return "読";
      if(c.species.includes("古典常識"))return "常";
      if(c.species.includes("和歌"))return "歌";
      if(c.species.includes("物語")||c.species.includes("随筆")||c.species.includes("日記")||c.species.includes("説話")||c.species.includes("歌謡"))return "作";
      return "古";
    }
    if(c.species.includes("歌人"))return "歌";
    if(c.species.includes("作者")||c.species.includes("編者"))return "筆";
    if(c.species.includes("語り手"))return "語";
    if(c.species.includes("皇族"))return "院";
    return "人";
  }

  if(c.subject==="英語"){
    if(c.card_type==="呪文"){
      if(c.species.includes("熟語"))return "熟";
      if(c.species.includes("語法"))return "語";
      return "構";
    }
    if(c.species.includes("時制"))return "時";
    if(c.species.includes("準動詞"))return "動";
    if(c.species.includes("比較"))return "比";
    if(c.species.includes("関係詞"))return "関";
    if(c.species.includes("仮定法"))return "仮";
    if(c.species.includes("節"))return "節";
    if(c.species.includes("名詞"))return "名";
    return "文";
  }

  if(c.card_type==="呪文"){
    if(c.species.includes("戦"))return "戦";
    if(c.species.includes("政"))return "政";
    if(c.species.includes("反乱")||c.species.includes("一揆"))return "乱";
    return "事";
  }
  if(c.species.includes("天皇")||c.species.includes("皇族")||c.species.includes("上皇"))return "帝";
  if(c.species.includes("僧"))return "仏";
  if(c.species.includes("武"))return "武";
  if(c.species.includes("政治家"))return "政";
  if(c.species.includes("学者")||c.species.includes("思想家")||c.species.includes("文化"))return "文";
  return c.base_name[0];
}

let revealTimer=null;
document.getElementById("showAllOpening").onclick=showAllOpening;
document.getElementById("closeOpening").onclick=closeOpening;
document.getElementById("openPack").onclick=()=>{
  const e=createOpen("pack",packSubject);
  document.getElementById("packNote").textContent=e||"結果を先に保存しました。";
  if(!e){
    renderAll();
    showPending(true);
  }
};
document.getElementById("openBox").onclick=()=>{
  const e=createOpen("box",boxSubject);
  document.getElementById("boxNote").textContent=e||"結果を先に保存しました。";
  if(!e){
    renderAll();
    showPending(true);
  }
};
function renderOpeningControls(){
  subjectChips(
    document.getElementById("packSubjects"),
    packSubject,
    id=>{packSubject=id;renderOpening();}
  );
  subjectChips(
    document.getElementById("boxSubjects"),
    boxSubject,
    id=>{boxSubject=id;renderOpening();}
  );

  document.getElementById("packCount").textContent=getPack(packSubject);
  document.getElementById("boxPackCount").textContent=getPack(boxSubject);
  document.getElementById("boxCount").textContent=Math.floor(getPack(boxSubject)/10);

  const currentPool=cardsFor(packSubject);
  document.getElementById("packCollectionLabel").textContent=`${SUBJECTS[packSubject]}図鑑`;
  document.getElementById("packKinds").textContent=currentPool.filter(c=>owned(c.id)>0).length;
  document.getElementById("packTotal").textContent=currentPool.length||"—";
  document.getElementById("packTitle").innerHTML=`${SUBJECTS[packSubject]}<br>PACK`;
  document.getElementById("packSymbol").textContent=SUBJECT_SYMBOLS[packSubject]||"?";
  document.getElementById("boxCopy").innerHTML=`${SUBJECTS[boxSubject]}<br>BOX<small>10 PACKS / 50 CARDS</small>`;

  document.getElementById("openPack").disabled=
    !IMPLEMENTED_PACKS.includes(packSubject)||getPack(packSubject)<1||!!save.pendingOpen;
  document.getElementById("openBox").disabled=
    !IMPLEMENTED_PACKS.includes(boxSubject)||getPack(boxSubject)<10||!!save.pendingOpen;

  if(packSubject==="JP-HISTORY"){
    document.getElementById("packNote").textContent="5枚入り・1〜4枚目 U75/R20/SR4/SSR1・5枚目R以上確定";
  }else if(packSubject==="ENGLISH"){
    document.getElementById("packNote").textContent="5枚入り・1〜4枚目 C30/U45/R20/SR4/SSR1・5枚目R以上確定";
  }else if(packSubject==="CLASSICAL-JP"||packSubject==="MODERN-JP"){
    document.getElementById("packNote").textContent="5枚入り・1〜4枚目 U75/R20/SR4/SSR1・5枚目R以上確定";
  }else{
    document.getElementById("packNote").textContent="カードデータ準備中。パックは勉強で貯められます。";
  }

  document.getElementById("boxNote").textContent=
    IMPLEMENTED_PACKS.includes(boxSubject)
      ?"50枚・SR以上1枚保証"
      :"カードデータ準備中。パック10個以上でも今は開封できません。";
}

/* catalog */
let catFilter="all",catQuery="",catalogSubject="JP-HISTORY";
document.getElementById("closeDetail").onclick=()=>document.getElementById("detailModal").classList.remove("open");
document.getElementById("catalogSearch").oninput=e=>{
  catQuery=e.target.value.trim();
  renderCatalog();
};
document.getElementById("catalogFilters").onclick=e=>{
  const b=e.target.closest(".chip");
  if(!b)return;
  document.querySelectorAll("#catalogFilters .chip").forEach(x=>x.classList.remove("active"));
  b.classList.add("active");
  catFilter=b.dataset.f;
  renderCatalog();
};



/* read-only opening history and release notes */
const RELEASE_NOTES=[
  {version:"1.8",description:"その場でめくるパック開封、BOXの高レア演出、複合フィルター、関連カードと詳細ナビゲーション、科目別のカードデザインに対応しました。"},
  {version:"1.7",description:"開封結果をまとめて表示できるようになりました。結果のカードから説明を開けます。「記録」から最近100回の開封履歴と更新履歴を見られます。"},
  {version:"1.6",description:"現代文60枚を追加しました。4科目・全270枚でパック、BOX、図鑑が使えます。"},
  {version:"1.5",description:"古文60枚を追加しました。古文パック・BOX・図鑑に対応しました。"},
  {version:"1.4",description:"動作確認用のカード・勉強記録のリセット機能を追加しました。"},
  {version:"1.3",description:"英語60枚を追加しました。英語パック・BOX・図鑑に対応しました。"},
  {version:"1.2",description:"セーブのバックアップ書き出し・読み込みと、セーブ形式の移行に対応しました。"}
];
const escapeHTML=value=>String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
function recentOpenings(){
  return save.openingHistory.filter(item=>item&&Array.isArray(item.results)).slice(0,100);
}
function historyDate(value){
  const d=new Date(value);
  return Number.isNaN(d.getTime())?"日時不明":d.toLocaleString("ja-JP",{year:"numeric",month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"});
}
let archiveReturnFocus=null;
function openArchive(title){
  const modal=document.getElementById("archiveModal");
  if(!modal.classList.contains("open"))archiveReturnFocus=document.activeElement;
  document.getElementById("archiveTitle").textContent=title;
  modal.classList.add("open");
}
function renderHistory(){
  openArchive("開封履歴");
  document.getElementById("archiveBack").hidden=true;
  const entries=recentOpenings();
  const content=document.getElementById("archiveContent");
  content.innerHTML=entries.length
    ?'<div class="archive-note">最近'+entries.length+'回の開封結果。タップしてカードを見返せます。</div>'+entries.map((entry,index)=>{
      const sr=entry.results.filter(x=>x&&x.rarity==="SR").length;
      const ssr=entry.results.filter(x=>x&&x.rarity==="SSR").length;
      const title=(SUBJECTS[entry.packId]||"不明な科目")+(entry.mode==="box"?" BOX":" パック");
      return '<button type="button" class="history-row" data-history-index="'+index+'"><span class="history-meta">'+escapeHTML(historyDate(entry.openedAt))+'</span><strong>'+escapeHTML(title)+'</strong><span class="history-meta">'+entry.results.length+'枚 / SR '+sr+' / SSR '+ssr+(entry.guaranteeTriggered?' / BOX保証':'')+'</span></button>';
    }).join("")
    :'<p class="archive-note">まだ開封履歴はありません。パックやBOXを開けると、ここに結果が残ります。</p>';
  content.querySelectorAll("[data-history-index]").forEach(button=>button.onclick=()=>showHistory(Number(button.dataset.historyIndex)));
}
function showHistory(index){
  const entry=recentOpenings()[index];
  if(!entry)return;
  openArchive((SUBJECTS[entry.packId]||"不明な科目")+(entry.mode==="box"?" BOX":" パック")+"の記録");
  document.getElementById("archiveBack").hidden=false;
  const content=document.getElementById("archiveContent");
  content.innerHTML='<p class="archive-note">'+escapeHTML(historyDate(entry.openedAt))+' / '+entry.results.length+'枚<br>NEW・BOX保証は開封当時の表示です。カードをタップすると説明を読めます。</p><div class="cardgrid">'+entry.results.map(x=>{
    if(!x||!ALL_CARDS.some(c=>c.id===x.cardId))return '<div class="panel archive-note">カード情報が見つかりません。</div>';
    return resultCard(x,false);
  }).join("")+'</div>';
  bindResultDetails(content);
}
function showUpdates(){
  openArchive("更新履歴");
  document.getElementById("archiveBack").hidden=true;
  document.getElementById("archiveContent").innerHTML='<p class="archive-note">現在のバージョン v'+APP_VERSION+'</p>'+RELEASE_NOTES.map(item=>'<section class="release-entry"><h3>v'+item.version+'</h3><p>'+item.description+'</p></section>').join("");
}
function closeArchive(){
  document.getElementById("archiveModal").classList.remove("open");
  document.getElementById("detailModal").classList.remove("open");
  archiveReturnFocus?.focus?.();
}
document.getElementById("openHistory").onclick=renderHistory;
document.getElementById("openUpdates").onclick=showUpdates;
document.getElementById("archiveBack").onclick=renderHistory;
document.getElementById("closeArchive").onclick=closeArchive;

/* test reset */
function setResetMessage(msg){
  const el=document.getElementById("resetMessage");
  if(el)el.textContent=msg;
}
function resetCardData(){
  if(!confirm(
    "カード所持データをリセットします。\n\n" +
    "所持カード・初獲得日・パラレル・開封履歴が消えます。\n" +
    "未開封PACKと勉強記録は残ります。\n\n実行しますか？"
  ))return;

  clearOpeningUI();
  save.collection={};
  save.firstAcquired={};
  save.parallels={};
  save.openingHistory=[];
  save.pendingOpen=null;
  persist();

  document.getElementById("openingModal").classList.remove("open");
  renderAll();
  setResetMessage("カード所持データをリセットしました。未開封PACKと勉強記録は残っています。");
}
function resetStudyData(){
  if(!confirm(
    "勉強時間をリセットします。\n\n" +
    "勉強記録・科目別繰越時間・実行中タイマーが消えます。\n" +
    "所持カードと未開封PACKは残ります。\n\n実行しますか？"
  ))return;

  save.studyCarrySeconds={};
  save.studyRecords={};
  save.timerState=null;
  persist();

  document.getElementById("studySubject").disabled=false;
  renderAll();
  setResetMessage("勉強時間と繰越時間をリセットしました。所持カードと未開封PACKは残っています。");
}
function resetAllTestData(){
  if(!confirm(
    "動作確認データをすべてリセットします。\n\n" +
    "カード・未開封PACK・勉強時間・繰越・開封履歴がすべて0になります。\n\n実行しますか？"
  ))return;

  clearOpeningUI();
  save.collection={};
  save.firstAcquired={};
  save.parallels={};
  save.openingHistory=[];
  save.pendingOpen=null;
  save.packs={};
  save.studyCarrySeconds={};
  save.studyRecords={};
  save.timerState=null;
  persist();

  document.getElementById("openingModal").classList.remove("open");
  document.getElementById("studySubject").disabled=false;
  renderAll();
  setResetMessage("動作確認データをすべてリセットしました。");
}

document.getElementById("resetCards").onclick=resetCardData;
document.getElementById("resetStudy").onclick=resetStudyData;
document.getElementById("resetAllTest").onclick=resetAllTestData;


/* backup / restore */
function buildBackupPayload(){
  return {
    format:"study-tcg-backup",
    exportedAt:new Date().toISOString(),
    appVersion:APP_VERSION,
    schemaVersion:CURRENT_SCHEMA,
    save:JSON.parse(JSON.stringify(save))
  };
}
function validateBackupPayload(payload){
  if(!payload || typeof payload!=="object")throw new Error("バックアップ形式が不正です。");
  const candidate=payload.format==="study-tcg-backup" ? payload.save : payload;
  if(!candidate || typeof candidate!=="object")throw new Error("セーブデータが見つかりません。");
  if(candidate.collection && typeof candidate.collection!=="object")throw new Error("カード所持データが壊れています。");
  if(candidate.packs && typeof candidate.packs!=="object")throw new Error("パックデータが壊れています。");
  if(candidate.studyRecords && typeof candidate.studyRecords!=="object")throw new Error("勉強記録が壊れています。");
  return migrateSave(JSON.parse(JSON.stringify(candidate)));
}
function backupFilename(){
  const d=new Date();
  return `study-tcg-backup-${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}.json`;
}
function setSaveMessage(msg){
  const el=document.getElementById("saveMessage");
  if(el)el.textContent=msg;
}
function refreshSaveStatus(){
  const schema=document.getElementById("saveSchema");
  const health=document.getElementById("saveHealth");
  const updated=document.getElementById("saveUpdated");
  if(schema)schema.textContent=`v${save.schemaVersion||CURRENT_SCHEMA}`;
  if(health)health.textContent="正常";
  if(updated){
    let v=save.meta?.lastUpdatedAt;
    updated.textContent=v ? `最終保存 ${new Date(v).toLocaleString("ja-JP",{month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"})}` : "—";
  }
}
function exportSaveFile(){
  try{
    persist();
    const payload=buildBackupPayload();
    const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");
    a.href=url;
    a.download=backupFilename();
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),2000);
    setSaveMessage("バックアップを書き出しました。iPhoneでは共有メニューから「ファイルに保存」でも保存できます。");
    refreshSaveStatus();
  }catch(e){
    setSaveMessage("書き出しに失敗しました："+e.message);
  }
}
async function copySaveText(){
  try{
    persist();
    const txt=JSON.stringify(buildBackupPayload());
    await navigator.clipboard.writeText(txt);
    setSaveMessage("バックアップJSONをコピーしました。メモなどに貼って保管できます。");
  }catch(e){
    setSaveMessage("コピーできませんでした。『バックアップを書き出す』を使ってください。");
  }
}
async function importSaveFile(file){
  try{
    if(!file) return;
    const txt=await file.text();
    const parsed=JSON.parse(txt);
    const restored=validateBackupPayload(parsed);

    // 実行中タイマーのバックアップを別端末で復元した際に、
    // 過去時刻から無制限に加算される事故を防ぐ。
    if(restored.timerState?.running){
      restored.timerState=null;
    }

    if(!confirm("現在のセーブデータを、このバックアップで置き換えます。よろしいですか？"))return;

    clearOpeningUI();
    save=restored;
    persist();
    renderAll();
    refreshSaveStatus();
    setSaveMessage("バックアップを復元しました。実行中だったタイマーだけ安全のため停止状態にしています。");
    if(save.pendingOpen)showPending(false);
  }catch(e){
    setSaveMessage("読み込みに失敗しました："+e.message);
  }finally{
    document.getElementById("importSaveFile").value="";
  }
}

/* calendar */
const now=new Date();let viewYear=now.getFullYear(),viewMonth=now.getMonth();
function intensity(sec){let m=sec/60;if(m<=0)return 0;if(m<30)return 1;if(m<60)return 2;if(m<120)return 3;if(m<240)return 4;return 5}
function monthSummary(y,m){let ym=`${y}-${pad(m+1)}-`,s={"JP-HISTORY":0,"ENGLISH":0,"MODERN-JP":0,"CLASSICAL-JP":0},grand=0,days=0;for(const [d,o] of Object.entries(save.studyRecords)){if(!d.startsWith(ym))continue;let t=dayTotal(o);grand+=t;if(t>0)days++;SUBJECT_IDS.forEach(id=>s[id]+=Number(o[id]||0))}return {s,grand,days}}
function renderCalendar(){let sm=monthSummary(viewYear,viewMonth);document.getElementById("monthTitle").textContent=`${viewYear}年 ${viewMonth+1}月`;document.getElementById("calendarMonthTotal").textContent=`合計 ${Math.floor(sm.grand/60)}分 / 勉強日 ${sm.days}日`;document.getElementById("calJP").textContent=`${Math.floor(sm.s["JP-HISTORY"]/60)}分`;document.getElementById("calEN").textContent=`${Math.floor(sm.s["ENGLISH"]/60)}分`;document.getElementById("calModern").textContent=`${Math.floor(sm.s["MODERN-JP"]/60)}分`;document.getElementById("calClassical").textContent=`${Math.floor(sm.s["CLASSICAL-JP"]/60)}分`;
  let first=new Date(viewYear,viewMonth,1).getDay(),days=new Date(viewYear,viewMonth+1,0).getDate(),prev=new Date(viewYear,viewMonth,0).getDate(),cells=[];
  for(let i=0;i<first;i++)cells.push(`<div class="day blank"><div class="date">${prev-first+i+1}</div></div>`);
  for(let d=1;d<=days;d++){let k=`${viewYear}-${pad(viewMonth+1)}-${pad(d)}`,o=save.studyRecords[k]||{},sec=dayTotal(o),today=viewYear===now.getFullYear()&&viewMonth===now.getMonth()&&d===now.getDate(),parts=SUBJECT_IDS.filter(id=>Math.floor(Number(o[id]||0)/60)>0).map(id=>`${SUBJECTS[id]} ${Math.floor(Number(o[id]||0)/60)}m`).join(" / ");cells.push(`<div class="day i${intensity(sec)} ${today?"today":""}" data-date="${k}"><div class="date">${d}</div><div class="minutes">${sec?Math.floor(sec/60)+"分":"—"}</div><div class="mini">${parts||"記録なし"}</div></div>`)}
  while(cells.length%7)cells.push(`<div class="day blank"></div>`);let cal=document.getElementById("calendar");cal.innerHTML=cells.join("");cal.querySelectorAll("[data-date]").forEach(el=>el.onclick=()=>showDay(el.dataset.date));
}
function showDay(d){let o=save.studyRecords[d]||{};document.getElementById("dayDetail").innerHTML=`<strong>${d}　${Math.floor(dayTotal(o)/60)}分</strong>${SUBJECT_IDS.map(id=>`<div class="drow"><span>${SUBJECTS[id]}</span><span>${Math.floor(Number(o[id]||0)/60)}分</span></div>`).join("")}`}
document.getElementById("prevMonth").onclick=()=>{viewMonth--;if(viewMonth<0){viewMonth=11;viewYear--}renderCalendar()};document.getElementById("nextMonth").onclick=()=>{viewMonth++;if(viewMonth>11){viewMonth=0;viewYear++}renderCalendar()};

/* render */
function renderAll(){renderStudy();renderOpening();renderCatalog();renderCalendar();refreshSaveStatus()}

document.getElementById("exportSave").onclick=exportSaveFile;
document.getElementById("copySave").onclick=copySaveText;
document.getElementById("importSaveBtn").onclick=()=>document.getElementById("importSaveFile").click();
document.getElementById("importSaveFile").onchange=e=>importSaveFile(e.target.files?.[0]);
if(save.timerState?.running){
  if(save.timerState.carryAtStart==null){
    save.timerState.carryAtStart=getCarry(save.timerState.subjectId);
    persist();
  }
  document.getElementById("studySubject").value=save.timerState.subjectId;
}


/* v1.8: presentation state is separate from the already committed draw. */
function normalizeOpening(p){
  if(!Array.isArray(p.results))p.results=[];
  const n=p.results.length;
  const legacy=!Array.isArray(p.revealedSlots);
  p.revealedSlots=legacy?Array.from({length:Math.min(n,Math.max(0,Math.floor(Number(p.revealIndex)||0)))},(_,i)=>i):[...new Set(p.revealedSlots.filter(i=>Number.isInteger(i)&&i>=0&&i<n))];
  p.revealIndex=p.revealedSlots.length;
  if(!['sealed','cards','box','results'].includes(p.phase))p.phase=p.mode==='box'?'box':'cards';
  if(p.revealIndex===n)p.phase='results';
  p.sceneVersion=1;
  return p;
}
const cardById=new Map(ALL_CARDS.map(c=>[c.id,c]));
const filters={rarity:'all',type:'all',ownership:'all',species:'all',parallel:false};
const subjectTheme={'日本史':'jp','英語':'en','古文':'cl','現代文':'md'};
let detailTrail=[],detailOrigin='catalog',detailNew=false,detailFocus=null,detailResumeBox=false;
let sceneEpoch=0,sceneTimers=new Set(),boxPaused=false,activeFlips=new Set();
const openingImageBuffer=new Map();
function warmOpeningImages(p){
  if(typeof Image==='undefined')return;
  // Only small images for the current pack / current BOX card and its two successors.
  // The saved draw is read without changing results or waiting on the network.
  const first=p.mode==='box'?p.results.findIndex((_,i)=>!p.revealedSlots.includes(i)):0;
  const items=first<0?[]:p.results.slice(first,first+(p.mode==='box'?3:5));
  const sources=new Set(items.map(x=>{const art=cardById.get(x.cardId)?.art?.normal;return art?.thumb||art?.src}).filter(Boolean));
  for(const src of openingImageBuffer.keys())if(!sources.has(src))openingImageBuffer.delete(src);
  for(const src of sources){
    if(openingImageBuffer.has(src))continue;
    const img=new Image();img.decoding='async';
    img.onerror=()=>{if(openingImageBuffer.get(src)===img)openingImageBuffer.delete(src)};
    openingImageBuffer.set(src,img);img.src=src;
  }
}
const $=id=>document.getElementById(id);
const reducedMotion=()=>!!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const effectDuration=r=>reducedMotion()?0:({SSR:3500,SR:1200,R:300}[r]||180);
function later(fn,ms){
  const epoch=sceneEpoch,id=setTimeout(()=>{sceneTimers.delete(id);if(epoch===sceneEpoch)fn();},ms);
  sceneTimers.add(id);return id;
}
function createOpen(mode,id){
  const before=JSON.stringify(save);
  try{return createOpenCommitted(mode,id)}catch(e){
    save=JSON.parse(before);
    return '保存できませんでした。端末の空き容量を確認してから、もう一度お試しください。';
  }
}
function artMarkup(c,detail=false){
  const art=c.art?.normal;
  if(art?.src)return `<img class="card-art" src="${escapeHTML(detail?art.src:(art.thumb||art.src))}" width="${detail?640:320}" height="${detail?960:480}" loading="lazy" decoding="async" alt="${escapeHTML(c.base_name)}のイラスト">`;
  return `<div class="emblem-field"><span class="emblem-ring"><span>${escapeHTML(sym(c))}</span></span>${RANK[c.rarity]>=2?'<small class="art-pending">イラスト準備中</small>':''}</div>`;
}
function cardFace(c,{known=true,isNew=false,guaranteed=false,detail=false}={}){
  const ep=c.display_name.replace(c.base_name,'').trim();
  return `<div class="tcg-face theme-${subjectTheme[c.subject]} rarity-${c.rarity} ${known?'':'unowned'}">
    <div class="art-window">${known?artMarkup(c,detail):'<div class="emblem-field"><span class="emblem-ring"><span>?</span></span></div>'}</div>
    <div class="card-foil" aria-hidden="true"></div>
    <div class="face-top"><b>${c.rarity}</b><span>${escapeHTML(c.subject)}</span></div>
    <div class="face-label"><small>${known?escapeHTML(ep):'未獲得カード'}</small><strong>${known?escapeHTML(c.base_name):'???'}</strong><span>${known?escapeHTML(c.card_type+' / '+c.species):'獲得すると詳細が解放されます'}</span></div>
    <div class="face-tags">${isNew?'<span class="tag-new">NEW</span>':''}${guaranteed?'<span class="tag-guaranteed">保証枠</span>':''}</div>
  </div>`;
}
function catalogCard(c){
  const known=owned(c.id)>0;
  return `<button type="button" class="tcg-card catalog-card" data-id="${c.id}" aria-label="${escapeHTML(known?c.base_name+'の詳細':'未獲得カード '+c.rarity)}">${cardFace(c,{known})}<span class="card-summary">${known?escapeHTML(c.description_short||c.description):'獲得すると解説が読めます。'}</span><span class="card-count">${known?'所持 ×'+owned(c.id):'未所持'}${Number(save.parallels[c.id]||0)>0?' / パラレル ×'+Number(save.parallels[c.id]):''}</span></button>`;
}
function resultCard(x,pending=true){
  const c=cardById.get(x.cardId);if(!c)return '';
  return `<button type="button" class="tcg-card result-card" data-card-id="${c.id}" data-new="${x.isNew?'true':'false'}" aria-label="${escapeHTML(c.base_name)}の詳細">${cardFace(c,{isNew:x.isNew,guaranteed:x.isGuaranteed})}<span class="card-summary">${escapeHTML(c.description_short||c.description)}</span></button>`;
}
function bindResultDetails(grid){
  grid.querySelectorAll('[data-card-id]').forEach(el=>el.onclick=()=>openDetail(el.dataset.cardId,{origin:grid===$('openingGrid')?'opening':'history',isNew:el.dataset.new==='true'}));
}
function matchCard(c){
  const has=owned(c.id)>0;
  return (filters.rarity==='all'||c.rarity===filters.rarity)
    &&(filters.type==='all'||c.card_type===filters.type)
    &&(filters.ownership==='all'||(filters.ownership==='owned'?has:!has))
    &&(filters.species==='all'||c.species===filters.species)
    &&(!filters.parallel||Number(save.parallels[c.id]||0)>0)
    &&(!catQuery||c.display_name.toLocaleLowerCase().includes(catQuery.toLocaleLowerCase()));
}
function renderCatalog(){
  subjectChips($('catalogSubjects'),catalogSubject,id=>{catalogSubject=id;renderCatalog()},true);
  const pool=cardsFor(catalogSubject),species=[...new Set(pool.map(c=>c.species))].sort((a,b)=>a.localeCompare(b,'ja'));
  if(filters.species!=='all'&&!species.includes(filters.species))filters.species='all';
  $('speciesFilter').innerHTML='<option value="all">すべて</option>'+species.map(s=>`<option value="${escapeHTML(s)}">${escapeHTML(s)}</option>`).join('');
  $('speciesFilter').value=filters.species;
  const list=pool.filter(matchCard),count=Object.values(filters).filter(v=>v!==false&&v!=='all').length+(catQuery?1:0);
  $('filterCount').textContent=`${count?'・'+count+'条件 / ':''}${list.length}枚`;
  $('catalogSubjectLabel').textContent=SUBJECTS[catalogSubject];
  $('catalogOwned').textContent=pool.filter(c=>owned(c.id)>0).length;
  $('catalogTotal').textContent=pool.length;
  const grid=$('catalogGrid');grid.innerHTML=list.length?list.map(catalogCard).join(''):'<p class="empty-state">条件に合うカードがありません。絞り込みを変えてみてください。</p>';
  grid.querySelectorAll('[data-id]').forEach(el=>el.onclick=()=>openDetail(el.dataset.id));
}
function resetCatalogFilters(){
  Object.assign(filters,{rarity:'all',type:'all',ownership:'all',species:'all',parallel:false});
  catQuery='';catalogSubject='JP-HISTORY';$('catalogSearch').value='';
  ['rarity','type','ownership','species'].forEach(k=>$(k+'Filter').value='all');
  $('parallelFilter').checked=false;renderCatalog();
}
function openDetail(id,options={}){
  if(!cardById.has(id))return;
  detailFocus=document.activeElement;detailTrail=[id];detailOrigin=options.origin||'catalog';detailNew=!!options.isNew;
  detailResumeBox=detailOrigin==='opening'&&save.pendingOpen?.mode==='box'&&!boxPaused&&save.pendingOpen.phase==='box';
  if(detailResumeBox){stopReveal();boxPaused=true;}
  renderDetail();$('detailModal').classList.add('open');$('closeDetail').focus({preventScroll:true});
  $('detailModal').querySelector('.sheet').scrollTop=0;
}
function renderDetail(){
  const id=detailTrail[detailTrail.length-1],c=cardById.get(id);if(!c)return;
  const known=owned(id)>0;
  const related=known?(c.related_cards||[]).map(r=>cardById.get(r)).filter(Boolean):[];
  $('detailBack').hidden=detailTrail.length<2;
  $('closeDetail').textContent=detailOrigin==='opening'?'開封に戻る':'閉じる';
  $('detailContent').innerHTML=`<div class="detail-card-wrap ${c.rarity==='SSR'?'ssr-detail':''}">${cardFace(c,{known,isNew:detailTrail.length===1&&detailNew,detail:true})}</div>
    <h2 id="detailHeading" class="detail-title">${known?escapeHTML(c.base_name):'未獲得カード'}</h2>
    <p class="detail-small">${known?escapeHTML(c.display_name.replace(c.base_name,'').trim()):'???'}</p>
    <div class="detail-meta">${escapeHTML(c.rarity+' / '+c.subject)}${known?' / '+escapeHTML(c.card_type+' / '+c.species+' / '+c.period):''}</div>
    ${known?`<p class="detail-overview">${escapeHTML(c.description_short||c.description)}</p><section class="learning-section" aria-labelledby="learningHeading"><h3 id="learningHeading">学習解説</h3><p class="detail-desc">${escapeHTML(c.description_long||c.description_short||c.description)}</p></section>`:'<p class="detail-desc">このカードはまだ獲得していません。獲得するとイラストや説明が解放されます。</p>'}
    <div class="detail-stats"><span>所持枚数 <b>${owned(id)}枚</b></span><span>初獲得日 <b>${known?escapeHTML(save.firstAcquired[id]||'—'):'—'}</b></span><span>パラレル <b>${Number(save.parallels[id]||0)}枚</b></span></div>
    ${known?'<section class="related-section"><h3>関連カード</h3>'+(related.length?'<div class="related-grid">'+related.map(r=>`<button class="related-link" data-related="${r.id}"><span>${escapeHTML(r.rarity+' / '+r.subject)}</span><strong>${owned(r.id)>0?escapeHTML(r.base_name):'???'}</strong><small>${owned(r.id)>0?'詳細を見る →':'未獲得'}</small></button>`).join('')+'</div>':'<p class="detail-small">関連カードは今後の追加をお待ちください。</p>')+'</section>':''}`;
  $('detailContent').querySelectorAll('[data-related]').forEach(el=>el.onclick=()=>{detailTrail.push(el.dataset.related);renderDetail();$('detailBack').focus({preventScroll:true});});
  $('detailModal').querySelector('.sheet').scrollTop=0;
}
function closeDetail(){
  $('detailModal').classList.remove('open');detailTrail=[];
  detailFocus?.focus?.({preventScroll:true});
  if(detailResumeBox&&save.pendingOpen&&$('openingModal').classList.contains('open')){boxPaused=false;runBox();}
  detailResumeBox=false;
}
function stopReveal(){
  if(revealTimer!==null)clearInterval(revealTimer);revealTimer=null;
  sceneEpoch++;sceneTimers.forEach(id=>clearTimeout(id));sceneTimers.clear();activeFlips.clear();
}
function clearOpeningUI(){
  stopReveal();boxPaused=false;detailResumeBox=false;detailTrail=[];
  openingImageBuffer.clear();
  ['openingModal','detailModal','archiveModal'].forEach(id=>$(id).classList.remove('open'));
}
function renderOpening(){
  renderOpeningControls();$('resumeBanner').hidden=!save.pendingOpen;
}
function updateRevealProgress(p){
  const count=p.revealedSlots.length,done=count===p.results.length;
  $('openingProgress').textContent=`${count} / ${p.results.length}枚を公開${!done&&p.phase==='cards'?' ・好きなカードをタップ':''}`;
  $('closeOpening').disabled=!done||activeFlips.size>0;
  $('showAllOpening').disabled=done;
  $('showAllOpening').hidden=p.phase==='sealed';
  $('viewOpeningResults').hidden=!done||p.phase==='results'||activeFlips.size>0;
  $('pauseBox').hidden=p.mode!=='box'||p.phase!=='box'||done;
  $('pauseBox').textContent=boxPaused?'続きから再生':'一時停止';
  $('openingSummary').textContent=p.phase==='results'?`SR ${p.results.filter(x=>x.rarity==='SR').length} / SSR ${p.results.filter(x=>x.rarity==='SSR').length}`:(p.mode==='box'?'10 PACKS / 50 CARDS':'5 CARDS');
}
function backFace(x,index){
  return `<span class="card-back ${x.rarity==='SSR'?'rainbow-omen':''}"><span class="back-seal">STUDY<br><b>TCG</b></span><small>${index+1}</small></span>`;
}
function flipButton(x,index,p){
  const revealed=p.revealedSlots.includes(index),c=cardById.get(x.cardId);
  return `<button type="button" class="fan-card ${revealed?'is-revealed':''}" style="--slot:${index};--angle:${(index-2)*5}deg" data-slot="${index}" aria-label="${revealed?escapeHTML(c?.base_name||'カード')+'の詳細':'裏向きのカード '+(index+1)}">${revealed?cardFace(c,{isNew:x.isNew,guaranteed:x.isGuaranteed}):backFace(x,index)}</button>`;
}
function showPending(){
  stopReveal();const p=save.pendingOpen;if(!p)return;
  normalizeOpening(p);boxPaused=false;
  if(p.phase!=='results')warmOpeningImages(p);
  $('openingModal').classList.add('open');$('openingTitle').textContent=(SUBJECTS[p.packId]||'')+(p.mode==='box'?' BOX':' パック')+'開封';
  const stage=$('openingStage'),grid=$('openingGrid');grid.hidden=true;grid.innerHTML='';stage.hidden=false;
  if(p.phase==='sealed'){
    const theme=subjectTheme[SUBJECTS[p.packId]];
    stage.innerHTML=`<div class="sealed-stage"><p class="stage-instruction">横にスワイプ、またはタップで開封</p><button type="button" class="sealed-pack theme-${theme}" aria-label="${SUBJECTS[p.packId]}${p.mode==='box'?'BOX':'パック'}を開封" id="tearPack"><span class="tear-strip">← OPEN →</span><small>STUDY TCG</small><strong>${SUBJECTS[p.packId]}</strong><span class="sealed-sigil">${SUBJECT_SYMBOLS[p.packId]}</span><small>${p.mode==='box'?'10 PACKS · 50 CARDS':'5 CARDS'}</small></button></div>`;
    const pack=$('tearPack');let pointer=null;
    pack.onpointerdown=e=>{pointer={x:e.clientX,y:e.clientY};pack.setPointerCapture?.(e.pointerId)};
    pack.onpointerup=e=>{if(pointer&&Math.abs(e.clientX-pointer.x)>45&&Math.abs(e.clientY-pointer.y)<100)tearPack();pointer=null};
    pack.onpointercancel=()=>{pointer=null};pack.onclick=tearPack;
  }else if(p.phase==='cards'){
    stage.innerHTML='<p class="stage-instruction">好きな順番でめくる · もう一度タップで詳細</p><div class="card-fan">'+p.results.map((x,i)=>flipButton(x,i,p)).join('')+'</div>';
    stage.querySelectorAll('[data-slot]').forEach(el=>el.onclick=()=>revealSlot(Number(el.dataset.slot),el));
  }else if(p.phase==='box'){
    stage.innerHTML='<div class="box-stage"><p id="boxMessage" class="stage-instruction">高レアカードでゆっくり止まります</p><div id="boxSpotlight"></div></div>';
    runBox();
  }else renderOpeningResults();
  updateRevealProgress(p);$('suspendOpening').focus({preventScroll:true});
}
function tearPack(){
  const p=save.pendingOpen;if(!p||p.phase!=='sealed')return;
  p.phase=p.mode==='box'?'box':'cards';persist();
  $('tearPack')?.classList.add('tearing');later(()=>showPending(),reducedMotion()?0:550);
}
function revealSlot(index,el){
  const p=save.pendingOpen;if(!p||!p.results[index]||p.phase!=='cards')return;
  const x=p.results[index];
  if(p.revealedSlots.includes(index)){
    if(!activeFlips.has(index))openDetail(x.cardId,{origin:'opening',isNew:x.isNew});return;
  }
  p.revealedSlots.push(index);p.revealIndex=p.revealedSlots.length;persist();
  activeFlips.add(index);
  el.classList.add('is-revealed');el.classList.add('flipping-'+x.rarity);
  el.innerHTML=`<span class="flip-front">${cardFace(cardById.get(x.cardId),{isNew:x.isNew,guaranteed:x.isGuaranteed})}</span><span class="flip-back">${backFace(x,index)}</span><span class="reveal-burst" aria-hidden="true"></span>`;
  el.setAttribute('aria-label',cardById.get(x.cardId).base_name+'の詳細');
  updateRevealProgress(p);
  later(()=>{activeFlips.delete(index);el.classList.remove('flipping-'+x.rarity);el.innerHTML=cardFace(cardById.get(x.cardId),{isNew:x.isNew,guaranteed:x.isGuaranteed});updateRevealProgress(p);},effectDuration(x.rarity));
}
function runBox(){
  const p=save.pendingOpen;if(!p||p.phase!=='box'||boxPaused)return;
  const index=p.results.findIndex((_,i)=>!p.revealedSlots.includes(i));
  if(index<0){p.phase='results';persist();renderOpeningResults();return;}
  const x=p.results[index],c=cardById.get(x.cardId);
  warmOpeningImages(p);
  p.revealedSlots.push(index);p.revealIndex=p.revealedSlots.length;persist();
  const spot=$('boxSpotlight');
  spot.innerHTML=`<button class="box-card flipping-${x.rarity}" aria-label="${escapeHTML(c.base_name)}の詳細" data-box-card=""><span class="flip-front">${cardFace(c,{isNew:x.isNew,guaranteed:x.isGuaranteed})}</span><span class="flip-back">${backFace(x,index)}</span><span class="reveal-burst" aria-hidden="true"></span></button>`;
  const button=spot.querySelector('[data-box-card]');
  activeFlips.add(index);updateRevealProgress(p);
  $('boxMessage').textContent=`PACK ${x.packNo||Math.floor(index/5)+1} / 10${x.rarity==='SSR'?' · SSR':x.rarity==='SR'?' · SR':''}${x.isGuaranteed?' · 保証枠':''}`;
  button.onclick=()=>{if(!activeFlips.has(index))openDetail(x.cardId,{origin:'opening',isNew:x.isNew})};
  const duration=x.rarity==='SR'||x.rarity==='SSR'?effectDuration(x.rarity):reducedMotion()?0:140;
  later(()=>{
    activeFlips.delete(index);button.classList.remove('flipping-'+x.rarity);button.innerHTML=cardFace(c,{isNew:x.isNew,guaranteed:x.isGuaranteed});updateRevealProgress(p);
    later(()=>runBox(),reducedMotion()?40:x.rarity==='SSR'?1800:x.rarity==='SR'?950:70);
  },duration);
}
function showAllOpening(){
  const p=save.pendingOpen;if(!p)return;stopReveal();boxPaused=false;
  p.revealedSlots=p.results.map((_,i)=>i);p.revealIndex=p.results.length;p.phase='results';persist();renderOpeningResults();
}
function renderOpeningResults(){
  const p=save.pendingOpen;if(!p||p.revealedSlots.length!==p.results.length)return;
  openingImageBuffer.clear();
  stopReveal();p.phase='results';persist();$('openingStage').hidden=true;
  const grid=$('openingGrid');grid.hidden=false;grid.innerHTML=p.results.map(x=>resultCard(x)).join('');bindResultDetails(grid);updateRevealProgress(p);
}
function suspendOpening(){stopReveal();openingImageBuffer.clear();$('openingModal').classList.remove('open');$('detailModal').classList.remove('open');renderOpening();}
function closeOpening(){
  const p=save.pendingOpen;if(!p||p.revealedSlots.length!==p.results.length||activeFlips.size)return;
  clearOpeningUI();save.pendingOpen=null;persist();renderAll();
}
['rarity','type','ownership','species'].forEach(k=>$(k+'Filter').onchange=e=>{filters[k]=e.target.value;renderCatalog()});
$('parallelFilter').onchange=e=>{filters.parallel=e.target.checked;renderCatalog()};
$('resetFilters').onclick=resetCatalogFilters;
$('detailBack').onclick=()=>{if(detailTrail.length>1){detailTrail.pop();renderDetail()}};
$('closeDetail').onclick=closeDetail;
$('resumeOpening').onclick=showPending;
$('suspendOpening').onclick=suspendOpening;
$('viewOpeningResults').onclick=renderOpeningResults;
$('pauseBox').onclick=()=>{
  boxPaused=!boxPaused;
  if(boxPaused){stopReveal();const p=save.pendingOpen;if(p?.revealedSlots.length){const x=p.results[p.revealedSlots[p.revealedSlots.length-1]];const spot=$('boxSpotlight');spot.innerHTML=resultCard(x);spot.querySelector('[data-card-id]').onclick=()=>openDetail(x.cardId,{origin:'opening',isNew:x.isNew});}}
  else runBox();
  if(save.pendingOpen)updateRevealProgress(save.pendingOpen);
};
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){
    if($('detailModal').classList.contains('open'))closeDetail();
    else if($('archiveModal').classList.contains('open'))closeArchive();
    else if($('openingModal').classList.contains('open'))suspendOpening();
  }
});
document.addEventListener('visibilitychange',()=>{
  if(document.hidden&&save.pendingOpen?.mode==='box'&&save.pendingOpen.phase==='box'&&!boxPaused)$('pauseBox').onclick();
});
renderAll();setInterval(()=>{if(save.timerState?.running)renderStudy()},1000);
if(save.pendingOpen)setTimeout(()=>showPending(),200);

