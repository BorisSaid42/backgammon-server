import express from "express";
import cors from "cors";
import {
  Connection, Keypair, PublicKey, Transaction,
  SystemProgram, LAMPORTS_PER_SOL, sendAndConfirmTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
 
const PORT = process.env.PORT || 3001;
const HELIUS_RPC = process.env.HELIUS_RPC;
const HOUSE_KEYPAIR_BASE58 = process.env.HOUSE_KEYPAIR;
const FRONTEND_URL = process.env.FRONTEND_URL || "*";
 
if (!HELIUS_RPC) throw new Error("Missing HELIUS_RPC");
if (!HOUSE_KEYPAIR_BASE58) throw new Error("Missing HOUSE_KEYPAIR");
 
const houseKeypair = Keypair.fromSecretKey(bs58.decode(HOUSE_KEYPAIR_BASE58));
const HOUSE_PUBKEY = houseKeypair.publicKey.toString();
const connection = new Connection(HELIUS_RPC, "confirmed");
console.log(`House wallet: ${HOUSE_PUBKEY}`);
 
const lobbies = new Map();
 
// ── Solana helpers ──
async function verifyPayment(signature, expectedLamports, fromWallet) {
  await sleep(2000);
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const tx = await connection.getParsedTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
      if (!tx) { await sleep(2000); continue; }
      if (tx.meta?.err) throw new Error("Transaction failed on-chain");
      for (const ix of tx.transaction.message.instructions) {
        if (ix.program === "system" && ix.parsed?.type === "transfer") {
          const info = ix.parsed.info;
          if (info.destination === HOUSE_PUBKEY && info.source === fromWallet && info.lamports >= expectedLamports) return true;
        }
      }
      throw new Error("Transaction does not match expected payment");
    } catch (e) { if (attempt === 9) throw e; await sleep(2000); }
  }
  throw new Error("Could not verify transaction");
}
 
async function sendPayout(toWallet, amountSol) {
  const lamports = Math.round(amountSol * LAMPORTS_PER_SOL) - 5000;
  if (lamports <= 0) throw new Error("Payout too small");
  const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: houseKeypair.publicKey, toPubkey: new PublicKey(toWallet), lamports }));
  const sig = await sendAndConfirmTransaction(connection, tx, [houseKeypair], { commitment: "confirmed" });
  console.log(`Payout: ${amountSol} SOL to ${toWallet} — ${sig}`);
  return sig;
}
 
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
 
// ── Game logic ──
const CK = 15, BAR = "bar", OFF = "off", WHITE = 1, BLACK = -1;
function initialBoard() { const b = Array(24).fill(0); b[0]=-2;b[5]=5;b[7]=3;b[11]=-5;b[12]=5;b[16]=-3;b[18]=-5;b[23]=2; return b; }
const rollDie = () => Math.floor(Math.random() * 6) + 1;
 
