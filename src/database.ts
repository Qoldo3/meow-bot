import { TelegramChat, TelegramUser } from "./types";

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
  // Read current treasury for ledger
  const before = await db.prepare(`SELECT treasury_balance FROM telegram_groups WHERE telegram_group_id = ?`).bind(groupId).first<{ treasury_balance: number }>();
  const balanceBefore = before?.treasury_balance ?? 0;
  const balanceAfter = balanceBefore + treasuryAmount;

  // Update tax counter, lottery pot and treasury atomically (batch)
  await db.batch([
    db.prepare(`UPDATE telegram_groups SET ${field} = COALESCE(${field},0) + ?, lottery_pot = COALESCE(lottery_pot,0) + ?, treasury_balance = ? WHERE telegram_group_id = ?`).bind(amount, lotteryAmount, balanceAfter, groupId),
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

export async function purchaseLotteryTickets(
  db: D1Database,
  groupId: number,
  userId: number,
  ticketCount: number,
  numbersList: string[] | null = null
) {
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

  const now = Math.floor(Date.now() / 1000);
  // Distribute funds: 75% lottery, 25% treasury
  const lotteryContribution = Math.floor(totalCost * 0.75);
  const treasuryContribution = totalCost - lotteryContribution;

  // Read current treasury balance for ledger
  const before = await db.prepare(`SELECT treasury_balance FROM telegram_groups WHERE telegram_group_id = ?`).bind(groupId).first<{ treasury_balance: number }>();
  const balanceBefore = before?.treasury_balance ?? 0;
  const balanceAfter = balanceBefore + treasuryContribution;

  // Build batch: guarded deduction, ticket inserts, counters update, treasury update and ledger
  const assignedNumbers: string[] = [];
  const stmts: any[] = [];
  stmts.push(db.prepare(`UPDATE group_members SET meow_points = meow_points - ? WHERE telegram_group_id = ? AND telegram_user_id = ? AND meow_points >= ?`).bind(totalCost, groupId, userId, totalCost));
  for (let i = 0; i < ticketCount; i++) {
    const numbers = numbersList && numbersList[i] ? numbersList[i] : (() => {
      const nums = new Set<number>();
      while (nums.size < 6) nums.add(Math.floor(Math.random() * 49) + 1);
      return Array.from(nums).join(',');
    })();
    assignedNumbers.push(numbers);
    stmts.push(db.prepare(`INSERT INTO lottery_tickets (lottery_round_id, telegram_group_id, telegram_user_id, numbers, amount_paid, purchased_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(round!.id, groupId, userId, numbers, ticketPrice, now));
  }

  stmts.push(db.prepare(`UPDATE telegram_groups SET lottery_ticket_sales = COALESCE(lottery_ticket_sales,0) + ?, lottery_pot = COALESCE(lottery_pot,0) + ?, treasury_balance = ? WHERE telegram_group_id = ?`).bind(ticketCount, lotteryContribution, balanceAfter, groupId));
  stmts.push(db.prepare(`INSERT INTO group_treasury_transactions (telegram_group_id, telegram_user_id, amount, balance_before, balance_after, reason, reference_type, reference_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(groupId, userId, treasuryContribution, balanceBefore, balanceAfter, 'lottery_ticket', 'lottery_round', String(round!.id), now));

  const res = await db.batch(stmts);
  // Ensure deduction succeeded
  if (!res || res.length === 0 || res[0].meta.changes === 0) return { success: false, reason: 'insufficient_funds' };
  return { success: true, roundId: round!.id, numbers: assignedNumbers };
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
    await db.batch(stmts);
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

  for (const matchCount of [3, 4, 5, 6]) {
    const winners = winnersByTier[matchCount] || [];
    if (winners.length === 0) continue;

    const tierAmount = Math.floor(pot * (tierPercents[matchCount] ?? 0));
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

export async function drawLotteryRound(db: D1Database, roundId: number, groupId: number, initiatedByUserId: number | null = null) {
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

    // pay winners
    const stmts: any[] = [];
    for (const p of payouts) {
      const tierPct = Math.round((tierPercents[p.matchCount] ?? 0) * 100);
      stmts.push(db.prepare(`INSERT INTO lottery_payouts (lottery_round_id, lottery_ticket_id, telegram_group_id, telegram_user_id, match_count, tier_pct, payout, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(roundId, p.ticketId, groupId, p.userId, p.matchCount, tierPct, p.amount, now));
      stmts.push(db.prepare(`UPDATE group_members SET meow_points = meow_points + ? WHERE telegram_group_id = ? AND telegram_user_id = ?`).bind(p.amount, groupId, p.userId));
      stmts.push(db.prepare(`INSERT INTO transactions (telegram_user_id, group_id, amount, reason, created_at) VALUES (?, ?, ?, ?, ?)`).bind(p.userId, groupId, p.amount, 'lottery_payout', now));
    }

    await db.batch(stmts);
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

export async function getGroupClanByName(db: D1Database, groupId: number, name: string) {
  return db
    .prepare(`SELECT clan_id, telegram_group_id, name, owner_user_id, treasury_balance, created_at FROM group_clans WHERE telegram_group_id = ? AND name = ? COLLATE NOCASE`)
    .bind(groupId, name)
    .first<{
      clan_id: number;
      telegram_group_id: number;
      name: string;
      owner_user_id: number;
      treasury_balance: number;
      created_at: number;
    }>();
}

export async function getGroupClanById(db: D1Database, clanId: number) {
  return db
    .prepare(`SELECT clan_id, telegram_group_id, name, owner_user_id, treasury_balance, created_at FROM group_clans WHERE clan_id = ?`)
    .bind(clanId)
    .first<{
      clan_id: number;
      telegram_group_id: number;
      name: string;
      owner_user_id: number;
      treasury_balance: number;
      created_at: number;
    }>();
}

export async function getUserClan(db: D1Database, groupId: number, userId: number) {
  return db
    .prepare(`
      SELECT c.clan_id, c.name, c.owner_user_id, c.treasury_balance, m.role, m.joined_at
      FROM clan_members m
      JOIN group_clans c ON c.clan_id = m.clan_id
      WHERE c.telegram_group_id = ? AND m.telegram_user_id = ?
    `)
    .bind(groupId, userId)
    .first<{
      clan_id: number;
      name: string;
      owner_user_id: number;
      treasury_balance: number;
      role: string;
      joined_at: number;
    }>();
}

export async function createGroupClan(db: D1Database, groupId: number, name: string, ownerUserId: number): Promise<number | null> {
  const existing = await getGroupClanByName(db, groupId, name);
  if (existing) return null;
  // Enforce one clan membership per user per group.
  const alreadyInClan = await db
    .prepare(`
      SELECT 1 FROM clan_members m
      JOIN group_clans c ON c.clan_id = m.clan_id
      WHERE c.telegram_group_id = ? AND m.telegram_user_id = ?
    `)
    .bind(groupId, ownerUserId)
    .first<{ "1": number }>();
  if (alreadyInClan) return null;
  const now = Math.floor(Date.now() / 1000);
  const result = await db
    .prepare(`INSERT INTO group_clans (telegram_group_id, name, owner_user_id, treasury_balance, created_at) VALUES (?, ?, ?, 0, ?)`)
    .bind(groupId, name, ownerUserId, now)
    .run();
  return result.meta?.last_row_id ?? null;
}

export async function joinClan(db: D1Database, clanId: number, userId: number): Promise<boolean> {
  const existing = await db
    .prepare(`SELECT 1 FROM clan_members WHERE clan_id = ? AND telegram_user_id = ?`)
    .bind(clanId, userId)
    .first<{ '1': number }>();
  if (existing) return false;
  // Enforce one clan membership per user per group.
  const clan = await getGroupClanById(db, clanId);
  if (!clan) return false;
  const otherClan = await db
    .prepare(`
      SELECT 1 FROM clan_members m
      JOIN group_clans c ON c.clan_id = m.clan_id
      WHERE c.telegram_group_id = ? AND m.telegram_user_id = ?
    `)
    .bind(clan.telegram_group_id, userId)
    .first<{ '1': number }>();
  if (otherClan) return false;
  const now = Math.floor(Date.now() / 1000);
  await db.prepare(`INSERT INTO clan_members (clan_id, telegram_user_id, role, joined_at) VALUES (?, ?, 'member', ?)`)
    .bind(clanId, userId, now)
    .run();
  return true;
}

export async function leaveClan(db: D1Database, clanId: number, userId: number): Promise<boolean> {
  const clan = await getGroupClanById(db, clanId);
  if (!clan) return false;

  if (clan.owner_user_id === userId) {
    await db.batch([
      db.prepare(`DELETE FROM clan_members WHERE clan_id = ?`).bind(clanId),
      db.prepare(`DELETE FROM group_clans WHERE clan_id = ?`).bind(clanId),
    ]);
    return true;
  }

  const result = await db
    .prepare(`DELETE FROM clan_members WHERE clan_id = ? AND telegram_user_id = ?`)
    .bind(clanId, userId)
    .run();
  return result.meta.changes > 0;
}

export async function getClanMembers(db: D1Database, clanId: number) {
  return db
    .prepare(`SELECT telegram_user_id, role, joined_at FROM clan_members WHERE clan_id = ? ORDER BY joined_at ASC`)
    .bind(clanId)
    .all<{ telegram_user_id: number; role: string; joined_at: number }>();
}

export async function getGroupClans(db: D1Database, groupId: number) {
  return db
    .prepare(`SELECT clan_id, name, owner_user_id, treasury_balance, created_at FROM group_clans WHERE telegram_group_id = ? ORDER BY created_at ASC`)
    .bind(groupId)
    .all<{
      clan_id: number;
      name: string;
      owner_user_id: number;
      treasury_balance: number;
      created_at: number;
    }>();
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
  const today = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);
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

export async function getGlobalRank(db: D1Database, userId: number): Promise<number> {
  const result = await db
    .prepare(`
      SELECT COUNT(*) + 1 AS rank FROM users
      WHERE meow_points > (SELECT meow_points FROM users WHERE telegram_id = ?)
    `)
    .bind(userId)
    .first<{ rank: number }>();
  return result?.rank ?? 0;
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
    .prepare(`SELECT telegram_id, username, first_name, meow_points, total_meows, daily_streak, last_daily_at, created_at FROM users WHERE telegram_id = ?`)
    .bind(userId)
    .first<{ telegram_id: number; username: string | null; first_name: string; meow_points: number; total_meows: number; daily_streak: number; last_daily_at: number | null; created_at: number }>();
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

  const results = await db.batch([
    db.prepare(`UPDATE users SET meow_points = meow_points - ? WHERE telegram_id = ? AND meow_points >= ?`).bind(amount, fromUserId, amount),
    db.prepare(`UPDATE users SET meow_points = meow_points + ? WHERE telegram_id = ?`).bind(amount, toUserId),
    db.prepare(`UPDATE group_members SET meow_points = meow_points - ? WHERE telegram_group_id = ? AND telegram_user_id = ? AND meow_points >= ?`).bind(amount, groupId, fromUserId, amount),
    db.prepare(`UPDATE group_members SET meow_points = meow_points + ? WHERE telegram_group_id = ? AND telegram_user_id = ?`).bind(amount, groupId, toUserId),
    db.prepare(`INSERT INTO transactions (telegram_user_id, group_id, amount, reason, created_at) VALUES (?, ?, ?, ?, ?)`)
      .bind(fromUserId, groupId, -amount, `PAY_TO_${toUserId}`, now),
    db.prepare(`INSERT INTO transactions (telegram_user_id, group_id, amount, reason, created_at) VALUES (?, ?, ?, ?, ?)`)
      .bind(toUserId, groupId, amount, `PAY_FROM_${fromUserId}`, now),
  ]);

  return results[0].meta.changes > 0 && results[2].meta.changes > 0;
}
