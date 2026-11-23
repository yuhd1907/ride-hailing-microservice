import Logo from './Logo';

export default function Footer() {
  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-8 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <Logo />
        <p>Dự án môn Hệ thống phân tán · Kiến trúc microservice: Gateway, Eureka, RabbitMQ, PostgreSQL, Redis.</p>
      </div>
    </footer>
  );
}
