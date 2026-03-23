import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import Header from './Header';

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(window.innerWidth >= 1024);
  const location = useLocation();

  // Airlines page manages its own padding (sticky bar needs to reach the very top)
  const isAirlines = location.pathname === '/admin/airlines';

  return (
    <div className="flex h-screen overflow-hidden bg-white">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <Sidebar open={sidebarOpen} setOpen={setSidebarOpen} />

      <div className="flex flex-col flex-1 overflow-hidden min-w-0">
        <Header sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} />
        <main className={`flex-1 overflow-y-auto bg-gray-50 ${isAirlines ? '' : 'p-4 sm:p-6'}`}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
