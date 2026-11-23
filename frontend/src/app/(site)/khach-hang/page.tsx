import type { Metadata } from 'next';
import BookingClient from '@/components/site/BookingClient';
import { gateway, requireUser } from '@/lib/server/gateway';
import { OPEN_TRIP } from '@/lib/labels';
import type { FareRate, Trip } from '@/lib/types';

export const metadata: Metadata = { title: 'Đặt xe' };

export default async function PassengerHome() {
  const user = requireUser('ROLE_PASSENGER');
  // Chuyến đang mở (nếu có) và bảng giá theo loại xe, đều lấy từ trip_db.
  const [recent, rates] = await Promise.all([gateway<Trip[]>('/trips/me?limit=10'), gateway<FareRate[]>('/trips/fare-rates')]);
  const activeTrip = recent.data?.find(t => OPEN_TRIP.includes(t.status)) ?? null;
  return (
    <BookingClient
      firstName={(user.fullName ?? user.email).split(' ').slice(-1)[0]}
      activeTrip={activeTrip}
      rates={rates.data ?? []}
      loadError={recent.error ?? rates.error}
    />
  );
}
