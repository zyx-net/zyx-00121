import { NavLink, Outlet } from "react-router-dom";
import {
  LayoutDashboard,
  Settings2,
  FileUp,
  ClipboardCheck,
  History,
  FileBarChart2,
  Activity,
  Database,
} from "lucide-react";

const navItems = [
  { to: "/", label: "仪表盘", icon: LayoutDashboard, end: true },
  { to: "/rules", label: "规则配置", icon: Settings2 },
  { to: "/import", label: "数据导入", icon: FileUp },
  { to: "/precheck", label: "导入预检工作台", icon: Database },
  { to: "/history", label: "历史记录", icon: History },
];

export function Layout() {
  return (
    <div className="min-h-screen bg-industrial-50 flex">
      <aside className="w-60 bg-industrial-900 text-white flex flex-col">
        <div className="px-5 py-5 border-b border-industrial-700/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary-600 flex items-center justify-center shadow-lg">
              <Activity size={22} />
            </div>
            <div>
              <h1 className="text-base font-bold tracking-wide">传感器质检</h1>
              <p className="text-xs text-industrial-400">QA Analysis Tool</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-all ${
                    isActive
                      ? "bg-primary-600 text-white shadow-md shadow-primary-900/30"
                      : "text-industrial-300 hover:text-white hover:bg-industrial-800"
                  }`
                }
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        <div className="px-4 py-3 border-t border-industrial-700/50 text-xs text-industrial-500">
          <p>数据保存在本地浏览器</p>
          <p className="mt-1">v1.0.0</p>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 bg-white border-b border-industrial-200 flex items-center justify-between px-6">
          <h2 className="text-sm font-semibold text-industrial-700">
            车间传感器质检分析工具
          </h2>
          <div className="flex items-center gap-2 text-xs text-industrial-500">
            <FileBarChart2 size={14} />
            <span>本地离线模式</span>
          </div>
        </header>
        <main className="flex-1 overflow-auto p-6">
          <div className="animate-fade-in">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
