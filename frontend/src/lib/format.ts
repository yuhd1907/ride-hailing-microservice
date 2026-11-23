export const vnd = (value: number | string | null | undefined) =>
  value === null || value === undefined || value === ''
    ? '—'
    : `${new Intl.NumberFormat('vi-VN').format(Number(value))} ₫`;

export const time = (value: string | number | null | undefined) => {
  if (value === null || value === undefined) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit', day: '2-digit', month: '2-digit' });
};

export const shortId = (id: string | null | undefined) => (id ? `${id.slice(0, 8)}…` : '—');

export const roleLabel = (roles: string[]) =>
  roles.includes('ROLE_DRIVER') ? 'Tài xế' : roles.includes('ROLE_PASSENGER') ? 'Hành khách' : roles.join(', ');

export const isDriver = (roles: string[] | undefined) => !!roles?.includes('ROLE_DRIVER');
export const isPassenger = (roles: string[] | undefined) => !!roles?.includes('ROLE_PASSENGER');
