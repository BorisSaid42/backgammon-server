import express from "express";
import cors from "cors";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";

// ═══════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════
const PORT = process.env.PORT || 3001;
const HELIUS_RPC = process.env.HELIUS_RPC;
const HOUSE_KEYPAIR_BASE58 = process.env.HOUSE_KEYPAIR;
const FRONTEND_URL = process.env.FRONTEND_URL || "*";

if (!HELIUS_RPC) throw new Error("Missing HELIUS_RPC env var");
if (!HOUSE_KEYPAIR_BASE58) throw new Error("Missing HOUSE_KEYPAIR env var");

const houseKeypair = Keypair.fromSecretKey(bs58.decode(HOUSE_KEYPAIR_BASE58));
const HOUSE_PUBKEY = houseKeypair.publicKey.toString();
const connection = new Connection(HELIUS_RPC, "confirmed");

console.log(`House wallet: ${HOUSE_PUBKEY}`);

// ═══════════════════════════════════════════════════════════════
// IN-MEMORY STORE
// ═══════════════════════════════════════════════════════════════
const lobbies = new Map();

// ═══════════════════════════════════════════════════════════════
// SOLANA HELPERS
// ═══════════════════════════════════════════════════════════════
async function verifyPayment(signature, expectedLamports, fromWallet) {
  await sleep(2000);
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const tx = await connection.getParsedTransaction(signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
      if (!tx) { await sleep(2000); continue; }
      if (tx.meta?.err) throw new Error("Transaction failed on-chain");
      const instructions = tx.transaction.message.instructions;
      let verified = false;
      for (const ix of instructions) {
        if (ix.program === "system" && ix.parsed?.type === "transfer") {
          const info = ix.parsed.info;
          if (info.destination === HOUSE_PUBKEY && info.source === fromWallet && info.lamports >= expectedLamports) {
            verified = true; break;
          }
        }
      }
      if (!verified) throw new Error("Transaction does not match expected payment");
      return true;
    } catch (e) {
      if (attempt === 9) throw e;
      await sleep(2000);
    }
  }
  throw new Error("Could not verify transaction after 10 attempts");
}