function getValidMoves(board,bW,bB,pl,dice){const m=[];findMoves(board,bW,bB,pl,[...dice],[],m,new Set());return m}
function findMoves(board,bW,bB,pl,rd,cm,am,seen){if(!rd.length){const k=JSON.stringify(cm);if(!seen.has(k)){seen.add(k);am.push([...cm])}return}let f=false;for(let di=0;di<rd.length;di++){const die=rd[di];const srcs=getSources(board,bW,bB,pl);for(const src of srcs){const dest=getDest(src,die,pl);if(dest===null)continue;if(!isValid(board,bW,bB,pl,src,dest,die))continue;f=true;const[nb,nW,nB,hit]=doMove(board,bW,bB,pl,src,dest);const nd=[...rd];nd.splice(di,1);findMoves(nb,nW,nB,pl,nd,[...cm,{from:src,to:dest,die,hit}],am,seen)}}if(!f&&cm.length>0){const k=JSON.stringify(cm);if(!seen.has(k)){seen.add(k);am.push([...cm])}}}
function getSources(board,bW,bB,pl){const bar=pl===WHITE?bW:bB;if(bar>0)return[BAR];const s=[];for(let i=0;i<24;i++){if((pl===WHITE&&board[i]>0)||(pl===BLACK&&board[i]<0))s.push(i)}return s}
function getDest(src,die,pl){if(src===BAR)return pl===WHITE?24-die:die-1;const d=pl===WHITE?src-die:src+die;if(d<0||d>23)return OFF;return d}
function canBearOff(board,pl){for(let i=0;i<24;i++){if(pl===WHITE&&board[i]>0&&i>5)return false;if(pl===BLACK&&board[i]<0&&i<18)return false}return true}
function isValid(board,bW,bB,pl,src,dest,die){const bar=pl===WHITE?bW:bB;if(src===BAR&&bar===0)return false;if(src!==BAR&&bar>0)return false;if(src!==BAR){if(pl===WHITE&&board[src]<=0)return false;if(pl===BLACK&&board[src]>=0)return false}if(dest===OFF){if(!canBearOff(board,pl))return false;if(src!==BAR){if(pl===WHITE&&die>src+1){for(let i=src+1;i<=5;i++)if(board[i]>0)return false}else if(pl===BLACK&&die>(24-src)){for(let i=src-1;i>=18;i--)if(board[i]<0)return false}}return true}if(pl===WHITE&&board[dest]<-1)return false;if(pl===BLACK&&board[dest]>1)return false;return true}
function doMove(board,bW,bB,pl,src,dest){const nb=[...board];let nW=bW,nB=bB,hit=false;if(src===BAR){if(pl===WHITE)nW--;else nB--}else{nb[src]+=pl===WHITE?-1:1}if(dest!==OFF){if(pl===WHITE&&nb[dest]===-1){nb[dest]=0;nB++;hit=true}else if(pl===BLACK&&nb[dest]===1){nb[dest]=0;nW++;hit=true}nb[dest]+=pl===WHITE?1:-1}return[nb,nW,nB,hit]}
function getBorneOff(board,bW,bB,pl){let on=pl===WHITE?bW:bB;for(let i=0;i<24;i++){if(pl===WHITE&&board[i]>0)on+=board[i];if(pl===BLACK&&board[i]<0)on+=Math.abs(board[i])}return CK-on}
function checkWinner(board,bW,bB){if(getBorneOff(board,bW,bB,WHITE)===CK)return WHITE;if(getBorneOff(board,bW,bB,BLACK)===CK)return BLACK;return null}
function getWinMult(board,bW,bB,winner){const loser=winner===WHITE?BLACK:WHITE;if(getBorneOff(board,bW,bB,loser)===0){const lb=loser===WHITE?bW:bB;let ih=false;for(let i=0;i<24;i++){if(loser===WHITE&&board[i]>0&&i<=5)ih=true;if(loser===BLACK&&board[i]<0&&i>=18)ih=true}if(lb>0||ih)return 3;return 2}return 1}
function getMaxMoves(vm){return vm.length?Math.max(...vm.map(m=>m.length)):0}
 
function validateMoveSequence(game, player, moves) {
  const allValid = getValidMoves(game.board, game.barW, game.barB, player, game.dice);
  const maxLen = getMaxMoves(allValid);
  if (!moves.length) { if (maxLen > 0) return { ok: false, error: "You have valid moves" }; return { ok: true }; }
  let b = [...game.board], bw = game.barW, bb = game.barB;
  const usedDice = [];
  for (const m of moves) {
    const rem = [...game.dice]; for (const ud of usedDice) { const i = rem.indexOf(ud); if (i >= 0) rem.splice(i, 1); }
    if (!isValid(b, bw, bb, player, m.from, m.to, m.die)) return { ok: false, error: `Invalid move` };
    if (!rem.includes(m.die)) return { ok: false, error: `Die ${m.die} not available` };
    [b, bw, bb] = doMove(b, bw, bb, player, m.from, m.to).slice(0, 3);
    usedDice.push(m.die);
  }
  if (moves.length < maxLen) {
    const rem = [...game.dice]; for (const ud of usedDice) { const i = rem.indexOf(ud); if (i >= 0) rem.splice(i, 1); }
    if (getMaxMoves(getValidMoves(b, bw, bb, player, rem)) > 0) return { ok: false, error: "Must use all possible dice" };
  }
  return { ok: true, board: b, barW: bw, barB: bb };
}
 
// ── Express ──
const app = express();
const allowedOrigins = FRONTEND_URL.split(",").map(s => s.trim());
app.use(cors({ origin: (origin, cb) => {
  if (!origin || allowedOrigins.includes("*") || allowedOrigins.includes(origin)) cb(null, true);
  else cb(new Error("Not allowed"));
}}));
app.use(express.json());
 
const genId = () => Math.random().toString(36).slice(2, 10);
function getColor(lobby, pid) { if (lobby.host.playerId === pid) return WHITE; if (lobby.guest?.playerId === pid) return BLACK; return null; }
 
app.get("/health", (_, res) => res.json({ ok: true, house: HOUSE_PUBKEY }));
app.get("/house", (_, res) => res.json({ publicKey: HOUSE_PUBKEY }));
 
