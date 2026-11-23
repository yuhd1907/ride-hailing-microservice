'use client';

import { useMapsLibrary } from '@vis.gl/react-google-maps';
import clsx from 'clsx';
import { Crosshair, Loader2, MapPin, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { MAPS_ENABLED } from '@/lib/maps';
import type { Point } from '@/lib/types';

interface Suggestion {
  id: string;
  main: string;
  secondary: string;
  prediction: google.maps.places.PlacePrediction;
}

/**
 * Ô nhập địa chỉ có gợi ý (Google Places API New — Autocomplete Data API).
 * Người dùng phải chọn một gợi ý thì mới có tọa độ để ghim lên bản đồ.
 */
export default function AddressInput({
  label,
  letter,
  color,
  value,
  placeholder,
  bias,
  onSelect,
  onClear,
  onUseMyLocation,
  locating,
  autoFocus,
}: {
  label: string;
  letter: string;
  color: string;
  value: Point | null;
  placeholder: string;
  bias?: Point | null;
  onSelect: (place: Point) => void;
  onClear: () => void;
  onUseMyLocation?: () => void;
  locating?: boolean;
  autoFocus?: boolean;
}) {
  const places = useMapsLibrary('places');
  const listId = useId();
  const [text, setText] = useState(value?.address ?? '');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [loading, setLoading] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState('');
  const tokenRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // Đồng bộ khi địa chỉ được đặt từ bên ngoài (GPS, kéo ghim).
  useEffect(() => {
    setText(value?.address ?? '');
  }, [value?.address]);

  useEffect(() => {
    const close = (e: MouseEvent) => boxRef.current && !boxRef.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  // Gợi ý theo từng ký tự gõ (có debounce); một phiên gợi ý dùng chung session token để tính phí theo phiên.
  useEffect(() => {
    if (!places || !open) return;
    const query = text.trim();
    if (query.length < 2 || query === value?.address) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      tokenRef.current ??= new places.AutocompleteSessionToken();
      setLoading(true);
      try {
        const { suggestions: result } = await places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input: query,
          sessionToken: tokenRef.current,
          includedRegionCodes: ['vn'],
          language: 'vi',
          region: 'vn',
          ...(bias ? { origin: { lat: bias.lat, lng: bias.lng }, locationBias: { center: { lat: bias.lat, lng: bias.lng }, radius: 30000 } } : {}),
        });
        if (cancelled) return;
        setSuggestions(
          result
            .map(s => s.placePrediction)
            .filter((p): p is google.maps.places.PlacePrediction => !!p)
            .map(p => ({ id: p.placeId, main: p.mainText?.text ?? p.text.text, secondary: p.secondaryText?.text ?? '', prediction: p })),
        );
        setHighlight(0);
        setSearched(query);
        setError(null);
      } catch {
        if (!cancelled) setError('Không tải được gợi ý địa chỉ. Kiểm tra API key đã bật Places API (New).');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [text, places, open, bias?.lat, bias?.lng, value?.address]); // eslint-disable-line react-hooks/exhaustive-deps

  async function choose(s: Suggestion) {
    setOpen(false);
    setResolving(true);
    setText(s.main);
    try {
      const place = s.prediction.toPlace();
      await place.fetchFields({ fields: ['location', 'formattedAddress', 'displayName'] });
      if (!place.location) throw new Error('no location');
      const name = place.displayName && !place.formattedAddress?.startsWith(place.displayName) ? `${place.displayName}, ${place.formattedAddress}` : place.formattedAddress;
      onSelect({
        lat: Number(place.location.lat().toFixed(6)),
        lng: Number(place.location.lng().toFixed(6)),
        address: (name ?? s.main).replace(/, Việt Nam$/, ''),
      });
      setError(null);
    } catch {
      setError('Không lấy được vị trí của địa chỉ này, hãy chọn địa chỉ khác.');
    } finally {
      tokenRef.current = null; // kết thúc phiên gợi ý
      setResolving(false);
    }
  }

  const showList = open && (suggestions.length > 0 || loading);

  return (
    <div ref={boxRef} className="relative">
      <div className={clsx('flex items-center gap-3 rounded-xl p-3 transition', open ? 'bg-slate-50 ring-2 ring-brand-500' : 'hover:bg-slate-50')}>
        <span className={clsx('flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white', color)}>{letter}</span>
        <div className="min-w-0 flex-1">
          <label htmlFor={`${listId}-input`} className="block text-xs font-medium text-slate-500">
            {label}
            {value && <span className="ml-2 text-emerald-600">· đã ghim</span>}
          </label>
          <input
            id={`${listId}-input`}
            value={text}
            disabled={!MAPS_ENABLED}
            autoFocus={autoFocus}
            autoComplete="off"
            role="combobox"
            aria-expanded={showList}
            aria-controls={`${listId}-list`}
            placeholder={MAPS_ENABLED ? placeholder : 'Chưa cấu hình Google Maps API key'}
            onFocus={() => setOpen(true)}
            onChange={e => {
              setText(e.target.value);
              setOpen(true);
              if (value) onClear(); // sửa địa chỉ thì bỏ ghim cũ, phải chọn lại
            }}
            onKeyDown={e => {
              if (!showList) return;
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setHighlight(h => Math.min(h + 1, suggestions.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setHighlight(h => Math.max(h - 1, 0));
              } else if (e.key === 'Enter' && suggestions[highlight]) {
                e.preventDefault();
                void choose(suggestions[highlight]);
              } else if (e.key === 'Escape') setOpen(false);
            }}
            className="w-full truncate bg-transparent text-sm font-medium text-slate-900 placeholder:font-normal placeholder:text-slate-400 focus:outline-none disabled:cursor-not-allowed"
          />
        </div>
        {(resolving || loading) && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
        {text && !resolving && (
          <button
            type="button"
            aria-label="Xóa địa chỉ"
            onClick={() => {
              setText('');
              setSuggestions([]);
              onClear();
            }}
            className="rounded-full p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
        {onUseMyLocation && MAPS_ENABLED && (
          <button type="button" onClick={onUseMyLocation} title="Dùng vị trí hiện tại" className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50">
            {locating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Crosshair className="h-3.5 w-3.5" />}
            <span className="hidden sm:inline">Vị trí của tôi</span>
          </button>
        )}
      </div>

      {showList && (
        <ul id={`${listId}-list`} role="listbox" className="absolute left-0 right-0 z-[1200] mt-1 max-h-80 overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
          {suggestions.map((s, i) => (
            <li
              key={s.id}
              role="option"
              aria-selected={i === highlight}
              onMouseEnter={() => setHighlight(i)}
              onMouseDown={e => {
                e.preventDefault();
                void choose(s);
              }}
              className={clsx('flex cursor-pointer items-start gap-3 px-4 py-2.5', i === highlight && 'bg-slate-50')}
            >
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-slate-900">{s.main}</div>
                {s.secondary && <div className="truncate text-xs text-slate-500">{s.secondary}</div>}
              </div>
            </li>
          ))}
          {loading && suggestions.length === 0 && <li className="px-4 py-3 text-sm text-slate-400">Đang tìm địa chỉ…</li>}
          <li className="border-t border-slate-100 px-4 pt-1.5 text-right text-[10px] text-slate-400">Gợi ý bởi Google</li>
        </ul>
      )}
      {open && !loading && suggestions.length === 0 && searched !== '' && searched === text.trim() && text !== value?.address && (
        <div className="absolute left-0 right-0 z-[1200] mt-1 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500 shadow-lg">Không tìm thấy địa chỉ phù hợp.</div>
      )}
      {error && <div className="mt-1 px-3 text-xs text-red-600">{error}</div>}
    </div>
  );
}
