/**
 * Client for the deployed Worker's PUBLIC endpoints (option A). These return
 * only permitted leaderboard fields — never customer data, per-transaction
 * records, per-affiliate performance, or admin data. My Performance and Admin
 * are intentionally not reachable here; they live behind authentication.
 */
import type { Movement, PeriodType, Scope } from "@shared/types";
import { API_BASE } from "@/config";

export interface PublicSummary {
  lastSuccessfulSyncAt: string | null;
  health: "ok" | "degraded";
  seatsClaimed: number;
  config: {
    launchAt: string | null;
    windowDays: number;
    directTargetCents: number;
    teamTargetCents: number;
    foundersPackMinCents: number;
    seatCap: number;
  };
}

export interface PublicBoardRow {
  rank: number;
  affiliateId: string;
  displayName: string;
  amountCents: number;
  orders: number;
  movement: Movement | null;
}

export interface PublicBoard {
  rows: PublicBoardRow[];
  hasSnapshot: boolean;
  disconnectedCount: number;
}

export interface PublicRecognitionRow {
  displayName: string;
  seatNo: number;
  qualifiedAt: string;
  expired: boolean;
}

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    signal,
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return (await res.json()) as T;
}

export const fetchSummary = (signal?: AbortSignal) =>
  get<PublicSummary>("/public/summary", signal);

export const fetchBoard = (scope: Scope, period: PeriodType, signal?: AbortSignal) =>
  get<PublicBoard>(`/public/board?scope=${scope}&period=${period}`, signal);

export const fetchRecognition = (signal?: AbortSignal) =>
  get<{ members: PublicRecognitionRow[] }>("/public/recognition", signal);
