import { TelegramChat, TelegramUser } from "./types";
import { tehranDayStart } from "./utils";
import { BOOSTER_COOLDOWN_SEC } from "./constants";

export async function ensureUser(db: D1Database, user: TelegramUser) {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(`
      INSERT INTO users (telegram_id, username, first_name, created_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(telegram_id) DO UPDATE SET
        username = excluded.username,
        first_name = excluded.first_name
    `)
    .bind(user.id, user.username ?? null, user.first_name, now)
    .run();
}

export async function ensureGroup(db: D1Database, chat: TelegramChat) {
  if (chat.type !== "group" && chat.type !== "supergroup") return;
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(`
      INSERT INTO telegram_groups (
        telegram_group_id,
        title,
        bot_enabled,
        cooldown_seconds,
        meow_tax_pool,
        duel_tax_pool,
        lottery_enabled,
        lottery_tax_percentage,
        lottery_ticket_price,
        lottery_pot,
        lottery_ticket_sales,
        treasury_balance,
        created_at,
        updated_at,
        is_active
      ) VALUES (?, ?, 1, 300, 0, 0, 1, 75, 100, 0, 0, 0, ?, ?, 1)
      ON CONFLICT(telegram_group_id) DO UPDATE SET
        title = excluded.title,
        updated_at = excluded.updated_at,
        is_active = 1
    `)
    .bind(chat.id, chat.title ?? "Unknown Group", now, now)
    .run();
}

export async function deactivateGroup(db: D1Database, groupId: number) {
  await db
    .prepare(`UPDATE telegram_groups SET is_active = 0, updated_at = ? WHERE telegram_group_id = ?`)
    .bind(Math.floor(Date.now() / 1000), groupId)
    .run();
}

export async function getGroupSettings(db: D1Database, groupId: number) {
  const row = await db
    .prepare(`
      SELECT bot_enabled, cooldown_seconds,
             meow_tax_pool, duel_tax_pool,
             lottery_enabled, lottery_tax_percentage,
             lottery_ticket_price, lottery_pot, lottery_ticket_sales,
             treasury_balance
      FROM telegram_groups
      WHERE telegram_group_id = ?
    `)
    .bind(groupId)
    .first<{
      bot_enabled: number;
      cooldown_seconds: number;
      meow_tax_pool: number;
      duel_tax_pool: number;
      lottery_enabled: number;
      lottery_tax_percentage: number;
      lottery_ticket_price: number;
      lottery_pot: number;
      lottery_ticket_sales: number;
      treasury_balance: number;
    }>();
  return {
    enabled: row ? row.bot_enabled === 1 : true,
    cooldown: row ? row.cooldown_seconds : 300,
    meowTaxPool: row?.meow_tax_pool ?? 0,
    duelTaxPool: row?.duel_tax_pool ?? 0,
    lotteryEnabled: row ? row.lottery_enabled === 1 : true,
    lotteryTaxPercentage: row?.lottery_tax_percentage ?? 75,
    lotteryTicketPrice: row?.lottery_ticket_price ?? 100,
    lotteryPot: row?.lottery_pot ?? 0,
    lotteryTicketSales: row?.lottery_ticket_sales ?? 0,
    treasuryBalance: row?.treasury_balance ?? 0,
  };
}

export async function getGroupLotteryConfig(db: D1Database, groupId: number) {
  const row = await db
    .prepare(`
      SELECT meow_tax_pool, duel_tax_pool, lottery_enabled, lottery_tax_percentage, lottery_ticket_price, lottery_pot, lottery_ticket_sales, treasury_balance
      FROM telegram_groups
      WHERE telegram_group_id = ?
    `)
    .bind(groupId)
    .first<{
      meow_tax_pool: number;
      duel_tax_pool: number;
      lottery_enabled: number;
      lottery_tax_percentage: number;
      lottery_ticket_price: number;
      lottery_pot: number;
      lottery_ticket_sales: number;
      treasury_balance: number;
    }>();

  return {
    meowTaxPool: row?.meow_tax_pool ?? 0,
    duelTaxPool: row?.duel_tax_pool ?? 0,
    lotteryEnabled: row ? row.lottery_enabled === 1 : true,
    lotteryTaxPercentage: row?.lottery_tax_percentage ?? 75,
    lotteryTicketPrice: row?.lottery_ticket_price ?? 100,
    lotteryPot: row?.lottery_pot ?? 0,
    lotteryTicketSales: row?.lottery_ticket_sales ?? 0,
    treasuryBalance: row?.treasury_balance ?? 0,
  };
}

export async function addGroupTaxPool(db: D1Database, groupId: number, type: "meow" | "duel", amount: number) {
  if (amount <= 0) return;
  const field = type === "meow" ? "meow_tax_pool" : "duel_tax_pool";
  await db
    .prepare(`UPDATE telegram_groups SET ${field} = COALESCE(${field}, 0) + ?, lottery_pot = COALESCE(lottery_pot, 0) + ? WHERE telegram_group_id = ?`)
    .bind(amount, amount, groupId)
    .run();
}

