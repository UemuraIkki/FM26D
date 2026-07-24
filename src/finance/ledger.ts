import type { SimDate } from "../core/calendar.js";
import { toIso } from "../core/calendar.js";

/**
 * Double-entry money ledger (requirement 5.1).
 *
 * Every currency movement in the world is one entry moving `amount` from
 * `from` to `to`. `WORLD` is the external economy (fans, broadcasters —
 * money enters/leaves the club system through it). Conservation invariant
 * (tested): for every club, initialBalance + Σ(in) − Σ(out) === balance,
 * and inter-club entries (transfer fees) net to zero across the system.
 */

export const WORLD_ACCOUNT = "WORLD";

export type TransactionType = "TICKET" | "BROADCAST" | "MERIT" | "WAGE" | "TRANSFER_FEE";

export interface Transaction {
  date: string; // ISO
  type: TransactionType;
  from: string; // club id or WORLD
  to: string; // club id or WORLD
  amount: number;
  note?: string;
}

export class Ledger {
  readonly transactions: Transaction[] = [];
  private balances = new Map<string, number>();
  private initial = new Map<string, number>();

  openAccount(clubId: string, initialBalance: number): void {
    if (this.balances.has(clubId)) throw new Error(`account exists: ${clubId}`);
    this.balances.set(clubId, initialBalance);
    this.initial.set(clubId, initialBalance);
  }

  balanceOf(clubId: string): number {
    const b = this.balances.get(clubId);
    if (b === undefined) throw new Error(`unknown account: ${clubId}`);
    return b;
  }

  /** Move money. Accounts must exist (WORLD is implicit and unbounded). */
  record(date: SimDate, type: TransactionType, from: string, to: string, amount: number, note?: string): void {
    if (amount < 0) throw new Error(`negative amount: ${amount}`);
    if (from !== WORLD_ACCOUNT) {
      this.balances.set(from, this.balanceOf(from) - amount);
    }
    if (to !== WORLD_ACCOUNT) {
      this.balances.set(to, this.balanceOf(to) + amount);
    }
    const entry: Transaction = { date: toIso(date), type, from, to, amount };
    if (note !== undefined) entry.note = note;
    this.transactions.push(entry);
  }

  /**
   * Money conservation check (requirement 5.1, test target): recompute every
   * balance from the transaction log and compare with the running balances.
   * Returns the max absolute drift (0 = perfectly conserved).
   */
  conservationDrift(): number {
    const recomputed = new Map<string, number>(this.initial);
    for (const t of this.transactions) {
      if (t.from !== WORLD_ACCOUNT) recomputed.set(t.from, (recomputed.get(t.from) ?? 0) - t.amount);
      if (t.to !== WORLD_ACCOUNT) recomputed.set(t.to, (recomputed.get(t.to) ?? 0) + t.amount);
    }
    let maxDrift = 0;
    for (const [account, balance] of this.balances) {
      const drift = Math.abs((recomputed.get(account) ?? 0) - balance);
      if (drift > maxDrift) maxDrift = drift;
    }
    return maxDrift;
  }

  /** Net flow between clubs must cancel: Σ balances − Σ initial = net WORLD inflow. */
  systemNetCheck(): { sumBalances: number; sumInitial: number; netWorldInflow: number } {
    let sumBalances = 0;
    let sumInitial = 0;
    for (const b of this.balances.values()) sumBalances += b;
    for (const b of this.initial.values()) sumInitial += b;
    let netWorldInflow = 0;
    for (const t of this.transactions) {
      if (t.from === WORLD_ACCOUNT && t.to !== WORLD_ACCOUNT) netWorldInflow += t.amount;
      if (t.to === WORLD_ACCOUNT && t.from !== WORLD_ACCOUNT) netWorldInflow -= t.amount;
    }
    return { sumBalances, sumInitial, netWorldInflow };
  }
}