async function sendPayout(toWalletStr, amountSol) {
  const toPubkey = new PublicKey(toWalletStr);
  const lamports = Math.round(amountSol * LAMPORTS_PER_SOL);
  const netLamports = lamports - 5000;
  if (netLamports <= 0) throw new Error("Payout too small to cover fees");
  const transaction = new Transaction().add(
    SystemProgram.transfer({ fromPubkey: houseKeypair.publicKey, toPubkey, lamports: netLamports })
  );
  const signature = await sendAndConfirmTransaction(connection, transaction, [houseKeypair], { commitment: "confirmed" });
  console.log(`Payout sent: ${amountSol} SOL to ${toWalletStr} — sig: ${signature}`);
  return signature;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ═══════════════════════════════════════════════════════════════
// GAME LOGIC (server-authoritative)
// ═══════════════════════════════════════════════════════════════
const CHECKERS = 15, BAR = "bar", OFF = "off", WHITE = 1, BLACK = -1;

function initialBoard() {
  const b = new Array(24).fill(0);
  b[0]=2;b[5]=-5;b[7]=-3;b[11]=5;b[12]=-5;b[16]=3;b[18]=5;b[23]=-2;
  return b;
}

const rollDie = () => Math.floor(Math.random() * 6) + 1;

function getValidMoves(board,barW,barB,player,dice){const m=[];findMoves(board,barW,barB,player,[...dice],[],m,new Set());return m}
function findMoves(board,barW,barB,player,rd,cm,am,seen){if(rd.length===0){const k=JSON.stringify(cm);if(!seen.has(k)){seen.add(k);am.push([...cm])}return}let f=false;for(let di=0;di<rd.length;di++){const die=rd[di];const sources=getSources(board,barW,barB,player);for(const src of sources){const dest=getDestination(src,die,player);if(dest===null)continue;if(!isValidMove(board,barW,barB,player,src,dest,die))continue;f=true;const[nb,nW,nB,hit]=applyMove(board,barW,barB,player,src,dest);const nd=[...rd];nd.splice(di,1);findMoves(nb,nW,nB,player,nd,[...cm,{from:src,to:dest,die,hit}],am,seen)}}if(!f&&cm.length>0){const k=JSON.stringify(cm);if(!seen.has(k)){seen.add(k);am.push([...cm])}}}
function getSources(board,barW,barB,player){const bar=player===WHITE?barW:barB;if(bar>0)return[BAR];const s=[];for(let i=0;i<24;i++){if((player===WHITE&&board[i]>0)||(player===BLACK&&board[i]<0))s.push(i)}return s}
function getDestination(src,die,player){if(src===BAR)return player===WHITE?24-die:die-1;const d=player===WHITE?src-die:src+die;if(d<0||d>23)return OFF;return d}
function canBearOff(board,player){for(let i=0;i<24;i++){if(player===WHITE&&board[i]>0&&i>5)return false;if(player===BLACK&&board[i]<0&&i<18)return false}return true}
function isValidMove(board,barW,barB,player,src,dest,die){const bar=player===WHITE?barW:barB;if(src===BAR&&bar===0)return false;if(src!==BAR&&bar>0)return false;if(src!==BAR){if(player===WHITE&&board[src]<=0)return false;if(player===BLACK&&board[src]>=0)return false}if(dest===OFF){if(!canBearOff(board,player))return false;if(src!==BAR){const ed=player===WHITE?src-die:src+die;if(ed<0||ed>23){if(player===WHITE){for(let i=src+1;i<=5;i++)if(board[i]>0)return false}else{for(let i=src-1;i>=18;i--)if(board[i]<0)return false}}}return true}if(player===WHITE&&board[dest]<-1)return false;if(player===BLACK&&board[dest]>1)return false;return true}
function applyMove(board,barW,barB,player,src,dest){const nb=[...board];let nW=barW,nB=barB,hit=false;if(src===BAR){if(player===WHITE)nW--;else nB--}else{nb[src]+=player===WHITE?-1:1}if(dest!==OFF){if(player===WHITE&&nb[dest]===-1){nb[dest]=0;nB++;hit=true}else if(player===BLACK&&nb[dest]===1){nb[dest]=0;nW++;hit=true}nb[dest]+=player===WHITE?1:-1}return[nb,nW,nB,hit]}
function getBorneOff(board,barW,barB,player){let on=player===WHITE?barW:barB;for(let i=0;i<24;i++){if(player===WHITE&&board[i]>0)on+=board[i];if(player===BLACK&&board[i]<0)on+=Math.abs(board[i])}return CHECKERS-on}
function checkWinner(board,barW,barB){if(getBorneOff(board,barW,barB,WHITE)===CHECKERS)return WHITE;if(getBorneOff(board,barW,barB,BLACK)===CHECKERS)return BLACK;return null}
function getWinMultiplier(board,barW,barB,winner){const loser=winner===WHITE?BLACK:WHITE;const lo=getBorneOff(board,barW,barB,loser);if(lo===0){const lb=loser===WHITE?barW:barB;let ih=false;for(let i=0;i<24;i++){if(loser===WHITE&&board[i]>0&&i<=5)ih=true;if(loser===BLACK&&board[i]<0&&i>=18)ih=true}if(lb>0||ih)return 3;return 2}return 1}
function getMaxMoves(vm){if(vm.length===0)return 0;return Math.max(...vm.map(m=>m.length))}

function validateMoveSequence(game, player, moves) {
  const allValid = getValidMoves(game.board, game.barW, game.barB, player, game.dice);
  const maxLen = getMaxMoves(allValid);
  if (moves.length === 0) {
    if (maxLen > 0) return { ok: false, error: "You have valid moves available" };
    return { ok: true };
  }
  let b = [...game.board], bw = game.barW, bb = game.barB;
  const usedDice = [];
  for (const m of moves) {
    const remainingDice = [...game.dice];
    for (const ud of usedDice) { const idx = remainingDice.indexOf(ud); if (idx >= 0) remainingDice.splice(idx, 1); }
    if (!isValidMove(b, bw, bb, player, m.from, m.to, m.die)) return { ok: false, error: `Invalid move: ${m.from} -> ${m.to} with die ${m.die}` };
    if (!remainingDice.includes(m.die)) return { ok: false, error: `Die ${m.die} not available` };
    [b, bw, bb] = applyMove(b, bw, bb, player, m.from, m.to).slice(0, 3);
    usedDice.push(m.die);
  }
  if (moves.length < maxLen) {
    const remainingDice = [...game.dice];
    for (const ud of usedDice) { const idx = remainingDice.indexOf(ud); if (idx >= 0) remainingDice.splice(idx, 1); }
    const moreMoves = getValidMoves(b, bw, bb, player, remainingDice);
    if (getMaxMoves(moreMoves) > 0) return { ok: false, error: "You must use all possible dice" };
  }
  return { ok: true, board: b, barW: bw, barB: bb };
}

// ═══════════════════════════════════════════════════════════════
// EXPRESS APP
// ═══════════════════════════════════════════════════════════════
const app = express();
app.use(cors({ origin: FRONTEND_URL }));
app.use(express.json());

app.get("/health", (req, res) => res.json({ ok: true, house: HOUSE_PUBKEY }));
app.get("/house", (req, res) => res.json({ publicKey: HOUSE_PUBKEY }));

app.post("/lobby/create", async (req, res) => {
  try {
    const { playerName, wallet, wagerPerPoint, txSignature } = req.body;
    if (!playerName) return res.status(400).json({ error: "Missing playerName" });
    const wager = parseFloat(wagerPerPoint) || 0;
    if (wager > 0 && !wallet) return res.status(400).json({ error: "Wallet required for paid games" });
    if (wager > 0) {
      if (!txSignature) return res.status(400).json({ error: "Payment transaction signature required" });
      await verifyPayment(txSignature, Math.round(wager * LAMPORTS_PER_SOL), wallet);
    }
    const id = genId();
    const lobby = { id, host: { name: playerName, wallet: wallet || "", playerId: genId() }, guest: null, status: "waiting", game: null, matchScore: { w: 0, b: 0 }, wagerPerPoint: wager, totalPot: wager, hostPaid: wager, guestPaid: 0, payouts: [], version: 0, createdAt: Date.now() };
    lobbies.set(id, lobby);
    console.log(`Lobby created: ${id} — wager: ${wager} SOL`);
    res.json({ lobbyId: id, playerId: lobby.host.playerId, color: WHITE });
  } catch (e) { console.error("Create lobby error:", e); res.status(500).json({ error: e.message }); }
});

app.post("/lobby/:id/join", async (req, res) => {
  try {
    const lobby = lobbies.get(req.params.id);
    if (!lobby) return res.status(404).json({ error: "Lobby not found" });
    if (lobby.guest) return res.status(400).json({ error: "Lobby is full" });
    const { playerName, wallet, txSignature } = req.body;
    if (!playerName) return res.status(400).json({ error: "Missing playerName" });
    const wager = lobby.wagerPerPoint;
    if (wager > 0 && !wallet) return res.status(400).json({ error: "Wallet required for paid games" });
    if (wager > 0) {
      if (!txSignature) return res.status(400).json({ error: "Payment transaction signature required" });
      await verifyPayment(txSignature, Math.round(wager * LAMPORTS_PER_SOL), wallet);
    }
    lobby.guest = { name: playerName, wallet: wallet || "", playerId: genId() };
    lobby.guestPaid = wager; lobby.totalPot += wager; lobby.version++;
    console.log(`Player joined lobby ${req.params.id}: ${playerName}`);
    res.json({ playerId: lobby.guest.playerId, color: BLACK, wagerPerPoint: wager });
  } catch (e) { console.error("Join lobby error:", e); res.status(500).json({ error: e.message }); }
});

app.get("/lobby/:id", (req, res) => {
  const lobby = lobbies.get(req.params.id);
  if (!lobby) return res.status(404).json({ error: "Lobby not found" });
  res.json(sanitizeLobby(lobby));
});

app.post("/lobby/:id/start", (req, res) => {
  const lobby = lobbies.get(req.params.id);
  if (!lobby) return res.status(404).json({ error: "Lobby not found" });
  const { playerId } = req.body;
  if (playerId !== lobby.host.playerId) return res.status(403).json({ error: "Only host can start" });
  if (!lobby.guest) return res.status(400).json({ error: "Need an opponent" });
  let d1 = rollDie(), d2 = rollDie();
  while (d1 === d2) { d1 = rollDie(); d2 = rollDie(); }
  const fp = d1 > d2 ? WHITE : BLACK;
  lobby.game = { board: initialBoard(), barW: 0, barB: 0, turn: fp, dice: [d1, d2].sort((a, b) => b - a), phase: "move", cubeValue: 1, cubeOwner: 0, winner: null, winPoints: 0, moveCount: 0, lastAction: `Game started. ${fp === WHITE ? lobby.host.name : lobby.guest.name} goes first (${d1}-${d2}).`, doublingPending: null };
  lobby.status = "playing"; lobby.version++; lobby.payoutProcessed = false; lobby.payoutSignature = null; lobby.payoutError = null;
  res.json(sanitizeLobby(lobby));
});

app.post("/lobby/:id/move", (req, res) => {
  const lobby = lobbies.get(req.params.id);
  if (!lobby) return res.status(404).json({ error: "Lobby not found" });
  if (!lobby.game || lobby.game.phase !== "move") return res.status(400).json({ error: "Not in move phase" });
  const { playerId, moves } = req.body;
  const player = getPlayerColor(lobby, playerId);
  if (player === null) return res.status(403).json({ error: "Not a player in this lobby" });
  if (lobby.game.turn !== player) return res.status(400).json({ error: "Not your turn" });
  const validation = validateMoveSequence(lobby.game, player, moves || []);
  if (!validation.ok) return res.status(400).json({ error: validation.error });
  if (moves && moves.length > 0) { lobby.game.board = validation.board; lobby.game.barW = validation.barW; lobby.game.barB = validation.barB; }
  lobby.game.moveCount++;
  const winner = checkWinner(lobby.game.board, lobby.game.barW, lobby.game.barB);
  if (winner) { handleGameWin(lobby, winner); }
  else {
    const d1 = rollDie(), d2 = rollDie();
    lobby.game.turn = lobby.game.turn === WHITE ? BLACK : WHITE;
    lobby.game.dice = d1 === d2 ? [d1, d1, d1, d1] : [d1, d2].sort((a, b) => b - a);
    lobby.game.phase = "move";
    lobby.game.lastAction = `${lobby.game.turn === WHITE ? lobby.host.name : lobby.guest.name}'s turn. Rolled ${lobby.game.dice.join("-")}.`;
  }
  lobby.version++;
  res.json(sanitizeLobby(lobby));
});

app.post("/lobby/:id/double", async (req, res) => {
  try {
    const lobby = lobbies.get(req.params.id);
    if (!lobby) return res.status(404).json({ error: "Lobby not found" });
    if (!lobby.game || lobby.game.phase !== "move") return res.status(400).json({ error: "Not in move phase" });
    const { playerId, txSignature } = req.body;
    const player = getPlayerColor(lobby, playerId);
    if (player === null) return res.status(403).json({ error: "Not a player" });
    if (lobby.game.turn !== player) return res.status(400).json({ error: "Not your turn" });
    if (lobby.game.cubeOwner !== 0 && lobby.game.cubeOwner !== player) return res.status(400).json({ error: "You don't own the cube" });
    const cost = lobby.game.cubeValue * lobby.wagerPerPoint;
    const playerWallet = player === WHITE ? lobby.host.wallet : lobby.guest.wallet;
    if (cost > 0) {
      if (!txSignature) return res.status(400).json({ error: "Payment required to double" });
      await verifyPayment(txSignature, Math.round(cost * LAMPORTS_PER_SOL), playerWallet);
      lobby.totalPot += cost;
      if (player === WHITE) lobby.hostPaid += cost; else lobby.guestPaid += cost;
    }
    lobby.game.doublingPending = { type: "double", from: player, target: player === WHITE ? BLACK : WHITE, value: lobby.game.cubeValue * 2 };
    lobby.game.phase = "double";
    lobby.game.lastAction = `${player === WHITE ? lobby.host.name : lobby.guest.name} offers to double to ${lobby.game.cubeValue * 2}`;
    lobby.version++;
    res.json(sanitizeLobby(lobby));
  } catch (e) { console.error("Double error:", e); res.status(500).json({ error: e.message }); }
});

app.post("/lobby/:id/double-response", async (req, res) => {
  try {
    const lobby = lobbies.get(req.params.id);
    if (!lobby) return res.status(404).json({ error: "Lobby not found" });
    if (!lobby.game || lobby.game.phase !== "double") return res.status(400).json({ error: "No double pending" });
    const { playerId, action, txSignature } = req.body;
    const player = getPlayerColor(lobby, playerId);
    if (player === null) return res.status(403).json({ error: "Not a player" });
    const dp = lobby.game.doublingPending;
    if (!dp || dp.target !== player) return res.status(400).json({ error: "Double not targeted at you" });
    const playerName = player === WHITE ? lobby.host.name : lobby.guest.name;
    const playerWallet = player === WHITE ? lobby.host.wallet : lobby.guest.wallet;

    if (action === "drop") {
      lobby.game.winner = dp.from; lobby.game.winPoints = lobby.game.cubeValue; lobby.game.phase = "gameover";
      lobby.game.lastAction = `${playerName} drops.`; lobby.game.doublingPending = null;
      lobby.matchScore = lobby.matchScore || { w: 0, b: 0 };
      if (dp.from === WHITE) lobby.matchScore.w += lobby.game.cubeValue; else lobby.matchScore.b += lobby.game.cubeValue;
      processPayoutForLobby(lobby).catch(e => console.error("Payout failed:", e));
    } else if (action === "accept") {
      const cost = (dp.value - lobby.game.cubeValue) * lobby.wagerPerPoint;
      if (cost > 0) {
        if (!txSignature) return res.status(400).json({ error: "Payment required" });
        await verifyPayment(txSignature, Math.round(cost * LAMPORTS_PER_SOL), playerWallet);
        lobby.totalPot += cost;
        if (player === WHITE) lobby.hostPaid += cost; else lobby.guestPaid += cost;
      }
      if (dp.type === "double") { lobby.game.cubeValue = dp.value; lobby.game.cubeOwner = player; }
      else { lobby.game.cubeValue = dp.value; lobby.game.cubeOwner = dp.from; }
      lobby.game.doublingPending = null; lobby.game.phase = "move";
      lobby.game.lastAction = `${playerName} accepts. Cube at ${lobby.game.cubeValue}.`;
    } else if (action === "beaver") {
      const beaverValue = dp.value * 2;
      const cost = (beaverValue - lobby.game.cubeValue) * lobby.wagerPerPoint;
      if (cost > 0) {
        if (!txSignature) return res.status(400).json({ error: "Payment required" });
        await verifyPayment(txSignature, Math.round(cost * LAMPORTS_PER_SOL), playerWallet);
        lobby.totalPot += cost;
        if (player === WHITE) lobby.hostPaid += cost; else lobby.guestPaid += cost;
      }
      lobby.game.doublingPending = { type: "beaver", from: player, target: dp.from, value: beaverValue };
      lobby.game.lastAction = `${playerName} beavers! Stakes now ${beaverValue}.`;
    } else {
      return res.status(400).json({ error: "Invalid action" });
    }
    lobby.version++;
    res.json(sanitizeLobby(lobby));
  } catch (e) { console.error("Double response error:", e); res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════
function genId() { return Math.random().toString(36).slice(2, 10); }

function getPlayerColor(lobby, playerId) {
  if (lobby.host.playerId === playerId) return WHITE;
  if (lobby.guest?.playerId === playerId) return BLACK;
  return null;
}

function handleGameWin(lobby, winner) {
  const mult = getWinMultiplier(lobby.game.board, lobby.game.barW, lobby.game.barB, winner);
  const pts = mult * lobby.game.cubeValue;
  lobby.game.winner = winner; lobby.game.winPoints = pts; lobby.game.phase = "gameover";
  const winnerName = winner === WHITE ? lobby.host.name : lobby.guest.name;
  const typeStr = mult === 3 ? "Backgammon!" : mult === 2 ? "Gammon!" : "";
  lobby.game.lastAction = `${winnerName} wins! ${typeStr} ${pts} point(s).`;
  lobby.matchScore = lobby.matchScore || { w: 0, b: 0 };
  if (winner === WHITE) lobby.matchScore.w += pts; else lobby.matchScore.b += pts;
  processPayoutForLobby(lobby).catch(e => console.error("Payout failed:", e));
}

async function processPayoutForLobby(lobby) {
  if (lobby.wagerPerPoint <= 0 || lobby.totalPot <= 0) return;
  if (lobby.payoutProcessed) return;
  const winner = lobby.game.winner;
  const winnerWallet = winner === WHITE ? lobby.host.wallet : lobby.guest.wallet;
  console.log(`Processing payout: ${lobby.totalPot} SOL to ${winnerWallet}`);
  try {
    const sig = await sendPayout(winnerWallet, lobby.totalPot);
    lobby.payoutSignature = sig; lobby.payoutProcessed = true; lobby.version++;
    console.log(`Payout complete: ${sig}`);
  } catch (e) {
    console.error(`Payout failed for lobby ${lobby.id}:`, e);
    lobby.payoutError = e.message;
  }
}

function sanitizeLobby(lobby) {
  return {
    id: lobby.id,
    host: { name: lobby.host.name, wallet: lobby.host.wallet },
    guest: lobby.guest ? { name: lobby.guest.name, wallet: lobby.guest.wallet } : null,
    status: lobby.status, game: lobby.game, matchScore: lobby.matchScore,
    wagerPerPoint: lobby.wagerPerPoint, totalPot: lobby.totalPot, version: lobby.version,
    payoutSignature: lobby.payoutSignature || null, payoutError: lobby.payoutError || null,
  };
}

setInterval(() => {
  const cutoff = Date.now() - 4 * 60 * 60 * 1000;
  for (const [id, lobby] of lobbies) {
    if (lobby.createdAt < cutoff) { lobbies.delete(id); console.log(`Cleaned up lobby ${id}`); }
  }
}, 30 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`Backgammon server running on port ${PORT}`);
  console.log(`House wallet: ${HOUSE_PUBKEY}`);
});