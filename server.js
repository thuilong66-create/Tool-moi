import fastify from "fastify";
import cors from "@fastify/cors";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const app = fastify({ logger: false });
await app.register(cors, { origin: true });

const TOOLS = {
  lc79_hu:   {name:"LC79 HŨ (TÀI XỈU)",  url:`${BASE}/lc79/tx/history/${KEY}`,    A:"TÀI",   B:"XỈU",   tables:false},
  lc79_md5:  {name:"LC79 MD5",            url:`${BASE}/lc79/md5/history/${KEY}`,   A:"TÀI",   B:"XỈU",   tables:false},
  hit_hu:    {name:"HIT HŨ (TÀI XỈU)",    url:`${BASE}/hitclub/tx/history/${KEY}`, A:"TÀI",   B:"XỈU",   tables:false},
  hit_md5:   {name:"HIT MD5",             url:`${BASE}/hitclub/md5/history/${KEY}`,A:"TÀI",   B:"XỈU",   tables:false},
  max789_hu: {name:"MAX789 HŨ (TÀI XỈU)", url:`${BASE}/max789/tx/history/${KEY}`,  A:"TÀI",   B:"XỈU",   tables:false},
  max789_md5:{name:"MAX789 MD5",          url:`${BASE}/max789/md5/history/${KEY}`, A:"TÀI",   B:"XỈU",   tables:false},
  sunwin_hu: {name:"SUNWIN HŨ (TÀI XỈU)", url:`${BASE}/sunwin/tx/history/${KEY}`,  A:"TÀI",   B:"XỈU",   tables:false},
  bcr:       {name:"BCR BACCARAT",        url:"https://bcf-ayt4.onrender.com/sexy/all", A:"PLAYER", B:"BANKER", tables:true},
};
let A="TÀI", B="XỈU"; // dynamic per tool