export async function addLotteryTicketSale(db: D1Database, groupId: number, ticketPrice: number, ticketCount: number) {
  if (ticketPrice <= 0 || ticketCount <= 0) return;
  await db
    .prepare(`UPDATE telegram_groups SET lottery_ticket_sales = COALESCE(lottery_ticket_sales, 0) + ?, lottery_pot = COALESCE(lottery_pot, 0) + ? WHERE telegram_group_id = ?`)
    .bind(ticketCount, ticketPrice * ticketCount, groupId)
    .run();
}

export async function distributeGroupTax(db: D1Database, groupId: number, type: "meow" | "duel", amount: number) {
  if (amount <= 0) return;
  const field = type === "meow" ? "meow_tax_pool" : "duel_tax_pool";
  const treasuryAmount = Math.floor(amount * 0.75);
  const lotteryAmount = amount - treasuryAmount;
  const now = Math.floor(Date.now() / 1000);
  // Read current treasury for the ledger row (approximate under concurrency —
  // the UPDATE itself uses a delta so concurrent writers can't lose updates).
  const before = await db.prepare(`SELECT treasury_balance FROM telegram_groups WHERE telegram_group_id = ?`).bind(groupId).first<{ treasury_balance: number }>();
  const balanceBefore = before?.treasury_balance ?? 0;
  const balanceAfter = balanceBefore + treasuryAmount;

  // Update tax counter, lottery pot and treasury atomically (batch)
  await db.batch([
    db.prepare(`UPDATE telegram_groups SET ${field} = COALESCE(${field},0) + ?, lottery_pot = COALESCE(lottery_pot,0) + ?, treasury_balance = COALESCE(treasury_balance,0) + ? WHERE telegram_group_id = ?`).bind(amount, lotteryAmount, treasuryAmount, groupId),
    db.prepare(`INSERT INTO group_treasury_transactions (telegram_group_id, telegram_user_id, amount, balance_before, balance_after, reason, reference_type, reference_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(groupId, null, treasuryAmount, balanceBefore, balanceAfter, `tax:${type}`, 'tax', null, now),
  ]);
}

export async function startLotteryRound(db: D1Database, groupId: number, ticketPrice?: number, taxPercentage?: number) {
  const now = Math.floor(Date.now() / 1000);
  const last = await db.prepare(`SELECT COALESCE(MAX(round_number), 0) as max_round FROM lottery_rounds WHERE telegram_group_id = ?`).bind(groupId).first<{ max_round: number }>();
  const roundNumber = (last?.max_round ?? 0) + 1;
  const groupCfg = await db.prepare(`SELECT lottery_ticket_price, lottery_tax_percentage FROM telegram_groups WHERE telegram_group_id = ?`).bind(groupId).first<{ lottery_ticket_price: number; lottery_tax_percentage: number }>();
  const price = ticketPrice ?? groupCfg?.lottery_ticket_price ?? 100;
  const taxPct = taxPercentage ?? groupCfg?.lottery_tax_percentage ?? 75;

  const res = await db.prepare(`INSERT INTO lottery_rounds (telegram_group_id, round_number, ticket_price, tax_percentage, status, started_at, created_at) VALUES (?, ?, ?, ?, 'open', ?, ?)`)
    .bind(groupId, roundNumber, price, taxPct, now, now)
    .run();
  return res.meta?.last_row_id ?? null;
}

export type LotteryPurchaseResult =
  | { success: true; roundId: number; numbers: string[]; allocated: number }
  | { success: false; reason: string };

export async function purchaseLotteryTickets(
  db: D1Database,
  groupId: number,
  userId: number,
  ticketCount: number
): Promise<LotteryPurchaseResult> {
  if (ticketCount <= 0) return { success: false, reason: 'invalid_count' };

  // find open round
  let round = await db.prepare(`SELECT id, ticket_price FROM lottery_rounds WHERE telegram_group_id = ? AND status = 'open' ORDER BY created_at DESC LIMIT 1`).bind(groupId).first<{ id: number; ticket_price: number }>();
  if (!round) {
    const newId = await startLotteryRound(db, groupId);
    if (!newId) return { success: false, reason: 'round_creation_failed' };
    round = await db.prepare(`SELECT id, ticket_price FROM lottery_rounds WHERE id = ?`).bind(newId).first<{ id: number; ticket_price: number }>();
  }

  const ticketPrice = round!.ticket_price;
  const totalCost = ticketPrice * ticketCount;

  // Debit first with a guarded write. D1 batches roll back on SQL errors, but
  // a zero-row UPDATE is still a successful statement, so putting this guard
  // next to ticket inserts would mint tickets for insufficient-funds users.
  const debit = await db.prepare(
    `UPDATE group_members SET meow_points = meow_points - ?
     WHERE telegram_group_id = ? AND telegram_user_id = ? AND meow_points >= ?`
  ).bind(totalCost, groupId, userId, totalCost).run();
  if (!debit || debit.meta.changes === 0) return { success: false, reason: 'insufficient_funds' };

  try {
    // The user's own pending free tickets (earned by meowing) — read BEFORE
    // allocation zeroes the counter, so the caller can report exactly what
    // was registered for them (allocatePendingLotteryTickets also registers
    // other members' tickets, which must not be shown as the buyer's).
    const pendingMine = await db
      .prepare(`SELECT lottery_bonus_tickets FROM group_members WHERE telegram_group_id = ? AND telegram_user_id = ?`)
      .bind(groupId, userId)
      .first<{ lottery_bonus_tickets: number }>();
    const allocated = await allocatePendingLotteryTickets(db, groupId);

    const now = Math.floor(Date.now() / 1000);
    // Distribute funds: 75% lottery, 25% treasury
    const lotteryContribution = Math.floor(totalCost * 0.75);
    const treasuryContribution = totalCost - lotteryContribution;

    // Read current treasury balance for ledger
    const before = await db.prepare(`SELECT treasury_balance FROM telegram_groups WHERE telegram_group_id = ?`).bind(groupId).first<{ treasury_balance: number }>();
    const balanceBefore = before?.treasury_balance ?? 0;
    const balanceAfter = balanceBefore + treasuryContribution;

    const assignedNumbers: string[] = [];
    const stmts: any[] = [];
    for (let i = 0; i < ticketCount; i++) {
      const nums = new Set<number>();
      while (nums.size < 6) nums.add(Math.floor(Math.random() * 49) + 1);
      const numbers = Array.from(nums).join(',');
      assignedNumbers.push(numbers);
      stmts.push(db.prepare(`INSERT INTO lottery_tickets (lottery_round_id, telegram_group_id, telegram_user_id, numbers, amount_paid, purchased_at) VALUES (?, ?, ?, ?, ?, ?)`)
        .bind(round!.id, groupId, userId, numbers, ticketPrice, now));
    }

    stmts.push(db.prepare(`UPDATE telegram_groups SET lottery_ticket_sales = COALESCE(lottery_ticket_sales,0) + ?, lottery_pot = COALESCE(lottery_pot,0) + ?, treasury_balance = COALESCE(treasury_balance,0) + ? WHERE telegram_group_id = ?`).bind(ticketCount, lotteryContribution, treasuryContribution, groupId));
    stmts.push(db.prepare(`INSERT INTO group_treasury_transactions (telegram_group_id, telegram_user_id, amount, balance_before, balance_after, reason, reference_type, reference_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(groupId, userId, treasuryContribution, balanceBefore, balanceAfter, 'lottery_ticket', 'lottery_round', String(round!.id), now));

    await db.batch(stmts);

    return { success: true, roundId: round!.id, numbers: assignedNumbers, allocated: Math.max(0, pendingMine?.lottery_bonus_tickets ?? 0) };
  } catch (err) {
    // The debit is a separate guarded write so compensate if a later SQL
    // statement fails. The batch itself remains atomic for its own statements.
    await db.prepare(`UPDATE group_members SET meow_points = meow_points + ? WHERE telegram_group_id = ? AND telegram_user_id = ?`)
      .bind(totalCost, groupId, userId).run();
    throw err;
  }
}

export async function allocatePendingLotteryTickets(db: D1Database, groupId: number) {
  const round = await db.prepare(`SELECT id FROM lottery_rounds WHERE telegram_group_id = ? AND status = 'open' ORDER BY created_at DESC LIMIT 1`).bind(groupId).first<{ id: number }>();
  if (!round) return 0;

  const pendingMembers = await db.prepare(`
    SELECT telegram_user_id, lottery_bonus_tickets
    FROM group_members
    WHERE telegram_group_id = ? AND lottery_bonus_tickets > 0
  `).bind(groupId).all<{ telegram_user_id: number; lottery_bonus_tickets: number }>();

  if (!pendingMembers.results.length) return 0;

  const now = Math.floor(Date.now() / 1000);
  const stmts: any[] = [];
  let totalAllocated = 0;

  for (const member of pendingMembers.results) {
    const credits = Math.max(0, member.lottery_bonus_tickets || 0);
    if (credits <= 0) continue;

    totalAllocated += credits;
    for (let i = 0; i < credits; i++) {
      const nums = new Set<number>();
      while (nums.size < 6) nums.add(Math.floor(Math.random() * 49) + 1);
      stmts.push(db.prepare(`INSERT INTO lottery_tickets (lottery_round_id, telegram_group_id, telegram_user_id, numbers, amount_paid, purchased_at) VALUES (?, ?, ?, ?, ?, ?)`)
        .bind(round.id, groupId, member.telegram_user_id, Array.from(nums).join(','), 0, now));
    }

    stmts.push(db.prepare(`UPDATE group_members SET lottery_bonus_tickets = 0 WHERE telegram_group_id = ? AND telegram_user_id = ?`).bind(groupId, member.telegram_user_id));
  }

  if (stmts.length > 0) {
    // A heavy meower can hold >100 pending tickets; D1 batch() caps at 100
    // statements, so chunk (same pattern as sweep.ts).
// D1 caps queries at 50 per invocation on the Free plan (each batch statement
// counts as one) — keep batches ≤40 so surrounding queries stay under it.
  const chunkSize = 40;
  for (let i = 0; i < stmts.length; i += chunkSize) {
    await db.batch(stmts.slice(i, i + chunkSize));
  }
  }

  return totalAllocated;
}

export async function getLotteryParticipants(db: D1Database, groupId: number) {
  const round = await db.prepare(`SELECT id FROM lottery_rounds WHERE telegram_group_id = ? AND status = 'open' ORDER BY created_at DESC LIMIT 1`).bind(groupId).first<{ id: number }>();
  if (!round) return [];

  const participants = await db.prepare(`
    SELECT gm.telegram_user_id, gm.username, gm.first_name, COUNT(*) as ticket_count
    FROM lottery_tickets lt
    JOIN group_members gm
      ON gm.telegram_group_id = lt.telegram_group_id
     AND gm.telegram_user_id = lt.telegram_user_id
    WHERE lt.lottery_round_id = ?
    GROUP BY lt.telegram_user_id
    ORDER BY ticket_count DESC, gm.username ASC
  `).bind(round.id).all<{ telegram_user_id: number; username: string | null; first_name: string | null; ticket_count: number }>();

  return participants.results;
}

function parseNumbers(csv: string) {
  return csv.split(',').map(s => parseInt(s, 10));
}

function countMatches(a: number[], b: number[]) {
  const set = new Set(a);
  return b.reduce((acc, n) => acc + (set.has(n) ? 1 : 0), 0);
}

export function calculateLotteryPayouts(pot: number, winnersByTier: { [k: number]: Array<{ ticketId: number; userId: number; numbers: string; displayName: string }> }) {
  const tierPercents: { [k: number]: number } = { 3: 0.2, 4: 0.35, 5: 0.5, 6: 1 };
  const payouts: Array<{ ticketId?: number; userId: number; amount: number; matchCount: number; numbers: string; displayName: string }> = [];
  let totalPaid = 0;

  // Tiers can co-occur (e.g. 3- and 4-match winners in the same draw), so the
  // raw tier amounts may exceed the pot. Compute them all first, then scale
  // proportionally so the payout never overcommits the pot.
  const tiers: Array<{ matchCount: number; amount: number; winners: typeof winnersByTier[number] }> = [];
  let rawTotal = 0;
  for (const matchCount of [3, 4, 5, 6]) {
    const winners = winnersByTier[matchCount] || [];
    if (winners.length === 0) continue;
    const tierAmount = Math.floor(pot * (tierPercents[matchCount] ?? 0));
    tiers.push({ matchCount, amount: tierAmount, winners });
    rawTotal += tierAmount;
  }
  const scale = rawTotal > pot && pot > 0 ? pot / rawTotal : 1;

  for (const { matchCount, amount, winners } of tiers) {
    const tierAmount = Math.floor(amount * scale);
    const perWinner = Math.floor(tierAmount / winners.length);

    for (const winner of winners) {
      payouts.push({
        ticketId: winner.ticketId,
        userId: winner.userId,
        amount: perWinner,
        matchCount,
        numbers: winner.numbers,
        displayName: winner.displayName,
      });
      totalPaid += perWinner;
    }
  }

  return { payouts, totalPaid };
}

export async function drawLotteryRound(db: D1Database, roundId: number, groupId: number) {
  const round = await db.prepare(`SELECT id, ticket_price, status, round_number FROM lottery_rounds WHERE id = ? AND telegram_group_id = ?`).bind(roundId, groupId).first<{ id: number; ticket_price: number; status: string; round_number: number }>();
  if (!round) return { success: false, reason: 'not_found' };
  if (round.status !== 'open') return { success: false, reason: 'not_open' };

  const now = Math.floor(Date.now() / 1000);
  // Generate winning numbers
  const winSet = new Set<number>();
  while (winSet.size < 6) winSet.add(Math.floor(Math.random() * 49) + 1);
  const winningNumbers = Array.from(winSet).sort((a,b)=>a-b).join(',');

  // mark round as drawn with guarded update to avoid double-draws
  const mark = await db.prepare(`UPDATE lottery_rounds SET status = 'drawn', winning_numbers = ?, drawn_at = ? WHERE id = ? AND status = 'open'`).bind(winningNumbers, now, roundId).run();
  if (!mark || mark.meta.changes === 0) return { success: false, reason: 'already_drawn' };

  // Load tickets
  const tickets = await db.prepare(`
    SELECT lt.id, lt.telegram_user_id, lt.numbers, gm.username, gm.first_name
    FROM lottery_tickets lt
    LEFT JOIN group_members gm
      ON gm.telegram_group_id = lt.telegram_group_id
     AND gm.telegram_user_id = lt.telegram_user_id
    WHERE lt.lottery_round_id = ?
  `).bind(roundId).all<{ id: number; telegram_user_id: number; numbers: string; username: string | null; first_name: string | null }>();

  // Get current pot
  const grp = await db.prepare(`SELECT lottery_pot FROM telegram_groups WHERE telegram_group_id = ?`).bind(groupId).first<{ lottery_pot: number }>();
  const pot = grp?.lottery_pot ?? 0;

  const winnersByTier: { [k: number]: Array<{ ticketId: number; userId: number; numbers: string; displayName: string }> } = {};
  for (const t of tickets.results) {
    const ticketNums = parseNumbers(t.numbers);
    const matches = countMatches(ticketNums, Array.from(winSet));
    if (matches >= 3) {
      const displayName = t.username || t.first_name || `کاربر ${t.telegram_user_id}`;
      winnersByTier[matches] = winnersByTier[matches] || [];
      winnersByTier[matches].push({ ticketId: t.id, userId: t.telegram_user_id, numbers: t.numbers, displayName });
    }
  }

  // compute payouts
  const { payouts, totalPaid } = calculateLotteryPayouts(pot, winnersByTier);

  const tierPercents: { [k: number]: number } = { 3: 0.2, 4: 0.35, 5: 0.5, 6: 1 };

  // reduce pot by totalPaid
  if (totalPaid > 0) {
    const res = await db.prepare(`UPDATE telegram_groups SET lottery_pot = lottery_pot - ? WHERE telegram_group_id = ? AND lottery_pot >= ?`).bind(totalPaid, groupId, totalPaid).run();
    if (res.meta.changes === 0) {
      return { success: false, reason: 'insufficient_pot' };
    }

    // pay winners (3 stmts each — chunk for D1's 100-statement batch cap)
    const stmts: any[] = [];
    for (const p of payouts) {
      const tierPct = Math.round((tierPercents[p.matchCount] ?? 0) * 100);
      stmts.push(db.prepare(`INSERT INTO lottery_payouts (lottery_round_id, lottery_ticket_id, telegram_group_id, telegram_user_id, match_count, tier_pct, payout, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(roundId, p.ticketId, groupId, p.userId, p.matchCount, tierPct, p.amount, now));
      stmts.push(db.prepare(`UPDATE group_members SET meow_points = meow_points + ? WHERE telegram_group_id = ? AND telegram_user_id = ?`).bind(p.amount, groupId, p.userId));
      stmts.push(db.prepare(`INSERT INTO transactions (telegram_user_id, group_id, amount, reason, created_at) VALUES (?, ?, ?, ?, ?)`).bind(p.userId, groupId, p.amount, 'lottery_payout', now));
    }
// Free-plan D1 cap is 50 queries per invocation (each batch statement counts
  // as one) — chunk at 40 to leave headroom for the queries before the batch.
  for (let i = 0; i < stmts.length; i += 40) {
    await db.batch(stmts.slice(i, i + 40));
  }
  }

  const winners = payouts.map((p) => ({ userId: p.userId, ticketId: p.ticketId, numbers: p.numbers, payout: p.amount, matchCount: p.matchCount, displayName: p.displayName }));
  return { success: true, winningNumbers, totalPaid, payoutsCount: payouts.length, winners };
}

export async function addGroupTreasuryTransaction(db: D1Database, groupId: number, telegramUserId: number | null, amount: number, reason: string) {
  const now = Math.floor(Date.now() / 1000);
  await db.batch([
    db.prepare(`UPDATE telegram_groups SET treasury_balance = COALESCE(treasury_balance, 0) + ? WHERE telegram_group_id = ?`).bind(amount, groupId),
    db.prepare(`INSERT INTO group_treasury_transactions (telegram_group_id, telegram_user_id, amount, reason, created_at) VALUES (?, ?, ?, ?, ?)`).bind(groupId, telegramUserId, amount, reason, now),
  ]);
}

export async function getRecentGroupTreasuryTransactions(db: D1Database, groupId: number, limit: number = 5) {
  return db
    .prepare(`SELECT telegram_user_id, amount, reason, created_at FROM group_treasury_transactions WHERE telegram_group_id = ? ORDER BY created_at DESC LIMIT ?`)
    .bind(groupId, limit)
    .all<{ telegram_user_id: number | null; amount: number; reason: string; created_at: number }>();
}

export async function setGroupLotteryTicketPrice(db: D1Database, groupId: number, price: number) {
  await db
    .prepare(`UPDATE telegram_groups SET lottery_ticket_price = ? WHERE telegram_group_id = ?`)
    .bind(price, groupId)
    .run();
}

export async function setGroupLotteryPot(db: D1Database, groupId: number, amount: number) {
  await db
    .prepare(`UPDATE telegram_groups SET lottery_pot = ? WHERE telegram_group_id = ?`)
    .bind(amount, groupId)
    .run();
}

export async function getUserStats(db: D1Database, userId: number) {
  return db
    .prepare(`SELECT meow_points, total_meows FROM users WHERE telegram_id = ?`)
    .bind(userId)
    .first<{ meow_points: number; total_meows: number }>();
}

export async function getGroupMemberBalance(db: D1Database, groupId: number, userId: number): Promise<number> {
  const row = await db
    .prepare(`SELECT meow_points FROM group_members WHERE telegram_group_id = ? AND telegram_user_id = ?`)
    .bind(groupId, userId)
    .first<{ meow_points: number }>();

  return row?.meow_points ?? 0;
}

export async function getGroupRank(db: D1Database, groupId: number, userId: number): Promise<number> {
  const result = await db
    .prepare(`
      SELECT COUNT(*) + 1 AS rank FROM group_members
      WHERE telegram_group_id = ? AND meow_points > (
        SELECT meow_points FROM group_members WHERE telegram_group_id = ? AND telegram_user_id = ?
      )
    `)
    .bind(groupId, groupId, userId)
    .first<{ rank: number }>();

  return result?.rank ?? 0;
}

export async function getGroupDailyLeaderboard(db: D1Database, groupId: number, limit: number = 10) {
  // "Today" is Tehran midnight (UTC+3:30), not UTC midnight — meows after
  // 20:30 UTC belong to the next Tehran day.
  const today = tehranDayStart();
  return db
    .prepare(`
      SELECT u.first_name, u.username, SUM(t.amount) AS today_points
      FROM transactions t
      JOIN users u ON u.telegram_id = t.telegram_user_id
      WHERE t.group_id = ? AND t.reason = 'MEOW' AND t.created_at >= ?
      GROUP BY t.telegram_user_id
      ORDER BY today_points DESC
      LIMIT ?
    `)
    .bind(groupId, today, limit)
    .all<{ first_name: string; username: string | null; today_points: number }>();
}

export async function isMaintenanceMode(db: D1Database): Promise<boolean> {
  const row = await db.prepare(`SELECT value FROM bot_settings WHERE key = 'maintenance'`).first<{ value: string }>();
  return row?.value === "1";
}

export async function findUserByUsername(db: D1Database, rawUsername: string) {
  return db
    .prepare(`SELECT telegram_id, first_name FROM users WHERE LOWER(username) = LOWER(?)`)
    .bind(rawUsername)
    .first<{ telegram_id: number; first_name: string }>();
}

export async function findUserById(db: D1Database, userId: number) {
  return db
    .prepare(`SELECT telegram_id, username, first_name, meow_points, total_meows, created_at FROM users WHERE telegram_id = ?`)
    .bind(userId)
    .first<{ telegram_id: number; username: string | null; first_name: string; meow_points: number; total_meows: number; created_at: number }>();
}

export async function getDuelRating(db: D1Database, userId: number, groupId?: number): Promise<number> {
  if (groupId != null) {
    const row = await db.prepare(`SELECT duel_rating FROM group_members WHERE telegram_group_id = ? AND telegram_user_id = ?`).bind(groupId, userId).first<{ duel_rating: number }>();
    return row?.duel_rating ?? 1000;
  }
  // Fallback: global rating (for contexts without a group, e.g. owner panel)
  const row = await db.prepare(`SELECT duel_rating FROM users WHERE telegram_id = ?`).bind(userId).first<{ duel_rating: number }>();
  return row?.duel_rating ?? 1000;
}

export async function getDuelLeaderboard(db: D1Database, groupId: number, limit: number = 10) {
  return db
    .prepare(`SELECT first_name, username, duel_rating FROM group_members WHERE telegram_group_id = ? ORDER BY duel_rating DESC LIMIT ?`)
    .bind(groupId, limit)
    .all<{ first_name: string; username: string | null; duel_rating: number }>();
}

/** The user's active title in a group (or null when they have none set). */
export async function getActiveTitle(
  db: D1Database,
  groupId: number,
  userId: number
): Promise<{ name: string; last_price: number | null; emoji: string | null } | null> {
  const row = await db
    .prepare(`
      SELECT t.name, t.last_price, t.emoji
      FROM titles t
      JOIN group_members gm ON gm.active_title_id = t.id
      WHERE gm.telegram_group_id = ? AND gm.telegram_user_id = ?
        AND t.telegram_group_id = gm.telegram_group_id
    `)
    .bind(groupId, userId)
    .first<{ name: string; last_price: number | null; emoji: string | null }>();
  return row ?? null;
}

export async function isUserBanned(db: D1Database, userId: number): Promise<boolean> {
  const row = await db.prepare(`SELECT is_banned FROM users WHERE telegram_id = ?`).bind(userId).first<{ is_banned: number }>();
  return row ? row.is_banned === 1 : false;
}

export async function getBotSetting(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare(`SELECT value FROM bot_settings WHERE key = ?`).bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

export async function setBotSetting(db: D1Database, key: string, value: string) {
  await db.prepare(`INSERT INTO bot_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(key, value).run();
}

export async function saveBroadcastDraft(db: D1Database, userId: number, text: string) {
  await db.prepare(`INSERT INTO bot_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(`broadcast_draft:${userId}`, text).run();
}

export async function getBroadcastDraft(db: D1Database, userId: number): Promise<string | null> {
  const row = await db.prepare(`SELECT value FROM bot_settings WHERE key = ?`).bind(`broadcast_draft:${userId}`).first<{ value: string }>();
  return row?.value ?? null;
}

export async function deleteBroadcastDraft(db: D1Database, userId: number) {
  await db.prepare(`DELETE FROM bot_settings WHERE key = ?`).bind(`broadcast_draft:${userId}`).run();
}

export async function getUserTransactions(db: D1Database, userId: number, limit: number = 20) {
  return db
    .prepare(`
      SELECT amount, reason, group_id, created_at
      FROM transactions
      WHERE telegram_user_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `)
    .bind(userId, limit)
    .all<{ amount: number; reason: string; group_id: number | null; created_at: number }>();
}

export async function getUserGroupMemberships(db: D1Database, userId: number) {
  return db
    .prepare(`
      SELECT gm.telegram_group_id, g.title, gm.meow_points, gm.total_meows
      FROM group_members gm
      JOIN telegram_groups g ON g.telegram_group_id = gm.telegram_group_id
      WHERE gm.telegram_user_id = ? AND g.is_active = 1
      ORDER BY gm.meow_points DESC
    `)
    .bind(userId)
    .all<{ telegram_group_id: number; title: string; meow_points: number; total_meows: number }>();
}

export async function applyPayTransfer(db: D1Database, fromUserId: number, toUserId: number, amount: number, groupId: number, now: number): Promise<boolean> {
  if (fromUserId === toUserId || !Number.isInteger(amount) || amount <= 0) return false;

  const sender = await db
    .prepare(`SELECT meow_points FROM users WHERE telegram_id = ?`)
    .bind(fromUserId)
    .first<{ meow_points: number }>();

  const senderGroup = await db
    .prepare(`SELECT meow_points FROM group_members WHERE telegram_group_id = ? AND telegram_user_id = ?`)
    .bind(groupId, fromUserId)
    .first<{ meow_points: number }>();

  const receiverGroup = await db
    .prepare(`SELECT meow_points FROM group_members WHERE telegram_group_id = ? AND telegram_user_id = ?`)
    .bind(groupId, toUserId)
    .first<{ meow_points: number }>();

  if (!sender || sender.meow_points < amount || !senderGroup || senderGroup.meow_points < amount || !receiverGroup) {
    return false;
  }

  // Debit both sender balances first. A zero-row guarded UPDATE is not a SQL
  // error in D1, so never credit the receiver until both debits are confirmed.
  const debits = await db.batch([
    db.prepare(`UPDATE users SET meow_points = meow_points - ? WHERE telegram_id = ? AND meow_points >= ?`).bind(amount, fromUserId, amount),
    db.prepare(`UPDATE group_members SET meow_points = meow_points - ? WHERE telegram_group_id = ? AND telegram_user_id = ? AND meow_points >= ?`).bind(amount, groupId, fromUserId, amount),
  ]);
  if (debits[0].meta.changes === 0 || debits[1].meta.changes === 0) {
    const refunds: any[] = [];
    if (debits[0].meta.changes > 0) refunds.push(db.prepare(`UPDATE users SET meow_points = meow_points + ? WHERE telegram_id = ?`).bind(amount, fromUserId));
    if (debits[1].meta.changes > 0) refunds.push(db.prepare(`UPDATE group_members SET meow_points = meow_points + ? WHERE telegram_group_id = ? AND telegram_user_id = ?`).bind(amount, groupId, fromUserId));
    if (refunds.length) await db.batch(refunds);
    return false;
  }

  try {
    await db.batch([
      db.prepare(`UPDATE users SET meow_points = meow_points + ? WHERE telegram_id = ?`).bind(amount, toUserId),
      db.prepare(`UPDATE group_members SET meow_points = meow_points + ? WHERE telegram_group_id = ? AND telegram_user_id = ?`).bind(amount, groupId, toUserId),
      db.prepare(`INSERT INTO transactions (telegram_user_id, group_id, amount, reason, created_at) VALUES (?, ?, ?, ?, ?)`)
        .bind(fromUserId, groupId, -amount, `PAY_TO_${toUserId}`, now),
      db.prepare(`INSERT INTO transactions (telegram_user_id, group_id, amount, reason, created_at) VALUES (?, ?, ?, ?, ?)`)
        .bind(toUserId, groupId, amount, `PAY_FROM_${fromUserId}`, now),
    ]);
  } catch (err) {
    // The credit batch is atomic on SQL errors; restore the first batch's
    // debits before propagating the failure to the caller.
    await db.batch([
      db.prepare(`UPDATE users SET meow_points = meow_points + ? WHERE telegram_id = ?`).bind(amount, fromUserId),
      db.prepare(`UPDATE group_members SET meow_points = meow_points + ? WHERE telegram_group_id = ? AND telegram_user_id = ?`).bind(amount, groupId, fromUserId),
    ]);
    throw err;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Boosters — per-group temporary meow multipliers
// ---------------------------------------------------------------------------

export async function getBoosterStatus(
  db: D1Database,
  groupId: number,
  userId: number
): Promise<{ multiplier: number; until: number } | null> {
  const row = await db
    .prepare(
      `SELECT active_booster_multiplier, active_booster_until
       FROM group_members
       WHERE telegram_group_id = ? AND telegram_user_id = ?`
    )
    .bind(groupId, userId)
    .first<{ active_booster_multiplier: number; active_booster_until: number }>();
  if (!row || row.active_booster_multiplier <= 0 || row.active_booster_until <= 0) return null;
  const now = Math.floor(Date.now() / 1000);
  if (row.active_booster_until <= now) return null;
  return { multiplier: row.active_booster_multiplier, until: row.active_booster_until };
}

export async function buyBooster(
  db: D1Database,
  groupId: number,
  userId: number,
  multiplier: number,
  durationSec: number,
  cost: number
): Promise<{ success: boolean; reason?: string }> {
  const now = Math.floor(Date.now() / 1000);

  // 4h purchase cooldown, enforced via the BOOSTER_* transaction rows (no
  // schema change needed) so a user can't chain boosters back to back.
  const last = await db
    .prepare(`SELECT created_at FROM transactions WHERE telegram_user_id = ? AND group_id = ? AND reason LIKE 'BOOSTER_%' ORDER BY created_at DESC LIMIT 1`)
    .bind(userId, groupId)
    .first<{ created_at: number }>();
  if (last && now - last.created_at < BOOSTER_COOLDOWN_SEC) {
    return { success: false, reason: "cooldown" };
  }

  const until = now + durationSec;

  // Check and debit from both balances (all-or-nothing)
  const res = await db.batch([
    db.prepare(`UPDATE users SET meow_points = meow_points - ? WHERE telegram_id = ? AND meow_points >= ?`).bind(cost, userId, cost),
    db.prepare(`UPDATE group_members SET meow_points = meow_points - ? WHERE telegram_group_id = ? AND telegram_user_id = ? AND meow_points >= ?`).bind(cost, groupId, userId, cost),
  ]);
  if (res[0].meta.changes === 0 || res[1].meta.changes === 0) {
    // Refund partial applies
    const refunds: any[] = [];
    if (res[0].meta.changes > 0) refunds.push(db.prepare(`UPDATE users SET meow_points = meow_points + ? WHERE telegram_id = ?`).bind(cost, userId));
    if (res[1].meta.changes > 0) refunds.push(db.prepare(`UPDATE group_members SET meow_points = meow_points + ? WHERE telegram_group_id = ? AND telegram_user_id = ?`).bind(cost, groupId, userId));
    if (refunds.length) await db.batch(refunds);
    return { success: false, reason: "insufficient_funds" };
  }

  // Activate the booster and record the transaction in ONE batch so a crash
  // can't leave an active booster with no audit trail (or vice versa).
  await db.batch([
    db.prepare(
      `UPDATE group_members
       SET active_booster_multiplier = ?, active_booster_until = ?
       WHERE telegram_group_id = ? AND telegram_user_id = ?`
    )
      .bind(multiplier, until, groupId, userId),
    db.prepare(`INSERT INTO transactions (telegram_user_id, group_id, amount, reason, created_at) VALUES (?, ?, ?, ?, ?)`)
      .bind(userId, groupId, -cost, `BOOSTER_${multiplier}x`, now),
  ]);

  return { success: true };
}

export async function getActiveBoosterMultiplier(db: D1Database, groupId: number, userId: number): Promise<number> {
  const now = Math.floor(Date.now() / 1000);
  const row = await db
    .prepare(
      `SELECT active_booster_multiplier FROM group_members
       WHERE telegram_group_id = ? AND telegram_user_id = ?
         AND active_booster_multiplier > 0 AND active_booster_until > ?`
    )
    .bind(groupId, userId, now)
    .first<{ active_booster_multiplier: number }>();
  return row?.active_booster_multiplier ?? 1;
}

// ---------------------------------------------------------------------------
// Notifications — opt-out DM notifications
// ---------------------------------------------------------------------------

export async function getNotificationsEnabled(db: D1Database, userId: number): Promise<boolean> {
  const row = await db
    .prepare(`SELECT notifications_enabled FROM users WHERE telegram_id = ?`)
    .bind(userId)
    .first<{ notifications_enabled: number }>();
  return row ? row.notifications_enabled === 1 : true;
}

export async function setNotificationsEnabled(db: D1Database, userId: number, enabled: boolean): Promise<void> {
  await db
    .prepare(`UPDATE users SET notifications_enabled = ? WHERE telegram_id = ?`)
    .bind(enabled ? 1 : 0, userId)
    .run();
}

export async function getLotteryWins(db: D1Database, userId: number): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) as c FROM transactions
       WHERE telegram_user_id = ? AND reason = 'lottery_payout'`
    )
    .bind(userId)
    .first<{ c: number }>();
  return row?.c ?? 0;
}

export async function getGroupStats(db: D1Database, groupId: number) {
  const members = await db
    .prepare(`SELECT COUNT(*) as c FROM group_members WHERE telegram_group_id = ?`)
    .bind(groupId)
    .first<{ c: number }>();
  const totalMeows = await db
    .prepare(`SELECT SUM(total_meows) as s FROM group_members WHERE telegram_group_id = ?`)
    .bind(groupId)
    .first<{ s: number | null }>();
  const settings = await getGroupSettings(db, groupId);
  const topMeower = await db
    .prepare(`SELECT username, first_name, meow_points FROM group_members WHERE telegram_group_id = ? ORDER BY meow_points DESC LIMIT 1`)
    .bind(groupId)
    .first<{ username: string | null; first_name: string | null; meow_points: number }>();
  return {
    memberCount: members?.c ?? 0,
    totalMeows: totalMeows?.s ?? 0,
    treasuryBalance: settings.treasuryBalance,
    lotteryPot: settings.lotteryPot,
    topMeower,
  };
}
