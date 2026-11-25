import type { Metadata } from 'next';
import { Container, ErrorState, PageTitle } from '@/components/site/Blocks';
import DriverWallet from '@/components/site/DriverWallet';
import { gateway, requireUser } from '@/lib/server/gateway';
import type { BankAccount, BankTransaction, WalletPolicy } from '@/lib/types';

export const metadata: Metadata = { title: 'Ví tài xế' };

export default async function DriverWalletPage() {
  requireUser('ROLE_DRIVER');
  // Ví nằm trong ngân hàng ảo của Payment Service (payment_db).
  const [account, transactions, policy] = await Promise.all([
    gateway<BankAccount>('/payments/bank/me'),
    gateway<BankTransaction[]>('/payments/bank/me/transactions?limit=50'),
    gateway<WalletPolicy>('/payments/bank/policy'),
  ]);
  return (
    <Container>
      <PageTitle title="Ví tài xế" subtitle="Nhận tiền chuyến, trừ chiết khấu nền tảng, nạp và rút tiền về ngân hàng liên kết" />
      {account.error && <ErrorState message={account.error} />}
      <DriverWallet initialAccount={account.data} initialTransactions={transactions.data ?? []} policy={policy.data} />
    </Container>
  );
}