const blocksOf = s => { const b=[]; let c=1; for(let i=1;i<s.length;i++){if(s[i]===s[i-1])c++;else{b.push(c);c=1;}} b.push(c); return b; };
function wilson(correct,total,z=1.96){if(total===0)return 0;const p=correct/total,d=1+z*z/total;const c=(p+z*z/(2*total))/d,sp=z*Math.sqrt(p*(1-p)/total+z*z/(4*total*total))/d;return Math.max(0,c-sp);}
function detectRegime(seq){if(seq.length<30)return 'balanced';const recent=seq.slice(-50);let maxS=1,cur=1;for(let i=1;i<recent.length;i++){if(recent[i]===recent[i-1])cur++;else{maxS=Math.max(maxS,cur);cur=1;}}maxS=Math.max(maxS,cur);const aRatio=recent.filter(x=>x===A).length/recent.length;const bias=Math.abs(aRatio-0.5);let alt=0;for(let i=1;i<recent.length;i++)if(recent[i]!==recent[i-1])alt++;const altRate=alt/(recent.length-1);if(maxS>=6)return 'streaky';if(altRate>0.62)return 'choppy';if(bias>0.12)return 'trending';return 'balanced';}
const REGIME_BOOST={streaky:{markov:0.9,streak:1.5,betbreak:1.4,pattern:1.0,pattern63:1.3,momentum:1.1,alt:0.7},choppy:{markov:1.1,streak:0.7,betbreak:1.0,pattern:1.4,pattern63:1.4,momentum:0.8,alt:1.5},trending:{markov:1.2,streak:1.1,betbreak:0.9,pattern:0.9,pattern63:1.0,momentum:1.5,alt:0.8},balanced:{markov:1.2,streak:1.0,betbreak:1.0,pattern:1.1,pattern63:1.2,momentum:1.0,alt:1.0}};
function markovN(seq,n,minC){if(seq.length<n+8)return null;const key=seq.slice(-n).join('|');let a=0,b=0;for(let i=n;i<seq.length;i++){if(seq.slice(i-n,i).join('|')===key){if(seq[i]===A)a++;else b++;}}const t=a+b;if(t<minC)return null;const pa=(a+1)/(t+2);if(pa>0.6)return{vote:A,w:1+wilson(a,t)*0.5};if(pa<0.4)return{vote:B,w:1+wilson(b,t)*0.5};return null;}
const s_markov2=s=>markovN(s,2,8);const s_markov3=s=>markovN(s,3,6);const s_markov4=s=>markovN(s,4,4);
function s_recentMarkov(seq){if(seq.length<50)return null;return markovN(seq.slice(-150),2,5);}
function s_weightedMarkov(seq){if(seq.length<60)return null;const key=seq.slice(-2).join('|');let wa=0,wb=0,tau=80;for(let i=2;i<seq.length;i++){if(seq.slice(i-2,i).join('|')===key){const w=Math.exp(-(seq.length-i)/tau);if(seq[i]===A)wa+=w;else wb+=w;}}const t=wa+wb;if(t<3)return null;const pa=(wa+0.3)/(t+0.6);if(pa>0.6)return{vote:A,w:1.2};if(pa<0.4)return{vote:B,w:1.2};return null;}
function s_bayesian(seq){if(seq.length<40)return null;const key=seq.slice(-3).join('|');const prior=0.5+(seq.slice(-30).filter(x=>x===A).length/30-0.5)*0.5;let a=0,b=0;for(let i=3;i<seq.length;i++){if(seq.slice(i-3,i).join('|')===key){if(seq[i]===A)a++;else b++;}}const t=a+b;if(t<5)return null;const pa=(a+4*prior)/(t+4);if(pa>0.6)return{vote:A,w:1.1};if(pa<0.4)return{vote:B,w:1.1};return null;}
function s_streak(seq){if(seq.length<30)return null;const last=seq[seq.length-1];let s=1;for(let i=seq.length-2;i>=0;i--){if(seq[i]===last)s++;else break;}if(s<3)return null;let cont=0,brk=0;for(let i=0;i<seq.length-1;i++){let ss=1;for(let j=i-1;j>=0;j--){if(seq[j]===seq[i])ss++;else break;}if(ss===s){if(seq[i+1]===seq[i])cont++;else brk++;}}const t=cont+brk;if(t<6)return null;const pc=(cont+1.5)/(t+3);if(pc>0.58)return{vote:last,w:1.3};if(pc<0.42)return{vote:last===A?B:A,w:1.3};return null;}
function s_betBreaker(seq){if(seq.length<50)return null;const last=seq[seq.length-1];let s=1;for(let i=seq.length-2;i>=0;i--){if(seq[i]===last)s++;else break;}if(s<4||s>9)return null;let cont=0,brk=0;for(let i=0;i<seq.length-1;i++){let ss=1;for(let j=i-1;j>=0;j--){if(seq[j]===seq[i])ss++;else break;}if(ss===s){if(seq[i+1]===seq[i])cont++;else brk++;}}const t=cont+brk;if(t<5)return null;const pb=(brk+1.5)/(t+3);if(pb>0.6)return{vote:last===A?B:A,w:1.4};if(pb<0.4)return{vote:last,w:1.2};return null;}
function s_streakDist(seq){if(seq.length<60)return null;const last=seq[seq.length-1];let cur=1;for(let i=seq.length-2;i>=0;i--){if(seq[i]===last)cur++;else break;}if(cur<2)return null;const ends={};let c=1;for(let i=1;i<seq.length;i++){if(seq[i]===seq[i-1])c++;else{ends[c]=(ends[c]||0)+1;c=1;}}ends[c]=(ends[c]||0)+1;const maxH=Math.max(...Object.keys(ends).map(Number));if(cur>=maxH+1)return{vote:last===A?B:A,w:1.5};const stop=ends[cur]||0;const cont=Object.entries(ends).filter(([k])=>Number(k)>cur).reduce((a,[,v])=>a+v,0);if(stop+cont<6)return null;const ps=(stop+1.5)/(stop+cont+3);if(ps>0.62)return{vote:last===A?B:A,w:1.3};if(ps<0.38)return{vote:last,w:1.1};return null;}
function s_pattern(seq){if(seq.length<6)return null;const b=blocksOf(seq);const last=b[b.length-1];const lv=seq[seq.length-1];const opp=lv===A?B:A;if(last>=5)return{vote:opp,w:1.4};if(last>=3&&b.length>=2)return{vote:opp,w:1.1};if(b.length>=3){const l3=b.slice(-3);if(l3[0]===l3[2]&&l3[0]>=2)return{vote:opp,w:1.2};if(l3[0]<l3[1]&&l3[1]>l3[2])return{vote:opp,w:1.1};if((l3[0]===1&&l3[1]===2&&l3[2]===1)||(l3[0]===2&&l3[1]===1&&l3[2]===2))return{vote:opp,w:1.3};}const fib=[1,1,2,3,5];if(b.length>=3&&b.slice(-3).every((v,i)=>v===fib[i]))return{vote:opp,w:1.3};return null;}
function s_alternating(seq){if(seq.length<6)return null;const l6=seq.slice(-6);let alt=true;for(let i=1;i<l6.length;i++){if(l6[i]===l6[i-1]){alt=false;break;}}if(alt)return{vote:l6[l6.length-1],w:1.3};return null;}
function s_doubleBlock(seq){if(seq.length<8)return null;const b=blocksOf(seq);if(b.length>=2&&b[b.length-1]===b[b.length-2]&&b[b.length-1]>=2&&b[b.length-1]<=4){return{vote:seq[seq.length-1]===A?B:A,w:1.2};}return null;}
function s_longPattern(seq){if(seq.length<10)return null;const tail=seq.slice(-8).join('');if(tail===tail.split('').reverse().join(''))return{vote:seq[seq.length-1]===A?B:A,w:1.2};return null;}
function s_momentum(seq,w){if(seq.length<w+5)return null;const a=seq.slice(-w).filter(x=>x===A).length;const pa=a/w;if(pa>0.65)return{vote:A,w:1.1};if(pa<0.35)return{vote:B,w:1.1};return null;}
const s_mom5=s=>s_momentum(s,5);const s_mom10=s=>s_momentum(s,10);const s_mom20=s=>s_momentum(s,20);
function s_dualTimeframe(seq){const m5=s_momentum(seq,5),m20=s_momentum(seq,20);if(m5&&m20&&m5.vote===m20.vote)return{vote:m5.vote,w:1.4};return null;}

