import type { AppMode } from '../constants';

export type WalletCurrency = 'DEMO' | 'INR';
export type TxType = 'DEPOSIT' | 'WITHDRAWAL' | 'CONTEST_ENTRY' | 'CONTEST_WINNING' | 'REFUND' | 'BONUS' | 'ADJUSTMENT';
export type TxStatus = 'PENDING' | 'SUCCESS' | 'FAILED';
export type KycStatus = 'NOT_STARTED' | 'PENDING' | 'VERIFIED' | 'REJECTED';

export interface BalanceDto {
  currency: WalletCurrency;
  deposited: number;
  winnings: number;
  bonus: number;
  total: number;
  /** Winnings minus anything already held for pending withdrawals. */
  withdrawable: number;
}

export interface WalletDto {
  mode: AppMode;
  /** The currency the app should show first: DEMO in demo mode, INR otherwise. */
  primary: WalletCurrency;
  balances: BalanceDto[];
  depositsEnabled: boolean;
  withdrawalsEnabled: boolean;
  kycStatus: KycStatus;
  limits: { minDeposit: number; maxDeposit: number; minWithdrawal: number };
}

export interface WalletTxDto {
  id: string;
  type: TxType;
  status: TxStatus;
  currency: WalletCurrency;
  /** Signed: + money in, − money out. */
  amount: number;
  description: string;
  reference: string | null;
  createdAt: string;
}

export interface DepositOrderDto {
  transactionId: string;
  amount: number;
  /** Hosted checkout page to open in the in-app browser. */
  checkoutUrl: string;
}

export interface KycDto {
  status: KycStatus;
  fullName: string | null;
  panMasked: string | null;
  reviewNote: string | null;
}