app.post("/lobby/create", async (req, res) => {
  try {
    const { playerName, wallet, wagerPerPoint, txSignature } = req.body;
    if (!playerName) return res.status(400).json({ error: "Missing playerName" });
    const wager = parseFloat(wagerPerPoint) || 0;
    if (wager > 0 && !wallet) return res.status(400).json({ error: "Wallet required for paid games" });
    if (wager > 0) {
      if (!txSignature) return res.status(400).json({ error: "Payment signature required" });
      await verifyPayment(txSignature, Math.round(wager * LAMPORTS_PER_SOL), wallet);
    }
    const id = genId();
    const lobby = { id, host: { name: playerName, wallet: wallet || "", playerId: genId() }, guest: null, status: "waiting", game: null, matchScore: { w: 0, b: 0 }, wagerPerPoint: wager, totalPot: wager, hostPaid: wager, guestPaid: 0, version: 0, createdAt: Date.now() };
    lobbies.set(id, lobby);
    console.log(`Lobby ${id} created — ${wager} SOL`);
    res.json({ lobbyId: id, playerId: lobby.host.playerId, color: WHITE });
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});
 
app.post("/lobby/:id/join", async (req, res) => {
  try {
    const lobby = lobbies.get(req.params.id);
    if (!lobby) return res.status(404).json({ error: "Lobby not found" });
    if (lobby.guest) return res.status(400).json({ error: "Lobby full" });
    const { playerName, wallet, txSignature } = req.body;
    if (!playerName) return res.status(400).json({ error: "Missing playerName" });
    if (wallet && wallet === lobby.host.wallet && wallet !== "") return res.status(400).json({ error: "Cannot join your own lobby" });
    const wager = lobby.wagerPerPoint;
    if (wager > 0 && !wallet) return res.status(400).json({ error: "Wallet required for paid games" });
    if (wager > 0) {
      if (!txSignature) return res.status(400).json({ error: "Payment signature required" });
      await verifyPayment(txSignature, Math.round(wager * LAMPORTS_PER_SOL), wallet);
    }
    lobby.guest = { name: playerName, wallet: wallet || "", playerId: genId() };
    lobby.guestPaid = wager; lobby.totalPot += wager; lobby.version++;
    res.json({ playerId: lobby.guest.playerId, color: BLACK, wagerPerPoint: wager });
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});
 
app.get("/lobby/:id", (req, res) => {
  const lobby = lobbies.get(req.params.id);
  if (!lobby) return res.status(404).json({ error: "Lobby not found" });
  res.json(sanitize(lobby));
});
 
app.post("/lobby/:id/start", (req, res) => {
  const lobby = lobbies.get(req.params.id);
  if (!lobby) return res.status(404).json({ error: "Not found" });
  if (req.body.playerId !== lobby.host.playerId) return res.status(403).json({ error: "Only host can start" });
  if (!lobby.guest) return res.status(400).json({ error: "Need opponent" });
  let d1 = rollDie(), d2 = rollDie(); while (d1 === d2) { d1 = rollDie(); d2 = rollDie(); }
  const fp = d1 > d2 ? WHITE : BLACK;
  lobby.game = { board: initialBoard(), barW: 0, barB: 0, turn: fp, dice: [d1, d2].sort((a, b) => b - a), phase: "move", cubeValue: 1, cubeOwner: 0, winner: null, winPoints: 0, moveCount: 0, lastAction: `${fp === WHITE ? lobby.host.name : lobby.guest.name} goes first (${d1}-${d2})`, doublingPending: null };
  lobby.status = "playing"; lobby.version++; lobby.payoutProcessed = false; lobby.payoutSignature = null; lobby.payoutError = null;
  res.json(sanitize(lobby));
});
 
app.post("/lobby/:id/move", (req, res) => {
  const lobby = lobbies.get(req.params.id);
  if (!lobby?.game || lobby.game.phase !== "move") return res.status(400).json({ error: "Not in move phase" });
  const player = getColor(lobby, req.body.playerId);
  if (player === null) return res.status(403).json({ error: "Not a player" });
  if (lobby.game.turn !== player) return res.status(400).json({ error: "Not your turn" });
  const v = validateMoveSequence(lobby.game, player, req.body.moves || []);
  if (!v.ok) return res.status(400).json({ error: v.error });
  if (req.body.moves?.length) { lobby.game.board = v.board; lobby.game.barW = v.barW; lobby.game.barB = v.barB; }
  lobby.game.moveCount++;
  const winner = checkWinner(lobby.game.board, lobby.game.barW, lobby.game.barB);
  if (winner) { handleWin(lobby, winner); }
  else {
    const d1 = rollDie(), d2 = rollDie();
    lobby.game.turn = lobby.game.turn === WHITE ? BLACK : WHITE;
    lobby.game.dice = d1 === d2 ? [d1, d1, d1, d1] : [d1, d2].sort((a, b) => b - a);
    lobby.game.phase = "move";
    lobby.game.lastAction = `${lobby.game.turn === WHITE ? lobby.host.name : lobby.guest.name}'s turn (${lobby.game.dice.join("-")})`;
  }
  lobby.version++;
  res.json(sanitize(lobby));
});
 
app.post("/lobby/:id/double", async (req, res) => {
  try {
    const lobby = lobbies.get(req.params.id);
    if (!lobby?.game || lobby.game.phase !== "move") return res.status(400).json({ error: "Not in move phase" });
    const player = getColor(lobby, req.body.playerId);
    if (player === null || lobby.game.turn !== player) return res.status(400).json({ error: "Not your turn" });
    if (lobby.game.cubeOwner !== 0 && lobby.game.cubeOwner !== player) return res.status(400).json({ error: "Don't own cube" });
    const cost = lobby.game.cubeValue * lobby.wagerPerPoint;
    const wallet = player === WHITE ? lobby.host.wallet : lobby.guest.wallet;
    if (cost > 0) { if (!req.body.txSignature) return res.status(400).json({ error: "Payment required" }); await verifyPayment(req.body.txSignature, Math.round(cost * LAMPORTS_PER_SOL), wallet); lobby.totalPot += cost; if (player === WHITE) lobby.hostPaid += cost; else lobby.guestPaid += cost; }
    lobby.game.doublingPending = { type: "double", from: player, target: player === WHITE ? BLACK : WHITE, value: lobby.game.cubeValue * 2 };
    lobby.game.phase = "double";
    lobby.game.lastAction = `${player === WHITE ? lobby.host.name : lobby.guest.name} doubles to ${lobby.game.cubeValue * 2}`;
    lobby.version++;
    res.json(sanitize(lobby));
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});
 
app.post("/lobby/:id/double-response", async (req, res) => {
  try {
    const lobby = lobbies.get(req.params.id);
    if (!lobby?.game || lobby.game.phase !== "double") return res.status(400).json({ error: "No double pending" });
    const player = getColor(lobby, req.body.playerId);
    const dp = lobby.game.doublingPending;
    if (!dp || dp.target !== player) return res.status(400).json({ error: "Not for you" });
    const name = player === WHITE ? lobby.host.name : lobby.guest.name;
    const wallet = player === WHITE ? lobby.host.wallet : lobby.guest.wallet;
    const { action, txSignature } = req.body;
 
    if (action === "drop") {
      lobby.game.winner = dp.from; lobby.game.winPoints = lobby.game.cubeValue; lobby.game.phase = "gameover";
      lobby.game.lastAction = `${name} drops`; lobby.game.doublingPending = null;
      if (dp.from === WHITE) (lobby.matchScore.w || 0); lobby.matchScore[dp.from === WHITE ? "w" : "b"] += lobby.game.cubeValue;
      processPayoutForLobby(lobby).catch(e => console.error("Payout:", e));
    } else if (action === "accept") {
      const cost = (dp.value - lobby.game.cubeValue) * lobby.wagerPerPoint;
      if (cost > 0) { if (!txSignature) return res.status(400).json({ error: "Payment required" }); await verifyPayment(txSignature, Math.round(cost * LAMPORTS_PER_SOL), wallet); lobby.totalPot += cost; if (player === WHITE) lobby.hostPaid += cost; else lobby.guestPaid += cost; }
      if (dp.type === "double") { lobby.game.cubeValue = dp.value; lobby.game.cubeOwner = player; } else { lobby.game.cubeValue = dp.value; lobby.game.cubeOwner = dp.from; }
      lobby.game.doublingPending = null; lobby.game.phase = "move";
      lobby.game.lastAction = `${name} accepts. Cube ${lobby.game.cubeValue}`;
    } else if (action === "beaver") {
      const bv = dp.value * 2, cost = (bv - lobby.game.cubeValue) * lobby.wagerPerPoint;
      if (cost > 0) { if (!txSignature) return res.status(400).json({ error: "Payment required" }); await verifyPayment(txSignature, Math.round(cost * LAMPORTS_PER_SOL), wallet); lobby.totalPot += cost; if (player === WHITE) lobby.hostPaid += cost; else lobby.guestPaid += cost; }
      lobby.game.doublingPending = { type: "beaver", from: player, target: dp.from, value: bv };
      lobby.game.lastAction = `${name} beavers! Stakes ${bv}`;
    } else return res.status(400).json({ error: "Invalid action" });
    lobby.version++;
    res.json(sanitize(lobby));
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});
 
// ── Forfeit ──
app.post("/lobby/:id/forfeit", (req, res) => {
  try {
    const lobby = lobbies.get(req.params.id);
    if (!lobby) return res.status(404).json({ error: "Not found" });
    const player = getColor(lobby, req.body.playerId);
    if (player === null) return res.status(403).json({ error: "Not a player" });
    if (!lobby.game || lobby.game.phase === "gameover") return res.status(400).json({ error: "No active game" });
    const winner = player === WHITE ? BLACK : WHITE;
    const pts = lobby.game.cubeValue;
    lobby.game.winner = winner; lobby.game.winPoints = pts; lobby.game.phase = "gameover";
    lobby.status = "finished";
    const loserName = player === WHITE ? lobby.host.name : lobby.guest.name;
    const winnerName = winner === WHITE ? lobby.host.name : lobby.guest.name;
    lobby.game.lastAction = `${loserName} forfeits. ${winnerName} wins ${pts}pt.`;
    lobby.game.doublingPending = null;
    lobby.matchScore[winner === WHITE ? "w" : "b"] += pts;
    lobby.version++;
    processPayoutForLobby(lobby).catch(e => console.error("Payout:", e));
    res.json(sanitize(lobby));
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});
 
// ── List all lobbies ──
app.get("/lobbies", (req, res) => {
  const list = [];
  for (const [id, lobby] of lobbies) {
    list.push({
      id,
      host: lobby.host.name,
      guest: lobby.guest?.name || null,
      status: lobby.status,
      wagerPerPoint: lobby.wagerPerPoint,
      totalPot: lobby.totalPot,
      joinable: lobby.status === "waiting" && !lobby.guest,
      createdAt: lobby.createdAt,
    });
  }
  // Sort: joinable first, then by creation time (newest first)
  list.sort((a, b) => {
    if (a.joinable && !b.joinable) return -1;
    if (!a.joinable && b.joinable) return 1;
    return b.createdAt - a.createdAt;
  });
  res.json({ lobbies: list });
});
 
function handleWin(lobby, winner) {
  const mult = getWinMult(lobby.game.board, lobby.game.barW, lobby.game.barB, winner);
  const pts = mult * lobby.game.cubeValue;
  lobby.game.winner = winner; lobby.game.winPoints = pts; lobby.game.phase = "gameover";
  lobby.status = "finished";
  const wn = winner === WHITE ? lobby.host.name : lobby.guest.name;
  lobby.game.lastAction = `${wn} wins! ${mult === 3 ? "Backgammon!" : mult === 2 ? "Gammon!" : ""} ${pts}pt`;
  lobby.matchScore[winner === WHITE ? "w" : "b"] += pts;
  processPayoutForLobby(lobby).catch(e => console.error("Payout:", e));
}
 
async function processPayoutForLobby(lobby) {
  if (lobby.wagerPerPoint <= 0 || lobby.totalPot <= 0 || lobby.payoutProcessed) return;
  const wallet = lobby.game.winner === WHITE ? lobby.host.wallet : lobby.guest.wallet;
  if (!wallet) return;
  try { const sig = await sendPayout(wallet, lobby.totalPot); lobby.payoutSignature = sig; lobby.payoutProcessed = true; lobby.version++; }
  catch (e) { console.error(`Payout failed ${lobby.id}:`, e); lobby.payoutError = e.message; }
}
 
function sanitize(lobby) {
  return { id: lobby.id, host: { name: lobby.host.name, wallet: lobby.host.wallet }, guest: lobby.guest ? { name: lobby.guest.name, wallet: lobby.guest.wallet } : null, status: lobby.status, game: lobby.game, matchScore: lobby.matchScore, wagerPerPoint: lobby.wagerPerPoint, totalPot: lobby.totalPot, version: lobby.version, payoutSignature: lobby.payoutSignature || null, payoutError: lobby.payoutError || null };
}
 
setInterval(() => { const cut = Date.now() - 4 * 3600000; for (const [id, l] of lobbies) if (l.createdAt < cut) { lobbies.delete(id); console.log(`Cleaned ${id}`); } }, 30 * 60000);
 
app.listen(PORT, () => console.log(`Server :${PORT} — House: ${HOUSE_PUBKEY}`));