const PATTERN8_MAP = {"TXXTTXTX":{"pred":"T","rate":61.5,"n":13},"XXTTXTXX":{"pred":"T","rate":55.6,"n":18},"XTTXTXXT":{"pred":"T","rate":56.2,"n":16},"TTXTXXTT":{"pred":"T","rate":50.0,"n":16},"TXTXXTTT":{"pred":"X","rate":56.2,"n":16},"XTXXTTTX":{"pred":"T","rate":65.0,"n":20},"TXXTTTXX":{"pred":"T","rate":63.2,"n":19},"XXTTTXXT":{"pred":"X","rate":68.2,"n":22},"XTTTXXTX":{"pred":"T","rate":55.2,"n":29},"TTTXXTXX":{"pred":"X","rate":58.3,"n":24},"TTXXTXXX":{"pred":"T","rate":60.7,"n":28},"TXXTXXXX":{"pred":"X","rate":57.1,"n":21},"XXTXXXXX":{"pred":"T","rate":70.6,"n":17},"XTXXXXXT":{"pred":"X","rate":63.2,"n":19},"TXXXXXTX":{"pred":"X","rate":61.5,"n":26},"XXXXXTXX":{"pred":"X","rate":54.5,"n":22},"XXXXTXXX":{"pred":"T","rate":64.7,"n":17},"XXXTXXXT":{"pred":"T","rate":61.9,"n":21},"XXTXXXTX":{"pred":"X","rate":66.7,"n":24},"XTXXXTXX":{"pred":"T","rate":57.1,"n":21},"TXXXTXXX":{"pred":"T","rate":58.8,"n":17},"XXXTXXXX":{"pred":"T","rate":61.5,"n":13},"XXTXXXXT":{"pred":"X","rate":58.8,"n":17},"XTXXXXTT":{"pred":"T","rate":57.9,"n":19},"TXXXXTTX":{"pred":"X","rate":55.6,"n":18},"XXXXTTXX":{"pred":"T","rate":50.0,"n":20},"XXXTTXXX":{"pred":"X","rate":66.7,"n":18},"XXTTXXXT":{"pred":"T","rate":58.3,"n":12},"XTTXXXTX":{"pred":"T","rate":69.2,"n":13},"TTXXXTXT":{"pred":"T","rate":50.0,"n":16},"TXXXTXTX":{"pred":"T","rate":54.5,"n":22},"XXXTXTXT":{"pred":"T","rate":58.3,"n":24},"XXTXTXTT":{"pred":"T","rate":56.0,"n":25},"XTXTXTTT":{"pred":"T","rate":52.4,"n":21},"TXTXTTTT":{"pred":"T","rate":52.9,"n":17},"XTXTTTTT":{"pred":"T","rate":56.5,"n":23},"TXTTTTTT":{"pred":"X","rate":59.1,"n":22},"XTTTTTTX":{"pred":"T","rate":52.0,"n":25},"TTTTTTXT":{"pred":"X","rate":52.4,"n":21},"TTTTTXTX":{"pred":"T","rate":52.4,"n":21},"TTTTXTXT":{"pred":"T","rate":65.2,"n":23},"TTTXTXTT":{"pred":"X","rate":73.9,"n":23},"TTXTXTTX":{"pred":"T","rate":54.2,"n":24},"TXTXTTXT":{"pred":"T","rate":50.0,"n":24},"XTXTTXTX":{"pred":"T","rate":53.3,"n":15},"TXTTXTXT":{"pred":"X","rate":61.1,"n":18},"XTTXTXTT":{"pred":"X","rate":53.8,"n":13},"TXTTXTXX":{"pred":"T","rate":50.0,"n":12},"XTTXTXXX":{"pred":"X","rate":71.4,"n":14},"TTXTXXXT":{"pred":"X","rate":54.5,"n":11},"TXTXXXTT":{"pred":"X","rate":63.6,"n":22},"XTXXXTTX":{"pred":"X","rate":56.0,"n":25},"TXXXTTXX":{"pred":"T","rate":60.9,"n":23},"XXXTTXXT":{"pred":"X","rate":54.2,"n":24},"XXTTXXTX":{"pred":"T","rate":51.9,"n":27},"XTTXXTXX":{"pred":"X","rate":60.9,"n":23},"TXXTXXXT":{"pred":"X","rate":55.2,"n":29},"XXTXXXTT":{"pred":"T","rate":57.7,"n":26},"XTXXXTTT":{"pred":"T","rate":56.5,"n":23},"TXXXTTTT":{"pred":"T","rate":52.9,"n":17},"XXXTTTTT":{"pred":"T","rate":50.0,"n":22},"XXTTTTTT":{"pred":"X","rate":52.2,"n":23},"TTTTTTXX":{"pred":"X","rate":58.3,"n":24},"TTTTTXXX":{"pred":"X","rate":55.6,"n":27},"TTTTXXXT":{"pred":"X","rate":54.2,"n":24},"TTTXXXTX":{"pred":"X","rate":63.2,"n":19},"TXXXTXTT":{"pred":"X","rate":53.8,"n":13},"XXXTXTTX":{"pred":"X","rate":83.3,"n":12},"XXTXTTXX":{"pred":"T","rate":57.1,"n":21},"XTXTTXXT":{"pred":"X","rate":62.5,"n":24},"TXTTXXTT":{"pred":"T","rate":75.0,"n":16},"XTTXXTTT":{"pred":"T","rate":56.0,"n":25},"TTXXTTTX":{"pred":"X","rate":60.0,"n":20},"TXXTTTXT":{"pred":"T","rate":50.0,"n":22},"XXTTTXTX":{"pred":"X","rate":52.6,"n":19},"XTTTXTXX":{"pred":"X","rate":77.8,"n":18},"TTTXTXXX":{"pred":"X","rate":66.7,"n":21},"XTXTTXXX":{"pred":"X","rate":72.2,"n":18},"TXTTXXXT":{"pred":"X","rate":61.5,"n":13},"TTXXXTXX":{"pred":"X","rate":53.3,"n":15},"TXXXTXXT":{"pred":"X","rate":57.9,"n":19},"XXXTXXTX":{"pred":"X","rate":57.1,"n":21},"XXTXXTXT":{"pred":"X","rate":61.1,"n":18},"XTXXTXTX":{"pred":"T","rate":61.1,"n":18},"TXXTXTXT":{"pred":"X","rate":57.7,"n":26},"XTXTXTTX":{"pred":"T","rate":50.0,"n":22},"XTXTTXTT":{"pred":"T","rate":82.4,"n":17},"TXTTXTTT":{"pred":"T","rate":54.5,"n":22},"XTTXTTTX":{"pred":"T","rate":59.1,"n":22},"TTXTTTXT":{"pred":"T","rate":70.8,"n":24},"TXTTTXTT":{"pred":"T","rate":52.4,"n":21},"XTTTXTTX":{"pred":"T","rate":62.5,"n":16},"TTTXTTXT":{"pred":"X","rate":52.6,"n":19},"TTXTTXTX":{"pred":"T","rate":66.7,"n":15},"TTXTXXTX":{"pred":"T","rate":56.2,"n":16},"TXTXXTXT":{"pred":"T","rate":53.3,"n":15},"XTXXTXTT":{"pred":"X","rate":53.3,"n":15},"TXXTXTTT":{"pred":"T","rate":76.2,"n":21},"XXTXTTTT":{"pred":"T","rate":58.3,"n":24},"TXTTTTTX":{"pred":"X","rate":57.1,"n":21},"XTTTTTXX":{"pred":"X","rate":56.5,"n":23},"TTTTXXXX":{"pred":"X","rate":53.6,"n":28},"TTTXXXXX":{"pred":"X","rate":52.0,"n":25},"TTXXXXXX":{"pred":"T","rate":52.4,"n":21},"TXXXXXXT":{"pred":"T","rate":77.8,"n":18},"XXXXXXTT":{"pred":"X","rate":54.5,"n":22},"XXXXXTTX":{"pred":"T","rate":56.5,"n":23},"XTTXXTXT":{"pred":"X","rate":70.4,"n":27},"TTXXTXTT":{"pred":"T","rate":60.9,"n":23},"XTXTTTTX":{"pred":"T","rate":50.0,"n":18},"TXTTTTXT":{"pred":"X","rate":68.4,"n":19},"XTTTTXTX":{"pred":"T","rate":57.1,"n":21},"TTTTXTXX":{"pred":"T","rate":63.2,"n":19},"TTTXTXXT":{"pred":"X","rate":56.2,"n":16},"TXTXTTTX":{"pred":"T","rate":50.0,"n":16},"XTXTTTXX":{"pred":"T","rate":56.5,"n":23},"TXTTTXXT":{"pred":"X","rate":58.3,"n":24},"XTTTXXTT":{"pred":"T","rate":55.6,"n":18},"TTTXXTTT":{"pred":"T","rate":60.9,"n":23},"TTXXTTTT":{"pred":"T","rate":50.0,"n":28},"TXXTTTTX":{"pred":"X","rate":57.1,"n":28},"XXTTTTXT":{"pred":"T","rate":55.6,"n":18},"TXTXTTXX":{"pred":"T","rate":54.5,"n":22},"TXTTXXXX":{"pred":"T","rate":52.6,"n":19},"XTTXXXXT":{"pred":"X","rate":70.6,"n":17},"TTXXXXTX":{"pred":"X","rate":57.1,"n":21},"TXXXXTXT":{"pred":"T","rate":61.9,"n":21},"XXXXTXTX":{"pred":"T","rate":75.0,"n":16},"TXTTTTXX":{"pred":"X","rate":60.0,"n":20},"XTTTTXXT":{"pred":"X","rate":57.9,"n":19},"TTTTXXTX":{"pred":"X","rate":60.0,"n":20},"XXXTXXTT":{"pred":"T","rate":53.8,"n":26},"XXTXXTTT":{"pred":"T","rate":57.7,"n":26},"XXTTTXTT":{"pred":"T","rate":71.4,"n":21},"TTTXTTXX":{"pred":"X","rate":52.9,"n":17},"TTXTTXXX":{"pred":"T","rate":57.1,"n":14},"XTTXXXXX":{"pred":"T","rate":63.6,"n":22},"TTXXXXXT":{"pred":"X","rate":53.8,"n":26},"TXXXXXTT":{"pred":"X","rate":57.9,"n":19},"XXXXXTTT":{"pred":"T","rate":55.6,"n":18},"XXXXTTTT":{"pred":"T","rate":72.2,"n":18},"XXXTTTTX":{"pred":"X","rate":53.8,"n":13},"XTTXTXTX":{"pred":"X","rate":57.9,"n":19},"TTXTXTXT":{"pred":"X","rate":56.2,"n":16},"TXTXTXTX":{"pred":"X","rate":55.6,"n":18},"XTXTXTXT":{"pred":"T","rate":55.0,"n":20},"XTXTXTXX":{"pred":"X","rate":56.5,"n":23},"TXTXTXXT":{"pred":"X","rate":77.8,"n":18},"XTXTXXTX":{"pred":"X","rate":66.7,"n":18},"XXTXTXTX":{"pred":"X","rate":52.0,"n":25},"TXTXTXTT":{"pred":"X","rate":61.1,"n":18},"TXTTTXXX":{"pred":"X","rate":60.0,"n":20},"XTTTXXXX":{"pred":"X","rate":62.5,"n":16},"TTTXXXXT":{"pred":"T","rate":52.6,"n":19},"TTXXXXTT":{"pred":"X","rate":66.7,"n":15},"XXXTXTXX":{"pred":"X","rate":57.1,"n":14},"XXTXTXXX":{"pred":"T","rate":73.7,"n":19},"XTXTXXXT":{"pred":"T","rate":63.0,"n":27},"XXTTXXTT":{"pred":"T","rate":72.2,"n":18},"TXXTTTTT":{"pred":"T","rate":52.2,"n":23},"TTTTTXTT":{"pred":"X","rate":60.0,"n":20},"TTTTXTTT":{"pred":"T","rate":53.3,"n":15},"TTTXTTTT":{"pred":"X","rate":55.6,"n":18},"TTXTTTTX":{"pred":"X","rate":52.4,"n":21},"XTXXTTTT":{"pred":"X","rate":60.9,"n":23},"XTTTTXTT":{"pred":"T","rate":50.0,"n":16},"XTTTTXXX":{"pred":"X","rate":52.0,"n":25},"TXXXXTTT":{"pred":"T","rate":50.0,"n":16},"XXXXTTTX":{"pred":"T","rate":62.5,"n":16},"XXXTTTXX":{"pred":"T","rate":62.5,"n":16},"TXTXTXXX":{"pred":"T","rate":56.5,"n":23},"XXTTTTXX":{"pred":"X","rate":54.2,"n":24},"TTTXXXTT":{"pred":"X","rate":54.5,"n":22},"TTXXXTTX":{"pred":"T","rate":59.1,"n":22},"TXXXTTXT":{"pred":"T","rate":62.5,"n":24},"XXXTTXTT":{"pred":"T","rate":73.1,"n":26},"XXTTXTTX":{"pred":"X","rate":61.5,"n":13},"XTTXTTXX":{"pred":"T","rate":58.3,"n":12},"TTXTTXXT":{"pred":"X","rate":53.3,"n":15},"TTTXXTXT":{"pred":"T","rate":62.5,"n":24},"TTXXTXTX":{"pred":"T","rate":53.6,"n":28},"TXTXXXTX":{"pred":"T","rate":68.8,"n":16},"TTTTXXTT":{"pred":"T","rate":68.4,"n":19},"XTTTTTTT":{"pred":"T","rate":60.0,"n":20},"TTTTTTTT":{"pred":"T","rate":53.8,"n":26},"TTTTTTTX":{"pred":"X","rate":60.0,"n":20},"TTTTTXXT":{"pred":"T","rate":55.0,"n":20},"TTTXXTTX":{"pred":"T","rate":50.0,"n":14},"TTXXTTXX":{"pred":"T","rate":72.7,"n":11},"TXXTTXXT":{"pred":"X","rate":66.7,"n":21},"TTXXTXXT":{"pred":"X","rate":63.2,"n":19},"TXXTXXTX":{"pred":"X","rate":52.6,"n":19},"XXTXXTXX":{"pred":"X","rate":61.9,"n":21},"XTXXTXXX":{"pred":"T","rate":54.5,"n":22},"XTXXXXTX":{"pred":"T","rate":52.2,"n":23},"XXXXTXTT":{"pred":"T","rate":76.2,"n":21},"XXXTXTTT":{"pred":"X","rate":63.6,"n":22},"TXXTXXTT":{"pred":"T","rate":66.7,"n":18},"XXXXXTXT":{"pred":"T","rate":50.0,"n":16},"XTTXXXTT":{"pred":"X","rate":83.3,"n":12},"XXTTXXXX":{"pred":"X","rate":65.0,"n":20},"TXTTXTTX":{"pred":"X","rate":57.1,"n":7},"XTTXTTXT":{"pred":"X","rate":62.5,"n":8},"TTXTTXTT":{"pred":"T","rate":66.7,"n":12},"XTTXTTTT":{"pred":"T","rate":52.2,"n":23},"TTXTTTTT":{"pred":"X","rate":55.0,"n":20},"TTTTXTTX":{"pred":"X","rate":55.0,"n":20},"TTXTXXXX":{"pred":"T","rate":68.0,"n":25},"TXTXXXXT":{"pred":"X","rate":52.0,"n":25},"XXTTTTTX":{"pred":"T","rate":50.0,"n":22},"XTTTTTXT":{"pred":"T","rate":50.0,"n":20},"TTTXTXTX":{"pred":"T","rate":53.3,"n":15},"TXTXXTXX":{"pred":"T","rate":52.6,"n":19},"XTXXTXXT":{"pred":"T","rate":61.1,"n":18},"XTXTXXXX":{"pred":"T","rate":53.3,"n":15},"TXXXXTXX":{"pred":"T","rate":78.3,"n":23},"TTXTXTXX":{"pred":"X","rate":55.6,"n":18},"XTXTXXTT":{"pred":"T","rate":50.0,"n":16},"TXXXTTTX":{"pred":"X","rate":57.9,"n":19},"XXXTTTXT":{"pred":"T","rate":55.6,"n":18},"XXTTTXXX":{"pred":"T","rate":69.2,"n":13},"XTTTXXXT":{"pred":"T","rate":66.7,"n":18},"TTXXXTTT":{"pred":"X","rate":66.7,"n":12},"TXXTXTTX":{"pred":"X","rate":64.7,"n":17},"TXTTXXTX":{"pred":"T","rate":56.5,"n":23},"XXTXTTTX":{"pred":"X","rate":78.9,"n":19},"XTXXXXXX":{"pred":"T","rate":53.8,"n":13},"TXXXXXXX":{"pred":"T","rate":75.0,"n":16},"XXXXXXXT":{"pred":"T","rate":50.0,"n":16},"XXXXTTXT":{"pred":"T","rate":52.4,"n":21},"XXXTTXTX":{"pred":"X","rate":68.4,"n":19},"TXTXXXXX":{"pred":"X","rate":53.3,"n":15},"XXXXTXXT":{"pred":"T","rate":64.3,"n":28},"TXXTXTXX":{"pred":"T","rate":50.0,"n":20},"XXTXTXXT":{"pred":"T","rate":75.0,"n":16},"TXTXXTTX":{"pred":"X","rate":68.8,"n":16},"XTXXTTXX":{"pred":"T","rate":54.2,"n":24},"TXXTTXXX":{"pred":"X","rate":57.1,"n":14},"XXTTXTTT":{"pred":"X","rate":52.2,"n":23},"TTXTTTXX":{"pred":"T","rate":52.4,"n":21},"XXXXXXTX":{"pred":"T","rate":50.0,"n":12},"TTTXTTTX":{"pred":"X","rate":52.2,"n":23},"XTTTXTTT":{"pred":"X","rate":61.5,"n":26},"TXTTTXTX":{"pred":"X","rate":57.1,"n":14},"XTXXXTXT":{"pred":"X","rate":73.7,"n":19},"XTTXXTTX":{"pred":"T","rate":55.6,"n":9},"TTXXTTXT":{"pred":"X","rate":75.0,"n":12},"XXTTXTXT":{"pred":"X","rate":57.1,"n":14},"XXTXXTTX":{"pred":"X","rate":72.2,"n":18},"XXTXTTXT":{"pred":"T","rate":62.5,"n":8},"TTXTXTTT":{"pred":"T","rate":50.0,"n":12},"XTXTTTXT":{"pred":"X","rate":58.3,"n":12},"XTTTXTXT":{"pred":"T","rate":53.3,"n":15},"XTXXTTXT":{"pred":"T","rate":70.0,"n":10},"TXXTTXTT":{"pred":"X","rate":60.0,"n":10},"XXXXXXXX":{"pred":"X","rate":63.6,"n":11}};
function s_pattern8(seq){
  if(seq.length<8)return null;
  const key=seq.slice(-8).map(x=>x===A?'T':'X').join('');
  const m=PATTERN8_MAP[key];
  if(!m||m.rate<55)return null;
  return{vote:m.pred==='T'?A:B,w:1+(m.rate-50)/25,name:'PATTERN8('+m.rate+'%)'};
}

