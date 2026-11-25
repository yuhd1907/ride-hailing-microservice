import { BadgeDollarSign, Bike, Car, Clock3, MapPinned, ShieldCheck, Smartphone, Wallet } from 'lucide-react';
import Link from 'next/link';
import { currentUser } from '@/lib/server/gateway';
import { homeOf } from '@/lib/session';

const SERVICES = [
  { icon: Bike, name: 'Xe máy', text: 'Len lỏi giờ cao điểm, phù hợp đi một mình.' },
  { icon: Car, name: 'Ô tô 4 chỗ', text: 'Thoải mái cho gia đình nhỏ và đi công tác.' },
  { icon: Car, name: 'Ô tô 7 chỗ', text: 'Nhiều chỗ ngồi, chở thêm hành lý.' },
];

const STEPS = [
  { icon: MapPinned, title: 'Chọn điểm đón và điểm đến', text: 'Chạm lên bản đồ hoặc dùng vị trí hiện tại của bạn.' },
  { icon: BadgeDollarSign, title: 'Xem giá trước khi đặt', text: 'Giá cước do hệ thống tính theo quãng đường, không phát sinh khi lên xe.' },
  { icon: Clock3, title: 'Theo dõi tài xế', text: 'Hệ thống tự ghép tài xế gần nhất và cập nhật trạng thái chuyến liên tục.' },
  { icon: Wallet, title: 'Thanh toán tự động', text: 'Kết thúc chuyến, cước phí được thanh toán và bạn nhận thông báo ngay.' },
];

export default function HomePage() {
  const user = currentUser();
  const bookHref = user ? homeOf(user.role) : '/dang-nhap?next=/khach-hang';

  return (
    <main>
      <section className="relative overflow-hidden bg-black text-white">
        <div className="mx-auto grid max-w-7xl gap-12 px-4 py-20 sm:px-6 lg:grid-cols-2 lg:py-28">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-brand-100 ring-1 ring-white/20">
              <ShieldCheck className="h-3.5 w-3.5" /> Tài xế xác thực · Giá minh bạch
            </span>
            <h1 className="mt-6 text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
              Đặt xe trong vài giây,
              <br />
              <span className="text-brand-100">biết giá trước khi đi.</span>
            </h1>
            <p className="mt-5 max-w-xl text-lg text-slate-300">
              Gogo kết nối bạn với tài xế gần nhất. Mỗi tài xế chỉ nhận một chuyến tại một thời điểm, nên chuyến của bạn luôn được giữ đúng người.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href={bookHref} className="rounded-xl bg-white px-6 py-3 text-sm font-semibold text-slate-900 shadow hover:bg-brand-50">
                {user?.role === 'ROLE_DRIVER' ? 'Vào bảng điều khiển tài xế' : 'Đặt xe ngay'}
              </Link>
              {!user && (
                <Link href="/dang-ky?vai-tro=tai-xe" className="rounded-xl px-6 py-3 text-sm font-semibold text-white ring-1 ring-white/30 hover:bg-white/10">
                  Đăng ký làm tài xế
                </Link>
              )}
            </div>
          </div>
          <div className="hidden items-center justify-center lg:flex">
            <div className="w-full max-w-md rounded-3xl bg-white/5 p-6 ring-1 ring-white/15 backdrop-blur">
              <div className="space-y-3">
                <div className="flex items-center gap-3 rounded-2xl bg-white p-4 text-slate-900">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white">A</span>
                  <div>
                    <div className="text-xs text-slate-500">Điểm đón</div>
                    <div className="text-sm font-medium">Vị trí hiện tại của bạn</div>
                  </div>
                </div>
                <div className="flex items-center gap-3 rounded-2xl bg-white p-4 text-slate-900">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-rose-600 text-sm font-bold text-white">B</span>
                  <div>
                    <div className="text-xs text-slate-500">Điểm đến</div>
                    <div className="text-sm font-medium">Chọn trên bản đồ</div>
                  </div>
                </div>
                <div className="flex items-center justify-between rounded-2xl bg-neutral-800 p-4">
                  <div>
                    <div className="text-xs text-brand-100">Giá cước</div>
                    <div className="text-lg font-bold">Hiển thị trước khi đặt</div>
                  </div>
                  <Smartphone className="h-8 w-8 text-brand-100" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="dich-vu" className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
        <h2 className="text-2xl font-bold text-slate-900">Dịch vụ</h2>
        <p className="mt-2 text-slate-500">Chọn loại xe phù hợp; tài xế được ghép theo vị trí thực tế.</p>
        <div className="mt-8 grid gap-6 md:grid-cols-3">
          {SERVICES.map(s => (
            <div key={s.name} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <s.icon className="h-8 w-8 text-brand-600" />
              <div className="mt-4 text-lg font-semibold text-slate-900">{s.name}</div>
              <p className="mt-1 text-sm text-slate-500">{s.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="cach-dat-xe" className="border-y border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
          <h2 className="text-2xl font-bold text-slate-900">Đặt xe chỉ với 4 bước</h2>
          <div className="mt-8 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s, i) => (
              <div key={s.title}>
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                    <s.icon className="h-5 w-5" />
                  </span>
                  <span className="text-sm font-semibold text-slate-400">Bước {i + 1}</span>
                </div>
                <div className="mt-4 font-semibold text-slate-900">{s.title}</div>
                <p className="mt-1 text-sm text-slate-500">{s.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="tai-xe" className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
        <div className="flex flex-col items-start justify-between gap-6 rounded-3xl bg-black p-10 text-white md:flex-row md:items-center">
          <div>
            <h2 className="text-2xl font-bold">Lái xe cùng Gogo</h2>
            <p className="mt-2 max-w-xl text-slate-300">Tự chọn giờ làm, bật nhận cuốc khi sẵn sàng, xem thu nhập theo từng chuyến đã hoàn thành.</p>
          </div>
          <Link href={user ? homeOf(user.role) : '/dang-ky?vai-tro=tai-xe'} className="rounded-xl bg-white px-6 py-3 text-sm font-semibold text-black hover:bg-neutral-200">
            {user ? 'Vào tài khoản' : 'Đăng ký tài xế'}
          </Link>
        </div>
      </section>
    </main>
  );
}
