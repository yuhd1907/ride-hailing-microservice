import type { Metadata } from 'next';
import BookingClient from '@/components/site/BookingClient';
import { gateway, requireUser } from '@/lib/server/gateway';
import { OPEN_TRIP } from '@/lib/labels';
import type { FareRate, Trip } from '@/lib/types';

export const metadata: Metadata = { title: 'Đặt xe' };

export default async function PassengerHome({ searchParams }: { searchParams: { 'dat-lai'?: string; chieu?: string } }) {
  const user = requireUser('ROLE_PASSENGER');
  // Chuyến đang mở (nếu có) và bảng giá theo loại xe, đều lấy từ trip_db.
  const [recent, rates, previous] = await Promise.all([
    gateway<Trip[]>('/trips/me?limit=10'),
    gateway<FareRate[]>('/trips/fare-rates'),
    // "Đặt lại": lấy điểm đón/đến của chuyến cũ (Trip Service chỉ trả chuyến của chính khách).
    searchParams['dat-lai'] ? gateway<Trip>(`/trips/${encodeURIComponent(searchParams['dat-lai'])}`) : Promise.resolve(null),
  ]);
  const activeTrip = recent.data?.find(t => OPEN_TRIP.includes(t.status)) ?? null;
  const old = previous?.data ?? null;
  const reverse = searchParams.chieu === 've';
  return (
    <BookingClient
      firstName={(user.fullName ?? user.email).split(' ').slice(-1)[0]}
      activeTrip={activeTrip}
      rates={rates.data ?? []}
      loadError={recent.error ?? rates.error}
      initialPickup={old ? (reverse ? old.destination : old.pickup) : null}
      initialDestination={old ? (reverse ? old.pickup : old.destination) : null}
      initialVehicleType={old?.vehicleType ?? null}
    />
  );
}