const PATTERNS_63=[
{name:"BET_9+",type:"streak",spec:[9,99],action:"opp",conf:94},{name:"BET_7-8",type:"streak",spec:[7,8],action:"opp",conf:91},{name:"BET_5-6",type:"streak",spec:[5,6],action:"opp",conf:88},
{name:"CHUKY_7-7",type:"groups",spec:[7,7],action:"opp",conf:92},{name:"CHUKY_6-6",type:"groups",spec:[6,6],action:"opp",conf:91},{name:"CHUKY_5-5",type:"groups",spec:[5,5],action:"opp",conf:90},{name:"CHUKY_4-4",type:"groups",spec:[4,4],action:"opp",conf:89},{name:"CHUKY_3-3",type:"groups",spec:[3,3],action:"opp",conf:89},{name:"CHUKY_2-2",type:"groups",spec:[2,2,2,2],action:"opp",conf:88},{name:"CHUKY_1-1",type:"groups",spec:[1,1,1,1,1,1],action:"opp",conf:90},
{name:"NHIPHUC_3-2-2-3",type:"groups",spec:[3,2,2,3],action:"opp",conf:89},{name:"NHIPHUC_1-1-2-2-3",type:"groups",spec:[1,1,2,2,3],action:"opp",conf:86},{name:"NHIPHUC_2-1-2-1-2",type:"groups",spec:[2,1,2,1,2],action:"opp",conf:88},{name:"NHIPHUC_1-2-1-2-1",type:"groups",spec:[1,2,1,2,1],action:"opp",conf:88},{name:"NHIPHUC_3-1-2-2",type:"groups",spec:[3,1,2,2],action:"opp",conf:84},{name:"NHIPHUC_2-2-1-3",type:"groups",spec:[2,2,1,3],action:"opp",conf:85},{name:"NHIPHUC_3-2-3-2",type:"groups",spec:[3,2,3,2],action:"opp",conf:88},{name:"NHIPHUC_1-2-1-3",type:"groups",spec:[1,2,1,3],action:"opp",conf:84},{name:"NHIPHUC_3-1-1-3",type:"groups",spec:[3,1,1,3],action:"opp",conf:90},{name:"NHIPHUC_3-2-3",type:"groups",spec:[3,2,3],action:"opp",conf:86},{name:"NHIPHUC_2-3-2",type:"groups",spec:[2,3,2],action:"opp",conf:84},{name:"NHIPHUC_3-1-3",type:"groups",spec:[3,1,3],action:"opp",conf:91},{name:"NHIPHUC_1-3-1",type:"groups",spec:[1,3,1],action:"opp",conf:90},{name:"NHIPHUC_1-2-3",type:"groups",spec:[1,2,3],action:"opp",conf:84},{name:"NHIPHUC_2-1-2",type:"groups",spec:[2,1,2],action:"opp",conf:86},{name:"NHIPHUC_1-2-1",type:"groups",spec:[1,2,1],action:"opp",conf:85},{name:"NHIPHUC_2-1-1-2",type:"groups",spec:[2,1,1,2],action:"opp",conf:87},{name:"NHIPHUC_1-2-1-2",type:"groups",spec:[1,2,1,2],action:"opp",conf:87},{name:"NHIPHUC_1-1-1-2",type:"groups",spec:[1,1,1,2],action:"opp",conf:87},{name:"NHIPHUC_2-2-1-1",type:"groups",spec:[2,2,1,1],action:"opp",conf:88},{name:"NHIPHUC_1-1-2-2",type:"groups",spec:[1,1,2,2],action:"opp",conf:88},{name:"NHIPHUC_1-2-2-1",type:"groups",spec:[1,2,2,1],action:"opp",conf:86},{name:"NHIPHUC_1-1-2",type:"groups",spec:[1,1,2],action:"opp",conf:84},{name:"NHIPHUC_1-2-1-1",type:"groups",spec:[1,2,1,1],action:"opp",conf:83},{name:"NHIPHUC_1-6",type:"groups",spec:[1,6],action:"opp",conf:90},{name:"NHIPHUC_6-1",type:"groups",spec:[6,1],action:"opp",conf:90},{name:"NHIPHUC_1-5",type:"groups",spec:[1,5],action:"opp",conf:89},{name:"NHIPHUC_5-1",type:"groups",spec:[5,1],action:"opp",conf:89},{name:"NHIPHUC_1-4",type:"groups",spec:[1,4],action:"opp",conf:85},{name:"NHIPHUC_4-1",type:"groups",spec:[4,1],action:"opp",conf:85},{name:"NHIPHUC_1-3",type:"groups",spec:[1,3],action:"opp",conf:83},{name:"NHIPHUC_3-1",type:"groups",spec:[3,1],action:"opp",conf:83},
{name:"GUONG_11",type:"palin",spec:11,action:"opp",conf:88},{name:"GUONG_9",type:"palin",spec:9,action:"opp",conf:86},{name:"PALIN_7",type:"palin",spec:7,action:"opp",conf:84},{name:"PALIN_5",type:"palin",spec:5,action:"opp",conf:82},
{name:"BET_3-4",type:"streak",spec:[3,4],action:"cont",conf:82},
];
function s_pattern63(seq){
  if(seq.length<3)return null;
  const rle=blocksOf(seq);const last=seq[seq.length-1];const cont=last,opp=last===A?B:A;const streak=rle[rle.length-1];
  const last8=seq.slice(-8);
  if(last8.length>=8&&last8.every((v,i)=>i===0||v!==last8[i-1]))return{vote:cont,w:1.8,name:"ANTI_TRAP_8DAO"};
  for(const p of PATTERNS_63){
    let matched=false;
    if(p.type==="streak"){if(p.spec[0]<=streak&&streak<=p.spec[1])matched=true;}
    else if(p.type==="groups"){const tail=rle.slice(-p.spec.length);if(tail.length===p.spec.length&&tail.every((v,i)=>v===p.spec[i]))matched=true;}
    else if(p.type==="palin"){const L=p.spec;if(seq.length>=L){const s=seq.slice(-L);if(s.every((v,i)=>v===s[L-1-i]))matched=true;}}
    if(matched)return{vote:p.action==="cont"?cont:opp,w:1+(p.conf-80)/18,name:p.name};
  }
  if(seq.length>=12){const lastN=seq.slice(-20);const aN=lastN.filter(x=>x===A).length;const bN=lastN.length-aN;if(Math.abs(aN-bN)>=6)return{vote:aN<bN?A:B,w:1.3,name:"HOI_QUY_20"};}
  return null;
}
function s_markovFallback(seq){
  if(seq.length<4)return null;
  const w=Math.min(20,seq.length);const recent=seq.slice(-w);
  let aa=0,ab=0,ba=0,bb=0;
  for(let i=0;i<recent.length-1;i++){const x=recent[i],y=recent[i+1];if(x===A&&y===A)aa++;else if(x===A&&y===B)ab++;else if(x===B&&y===A)ba++;else bb++;}
  const last=recent[recent.length-1];let pCont;
  if(last===A){const t=aa+ab||1;pCont=aa/t;}else{const t=ba+bb||1;pCont=bb/t;}
  if(pCont>0.58)return{vote:last,w:1.0,name:"MARKOV_FB"};
  if(pCont<0.42)return{vote:last===A?B:A,w:1.0,name:"MARKOV_FB"};
  return null;
}
function predict(seq){
  const regime=detectRegime(seq);const boost=REGIME_BOOST[regime];
  const raw=[{s:s_markov2(seq),g:'markov'},{s:s_markov3(seq),g:'markov'},{s:s_markov4(seq),g:'markov'},{s:s_recentMarkov(seq),g:'markov'},{s:s_weightedMarkov(seq),g:'markov'},{s:s_bayesian(seq),g:'markov'},{s:s_streak(seq),g:'streak'},{s:s_betBreaker(seq),g:'betbreak'},{s:s_streakDist(seq),g:'streak'},{s:s_pattern(seq),g:'pattern'},{s:s_alternating(seq),g:'alt'},{s:s_doubleBlock(seq),g:'pattern'},{s:s_longPattern(seq),g:'pattern'},{s:s_mom5(seq),g:'momentum'},{s:s_mom10(seq),g:'momentum'},{s:s_mom20(seq),g:'momentum'},{s:s_dualTimeframe(seq),g:'momentum'},{s:s_pattern63(seq),g:'pattern63'},{s:s_pattern8(seq),g:'pattern'},{s:s_markovFallback(seq),g:'markov'}];
  let wA=0,wB=0,used=0,hit="";
  for(const{s,g}of raw){if(!s)continue;const bw=s.w*(boost[g]||1);if(s.vote===A)wA+=bw;else wB+=bw;used++;if(s.name&&!hit)hit=s.name;}
  if(used===0)return{prediction:'CHỜ',confidence:50,signals:0,regime};
  const total=wA+wB;const pred=wA>=wB?A:B;const wWin=Math.max(wA,wB);
  const conf=Math.min(97,Math.round(50+(wWin/total-0.5)*100+wilson(Math.round(wWin),Math.round(total))*15));
  return{prediction:pred,confidence:conf,signals:used,regime,pattern_hit:hit};
}

async function getHistory(toolId, table){
  const tool=TOOLS[toolId];
  if(!tool) throw new Error("Tool không tồn tại");
  A=tool.A; B=tool.B;
  const res=await fetch(tool.url,{headers:{"User-Agent":"Mozilla/5.0"},signal:AbortSignal.timeout(12000)});
  const data=await res.json();
  let lst=data.data||data.list||data.history||data.sessions||[];
  let lastId="";
  if(tool.tables){
    const tables=data.tables||data.data||data.list||[];
    const t=tables.find(x=>String(x.table||x.id||x.name||x.table_id||"")===String(table));
    if(t){lst=t.history||t.list||t.sessions||[];}else lst=[];
  }
  const seq=lst.map(s=>{
    const r=String(s.resultTruyenThong||s.result||s.winner||s.outcome||"").toUpperCase();
    const id=String(s.id||s.session||s.phien||s.period||"");
    if(id&&!lastId)lastId=id;
    if(r.includes("TAI")||r==="T")return A;
    if(r.includes("XIU")||r.includes("XỈU")||r==="X")return B;
    if(r.includes("PLAYER")||r==="P")return A;
    if(r.includes("BANKER")||r==="B")return B;
    return null;
  }).filter(Boolean);
  return {seq, lastId};
}
async function getTables(toolId){
  const tool=TOOLS[toolId];
  if(!tool||!tool.tables)return [];
  try{const res=await fetch(tool.url,{headers:{"User-Agent":"Mozilla/5.0"},signal:AbortSignal.timeout(12000)});const data=await res.json();const tables=data.tables||data.data||data.list||[];return tables.map(t=>({id:t.table||t.id||t.name||t.table_id,name:t.name||t.table_name||("Bàn "+(t.table||t.id))}));}catch{return[];}
}

app.get("/api/predict",async(req,reply)=>{
  try{
    const tool=req.query.tool, table=req.query.table;
    if(!tool||!TOOLS[tool])return reply.status(400).send({error:"Thiếu tool"});
    if(TOOLS[tool].tables&&!table)return reply.status(400).send({error:"Thiếu table"});
    const{seq,lastId}=await getHistory(tool,table);
    if(seq.length<5)return reply.status(503).send({error:"Đang lấy dữ liệu",current:seq.length});
    const r=predict(seq);
    return{...r,history:seq.slice(-20),history_len:seq.length,tool:TOOLS[tool].name,last_id:lastId,A,B};
  }catch(e){return reply.status(500).send({error:e.message});}
});
app.get("/api/tables",async(req,reply)=>{
  const tool=req.query.tool;
  if(!tool)return reply.status(400).send({error:"Thiếu tool"});
  return{tables:await getTables(tool)};
});
app.get("/",async(req,reply)=>{
  const html=fs.readFileSync(path.join(__dirname,"index.html"),"utf-8");
  reply.type("text/html").send(html);
});
app.listen({port:PORT,host:"0.0.0.0"}).then(()=>console.log("✅ AI VIP PRO ONE chạy tại http://localhost:"+PORT));
